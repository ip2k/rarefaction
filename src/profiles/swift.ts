// Swift via sourcekit-lsp.
//
// Two workspace shapes matter:
//   - SwiftPM package (Package.swift): sourcekit-lsp builds and indexes on its
//     own (background indexing). Freshness is "on-open".
//   - Xcode project (.xcodeproj / .xcworkspace): sourcekit-lsp needs compiler
//     flags from a Build Server Protocol server; `xcode-build-server` writes a
//     buildServer.json that points at Xcode's DerivedData. The index there is
//     only as fresh as the last build, so freshness is "on-build".

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPath, isSkippedDir, listSourceFiles } from "../fs.js";
import type { LaunchSpec } from "../lsp/client.js";
import type { Detection, Freshness, Profile, TestRunHint } from "./profile.js";

const execFileP = promisify(execFile);

interface BuildServerJson {
  build_root?: string;
  kind?: string;
  scheme?: string;
  workspace?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findFirst(root: string, predicate: (name: string) => boolean): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.find((e) => predicate(e.name))?.name;
}

/** Newest mtime of files matching `ext` under root, skipping build/package dirs. */
async function newestSource(root: string, ext: string): Promise<Date | undefined> {
  const files = await listSourceFiles(root, [ext]);
  if (files.length === 0) return undefined;
  return new Date(Math.max(...files.map((f) => f.mtimeMs)));
}

/** Time of the last Xcode build, read from the newest activity log in DerivedData. */
async function lastBuildAt(buildRoot: string): Promise<Date | undefined> {
  const logs = join(buildRoot, "Logs", "Build");
  let newest: number | undefined;
  try {
    for (const name of await readdir(logs)) {
      if (!name.endsWith(".xcactivitylog")) continue;
      const s = await stat(join(logs, name));
      if (newest === undefined || s.mtimeMs > newest) newest = s.mtimeMs;
    }
  } catch {
    return undefined;
  }
  return newest === undefined ? undefined : new Date(newest);
}

async function readBuildServer(root: string): Promise<BuildServerJson | undefined> {
  try {
    return JSON.parse(await readFile(join(root, "buildServer.json"), "utf8")) as BuildServerJson;
  } catch {
    return undefined;
  }
}

export const swiftProfile: Profile = {
  id: "swift",
  displayName: "Swift (sourcekit-lsp)",
  extensions: [".swift"],

  rootMarkers: ["Package.swift"],
  languageId: () => "swift",

  async detect(root) {
    const facts: string[] = [];
    const advice: string[] = [];
    const pkg = await exists(join(root, "Package.swift"));
    const xcodeproj = await findFirst(root, (n) => n.endsWith(".xcodeproj") || n.endsWith(".xcworkspace"));
    const bsp = await readBuildServer(root);

    if (pkg) facts.push("SwiftPM package (Package.swift) — sourcekit-lsp indexes in the background");
    if (xcodeproj) facts.push(`Xcode project: ${xcodeproj}`);
    if (bsp) {
      facts.push(`buildServer.json: kind=${bsp.kind ?? "?"} scheme=${bsp.scheme ?? "?"}`);
      if (bsp.build_root) facts.push(`build_root: ${bsp.build_root}`);
    }

    let ok = true;
    if (xcodeproj && !bsp && !pkg) {
      ok = false;
      advice.push(
        "This is an Xcode project without buildServer.json, so sourcekit-lsp has no compiler flags and cannot see across files.",
        `Fix: brew install xcode-build-server && cd ${root} && xcode-build-server config -project ${xcodeproj} -scheme <Scheme>`,
        "Then build once (Xcode, or xcodebuild) so the index exists. Add buildServer.json to .gitignore.",
      );
    } else if (!xcodeproj && !pkg) {
      ok = false;
      advice.push("No Package.swift or .xcodeproj found at the root; point --root at the project.");
    }
    try {
      const { stdout } = await execFileP("xcrun", ["--find", "sourcekit-lsp"]);
      facts.push(`sourcekit-lsp: ${stdout.trim()}`);
    } catch {
      ok = false;
      advice.push("sourcekit-lsp not found: install Xcode or a Swift toolchain (xcrun --find sourcekit-lsp must succeed).");
    }
    return { ok, facts, advice };
  },

  async launch(): Promise<LaunchSpec> {
    // Resolve through xcrun so the server matches the active Xcode; the build
    // server's flags and the index must come from the same toolchain.
    const { stdout } = await execFileP("xcrun", ["--find", "sourcekit-lsp"]);
    return { command: stdout.trim(), args: [] };
  },

  async freshness(root): Promise<Freshness> {
    const bsp = await readBuildServer(root);
    const newestSourceAt = await newestSource(root, ".swift");
    if (!bsp?.build_root) {
      return { model: "on-open", stale: false, ...(newestSourceAt ? { newestSourceAt } : {}) };
    }
    const indexedAt = await lastBuildAt(bsp.build_root);
    const stale = Boolean(indexedAt && newestSourceAt && newestSourceAt > indexedAt) || !indexedAt;
    const out: Freshness = { model: "on-build", stale };
    if (indexedAt) out.indexedAt = indexedAt;
    if (newestSourceAt) out.newestSourceAt = newestSourceAt;
    if (stale) {
      out.advice = indexedAt
        ? "A source file is newer than the last build; callers/callees may be missing or wrong until you build again."
        : "No build log found in build_root; build the scheme once so the index and compiler flags exist.";
    }
    return out;
  },

  testedStem: (relPath) => relPath.match(/(?:^|\/)([^/]+)Tests\.swift$/)?.[1],

  isTestFile(relPath) {
    const parts = relPath.split("/");
    return parts.some((p) => p === "Tests" || p.endsWith("Tests")) || basename(relPath).endsWith("Tests.swift");
  },

  isTestCase(symbolName, lineAbove) {
    // XCTest: `func testSomething()`. Swift Testing: any func annotated `@Test`.
    const bare = symbolName.split(".").pop() ?? symbolName;
    if (/^test[A-Z_0-9]/.test(bare)) return true;
    return Boolean(lineAbove && /@Test\b/.test(lineAbove));
  },

  isExternal(uri, root) {
    const path = canonicalPath(fileURLToPath(uri));
    const rel = relative(root, path);
    if (rel.startsWith("..")) return true; // SDK .swiftinterface, other toolchain files
    // Inside the tree but not ours: package checkouts and build products.
    return rel.split("/").some((p) => isSkippedDir(p)) || extname(path) === ".swiftinterface";
  },

  testRunHint(tests): TestRunHint {
    // sourcekit-lsp names methods "Type.method(args:)"; xcodebuild wants
    // Target/Class/method. The test target's name is not knowable from the
    // language server, so leave it as a placeholder the agent fills in.
    const classes = new Set<string>();
    for (const t of tests) {
      const cls = t.name.split(".")[0];
      if (cls) classes.add(cls);
    }
    const only = [...classes].map((c) => `-only-testing:<TestTarget>/${c}`).join(" ");
    return {
      command: `xcodebuild test -scheme <Scheme> -destination 'platform=iOS Simulator,name=<Device>' ${only}`,
      note: "Replace <TestTarget>, <Scheme> and <Device>; for a SwiftPM package use `swift test --filter <Class>`.",
    };
  },
};
