import { realpath, mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
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
    const w = await Workspace.load(r); const s = await w.select({ symbol: "driver/src/lib.rs:1:1" });
    expect(s.rootPath).toBe(join(r, "driver"));
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
