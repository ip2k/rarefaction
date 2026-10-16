// `scope`: the working set for a change to one symbol — the files `orient`
// finds through the language server (callers, callees, implementations,
// tests) and files that have historically changed together with them.
// Every file carries the reason it is in the set. Test-name and
// configuration-key links are built but off: they did not earn recall.
//
// Advisory, not a boundary: docs/measurement.md records how much of a real
// change the set covers. Callers should treat files outside it as "look
// before editing", not "forbidden".

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import * as z from "zod/v4";
import { listSourceFiles } from "../fs.js";
import { COCHANGE, countNeighbours, history, type History } from "../graph/cochange.js";
import { configKeys, configLinks, testLinks } from "../graph/links.js";
import type { Profile } from "../profiles/profile.js";
import type { Session } from "../session.js";
import { orient, OrientInput, type OrientOutputType } from "./orient.js";

export const ScopeInput = OrientInput.pick({ symbol: true, up: true, down: true, max_nodes: true });
export type ScopeInputType = z.infer<typeof ScopeInput>;

const Source = z.enum(["symbol", "call_graph", "co_change", "link"]);
type SourceType = z.infer<typeof Source>;

export const ScopeOutput = z.object({
  profile: z.string(),
  root: z.string(),
  symbol: z.object({ name: z.string(), file: z.string(), line: z.number().int() }),
  files: z.array(z.object({
    file: z.string().describe("Path relative to the project root."),
    sources: z.array(Source),
    reasons: z.array(z.string()),
  })).describe("The working set: symbol file first, then call-graph files, then files found only through history or links."),
  counts: z.object({
    files: z.number().int(), call_graph: z.number().int(), co_change: z.number().int(),
    co_change_only: z.number().int(), link_only: z.number().int(), project_source_files: z.number().int(),
  }),
  co_change: z.object({ anchor_commits: z.number(), unavailable: z.string().optional() }),
  warnings: z.array(z.string()),
  truncated: z.boolean().describe("The call-graph walk hit max_nodes."),
  stats: z.object({ ms: z.number().int(), lsp_requests: z.number().int(), cold_start: z.boolean() }),
});
export type ScopeOutputType = z.infer<typeof ScopeOutput>;

/** The round-2 components (docs/measurement.md, "Scope round 2"). */
export interface ScopeOptions {
  /** W: weight large commits by 20 ÷ n instead of dropping those over 20 files. */
  weighted: boolean;
  /** A: co-change from every call-graph file, not only the symbol's file. */
  anchors: boolean;
  /** L: test ↔ code by file name, and shared configuration keys. */
  links: boolean;
}
export const SCOPE_0_3: ScopeOptions = { weighted: false, anchors: false, links: false };
/** What ships: the round-2 ablation kept only A (docs/measurement.md); W and L stay off. */
export const SCOPE_OPTIONS: ScopeOptions = { weighted: false, anchors: true, links: false };

/** Everything `scope` reads, gathered once so several option sets can be assembled from it. */
export interface ScopeContext {
  orient: OrientOutputType;
  profile: Profile;
  root: string;
  history: History;
  /** Project source files, relative to the root. */
  project: string[];
  /** Lazily read file contents, for configuration keys. */
  text(rel: string): Promise<string>;
  ms: number;
}

export async function scopeContext(session: Session, input: ScopeInputType): Promise<ScopeContext> {
  const t0 = Date.now();
  const o = await orient(session, { ...input, include_body: true, max_body_lines: 400 });
  const project = (await listSourceFiles(session.rootPath, session.profile.extensions))
    .map((f) => relative(session.rootPath, f.path).split("\\").join("/"));
  const existing = new Set(project);
  const h = await history(session.rootPath, (rel) => existing.has(rel));
  const cache = new Map<string, Promise<string>>();
  const text = (rel: string) => {
    if (!cache.has(rel)) cache.set(rel, readFile(`${session.rootPath}/${rel}`, "utf8").catch(() => ""));
    return cache.get(rel)!;
  };
  return { orient: o, profile: session.profile, root: session.rootPath, history: h, project, text, ms: Date.now() - t0 };
}

const commits = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export async function assemble(ctx: ScopeContext, options: ScopeOptions): Promise<ScopeOutputType> {
  const t0 = Date.now();
  const o = ctx.orient;
  const entries = new Map<string, { sources: Set<SourceType>; reasons: string[] }>();
  const add = (file: string, source: SourceType, reason: string) => {
    const entry = entries.get(file) ?? { sources: new Set(), reasons: [] };
    entry.sources.add(source);
    if (entry.reasons.length < 4) entry.reasons.push(reason);
    entries.set(file, entry);
  };

  add(o.symbol.file, "symbol", `declares ${o.symbol.name}`);
  for (const c of o.callers) add(c.file, "call_graph", `${c.is_test_case ? "test" : "caller"} ${c.name}${c.depth > 1 ? ` (depth ${c.depth})` : ""}`);
  for (const c of o.callees) add(c.file, "call_graph", `callee ${c.name}`);
  for (const i of o.implementations) add(i.file, "call_graph", "implementation");
  for (const r of o.references ?? []) add(r.file, "call_graph", `${r.count} reference${r.count === 1 ? "" : "s"}`);
  for (const t of o.type_hierarchy?.supertypes ?? []) add(t.file, "call_graph", `supertype ${t.name}`);
  for (const t of o.type_hierarchy?.subtypes ?? []) add(t.file, "call_graph", `subtype ${t.name}`);
  for (const f of o.live_files) if (!entries.has(f)) add(f, "call_graph", "reached by the walk");
  const graphFiles = [...entries.keys()];

  const h = ctx.history;
  const seed = countNeighbours(h.commits, o.symbol.file, options.weighted);
  for (const n of seed.neighbours) {
    add(n.file, "co_change", `changed with ${o.symbol.file} in ${commits(n.support)} of ${commits(seed.anchorCommits)} commits`);
  }

  if (options.anchors && !h.unavailable) {
    // Other anchors together add at most maxFiles new files, by best confidence across anchors.
    const best = new Map<string, { anchor: string; support: number; confidence: number; of: number }>();
    for (const anchor of graphFiles) {
      if (anchor === o.symbol.file) continue;
      const r = countNeighbours(h.commits, anchor, options.weighted);
      for (const n of r.neighbours) {
        if (entries.has(n.file)) continue;
        const prev = best.get(n.file);
        if (!prev || n.confidence > prev.confidence || (n.confidence === prev.confidence && n.support > prev.support)) {
          best.set(n.file, { anchor, support: n.support, confidence: n.confidence, of: r.anchorCommits });
        }
      }
    }
    [...best].sort(([a, x], [b, y]) => y.confidence - x.confidence || y.support - x.support || a.localeCompare(b))
      .slice(0, COCHANGE.maxFiles)
      .forEach(([file, n]) => add(file, "co_change", `changed with ${n.anchor} in ${commits(n.support)} of ${commits(n.of)} commits`));
  }

  if (options.links) {
    for (const l of testLinks(ctx.profile, graphFiles, ctx.project)) add(l.file, "link", l.reason);
    const keys = configKeys(ctx.profile, o.body?.text ?? "");
    if (keys.length) {
      const texts = new Map(await Promise.all(ctx.project.map(async (f) => [f, await ctx.text(f)] as const)));
      for (const l of configLinks(keys, o.symbol.file, texts)) add(l.file, "link", l.reason);
    }
  }

  const order = (e: { sources: Set<string> }) => e.sources.has("symbol") ? 0 : e.sources.has("call_graph") ? 1 : e.sources.has("co_change") ? 2 : 3;
  const files = [...entries].sort(([a, x], [b, y]) => order(x) - order(y) || a.localeCompare(b))
    .map(([file, e]) => ({ file, sources: [...e.sources].sort() as SourceType[], reasons: e.reasons }));
  const only = (s: SourceType) => files.filter((f) => f.sources.length === 1 && f.sources[0] === s).length;

  const warnings = [...(o.warnings ?? [])];
  if (h.unavailable) warnings.push(`Co-change history unavailable (${h.unavailable}); the set is call-graph only.`);
  else if (seed.anchorCommits < COCHANGE.minSupport) warnings.push(`${o.symbol.file} has too little history (${commits(seed.anchorCommits)} commit${seed.anchorCommits === 1 ? "" : "s"}) for co-change neighbours.`);
  warnings.push("Advisory working set, not a boundary: changes often touch files outside it (see docs/measurement.md). Look before editing elsewhere; don't treat it as forbidden.");

  return {
    profile: o.profile ?? ctx.profile.id,
    root: ctx.root,
    symbol: { name: o.symbol.name, file: o.symbol.file, line: o.symbol.line },
    files,
    counts: {
      files: files.length,
      call_graph: files.filter((f) => f.sources.includes("call_graph") || f.sources.includes("symbol")).length,
      co_change: files.filter((f) => f.sources.includes("co_change")).length,
      co_change_only: only("co_change"),
      link_only: only("link"),
      project_source_files: o.project_source_files,
    },
    co_change: { anchor_commits: seed.anchorCommits, ...(h.unavailable ? { unavailable: h.unavailable } : {}) },
    warnings,
    truncated: o.truncated,
    stats: { ms: ctx.ms + Date.now() - t0, lsp_requests: o.stats.lsp_requests, cold_start: o.stats.cold_start },
  };
}

export async function scope(session: Session, input: ScopeInputType, options: ScopeOptions = SCOPE_OPTIONS): Promise<ScopeOutputType> {
  return assemble(await scopeContext(session, input), options);
}

export function renderScope(s: ScopeOutputType): string {
  const extra = [s.counts.co_change_only ? `${s.counts.co_change_only} more from co-change history` : "",
    s.counts.link_only ? `${s.counts.link_only} more from test names and shared keys` : ""].filter(Boolean);
  const out = [`# Scope for ${s.symbol.name} — ${s.symbol.file}:${s.symbol.line}`, "",
    `${s.counts.files} of ${s.counts.project_source_files} files: ${s.counts.call_graph} from the call graph${extra.length ? `, ${extra.join(", ")}` : ""}.`];
  for (const w of s.warnings) out.push("", `> ${w}`);
  out.push("");
  for (const f of s.files) out.push(`- ${f.file} — ${f.reasons.join("; ")}`);
  if (s.truncated) out.push("", "_Call-graph walk truncated at max_nodes; raise it or narrow the symbol._");
  out.push("", `_${s.stats.lsp_requests} LSP requests, ${s.stats.ms} ms${s.stats.cold_start ? " (includes language-server cold start)" : ""}_`);
  return out.join("\n");
}
