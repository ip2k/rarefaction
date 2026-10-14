// `orient`: everything an agent needs to start working on one symbol, in one
// call — signature and doc, the body, who calls it, what it calls, who
// implements it, which tests reach it, and the set of files that can matter.

import * as z from "zod/v4";
import type { Location, LocationLink, Position, Range } from "vscode-languageserver-protocol";
import { listSourceFiles } from "../fs.js";
import { itemKey, walkCalls, type WalkNode } from "../graph/walk.js";
import { parseSymbolQuery, enclosingSymbol, ResolveError, resolveSymbol, uriToRel } from "../graph/symbols.js";
import type { Session } from "../session.js";

export const OrientInput = z.object({
  symbol: z
    .string()
    .min(1)
    .describe(
      'A function, method, type or property: "updateLocation", "Engine.updateLocation", ' +
        'or an exact position "Sources/Engine.swift:204:10" (1-based line:column, on the name).',
    ),
  up: z
    .number()
    .int()
    .min(0)
    .max(4)
    .default(2)
    .describe("How many levels of callers to walk (default 2: test cases usually sit one helper above the code they exercise)."),
  down: z.number().int().min(0).max(3).default(1).describe("How many levels of callees to walk (default 1)."),
  max_nodes: z.number().int().min(1).max(200).default(50).describe("Maximum graph nodes per direction and reference contexts; lower it for compact answers."),
  include_body: z.boolean().default(true).describe("Include the symbol's source body."),
  max_body_lines: z.number().int().min(0).max(400).default(80).describe("Truncate the body after this many lines."),
});
export type OrientInputType = z.infer<typeof OrientInput>;

const Ref = z.object({
  name: z.string(),
  file: z.string().describe("Path relative to the project root."),
  line: z.number().int().describe("1-based line of the declaration."),
  depth: z.number().int().describe("1 = directly connected to the symbol."),
  call_sites: z.array(z.number().int()).describe("1-based lines where the call happens."),
});

export const OrientOutput = z.object({
  profile: z.string().optional(),
  root: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  symbol: z.object({
    name: z.string(),
    file: z.string(),
    line: z.number().int(),
    column: z.number().int(),
    callable: z.boolean().describe("Whether this symbol is a callable declaration. References are used when call hierarchy is unavailable."),
    signature: z.string().optional(),
    doc: z.string().optional(),
  }),
  body: z
    .object({
      start_line: z.number().int(),
      end_line: z.number().int(),
      text: z.string(),
      truncated: z.boolean(),
    })
    .optional(),
  callers: z.array(Ref.extend({ is_test_file: z.boolean(), is_test_case: z.boolean() })),
  callees: z.array(Ref),
  external_callees_omitted: z.number().int().describe("SDK / package callees dropped from `callees`."),
  references: z
    .array(z.object({ file: z.string(), count: z.number().int() }))
    .optional()
    .describe("For non-callables or servers without hierarchy: references grouped by file."),
  reference_contexts: z.array(z.object({ name: z.string(), file: z.string(), line: z.number().int(), is_test_case: z.boolean() })).optional(),
  implementations: z.array(z.object({ file: z.string(), line: z.number().int() })),
  type_hierarchy: z
    .object({
      supertypes: z.array(z.object({ name: z.string(), file: z.string(), line: z.number().int() })),
      subtypes: z.array(z.object({ name: z.string(), file: z.string(), line: z.number().int() })),
    })
    .optional(),
  tests: z.array(z.object({ name: z.string(), file: z.string(), line: z.number().int(), depth: z.number().int(), is_test_case: z.boolean() })),
  test_run_hint: z.object({ command: z.string(), note: z.string().optional() }).optional(),
  live_files: z.array(z.string()).describe("Files that can affect or be affected by the symbol within the walked depth."),
  project_source_files: z.number().int(),
  freshness: z.object({
    model: z.enum(["on-build", "on-open"]),
    stale: z.boolean(),
    indexed_at: z.string().optional(),
    newest_source_at: z.string().optional(),
    advice: z.string().optional(),
  }),
  truncated: z.boolean(),
  stats: z.object({ lsp_requests: z.number().int(), ms: z.number().int(), cold_start: z.boolean() }),
});
export type OrientOutputType = z.infer<typeof OrientOutput>;

function toLocations(x: Location | Location[] | LocationLink[] | null): { uri: string; range: Range }[] {
  if (!x) return [];
  const arr = Array.isArray(x) ? x : [x];
  return arr.map((l) => ("targetUri" in l ? { uri: l.targetUri, range: l.targetSelectionRange } : l));
}

/** Split a hover's markdown into the first fenced code block (signature) and the rest (doc). */
function splitHover(value: string): { signature?: string; doc?: string } {
  const m = /```[\w-]*\n([\s\S]*?)```\s*([\s\S]*)$/.exec(value);
  if (!m) return value.trim() ? { doc: value.trim() } : {};
  const signature = m[1]?.trim();
  const doc = m[2]?.trim();
  return { ...(signature ? { signature } : {}), ...(doc ? { doc } : {}) };
}

export async function orient(session: Session, input: OrientInputType): Promise<OrientOutputType> {
  const t0 = Date.now();
  const nodeLimit = input.max_nodes ?? 50;
  const detection = await session.detection();
  if (!detection.ok) {
    throw new ResolveError(
      `This project is not ready for ${session.profile.displayName}:\n` +
        detection.advice.map((a) => `  ${a}`).join("\n") +
        "\nCall `status` for details.",
    );
  }
  const coldStart = !session.started;
  const client = await session.lsp();
  await session.syncSources(client);
  const requestsBefore = client.stats.requests;
  const { profile, rootPath } = session;
  const isExternal = (uri: string) => profile.isExternal(uri, rootPath);

  const resolved = await resolveSymbol(client, profile, rootPath, parseSymbolQuery(input.symbol));
  const { uri, position } = resolved;
  // Some servers begin background indexing only after the first document opens.
  if (coldStart || client.indexing) await client.waitForIndexing({ startGraceMs: 500 });
  const live = new Set<string>([resolved.relPath]);

  // Signature and doc.
  const hover = await client.hover(uri, position);
  const hoverText =
    hover && typeof hover.contents === "object" && "value" in hover.contents
      ? hover.contents.value
      : typeof hover?.contents === "string"
        ? hover.contents
        : "";
  const { signature, doc } = splitHover(hoverText);

  // Body: documentSymbol's range covers the whole declaration. The
  // call-hierarchy item's range is only the signature line on some servers
  // (sourcekit-lsp), so it is the fallback, then the definition's range.
  let body: OrientOutputType["body"];
  if (input.include_body) {
    let range: Range | undefined = resolved.range ?? resolved.item?.range;
    if (!range) {
      const defs = toLocations(await client.definition(uri, position)).filter((d) => d.uri === uri);
      range = defs[0]?.range;
    }
    if (range) {
      const lines = (await session.text(uri)).split("\n");
      const all = lines.slice(range.start.line, range.end.line + 1);
      const truncated = all.length > input.max_body_lines;
      body = {
        start_line: range.start.line + 1,
        end_line: range.end.line + 1,
        text: (truncated ? all.slice(0, input.max_body_lines) : all).join("\n"),
        truncated,
      };
    }
  }

  // Callers / callees, or references for a non-callable.
  let callers: OrientOutputType["callers"] = [];
  let callees: OrientOutputType["callees"] = [];
  let externalCalleesOmitted = 0;
  let truncated = false;
  let references: OrientOutputType["references"];
  const referenceContexts: NonNullable<OrientOutputType["reference_contexts"]> = [];
  if (resolved.item && client.support.callHierarchy) {
    const walk = await walkCalls(client, resolved.item, { up: input.up, down: input.down, isExternal, maxNodes: nodeLimit });
    truncated = walk.truncated;
    externalCalleesOmitted = walk.externalCalleesOmitted;
    callers = await Promise.all(walk.callers.map((n) => describeCaller(session, n)));
    callees = walk.callees.map((n) => describeNode(rootPath, n));
    for (const n of [...walk.callers, ...walk.callees]) live.add(uriToRel(n.item.uri, rootPath));
  } else {
    const byFile = new Map<string, number>();
    const contexts = new Set<string>();
    const refs = ((await client.references(uri, position)) ?? []).filter(r => !isExternal(r.uri));
    if (refs.length > nodeLimit) truncated = true;
    for (const r of refs.slice(0, nodeLimit)) {
      const rel = uriToRel(r.uri, rootPath);
      byFile.set(rel, (byFile.get(rel) ?? 0) + 1);
      live.add(rel);
      const enclosing = await enclosingSymbol(client, r.uri, r.range.start);
      if (!enclosing) continue;
      const key = `${rel}:${enclosing.line}`;
      if (contexts.has(key)) continue;
      contexts.add(key);
      const lines = (await session.text(r.uri)).split("\n");
      referenceContexts.push({ ...enclosing, file: rel, is_test_case: profile.isTestCase(enclosing.name, lines[enclosing.line - 2]) });
    }
    references = [...byFile.entries()].sort().map(([file, count]) => ({ file, count }));
  }

  // Who implements it (protocol requirements → conformers, overridable → overrides).
  const implementations: OrientOutputType["implementations"] = [];
  if (client.support.implementation) {
    for (const l of toLocations(await client.implementation(uri, position))) {
      if (isExternal(l.uri)) continue;
      const rel = uriToRel(l.uri, rootPath);
      if (implementations.length >= nodeLimit) { truncated = true; break; }
      implementations.push({ file: rel, line: l.range.start.line + 1 });
      live.add(rel);
    }
  }

  // Type hierarchy, when the symbol is itself a type.
  let typeHierarchy: OrientOutputType["type_hierarchy"];
  if (client.support.typeHierarchy) {
    const items = (await client.prepareTypeHierarchy(uri, position)) ?? [];
    const item = items[0];
    if (item) {
      const describe = (t: { name: string; uri: string; selectionRange: Range }) => ({
        name: t.name,
        file: uriToRel(t.uri, rootPath),
        line: t.selectionRange.start.line + 1,
      });
      const supers = ((await client.supertypes(item)) ?? []).filter((t) => !isExternal(t.uri));
      const subs = ((await client.subtypes(item)) ?? []).filter((t) => !isExternal(t.uri));
      if (supers.length > nodeLimit || subs.length > nodeLimit) truncated = true;
      const supertypes = supers.slice(0, nodeLimit).map(describe);
      const subtypes = subs.slice(0, nodeLimit).map(describe);
      for (const t of [...supertypes, ...subtypes]) live.add(t.file);
      typeHierarchy = { supertypes, subtypes };
    }
  }

  const tests = callers
    .filter((c) => c.is_test_file)
    .map((c) => ({ name: c.name, file: c.file, line: c.line, depth: c.depth, is_test_case: c.is_test_case }));
  for (const context of referenceContexts.filter(c => c.is_test_case)) {
    tests.push({ ...context, depth: 1 });
  }
  // Only real test cases make a runnable selection; helpers live in types the
  // test runner cannot be pointed at.
  const cases = tests.filter((t) => t.is_test_case);
  const testRunHint = cases.length ? profile.testRunHint(cases.map((t) => ({ name: t.name, relPath: t.file }))) : undefined;

  const fresh = await profile.freshness(rootPath);
  const projectSourceFiles = (await listSourceFiles(rootPath, profile.extensions)).length;

  return {
    profile: profile.id, root: rootPath,
    warnings: [...detection.advice, ...(client.indexing ? ["Language server is still indexing; graph coverage may be incomplete."] : []), ...(!client.support.callHierarchy ? ["Call hierarchy unavailable; references do not establish caller/callee relationships."] : []), ...(client.unimplemented.size ? [`Language server does not implement ${[...client.unimplemented].join(", ")}; those results are omitted.`] : [])],
    symbol: {
      name: resolved.name,
      file: resolved.relPath,
      line: position.line + 1,
      column: position.character + 1,
      callable: Boolean(resolved.item) || [6, 9, 12].includes(resolved.kind ?? 0),
      ...(signature ? { signature } : {}),
      ...(doc ? { doc } : {}),
    },
    ...(body ? { body } : {}),
    callers,
    callees,
    external_callees_omitted: externalCalleesOmitted,
    ...(references ? { references, reference_contexts: referenceContexts } : {}),
    implementations,
    ...(typeHierarchy ? { type_hierarchy: typeHierarchy } : {}),
    tests,
    ...(testRunHint ? { test_run_hint: testRunHint } : {}),
    live_files: [...live].sort(),
    project_source_files: projectSourceFiles,
    freshness: {
      model: fresh.model,
      stale: fresh.stale,
      ...(fresh.indexedAt ? { indexed_at: fresh.indexedAt.toISOString() } : {}),
      ...(fresh.newestSourceAt ? { newest_source_at: fresh.newestSourceAt.toISOString() } : {}),
      ...(fresh.advice ? { advice: fresh.advice } : {}),
    },
    truncated,
    stats: { lsp_requests: client.stats.requests - requestsBefore, ms: Date.now() - t0, cold_start: coldStart },
  };
}

function describeNode(rootPath: string, n: WalkNode) {
  return {
    name: n.item.name,
    file: uriToRel(n.item.uri, rootPath),
    line: n.item.selectionRange.start.line + 1,
    depth: n.depth,
    call_sites: n.callSiteLines,
  };
}

async function describeCaller(session: Session, n: WalkNode) {
  const base = describeNode(session.rootPath, n);
  let isTestFile = session.profile.isTestFile(base.file);
  let isTestCase = false;
  {
    const lines = (await session.text(n.item.uri)).split("\n");
    const above = n.item.selectionRange.start.line > 0 ? lines[n.item.selectionRange.start.line - 1] : undefined;
    isTestCase = session.profile.isTestCase(n.item.name, above);
    isTestFile ||= isTestCase;
  }
  return { ...base, is_test_file: isTestFile, is_test_case: isTestCase };
}

export { itemKey, type Position };
