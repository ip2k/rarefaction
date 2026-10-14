import { realpathSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// Every dot-directory is skipped too (.git, .build, .claude worktrees, …).
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set(["DerivedData", "node_modules", "Pods", "Carthage", "target", "build", "dist", "out", "coverage"]);

export function isSkippedDir(name: string, skipDirs: ReadonlySet<string> = DEFAULT_SKIP_DIRS): boolean {
  return name.startsWith(".") || skipDirs.has(name);
}

export interface SourceFile {
  path: string;
  mtimeMs: number;
}

/** Every file under root with one of `extensions`, skipping build/package dirs. */
export async function listSourceFiles(
  root: string,
  extensions: readonly string[],
  skipDirs: ReadonlySet<string> = DEFAULT_SKIP_DIRS,
): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!isSkippedDir(e.name, skipDirs)) await walk(full);
      } else if (e.isFile() && extensions.some((x) => e.name.endsWith(x))) {
        const s = await stat(full);
        out.push({ path: full, mtimeMs: s.mtimeMs });
      }
    }
  }
  await walk(root);
  return out;
}

/** LSP servers can return different spellings of a symlinked path. */
export function canonicalPath(path: string): string {
  try { return realpathSync.native(path); } catch { return path; }
}
