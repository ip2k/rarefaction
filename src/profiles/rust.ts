import { join } from "node:path";
import { exists, liveFreshness, outside, testFile } from "./common.js";
import type { Profile } from "./profile.js";

export const rustProfile: Profile = {
  id: "rust", displayName: "Rust (rust-analyzer)", extensions: [".rs"],
  rootMarkers: ["Cargo.toml", "rust-project.json"],
  languageId: () => "rust",
  async detect(root) {
    const ok = await exists(join(root, "Cargo.toml")) || await exists(join(root, "rust-project.json"));
    return { ok, facts: ok ? ["Rust workspace; cargo target/features may be set in .rarefaction.json"] : [],
      advice: ok ? [] : ["Point project at the Cargo.toml or rust-project.json directory."] };
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
