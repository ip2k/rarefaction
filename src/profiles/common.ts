import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPath, isSkippedDir, listSourceFiles } from "../fs.js";
import type { Freshness } from "./profile.js";

export async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
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
