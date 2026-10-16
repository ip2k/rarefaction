// Co-change neighbours: files that have historically changed in the same
// commits as a given file. This records coupling a language server cannot
// see (data, configuration, IPC, tests run as processes). Language-agnostic:
// it reads git history and filters by the profile's extensions.
//
// Parameters are fixed in docs/measurement.md ("Widened scope" and "Scope
// round 2", each stated before measuring); do not tune them against results.

import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

export const COCHANGE = {
  maxCommits: 1000,
  sweepFiles: 20, // unweighted: commits touching more source files are skipped; weighted: weight 20 ÷ n above it
  maxWeightedFiles: 500, // weighted: commits touching more are imports or reformatting, dropped
  minSupport: 2,
  minConfidence: 0.15,
  maxFiles: 15,
} as const;

export interface Neighbour {
  /** Path relative to the project root. */
  file: string;
  /** Commits (or summed commit weight) touching both files. */
  support: number;
  /** support ÷ commits (or summed weight) touching the anchor file. */
  confidence: number;
}

export interface CoChange {
  neighbours: Neighbour[];
  /** Commits (or summed weight) that touched the anchor file after the sweep rule. */
  anchorCommits: number;
  /** Why co-change is unavailable, when it is. */
  unavailable?: string;
}

export interface History {
  /** Per commit, newest first: project-relative source files it touched. */
  commits: string[][];
  unavailable?: string;
}

const run = promisify(execFile);

/** Source-file lists of the last commits before `rev`, project-relative. */
export async function history(root: string, isSource: (rel: string) => boolean, rev = "HEAD"): Promise<History> {
  let top: string;
  try {
    top = (await run("git", ["-C", root, "rev-parse", "--show-toplevel"], { timeout: 10_000 })).stdout.trim();
  } catch {
    return { commits: [], unavailable: "not a git repository" };
  }
  let log: string;
  try {
    log = (await run("git", ["-C", top, "log", "--no-merges", "--no-renames", "--name-only", "--format=%x00", "-n", String(COCHANGE.maxCommits), rev, "--"],
      { timeout: 60_000, maxBuffer: 1 << 28 })).stdout;
  } catch {
    return { commits: [], unavailable: "git history unavailable" };
  }
  const rootAbs = resolve(root);
  const toProject = (repoPath: string) => {
    const rel = relative(rootAbs, resolve(top, repoPath));
    return rel.startsWith("..") ? undefined : rel.split(sep).join("/");
  };
  return { commits: parseLog(log, toProject, isSource) };
}

/** Neighbours of `anchor` (relative to `root`) in the history before `rev`. */
export async function coChange(root: string, anchor: string, isSource: (rel: string) => boolean, rev = "HEAD", weighted = false): Promise<CoChange> {
  const h = await history(root, isSource, rev);
  return h.unavailable ? { neighbours: [], anchorCommits: 0, unavailable: h.unavailable } : countNeighbours(h.commits, anchor, weighted);
}

/** Commit file lists from `git log --name-only --format=%x00`, project-relative and source-only. */
export function parseLog(log: string, toProject: (p: string) => string | undefined, isSource: (rel: string) => boolean): string[][] {
  return log.split("\0").map((block) => [...new Set(block.split("\n").map((l) => l.trim()).filter(Boolean)
    .map(toProject).filter((p): p is string => p !== undefined && isSource(p)))]).filter((files) => files.length > 0);
}

/** A commit's weight: unweighted drops sweeps; weighted counts them at 20 ÷ n. */
export function commitWeight(files: number, weighted: boolean): number {
  if (!weighted) return files > COCHANGE.sweepFiles ? 0 : 1;
  return files > COCHANGE.maxWeightedFiles ? 0 : Math.min(1, COCHANGE.sweepFiles / files);
}

export function countNeighbours(commits: string[][], anchor: string, weighted = false): CoChange {
  let anchorCommits = 0;
  const support = new Map<string, number>();
  for (const files of commits) {
    const w = commitWeight(files.length, weighted);
    if (w === 0 || !files.includes(anchor)) continue;
    anchorCommits += w;
    for (const f of files) if (f !== anchor) support.set(f, (support.get(f) ?? 0) + w);
  }
  const neighbours = [...support]
    .map(([file, s]) => ({ file, support: s, confidence: anchorCommits ? s / anchorCommits : 0 }))
    .filter((n) => n.support >= COCHANGE.minSupport - 1e-9 && n.confidence >= COCHANGE.minConfidence - 1e-9)
    .sort((a, b) => b.support - a.support || b.confidence - a.confidence || a.file.localeCompare(b.file))
    .slice(0, COCHANGE.maxFiles);
  return { neighbours, anchorCommits };
}
