import { createRequire } from "node:module";
import { join } from "node:path";
import { listSourceFiles } from "../fs.js";
import { exists, liveFreshness, outside, stemFrom, testFile } from "./common.js";
import type { Profile } from "./profile.js";
const require = createRequire(import.meta.url);
export const pythonProfile: Profile = {
  id: "python", displayName: "Python (Pyright)", extensions: [".py", ".pyi"],
  rootMarkers: ["pyrightconfig.json", "pyproject.toml", "setup.py"],
  languageId: () => "python",
  async detect(root) {
    const ok = await exists(join(root, "pyproject.toml")) || await exists(join(root, "pyrightconfig.json")) || (await listSourceFiles(root, [".py", ".pyi"])).length > 0;
    return { ok, facts: ok ? ["Python sources/project; Pyright; hierarchy/reference capabilities are probed at runtime"] : [],
      advice: ["Configure venv, interpreter and import paths using pyrightconfig.json or profiles.python.initializationOptions in .rarefaction.json."] };
  },
  async launch() { return { command: process.execPath, args: [require.resolve("pyright/dist/pyright-langserver.js"), "--stdio"],
    initializationOptions: { python: { analysis: { diagnosticMode: "openFilesOnly", typeCheckingMode: "off" } } } }; },
  freshness: root => liveFreshness(root, [".py", ".pyi"]),
  isTestFile: testFile,
  testedStem: stemFrom(/(?:^|\/)test_([^/]+)\.py$/, /(?:^|\/)([^/]+)_test\.py$/),
  stringLiteral: /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g,
  isTestCase: name => /(?:^|\.)test_/.test(name),
  isExternal: outside,
  testRunHint: tests => ({ command: `python -m pytest ${[...new Set(tests.map(t => t.relPath))].map(p => JSON.stringify(p)).join(" ")}`,
    note: "Uses pytest file selection; use the project's configured environment and runner if different." }),
};
