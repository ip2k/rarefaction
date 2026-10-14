import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { exists, liveFreshness, outside, testFile } from "./common.js";
import type { Profile } from "./profile.js";

export const rustProfile: Profile = {
  id: "rust", displayName: "Rust (rust-analyzer)", extensions: [".rs"],
  rootMarkers: ["Cargo.toml", "rust-project.json"],
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
  isTestCase: (_name, above) => /#\[(?:\w+::)?test\]/.test(above ?? ""),
  isExternal: outside,
  testRunHint: tests => ({ command: `cargo test ${JSON.stringify(tests[0]?.name.split("::").pop() ?? "")}`,
    note: "Runs the first discovered test filter; run other listed test cases separately. Embedded/no_std and Wasm projects may need a host test target or a configured runner." }),
};

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
