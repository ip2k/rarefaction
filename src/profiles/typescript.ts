import { createRequire } from "node:module";
import { join } from "node:path";
import { listSourceFiles } from "../fs.js";
import { exists, liveFreshness, outside, stemFrom, testFile } from "./common.js";
import type { Profile } from "./profile.js";
const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const require = createRequire(import.meta.url);
export const typescriptProfile: Profile = {
  id: "typescript", displayName: "TypeScript/JavaScript (typescript-language-server)", extensions,
  rootMarkers: ["tsconfig.json", "jsconfig.json"],
  languageId: path => /\.tsx$/.test(path) ? "typescriptreact" : /\.jsx$/.test(path) ? "javascriptreact" : /\.(ts|mts|cts)$/.test(path) ? "typescript" : "javascript",
  async detect(root) {
    const config = await exists(join(root, "tsconfig.json")) || await exists(join(root, "jsconfig.json"));
    const ok = config || (await listSourceFiles(root, extensions)).length > 0;
    return { ok, facts: [config ? "TypeScript/JavaScript project config found" : "Inferred TypeScript/JavaScript project"],
      advice: config ? [] : ["Use tsconfig.json/jsconfig.json to define source membership, module resolution and JSX settings."] };
  },
  async launch() { return { command: process.execPath, args: [require.resolve("typescript-language-server/lib/cli.mjs"), "--stdio"],
    initializationOptions: { tsserver: { path: require.resolve("typescript/lib/tsserver.js") } } }; },
  freshness: root => liveFreshness(root, extensions),
  isTestFile: testFile,
  testedStem: stemFrom(/(?:^|\/)([^/]+)\.(?:test|spec)\.[^./]+$/),
  stringLiteral: /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`\\$]*)`/g,
  isTestCase: name => /^(?:test|it|spec)(?:\b|[_A-Z])/.test(name),
  isExternal: outside,
  testRunHint: tests => ({ command: `npm test -- ${[...new Set(tests.map(t => t.relPath))].map(p => JSON.stringify(p)).join(" ")}`,
    note: "Check package.json: test filtering arguments depend on the project's test runner. Anonymous test callbacks may not appear in the call graph." }),
};
