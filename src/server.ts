import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ResolveError } from "./graph/symbols.js";
import { renderOrient } from "./render.js";
import { orient, OrientInput, OrientOutput } from "./tools/orient.js";
import { renderScope, scope, ScopeInput, ScopeOutput } from "./tools/scope.js";
import { ProfileId, type Workspace } from "./workspace.js";

export const SERVER_NAME = "rarefaction";
// Read from package.json so the reported version cannot drift from the published one.
// src/ and dist/ both sit one level below the package root, and npm always ships package.json.
export const SERVER_VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const selection = { profile: ProfileId.optional().describe("Source-language profile; required for bare names in mixed workspaces."),
  project: z.string().optional().describe("Workspace-relative project directory, e.g. tools/driver for a nested Cargo package. Without it, a path:line:column symbol is answered from its enclosing Cargo workspace, else from its nearest project marker (a warning says when that leaves part of the workspace out).") };
const StatusOutput = z.object({
  root: z.string(), profiles: z.array(z.object({ id: z.string(), root: z.string(), profile: z.string(), ok: z.boolean(),
    facts: z.array(z.string()), advice: z.array(z.string()), language_server_started: z.boolean(),
    support: z.object({ callHierarchy: z.boolean(), typeHierarchy: z.boolean(), implementation: z.boolean(), references: z.boolean() }).optional(),
    freshness: z.object({ model: z.enum(["on-build", "on-open"]), stale: z.boolean(), advice: z.string().optional() }),
  })),
});

export function createServer(workspace: Workspace): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  server.registerTool("orient", {
    title: "Orient on a symbol",
    description: "Compact source context from language-server indexes: signature, body, callers, callees, tests, implementations and relevant files. Use before broad file reads in Swift, Rust, C/C++, TypeScript/JavaScript, Python and WebAssembly WAT projects. In mixed workspaces specify profile or use path:line:column. No cross-language/FFI edges are inferred. Increase up/down only when needed.",
    inputSchema: OrientInput.extend(selection), outputSchema: OrientOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async input => {
    try {
      const { session, warnings } = await workspace.route(input);
      const result = await orient(session, { ...input, symbol: workspace.symbolFor(session, input.symbol) });
      if (warnings.length) result.warnings = [...warnings, ...result.warnings ?? []];
      return { content: [{ type: "text", text: renderOrient(result) }], structuredContent: result };
    } catch (err) {
      if (err instanceof ResolveError) return { content: [{ type: "text", text: err.message }], isError: true };
      throw err;
    }
  });
  server.registerTool("scope", {
    title: "Working set for a change",
    description: "The files a change to one symbol is likely to touch: orient's call-graph files (callers, callees, implementations, tests) plus files that have historically changed in the same commits as the symbol's file, each with its reason. Use when planning an edit, to know which files to read and check. Advisory, not a boundary: real changes often touch files outside it.",
    inputSchema: ScopeInput.extend(selection), outputSchema: ScopeOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async input => {
    try {
      const { session, warnings } = await workspace.route(input);
      const result = await scope(session, { ...input, symbol: workspace.symbolFor(session, input.symbol) });
      result.warnings.unshift(...warnings);
      return { content: [{ type: "text", text: renderScope(result) }], structuredContent: result };
    } catch (err) {
      if (err instanceof ResolveError) return { content: [{ type: "text", text: err.message }], isError: true };
      throw err;
    }
  });
  server.registerTool("status", {
    title: "Project, language server and index status",
    description: "Check detected source-language profiles, project roots, executables, compile flags and freshness. Call once before orient in a new project or when orientation is incomplete. Pass profile/project to inspect a nested package.",
    inputSchema: z.object(selection), outputSchema: StatusOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async input => {
    try {
      const sessions = input.profile || workspace.forcedProfile ? [await workspace.select(input)] : await workspace.inventory(input.project);
      const entries = await Promise.all(sessions.map(async session => {
        const detection = await session.detection();
        const advice = [...detection.advice]; const facts = [...detection.facts]; let ok = detection.ok;
        try { const launch = await session.profile.launch(session.rootPath); facts.push(`language server: ${launch.command}`); }
        catch (err) { ok = false; advice.push((err as Error).message); }
        const fresh = await session.profile.freshness(session.rootPath);
        return { id: session.profile.id, root: session.rootPath, profile: session.profile.displayName, ok,
          facts, advice, language_server_started: session.started,
          ...(session.started ? { support: (await session.lsp()).support } : {}),
          freshness: { model: fresh.model, stale: fresh.stale, ...(fresh.advice ? { advice: fresh.advice } : {}) } };
      }));
      const result = { root: workspace.rootPath, profiles: entries };
      const lines = [`workspace: ${result.root}`, ...entries.flatMap(p => [
        `${p.id}: ${p.ok ? "ready" : "NOT READY"} — ${p.root}`, ...p.facts.map(f => `  ${f}`),
        ...p.advice.map(a => `  advice: ${a}`), `  index: ${p.freshness.model}${p.freshness.stale ? " — STALE" : ""}`,
        ...(p.support ? [`  supports: ${Object.entries(p.support).filter(([,v]) => v).map(([k]) => k).join(", ")}`] : []),
      ])];
      if (!entries.length) lines.push("No supported project detected; pass profile and project to inspect a nested package.");
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: result };
    } catch (err) {
      if (err instanceof ResolveError) return { content: [{ type: "text", text: err.message }], isError: true };
      throw err;
    }
  });
  return server;
}
