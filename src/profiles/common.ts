import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPath, isSkippedDir, listSourceFiles } from "../fs.js";
import type { Freshness } from "./profile.js";

export async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

/** `member` relative to `dir`, with "/" separators, as workspace globs spell it. */
export function workspacePath(dir: string, member: string): string {
  return relative(dir, member).split(sep).join("/");
}

const tidy = (pattern: string): string => pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

/**
 * Whether a workspace member path matches a list of workspace globs (Cargo
 * `members`, npm/yarn `workspaces`, pnpm `packages`). A leading "!" excludes;
 * the last matching pattern wins.
 */
export function matchesWorkspaceGlobs(path: string, patterns: readonly string[]): boolean {
  let included = false;
  for (const raw of patterns) {
    const negated = raw.startsWith("!");
    const pattern = tidy(negated ? raw.slice(1) : raw);
    if (pattern && (path === pattern || posix.matchesGlob(path, pattern))) included = !negated;
  }
  return included;
}

/** `path` is `prefix` or lies below it (Cargo `exclude` entries are path prefixes). */
export function underPath(path: string, prefix: string): boolean {
  const p = tidy(prefix);
  return p.length > 0 && (path === p || path.startsWith(`${p}/`));
}

/** Resolve without spawning the executable (which might itself be an LSP). */
export async function executable(command: string, path = process.env.PATH ?? ""): Promise<string | undefined> {
  const candidates = isAbsolute(command) || command.includes(sep) ? [command] : path.split(delimiter).map(p => join(p, command));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch { /* keep searching */ }
  }
  return undefined;
}

export function outside(uri: string, root: string): boolean {
  if (!uri.startsWith("file:")) return true;
  const rel = relative(canonicalPath(root), canonicalPath(fileURLToPath(uri)));
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.split(sep).some(p => isSkippedDir(p));
}

export async function liveFreshness(root: string, extensions: readonly string[]): Promise<Freshness> {
  const files = await listSourceFiles(root, extensions);
  return { model: "on-open", stale: false, ...(files.length ? { newestSourceAt: new Date(Math.max(...files.map(f => f.mtimeMs))) } : {}) };
}

export const testFile = (path: string): boolean => /(^|\/)(tests?|__tests__)(\/|$)|(?:^|\/)test[_-][^/]+|(?:[._-](?:test|spec)|_tests)\.[^.]+$/i.test(path);

/** `testedStem` from file-name patterns; group 1 of the first match is the stem. */
export function stemFrom(...patterns: RegExp[]): (path: string) => string | undefined {
  return (path) => { for (const p of patterns) { const m = path.match(p); if (m) return m[1]; } return undefined; };
}
