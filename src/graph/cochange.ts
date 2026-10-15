// Co-change neighbours: files that have historically changed in the same
// commits as a given file. This records coupling a language server cannot
// see (data, configuration, IPC, tests run as processes). Language-agnostic:
// it reads git history and filters by the profile's extensions.
//
// Parameters are fixed in docs/measurement.md ("Widened scope", stated
// 2026-10-15 before measuring); do not tune them against results.

import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

export const COCHANGE = {
  maxCommits: 1000,
  sweepFiles: 20, // commits touching more source files than this are skipped
  minSupport: 2,
  minConfidence: 0.15,
  maxFiles: 15,
} as const;

export interface Neighbour {
  /** Path relative to the project root. */
  file: string;
  /** Commits touching both files. */
  support: number;
  /** support ÷ commits touching the anchor file. */
  confidence: number;
}

export interface CoChange {
  neighbours: Neighbour[];
  /** Commits (after the sweep filter) that touched the anchor file. */
  anchorCommits: number;
  /** Why co-change is unavailable, when it is. */
  unavailable?: string;
}

const run = promisify(execFile);

/**
 * Neighbours of `anchor` (relative to `root`) in the history before `rev`.
 * `isSource` receives project-relative paths.
 */
export async function coChange(root: string, anchor: string, isSource: (rel: string) => boolean, rev = "HEAD"): Promise<CoChange> {
  let top: string;
  try {
    top = (await run("git", ["-C", root, "rev-parse", "--show-toplevel"], { timeout: 10_000 })).stdout.trim();
  } catch {
    return { neighbours: [], anchorCommits: 0, unavailable: "not a git repository" };
  }
  let log: string;
  try {
    log = (await run("git", ["-C", top, "log", "--no-merges", "--no-renames", "--name-only", "--format=%x00", "-n", String(COCHANGE.maxCommits), rev, "--"],
      { timeout: 60_000, maxBuffer: 1 << 28 })).stdout;
  } catch {
    return { neighbours: [], anchorCommits: 0, unavailable: "git history unavailable" };
  }
  const rootAbs = resolve(root);
  const toProject = (repoPath: string) => {
    const rel = relative(rootAbs, resolve(top, repoPath));
    return rel.startsWith("..") ? undefined : rel.split(sep).join("/");
  };
  return countNeighbours(parseLog(log, toProject, isSource), anchor);
}

/** Commit file lists from `git log --name-only --format=%x00`, project-relative and source-only. */
export function parseLog(log: string, toProject: (p: string) => string | undefined, isSource: (rel: string) => boolean): string[][] {
  return log.split("\0").map((block) => [...new Set(block.split("\n").map((l) => l.trim()).filter(Boolean)
    .map(toProject).filter((p): p is string => p !== undefined && isSource(p)))]).filter((files) => files.length > 0);
}

export function countNeighbours(commits: string[][], anchor: string): CoChange {
  let anchorCommits = 0;
  const support = new Map<string, number>();
  for (const files of commits) {
    if (files.length > COCHANGE.sweepFiles || !files.includes(anchor)) continue;
    anchorCommits += 1;
    for (const f of files) if (f !== anchor) support.set(f, (support.get(f) ?? 0) + 1);
  }
  const neighbours = [...support]
    .map(([file, s]) => ({ file, support: s, confidence: anchorCommits ? s / anchorCommits : 0 }))
    .filter((n) => n.support >= COCHANGE.minSupport && n.confidence >= COCHANGE.minConfidence)
    .sort((a, b) => b.support - a.support || b.confidence - a.confidence || a.file.localeCompare(b.file))
    .slice(0, COCHANGE.maxFiles);
  return { neighbours, anchorCommits };
}
