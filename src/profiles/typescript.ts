import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { listSourceFiles } from "../fs.js";
import { exists, liveFreshness, matchesWorkspaceGlobs, outside, stemFrom, testFile, workspacePath } from "./common.js";
import type { Profile } from "./profile.js";
const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const require = createRequire(import.meta.url);
export const typescriptProfile: Profile = {
  id: "typescript", displayName: "TypeScript/JavaScript (typescript-language-server)", extensions,
  rootMarkers: ["tsconfig.json", "jsconfig.json"],
  // tsserver answers call hierarchy inside one tsconfig project, whatever
  // directory the language server was started in, so an enclosing workspace
  // is reported rather than routed to.
  async enclosingWorkspace(dir, member) {
    if (await exists(join(dir, "tsconfig.json")) || await exists(join(dir, "jsconfig.json"))) return "group";
    const patterns = [...await packageJsonWorkspaces(dir), ...await pnpmWorkspaces(dir)];
    return matchesWorkspaceGlobs(workspacePath(dir, member), patterns) ? "group" : undefined;
  },
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

/** npm and yarn `workspaces` globs from a directory's package.json. */
async function packageJsonWorkspaces(dir: string): Promise<string[]> {
  let workspaces: unknown;
  try { workspaces = (JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { workspaces?: unknown }).workspaces; } catch { return []; }
  const list = Array.isArray(workspaces) ? workspaces : (workspaces as { packages?: unknown } | undefined)?.packages;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
}

/** pnpm `packages` globs from pnpm-workspace.yaml; every subdirectory when the list is absent. */
async function pnpmWorkspaces(dir: string): Promise<string[]> {
  let text: string;
  try { text = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8"); } catch { return []; }
  const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");
  const out: string[] = [];
  let inList = false;
  for (const line of text.split(/\r?\n/)) {
    const key = line.match(/^packages\s*:\s*(.*?)\s*(?:#.*)?$/);
    if (key) {
      const inline = key[1]!.match(/^\[(.*)\]$/);
      if (inline) out.push(...inline[1]!.split(",").map(unquote).filter(Boolean));
      inList = !inline;
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s+-\s*(.+?)\s*(?:#.*)?$/);
    if (item) out.push(unquote(item[1]!));
    else if (/^\S/.test(line)) inList = false;
  }
  return /^packages\s*:/m.test(text) ? out : ["**"];
}
