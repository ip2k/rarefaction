// Phase-2 scope recall, offline (protocol in docs/measurement.md, stated
// 2026-10-14 before the first run). For each qualifying commit: check out its
// parent, find the function or method enclosing the commit's first changed
// hunk, run orient on it with default bounds, and score the live set against
// the files the commit changed.
//
//   npx tsx scripts/measure-scope.ts --repo <git checkout> --profile rust \
//     [--project <subdir>] [--max 25] [--label name] [--out results.jsonl]
//
// --label replaces the repository name in the output, so results from private
// projects can be aggregated without naming them. Rows still carry symbols and
// paths; publish only aggregates for private projects.
//
// The checkout is moved between commits with `git checkout --detach`; use a
// scratch clone. One language server per commit, so cold start is measured
// every time; the warm figure is a second orient call on the same session.

import { execFileSync } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { DocumentSymbol, SymbolInformation } from "vscode-languageserver-protocol";
import { profileById } from "../src/profiles/index.js";
import { renderOrient } from "../src/render.js";
import { Session } from "../src/session.js";
import { orient, type OrientOutputType } from "../src/tools/orient.js";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const repo = resolve(arg("--repo")!);
const profile = profileById(arg("--profile", "rust")!)!;
const project = arg("--project", ".")!;
const root = join(repo, project);
const max = Number(arg("--max", "25"));
const out = arg("--out");
const label = arg("--label", repo.split("/").pop()!)!;
const GENERATED = /(^|\/)(target|generated|gen)\/|\.pb\.rs$|_generated\.|\.g\.dart$/;

const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const isSource = (p: string) => profile.extensions.some((e) => p.endsWith(e)) && p.startsWith(project === "." ? "" : `${project}/`) && !GENERATED.test(p);
const FUNCTION_KINDS = new Set([6, 9, 12]); // Method, Constructor, Function

interface Candidate { sha: string; parent: string; modified: string[]; added: string[]; seedFile: string; seedLine: number }

function candidates(): { picked: Candidate[]; scanned: number; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const shas = git("log", "--no-merges", "--format=%H %P", "-n", "2000", "--", project === "." ? "." : project).trim().split("\n");
  const picked: Candidate[] = [];
  let scanned = 0;
  for (const line of shas) {
    if (picked.length >= max * 4) break;
    const [sha, parent, extra] = line.split(" ");
    if (!parent || extra) continue;
    scanned += 1;
    const status = git("diff", "--name-status", "-M", parent, sha).trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
    if (status.some(([s, ...p]) => s.startsWith("R") && p.some(isSource))) { skip("rename"); continue; }
    const modified = status.filter(([s, p]) => s === "M" && isSource(p)).map(([, p]) => p);
    const added = status.filter(([s, p]) => s === "A" && isSource(p)).map(([, p]) => p);
    const changed = modified.length + added.length;
    if (changed < 2 || changed > 15) { skip("not 2-15 source files"); continue; }
    if (modified.length < 2) { skip("fewer than 2 files existed at the parent"); continue; }
    const hunk = git("diff", "-U0", parent, sha, "--", modified[0]).match(/^@@ -(\d+)/m);
    if (!hunk) { skip("no hunk"); continue; }
    picked.push({ sha, parent, modified, added, seedFile: modified[0], seedLine: Math.max(1, Number(hunk[1])) });
  }
  return { picked, scanned, skipped };
}

function enclosing(symbols: DocumentSymbol[] | SymbolInformation[] | null, line: number): DocumentSymbol | undefined {
  // Innermost function or method whose range contains the 0-based line.
  let best: DocumentSymbol | undefined;
  const walk = (list: DocumentSymbol[]) => {
    for (const s of list) {
      if (s.range.start.line <= line && line <= s.range.end.line) {
        if (FUNCTION_KINDS.has(s.kind)) best = s;
        if (s.children) walk(s.children);
      }
    }
  };
  if (symbols && symbols.length && "range" in symbols[0]) walk(symbols as DocumentSymbol[]);
  return best;
}

const bytes = (rel: string) => { try { return statSync(join(repo, rel)).size; } catch { return 0; } };
const outputBytes = (o: OrientOutputType) => Buffer.byteLength(renderOrient(o)) + Buffer.byteLength(JSON.stringify(o));

async function measure(c: Candidate) {
  git("checkout", "-q", "--detach", "-f", c.parent);
  const session = new Session(root, profile);
  try {
    const t0 = Date.now();
    const client = await session.lsp();
    const uri = await client.open(join(repo, c.seedFile));
    const seed = enclosing(await client.documentSymbols(uri), c.seedLine - 1);
    if (!seed) return { sha: c.sha, skipped: "first hunk not inside a function or method" };
    const pos = seed.selectionRange.start;
    const symbol = `${relative(root, join(repo, c.seedFile))}:${pos.line + 1}:${pos.character + 1}`;
    const input = { symbol, up: 2, down: 1, max_nodes: 50, include_body: true, max_body_lines: 80 };
    await orient(session, input); // cold: includes the server start and indexing
    const coldMs = Date.now() - t0;
    const t1 = Date.now();
    const result = await orient(session, input);
    const warmMs = Date.now() - t1;
    const live = new Set(result.live_files.map((f) => relative(repo, join(root, f))));
    const hits = c.modified.filter((f) => live.has(f));
    const liveBytes = [...live].reduce((n, f) => n + bytes(f), 0);
    const changedBytes = c.modified.reduce((n, f) => n + bytes(f), 0);
    const ob = outputBytes(result);
    return {
      sha: c.sha.slice(0, 10), seed: `${seed.name} @ ${c.seedFile}:${pos.line + 1}`,
      changed: c.modified.length, added: c.added.length, hits: hits.length, recall: hits.length / c.modified.length,
      missed: c.modified.filter((f) => !live.has(f)),
      live: live.size, project_files: result.project_source_files, live_fraction: live.size / result.project_source_files,
      orient_bytes: ob, live_bytes: liveBytes, changed_bytes: changedBytes,
      bytes_vs_live: liveBytes ? ob / liveBytes : null, bytes_vs_changed: changedBytes ? ob / changedBytes : null,
      callers: result.callers.length, callees: result.callees.length, truncated: result.truncated,
      warnings: result.warnings ?? [], cold_ms: coldMs, warm_ms: warmMs,
    };
  } catch (error) {
    return { sha: c.sha.slice(0, 10), error: String(error).slice(0, 300) };
  } finally {
    await session.close();
  }
}

async function main() {
  const head = git("rev-parse", "HEAD").trim();
  const { picked, scanned, skipped } = candidates();
  process.stderr.write(`${repo}: ${picked.length} candidates from ${scanned} commits; skipped ${JSON.stringify(skipped)}\n`);
  let measured = 0;
  for (const c of picked) {
    if (measured >= max) break;
    const row = await measure(c);
    if (!("skipped" in row)) measured += 1;
    process.stderr.write(`${JSON.stringify(row)}\n`);
    if (out) appendFileSync(out, `${JSON.stringify({ repo: label, project, ...row })}\n`);
  }
  git("checkout", "-q", "--detach", "-f", head);
}

main().then(() => process.exit(0), (e) => { process.stderr.write(`${e}\n`); process.exit(1); });
