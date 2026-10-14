// Turn what an agent types — "updateLocation", "Engine.updateLocation",
// or "path/File.swift:204:10" — into a precise position and, when the symbol is
// callable, a CallHierarchyItem the walk can start from.

import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  CallHierarchyItem,
  DocumentSymbol,
  Position,
  Range,
  SymbolInformation,
  WorkspaceSymbol,
} from "vscode-languageserver-protocol";
import { canonicalPath, listSourceFiles } from "../fs.js";
import type { LspClient } from "../lsp/client.js";
import type { Profile } from "../profiles/profile.js";

export type SymbolQuery =
  | { kind: "position"; file: string; line: number; character: number } // 1-based, as an editor shows them
  | { kind: "name"; name: string; container?: string };

export interface ResolvedSymbol {
  uri: string;
  relPath: string;
  /** 0-based, as LSP wants it. */
  position: Position;
  name: string;
  kind?: number;
  /** Present when the symbol is callable (function, method, initializer). */
  item?: CallHierarchyItem;
  /** The whole declaration, when documentSymbol could locate it. */
  range?: Range;
}

export class ResolveError extends Error {
  constructor(
    message: string,
    readonly candidates: { name: string; relPath: string; line: number; character: number }[] = [],
    readonly suggestions: string[] = [],
  ) {
    super(message);
  }
}

const POSITION_RE = /^(.+?):(\d+):(\d+)$/;

export function parseSymbolQuery(input: string): SymbolQuery {
  const trimmed = input.trim();
  const m = POSITION_RE.exec(trimmed);
  if (m) {
    return { kind: "position", file: m[1]!, line: Number(m[2]), character: Number(m[3]) };
  }
  // Drop a trailing argument list — "update(_:)" and "update" name the same thing.
  const bare = trimmed.replace(/\(.*\)$/, "").replace(/::/g, ".");
  const dot = bare.lastIndexOf(".");
  if (dot > 0) return { kind: "name", name: bare.slice(dot + 1), container: bare.slice(0, dot) };
  return { kind: "name", name: bare };
}

/** "updateLocation(_:)" → "updateLocation"; "init(x:y:)" → "init". */
export function bareName(lspName: string): string {
  const withoutArgs = lspName.replace(/\(.*\)$/, "");
  return (withoutArgs.replace(/::/g, ".").split(".").pop() ?? withoutArgs).replace(/^\$/, "");
}

function locationOf(s: SymbolInformation | WorkspaceSymbol): { uri: string; start?: Position } {
  const loc = s.location;
  return "range" in loc ? { uri: loc.uri, start: loc.range.start } : { uri: loc.uri };
}

function flatten(symbols: DocumentSymbol[], out: DocumentSymbol[] = []): DocumentSymbol[] {
  for (const s of symbols) {
    out.push(s);
    if (s.children) flatten(s.children, out);
  }
  return out;
}

function contains(range: { start: Position; end: Position }, p: Position): boolean {
  const after = p.line > range.start.line || (p.line === range.start.line && p.character >= range.start.character);
  const before = p.line < range.end.line || (p.line === range.end.line && p.character <= range.end.character);
  return after && before;
}

/**
 * Locate the declaration via documentSymbol. Two things only it gives us:
 * `selectionRange` (the name — where call-hierarchy requests want the cursor;
 * servers otherwise report ranges from the first keyword) and `range` (the
 * whole declaration, which is what a body excerpt needs).
 */
async function findDeclaration(
  client: LspClient,
  uri: string,
  near: Position,
  name?: string,
): Promise<{ position: Position; range?: Range; kind?: number }> {
  const syms = await client.documentSymbols(uri);
  const first = syms?.[0];
  if (!first || !("selectionRange" in first)) return { position: near };
  const all = flatten(syms as DocumentSymbol[]);
  let hit: DocumentSymbol | undefined;
  if (name) {
    hit = all.find((s) => bareName(s.name) === name && contains(s.range, near)) ?? all.find((s) => bareName(s.name) === name);
  } else {
    // A position query: the innermost symbol whose name sits at that position.
    const candidates = all.filter((s) => contains(s.selectionRange, near));
    hit = candidates[candidates.length - 1];
  }
  return hit ? { position: hit.selectionRange.start, range: hit.range, kind: hit.kind } : { position: near };
}

/** Innermost callable enclosing a reference; this does not prove a call edge. */
export async function enclosingSymbol(client: LspClient, uri: string, position: Position): Promise<{ name: string; line: number } | undefined> {
  await client.open(fileURLToPath(uri));
  const symbols = await client.documentSymbols(uri);
  if (!symbols?.length || !("selectionRange" in symbols[0]!)) return undefined;
  const candidates = flatten(symbols as DocumentSymbol[]).filter(s => [6, 9, 12].includes(s.kind) && contains(s.range, position));
  const found = candidates[candidates.length - 1];
  return found ? { name: found.name, line: found.selectionRange.start.line + 1 } : undefined;
}

export async function resolveSymbol(
  client: LspClient,
  profile: Profile,
  rootPath: string,
  query: SymbolQuery,
): Promise<ResolvedSymbol> {
  if (query.kind === "position") {
    const file = isAbsolute(query.file) ? query.file : resolve(rootPath, query.file);
    const uri = await client.open(file);
    const given = { line: query.line - 1, character: query.character - 1 };
    const { position, range, kind } = await findDeclaration(client, uri, given);
    const items = (await client.prepareCallHierarchy(uri, position)) ?? [];
    const item = items[0];
    return {
      uri,
      relPath: uriToRel(uri, rootPath),
      position,
      name: item?.name ?? `${relative(rootPath, file)}:${query.line}:${query.character}`,
      ...(item ? { item } : {}),
      ...(range ? { range } : {}),
    ...(kind ? { kind } : {}),
    };
  }

  // TypeScript needs an open file to load the configured project. WAT servers
  // may have no workspace-symbol index, so fall back to document symbols.
  const sources = (await listSourceFiles(rootPath, profile.extensions)).filter(f => !profile.isExternal(pathToFileURL(f.path).href, rootPath));
  if (await profile.needsSourceScan?.(rootPath)) {
    for (const source of sources.slice(0, 200)) {
      const uri = await client.open(source.path);
      await client.documentSymbols(uri); // wait for the AST, not just didOpen
    }
  } else if (sources[0]) await client.open(sources[0].path);
  let raw = (await client.workspaceSymbols(query.name)) ?? [];
  let scanLimited = false;
  if (!raw.some(s => bareName(s.name) === bareName(query.name) && !profile.isExternal(locationOf(s).uri, rootPath))) {
    scanLimited = sources.length > 200;
    const scanned: SymbolInformation[] = [];
    for (const file of sources.slice(0, 200)) {
      const uri = await client.open(file.path);
      const symbols = (await client.documentSymbols(uri)) ?? [];
      function add(symbols: (DocumentSymbol | SymbolInformation)[], container = "") {
        for (const s of symbols) {
          if ("selectionRange" in s) {
            scanned.push({ name: s.name, kind: s.kind, location: { uri, range: s.selectionRange }, containerName: container });
            if (s.children) add(s.children, container ? `${container}.${s.name}` : s.name);
          } else scanned.push(s);
        }
      }
      add(symbols);
    }
    raw = [...raw, ...scanned];
  }
  const inProject = raw.filter((s) => !profile.isExternal(locationOf(s).uri, rootPath));
  const seen = new Set<string>();
  let matches = inProject.filter((s) => {
    if (bareName(s.name) !== bareName(query.name)) return false;
    if (query.container) {
      const container = (s.containerName ?? "").replace(/::/g, ".");
      const qualified = s.name.replace(/::/g, ".").startsWith(`${query.container}.`);
      if (!qualified && bareName(container) !== query.container && !container.endsWith(`.${query.container}`)) {
        return false;
      }
    }
    const { uri, start } = locationOf(s);
    const key = `${uri}#${start?.line ?? -1}:${start?.character ?? -1}`;
    if (seen.has(key)) return false; // servers often report a symbol twice
    seen.add(key);
    return true;
  });

  if (matches.length === 0) {
    const suggestions = [...new Set(inProject.map((s) => s.name))].slice(0, 8);
    throw new ResolveError(
      `No symbol named "${query.container ? `${query.container}.` : ""}${query.name}" in the project.` +
        (suggestions.length ? ` Similar names: ${suggestions.join(", ")}.` : "") +
        ` You can also pass an exact position as path/File:line:column.${scanLimited ? " Document fallback searched only 200 files; use an exact position or a narrower project." : ""}`,
      [],
      suggestions,
    );
  }

  // Definitions can point from a header to its body and from the body back
  // to the header. Collapse connected declarations, keeping the fullest
  // document-symbol range. Distinct overloads remain distinct components.
  if (profile.collapseDeclarations && matches.length > 1 && client.capabilities.definitionProvider) {
    const groups: { keys: Set<string>; symbol: SymbolInformation | WorkspaceSymbol; size: number }[] = [];
    for (const match of matches) {
      const location = locationOf(match);
      await client.open(fileURLToPath(location.uri));
      const near = location.start ?? { line: 0, character: 0 };
      const decl = await findDeclaration(client, location.uri, near, bareName(match.name));
      const key = (uri: string, p: Position) => `${uri}:${p.line}:${p.character}`;
      const keys = new Set([key(location.uri, decl.position)]);
      const definitions = await client.definition(location.uri, decl.position);
      for (const def of definitions ? (Array.isArray(definitions) ? definitions : [definitions]) : []) {
        keys.add("targetUri" in def ? key(def.targetUri, def.targetSelectionRange.start) : key(def.uri, def.range.start));
      }
      const range = decl.range;
      let group = { keys, symbol: match, size: range ? (range.end.line - range.start.line) * 1_000_000 + range.end.character - range.start.character : 0 };
      for (let i = groups.length - 1; i >= 0; i--) {
        const previous = groups[i]!;
        if (![...keys].some(k => previous.keys.has(k))) continue;
        for (const k of previous.keys) keys.add(k);
        if (previous.size > group.size) group = { ...previous, keys };
        groups.splice(i, 1);
      }
      groups.push(group);
    }
    matches = groups.map(g => g.symbol);
  }

  if (matches.length > 1) {
    const candidates = matches.map((s) => {
      const { uri, start } = locationOf(s);
      return {
        name: s.containerName ? `${s.containerName}.${s.name}` : s.name,
        relPath: relative(rootPath, canonicalPath(fileURLToPath(uri))),
        line: (start?.line ?? 0) + 1,
        character: (start?.character ?? 0) + 1,
      };
    });
    const list = candidates.map((c) => `  ${c.name} — ${c.relPath}:${c.line}:${c.character}`).join("\n");
    throw new ResolveError(
      `"${query.name}" is ambiguous (${matches.length} definitions). Re-run with one of:\n${list}`,
      candidates,
    );
  }

  const only = matches[0]!;
  const { uri: rawUri, start } = locationOf(only);
  const file = fileURLToPath(rawUri);
  const uri = await client.open(file);
  const near = start ?? { line: 0, character: 0 };
  const { position, range, kind } = await findDeclaration(client, uri, near, query.name);
  const items = (await client.prepareCallHierarchy(uri, position)) ?? [];
  const item = items[0];
  return {
    uri,
    relPath: uriToRel(uri, rootPath),
    position,
    name: item?.name ?? (only.containerName ? `${only.containerName}.${only.name}` : only.name),
    ...(item ? { item } : {}),
    ...(range ? { range } : {}),
    ...(kind ? { kind } : {}),
  };
}

export function uriToRel(uri: string, rootPath: string): string {
  return relative(rootPath, canonicalPath(fileURLToPath(uri)));
}

export function relToUri(rel: string, rootPath: string): string {
  return pathToFileURL(resolve(rootPath, rel)).href;
}
