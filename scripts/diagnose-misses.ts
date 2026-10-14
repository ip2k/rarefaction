// Root-cause pass for measure-scope.ts misses: for each measured commit with
// missed files, check out its parent again and run orient on the same seed
// with wider bounds (up 4, down 3, 200 nodes). A missed file that becomes
// live was beyond the default bounds; one that does not has no call edge the
// language server reports.
//
//   npx tsx scripts/diagnose-misses.ts --repo <checkout> --profile rust \
//     --results results.jsonl [--project <subdir>] --out diagnosis.jsonl

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { DocumentSymbol } from "vscode-languageserver-protocol";
import { profileById } from "../src/profiles/index.js";
import { Session } from "../src/session.js";
import { orient } from "../src/tools/orient.js";

const argv = (n: string, d?: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const repo = resolve(argv("--repo")!);
const profile = profileById(argv("--profile", "rust")!)!;
const root = join(repo, argv("--project", ".")!);
const out = argv("--out")!;
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
const FUNCTION_KINDS = new Set([6, 9, 12]);

interface Row { sha: string; seed: string; missed: string[]; missed_reached_after_commit: string[] | null }

async function main() {
  const head = git("rev-parse", "HEAD").trim();
  const rows = readFileSync(argv("--results")!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row).filter((r) => r.missed?.length);
  for (const r of rows) {
    const sha = git("rev-parse", r.sha).trim();
    const parent = git("rev-parse", `${sha}^`).trim();
    const [, name, file, line] = r.seed.match(/^(.*) @ (.*):(\d+)$/)!;
    git("checkout", "-q", "--detach", "-f", parent);
    const session = new Session(root, profile);
    let wider: string[] | null = null;
    try {
      const client = await session.lsp();
      const symbols = (await client.documentSymbols(await client.open(join(repo, file)))) as DocumentSymbol[];
      const found: DocumentSymbol[] = [];
      const walk = (list: DocumentSymbol[]) => { for (const s of list) { if (s.name === name && FUNCTION_KINDS.has(s.kind)) found.push(s); if (s.children) walk(s.children); } };
      walk(symbols ?? []);
      const s = found.sort((a, b) => Math.abs(a.selectionRange.start.line + 1 - Number(line)) - Math.abs(b.selectionRange.start.line + 1 - Number(line)))[0];
      if (s) {
        const p = s.selectionRange.start;
        const result = await orient(session, { symbol: `${relative(root, join(repo, file))}:${p.line + 1}:${p.character + 1}`, up: 4, down: 3, max_nodes: 200, include_body: false, max_body_lines: 0 });
        const live = new Set(result.live_files.map((f) => relative(repo, join(root, f))));
        wider = r.missed.filter((f) => live.has(f));
      }
    } catch (error) {
      process.stderr.write(`${r.sha}: ${error}\n`);
    } finally {
      await session.close();
    }
    const row = { sha: r.sha, missed: r.missed, reached_after_commit: r.missed_reached_after_commit, reached_with_wider_bounds: wider };
    process.stderr.write(`${JSON.stringify(row)}\n`);
    appendFileSync(out, `${JSON.stringify(row)}\n`);
  }
  git("checkout", "-q", "--detach", "-f", head);
}

main().then(() => process.exit(0), (e) => { process.stderr.write(`${e}\n`); process.exit(1); });
