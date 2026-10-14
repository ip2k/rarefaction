import { listSourceFiles } from "../fs.js";
import { liveFreshness, outside, testFile } from "./common.js";
import type { Profile } from "./profile.js";
export const wasmProfile: Profile = {
  id: "wasm", displayName: "WebAssembly text (wat_server)", extensions: [".wat"],
  languageId: () => "wat",
  async detect(root) {
    const ok = (await listSourceFiles(root, [".wat"])).length > 0;
    return { ok, facts: ok ? ["WebAssembly text sources (.wat)"] : [], advice: ["Binary .wasm is not source: disassemble it to .wat first. Rust/C/TypeScript compiled to Wasm use their source-language profile. WAST test scripts are not supported by this server."] };
  },
  async launch() { return { command: "wat_server", args: [] }; },
  freshness: root => liveFreshness(root, [".wat"]),
  isTestFile: testFile, isTestCase: () => false, isExternal: outside,
  testRunHint: () => ({ command: "<project-wasm-test-command>", note: "Use the project's Wasm runtime/harness; a WAT function is not automatically a test." }),
};
