import { realpath, mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
const roots: string[] = [];
async function root() { const r = await realpath(await mkdtemp(join(tmpdir(), "rarefaction-route-"))); roots.push(r); return r; }
afterEach(async () => { await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true }))); });
describe("workspace routing", () => {
  it("routes mixed sources by extension and refuses to guess bare names", async () => {
    const r = await root(); await writeFile(join(r, "a.c"), "int scale(void) { return 0; }"); await writeFile(join(r, "a.ts"), "export const scale = 0;");
    const w = await Workspace.load(r);
    expect((await w.select({ symbol: "a.c:1:5" })).profile.id).toBe("c");
    expect((await w.select({ symbol: "a.ts:1:14" })).profile.id).toBe("typescript");
    await expect(w.select({ symbol: "scale" })).rejects.toThrow("Mixed-language");
  });
  it("routes to nested Cargo roots and preserves workspace-relative positions", async () => {
    const r = await root(); await mkdir(join(r, "driver/src"), { recursive: true });
    await writeFile(join(r, "driver/Cargo.toml"), "[package]\nname='sample'\nversion='0.1.0'");
    const w = await Workspace.load(r); const { session: s, warnings } = await w.route({ symbol: "driver/src/lib.rs:1:1" });
    expect(s.rootPath).toBe(join(r, "driver"));
    expect(warnings).toEqual([]);
    expect(w.symbolFor(s, "driver/src/lib.rs:1:1")).toBe(join(r, "driver/src/lib.rs") + ":1:1");
  });
  it("merges embedded/Wasm initialization settings and reports missing commands", async () => {
    const r = await root(); await writeFile(join(r, ".rarefaction.json"), JSON.stringify({ profiles: { rust: {
      command: process.execPath, initializationOptions: { cargo: { target: "wasm32-unknown-unknown" } },
    }, c: { command: "/missing/clangd" } } }));
    const w = await Workspace.load(r); const launch = await w.session("rust").profile.launch(r);
    expect(launch.initializationOptions).toMatchObject({ cargo: { target: "wasm32-unknown-unknown", buildScripts: { enable: false } }, checkOnSave: false });
    await expect(w.session("c").profile.launch(r)).rejects.toThrow("not found");
  });
  it("rejects unknown config keys and project traversal", async () => {
    const r = await root(); await writeFile(join(r, ".rarefaction.json"), '{"profiles":{"python":{"typo":true}}}');
    await expect(Workspace.load(r)).rejects.toThrow();
    await rm(join(r, ".rarefaction.json")); const w = await Workspace.load(r);
    expect(() => w.session("c", "../elsewhere")).toThrow("inside");
  });
});

async function files(r: string, tree: Record<string, string>) {
  for (const [path, text] of Object.entries(tree)) { await mkdir(dirname(join(r, path)), { recursive: true }); await writeFile(join(r, path), text); }
}
const crate = (name: string, extra = "") => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${extra}`;

describe("workspace routing for members of a larger workspace", () => {
  it("answers a member crate from its Cargo workspace, so sibling crates stay in the project", async () => {
    const r = await root();
    await files(r, { "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n', "crates/core/Cargo.toml": crate("core"), "crates/core/src/lib.rs": "pub fn scale() {}\n",
      "crates/app/Cargo.toml": crate("app"), "crates/app/src/lib.rs": "" });
    const w = await Workspace.load(r);
    const { session, warnings } = await w.route({ symbol: "crates/core/src/lib.rs:1:8" });
    expect(session.rootPath).toBe(r);
    expect(warnings).toEqual([]);
    expect(w.symbolFor(session, "crates/core/src/lib.rs:1:8")).toBe(join(r, "crates/core/src/lib.rs") + ":1:8");
    // An explicit project still wins.
    expect((await w.route({ symbol: "crates/core/src/lib.rs:1:8", project: "crates/core" })).session.rootPath).toBe(join(r, "crates/core"));
  });

  it("finds the workspace through a nested workspace directory, path dependencies and package.workspace", async () => {
    const r = await root();
    await files(r, {
      "rust/Cargo.toml": crate("root", '[dependencies]\nhelper = { path = "helper" }\n[target.\'cfg(unix)\'.dev-dependencies]\nunixy = { path = "unixy" }\n[workspace]\nmembers = ["tools/**"]\n'),
      "rust/helper/Cargo.toml": crate("helper"), "rust/helper/src/lib.rs": "",
      "rust/unixy/Cargo.toml": crate("unixy"), "rust/unixy/src/lib.rs": "",
      "rust/tools/gen/cli/Cargo.toml": crate("cli"), "rust/tools/gen/cli/src/main.rs": "",
      "rust/pinned/Cargo.toml": crate("pinned", '[package.metadata]\nnote = "x"\n').replace('edition = "2021"', 'edition = "2021"\nworkspace = ".."'), "rust/pinned/src/lib.rs": "",
    });
    const w = await Workspace.load(r);
    for (const file of ["rust/helper/src/lib.rs", "rust/unixy/src/lib.rs", "rust/tools/gen/cli/src/main.rs", "rust/pinned/src/lib.rs"]) {
      const { session, warnings } = await w.route({ symbol: `${file}:1:1` });
      expect([file, session.rootPath]).toEqual([file, join(r, "rust")]);
      expect(warnings).toEqual([]);
    }
  });

  it("keeps an excluded, unlisted or self-rooted crate where it is, and says what was left out", async () => {
    const r = await root();
    await files(r, {
      "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\nexclude = ["crates/vendored"]\n',
      "crates/vendored/Cargo.toml": crate("vendored"), "crates/vendored/src/lib.rs": "",
      "examples/demo/Cargo.toml": crate("demo"), "examples/demo/src/lib.rs": "",
      "crates/inner/Cargo.toml": '[workspace]\nmembers = ["a"]\n', "crates/inner/a/Cargo.toml": crate("a"), "crates/inner/a/src/lib.rs": "",
    });
    const w = await Workspace.load(r);
    for (const [file, project] of [["crates/vendored/src/lib.rs", "crates/vendored"], ["examples/demo/src/lib.rs", "examples/demo"]] as const) {
      const { session, warnings } = await w.route({ symbol: `${file}:1:1` });
      expect(session.rootPath).toBe(join(r, project));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`Answered from "${project}" only, the nearest directory with a Cargo.toml.`);
      expect(warnings[0]).toContain('The workspace root has its own Cargo.toml but does not list it as a workspace member');
      expect(warnings[0]).toContain('pass project "."');
    }
    // A crate of a workspace nested inside another: its own workspace answers.
    const inner = await w.route({ symbol: "crates/inner/a/src/lib.rs:1:1" });
    expect(inner.session.rootPath).toBe(join(r, "crates/inner"));
    expect(inner.warnings[0]).toContain('Answered from the workspace at "crates/inner" only.');
  });

  it("does not move a TypeScript package to its npm or pnpm workspace, and says callers in other packages are missing", async () => {
    const r = await root();
    const tsconfig = '{"include":["src"]}';
    await files(r, {
      "package.json": JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "packages/core/tsconfig.json": tsconfig, "packages/core/src/engine.ts": "export const scale = 1;\n",
      "apps/pnpm/pnpm-workspace.yaml": "# pnpm\npackages:\n  - 'pkgs/*' # all of them\n  - \"!pkgs/skip\"\ncatalog:\n  x: 1\n",
      "apps/pnpm/pkgs/web/tsconfig.json": tsconfig, "apps/pnpm/pkgs/web/src/index.ts": "export const web = 1;\n",
      "apps/pnpm/pkgs/skip/tsconfig.json": tsconfig, "apps/pnpm/pkgs/skip/src/index.ts": "export const skip = 1;\n",
    });
    const w = await Workspace.load(r);
    const core = await w.route({ symbol: "packages/core/src/engine.ts:1:14" });
    expect(core.session.rootPath).toBe(join(r, "packages/core"));
    expect(core.warnings).toEqual(['Answered from "packages/core" only, the nearest directory with a tsconfig.json. The workspace root groups it with other packages, but the language server answers one package at a time, so callers in other packages are not listed, even with project set.']);
    const web = await w.route({ symbol: "apps/pnpm/pkgs/web/src/index.ts:1:14" });
    expect(web.session.rootPath).toBe(join(r, "apps/pnpm/pkgs/web"));
    expect(web.warnings[0]).toContain('"apps/pnpm" groups it with other packages');
    // Negated in pnpm-workspace.yaml, and the root's workspaces do not reach it.
    expect((await w.route({ symbol: "apps/pnpm/pkgs/skip/src/index.ts:1:14" })).warnings).toEqual([]);
  });
});
