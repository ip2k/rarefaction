// `scope`: the working set for a change to one symbol — the files `orient`
// finds through the language server (callers, callees, implementations,
// tests) plus the files that have historically changed together with the
// symbol's file. Every file carries the reason it is in the set.
//
// Advisory, not a boundary: docs/measurement.md records how much of a real
// change the set covers. Callers should treat files outside it as "look
// before editing", not "forbidden".

import { relative } from "node:path";
import * as z from "zod/v4";
import { listSourceFiles } from "../fs.js";
import { coChange, COCHANGE } from "../graph/cochange.js";
import type { Session } from "../session.js";
import { orient, OrientInput } from "./orient.js";

export const ScopeInput = OrientInput.pick({ symbol: true, up: true, down: true, max_nodes: true });
export type ScopeInputType = z.infer<typeof ScopeInput>;

export const ScopeOutput = z.object({
  profile: z.string(),
  root: z.string(),
  symbol: z.object({ name: z.string(), file: z.string(), line: z.number().int() }),
  files: z.array(z.object({
    file: z.string().describe("Path relative to the project root."),
    sources: z.array(z.enum(["symbol", "call_graph", "co_change"])),
    reasons: z.array(z.string()),
  })).describe("The working set, symbol file first, then call-graph files, then co-change-only files."),
  counts: z.object({
    files: z.number().int(), call_graph: z.number().int(), co_change: z.number().int(),
    co_change_only: z.number().int(), project_source_files: z.number().int(),
  }),
  co_change: z.object({ anchor_commits: z.number().int(), unavailable: z.string().optional() }),
  warnings: z.array(z.string()),
  truncated: z.boolean().describe("The call-graph walk hit max_nodes."),
  stats: z.object({ ms: z.number().int(), lsp_requests: z.number().int(), cold_start: z.boolean() }),
});
export type ScopeOutputType = z.infer<typeof ScopeOutput>;

export async function scope(session: Session, input: ScopeInputType): Promise<ScopeOutputType> {
  const t0 = Date.now();
  const o = await orient(session, { ...input, include_body: false, max_body_lines: 0 });
  const reasons = new Map<string, { sources: Set<"symbol" | "call_graph" | "co_change">; reasons: string[] }>();
  const add = (file: string, source: "symbol" | "call_graph" | "co_change", reason: string) => {
    const entry = reasons.get(file) ?? { sources: new Set(), reasons: [] };
    entry.sources.add(source);
    if (entry.reasons.length < 4) entry.reasons.push(reason);
    reasons.set(file, entry);
  };

  add(o.symbol.file, "symbol", `declares ${o.symbol.name}`);
  for (const c of o.callers) add(c.file, "call_graph", `${c.is_test_case ? "test" : "caller"} ${c.name}${c.depth > 1 ? ` (depth ${c.depth})` : ""}`);
  for (const c of o.callees) add(c.file, "call_graph", `callee ${c.name}`);
  for (const i of o.implementations) add(i.file, "call_graph", "implementation");
  for (const r of o.references ?? []) add(r.file, "call_graph", `${r.count} reference${r.count === 1 ? "" : "s"}`);
  for (const t of o.type_hierarchy?.supertypes ?? []) add(t.file, "call_graph", `supertype ${t.name}`);
  for (const t of o.type_hierarchy?.subtypes ?? []) add(t.file, "call_graph", `subtype ${t.name}`);
  for (const f of o.live_files) if (!reasons.has(f)) add(f, "call_graph", "reached by the walk");

  const existing = new Set((await listSourceFiles(session.rootPath, session.profile.extensions))
    .map((f) => relative(session.rootPath, f.path).split("\\").join("/")));
  const history = await coChange(session.rootPath, o.symbol.file, (rel) => existing.has(rel));
  for (const n of history.neighbours) {
    add(n.file, "co_change", `changed with ${o.symbol.file} in ${n.support} of ${history.anchorCommits} commits`);
  }

  const order = (e: { sources: Set<string> }) => e.sources.has("symbol") ? 0 : e.sources.has("call_graph") ? 1 : 2;
  const files = [...reasons].sort(([a, x], [b, y]) => order(x) - order(y) || a.localeCompare(b))
    .map(([file, e]) => ({ file, sources: [...e.sources].sort() as ("symbol" | "call_graph" | "co_change")[], reasons: e.reasons }));
  const coChangeOnly = files.filter((f) => f.sources.length === 1 && f.sources[0] === "co_change").length;

  const warnings = [...(o.warnings ?? [])];
  if (history.unavailable) warnings.push(`Co-change history unavailable (${history.unavailable}); the set is call-graph only.`);
  else if (history.anchorCommits < COCHANGE.minSupport) warnings.push(`${o.symbol.file} has too little history (${history.anchorCommits} commit${history.anchorCommits === 1 ? "" : "s"}) for co-change neighbours.`);
  warnings.push("Advisory working set, not a boundary: changes often touch files outside it (see docs/measurement.md). Look before editing elsewhere; don't treat it as forbidden.");

  return {
    profile: o.profile ?? session.profile.id,
    root: session.rootPath,
    symbol: { name: o.symbol.name, file: o.symbol.file, line: o.symbol.line },
    files,
    counts: {
      files: files.length,
      call_graph: files.filter((f) => f.sources.includes("call_graph") || f.sources.includes("symbol")).length,
      co_change: history.neighbours.length,
      co_change_only: coChangeOnly,
      project_source_files: o.project_source_files,
    },
    co_change: { anchor_commits: history.anchorCommits, ...(history.unavailable ? { unavailable: history.unavailable } : {}) },
    warnings,
    truncated: o.truncated,
    stats: { ms: Date.now() - t0, lsp_requests: o.stats.lsp_requests, cold_start: o.stats.cold_start },
  };
}

export function renderScope(s: ScopeOutputType): string {
  const out = [`# Scope for ${s.symbol.name} — ${s.symbol.file}:${s.symbol.line}`, "",
    `${s.counts.files} of ${s.counts.project_source_files} files: ${s.counts.call_graph} from the call graph, ${s.counts.co_change_only} more from co-change history.`];
  for (const w of s.warnings) out.push("", `> ${w}`);
  out.push("");
  for (const f of s.files) out.push(`- ${f.file} — ${f.reasons.join("; ")}`);
  if (s.truncated) out.push("", "_Call-graph walk truncated at max_nodes; raise it or narrow the symbol._");
  out.push("", `_${s.stats.lsp_requests} LSP requests, ${s.stats.ms} ms${s.stats.cold_start ? " (includes language-server cold start)" : ""}_`);
  return out.join("\n");
}
