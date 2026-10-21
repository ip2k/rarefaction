import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { canonicalPath } from "../fs.js";
import { exists, liveFreshness, matchesWorkspaceGlobs, outside, stemFrom, testFile, underPath, workspacePath } from "./common.js";
import type { Profile } from "./profile.js";

export const rustProfile: Profile = {
  id: "rust", displayName: "Rust (rust-analyzer)", extensions: [".rs"],
  rootMarkers: ["Cargo.toml", "rust-project.json"],
  // rust-analyzer started at a workspace root loads every member, and the
  // core keeps their files; started at a member, the other members' files are
  // outside the project and their callers drop out.
  async enclosingWorkspace(dir, member) {
    const root = await manifest(dir);
    const workspace = table(root?.workspace);
    if (!workspace) return undefined;
    const own = await manifest(member);
    if (table(own?.workspace)) return undefined; // a workspace root of its own
    // A member that names its workspace root is a member of that one only.
    const pointer = table(own?.package)?.workspace;
    if (typeof pointer === "string") return canonicalPath(resolve(member, pointer)) === canonicalPath(dir) ? "workspace" : undefined;
    const rel = workspacePath(dir, member);
    if (strings(workspace.exclude).some(prefix => underPath(rel, prefix))) return undefined;
    if (matchesWorkspaceGlobs(rel, strings(workspace.members))) return "workspace";
    // The root package's path dependencies are members without being listed.
    if (root && table(root.package) && pathDependencies(root).some(path => canonicalPath(resolve(dir, path)) === canonicalPath(member))) return "workspace";
    return undefined;
  },
  languageId: () => "rust",
  async detect(root) {
    const ok = await exists(join(root, "Cargo.toml")) || await exists(join(root, "rust-project.json"));
    if (!ok) return { ok, facts: [], advice: ["Point project at the Cargo.toml or rust-project.json directory."] };
    const facts = ["Rust workspace; cargo target/features may be set in .rarefaction.json"];
    const pinned = await pinnedToolchain(root);
    if (pinned && !await analyzerRuns(root)) {
      // rustup's proxy is on PATH either way; a pinned toolchain without the
      // component makes the server exit during initialization.
      return { ok: false, facts, advice: [`This project pins Rust ${pinned}, which lacks rust-analyzer: run \`rustup component add rust-analyzer --toolchain ${pinned}\`.`] };
    }
    return { ok, facts, advice: [] };
  },
  async launch() { return { command: "rust-analyzer", args: [], initializationOptions: {
    checkOnSave: false, cargo: { buildScripts: { enable: false } }, procMacro: { enable: false },
  } }; },
  freshness: root => liveFreshness(root, [".rs"]),
  isTestFile: path => testFile(path),
  testedStem: stemFrom(/(?:^|\/)tests\/([^/]+)\.rs$/, /(?:^|\/)([^/]+)_test\.rs$/),
  isTestCase: (_name, above) => /#\[(?:\w+::)?test\]/.test(above ?? ""),
  isExternal: outside,
  testRunHint: tests => ({ command: `cargo test ${JSON.stringify(tests[0]?.name.split("::").pop() ?? "")}`,
    note: "Runs the first discovered test filter; run other listed test cases separately. Embedded/no_std and Wasm projects may need a host test target or a configured runner." }),
};

type Table = Record<string, unknown>;
const table = (value: unknown): Table | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Table : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** A directory's parsed Cargo.toml; undefined when missing or not valid TOML. */
async function manifest(dir: string): Promise<Table | undefined> {
  try { return parseToml(await readFile(join(dir, "Cargo.toml"), "utf8")) as Table; } catch { return undefined; }
}

/** `path = "…"` dependencies of a manifest, including target-specific tables. */
function pathDependencies(cargo: Table): string[] {
  const tables = [cargo, ...Object.values(table(cargo.target) ?? {}).map(table)].filter((t): t is Table => t !== undefined);
  return tables.flatMap(t => ["dependencies", "dev-dependencies", "build-dependencies"].flatMap(kind =>
    Object.values(table(t[kind]) ?? {}).map(dep => table(dep)?.path).filter((p): p is string => typeof p === "string")));
}

/** The channel a rust-toolchain(.toml) pins, if any. */
async function pinnedToolchain(root: string): Promise<string | undefined> {
  for (const name of ["rust-toolchain.toml", "rust-toolchain"]) {
    try {
      const text = await readFile(join(root, name), "utf8");
      return text.match(/channel\s*=\s*"([^"]+)"/)?.[1] ?? (text.trim().split("\n")[0] || undefined);
    } catch { /* not pinned this way */ }
  }
  return undefined;
}

// Detection runs on every orient call; a server that started once keeps working.
const analyzerStarted = new Set<string>();

async function analyzerRuns(root: string): Promise<boolean> {
  if (analyzerStarted.has(root)) return true;
  try { await promisify(execFile)("rust-analyzer", ["--version"], { cwd: root, timeout: 20_000 }); } catch { return false; }
  analyzerStarted.add(root);
  return true;
}
