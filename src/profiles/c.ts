import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { listSourceFiles } from "../fs.js";
import { exists, liveFreshness, outside, testFile } from "./common.js";
import type { Profile } from "./profile.js";

const extensions = [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"];
export const cProfile: Profile = {
  id: "c", displayName: "C/C++ (clangd)", extensions,
  collapseDeclarations: true,
  needsSourceScan: async root => !(await exists(join(root, "compile_commands.json"))),
  rootMarkers: ["compile_commands.json", "compile_flags.txt"],
  languageId: path => /\.(cc|cpp|cxx|hpp|hh|hxx)$/.test(path) ? "cpp" : "c",
  async detect(root) {
    const database = await exists(join(root, "compile_commands.json"));
    const flags = await exists(join(root, "compile_flags.txt"));
    const ok = database || flags || (await listSourceFiles(root, extensions)).length > 0;
    const advice: string[] = [];
    if (!database && !flags) advice.push("No root compilation database: clangd will search source ancestors and use fallback flags otherwise. Generate compile_commands.json with the real include paths and defines for reliable cross-file results. Without it, exact-position queries may miss unopened callers; named queries scan at most 200 source files.");
    if (database) {
      const commands = await readFile(join(root, "compile_commands.json"), "utf8");
      if (/pi32|q32s/.test(commands)) advice.push("JieLi custom ISA flags are unsupported by upstream clangd. Use a separate analysis database; see docs/embedded.md. Analysis cannot verify pi32v2 ABI, assembly or code generation.");
    }
    return { ok, facts: [database ? "compile_commands.json found" : flags ? "compile_flags.txt found" : "C/C++ sources; fallback or per-directory flags", "clangd indexes source on open/background; compilation flags must match the selected build variant"], advice };
  },
  async launch() { return { command: "clangd", args: ["--background-index", "--limit-results=0", "--log=error", "-j=2"] }; },
  freshness: root => liveFreshness(root, extensions),
  isTestFile: testFile,
  isTestCase: (name, above) => /^test[_A-Z]|^TEST(?:_F|_P)?\b/.test(name) || /\bTEST(?:_F|_P)?\s*\(/.test(above ?? ""),
  isExternal: outside,
  testRunHint: () => ({ command: "ctest --test-dir <build-directory> -R <test-name>", note: "Replace placeholders for a CMake/CTest project; otherwise use the project's test runner. Do not flash hardware to run orientation checks." }),
};
