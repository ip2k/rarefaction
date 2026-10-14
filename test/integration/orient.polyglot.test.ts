import { resolve } from "node:path";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { cProfile } from "../../src/profiles/c.js";
import { rustProfile } from "../../src/profiles/rust.js";
import { typescriptProfile } from "../../src/profiles/typescript.js";
import { wasmProfile } from "../../src/profiles/wasm.js";
import { executable } from "../../src/profiles/common.js";
import { Session } from "../../src/session.js";
import { orient } from "../../src/tools/orient.js";

// A rustup proxy exists on PATH even without the rust-analyzer component, so
// native servers must actually start to count as present.
async function runs(command: string): Promise<boolean> {
  if (!await executable(command)) return false;
  const { execFileSync } = await import("node:child_process");
  try { execFileSync(command, ["--version"], { stdio: "ignore", timeout: 10_000 }); return true; } catch { return false; }
}

const input = { symbol: "scale", up: 2, down: 1, max_nodes: 50, include_body: true, max_body_lines: 20 };
for (const [profile, fixture, command] of [[cProfile, "SampleC", "clangd"], [rustProfile, "SampleRust", "rust-analyzer"], [typescriptProfile, "SampleTypeScript", process.execPath], [wasmProfile, "SampleWasm", "wat_server"]] as const) {
  describe.skipIf(!await (command === "clangd" || command === "rust-analyzer" ? runs(command) : executable(command)))(`${profile.id} real language server`, () => {
    it("resolves the body and callers through the language server", async () => {
      const session = new Session(resolve("fixtures", fixture), profile);
      try {
        const result = await orient(session, input);
        expect(result.body?.text).toContain(profile.id === "wasm" ? "i32.mul" : profile.id === "rust" ? "value * 2" : "value * 2");
        expect(result.callers.some(c => c.name.includes("render"))).toBe(true);
        expect(result.live_files.some(f => f.includes(profile.id === "wasm" ? ".wat" : profile.id === "rust" ? ".rs" : profile.id === "c" ? ".c" : ".ts"))).toBe(true);
        if (profile.id !== "wasm") expect(result.tests.some(t => t.is_test_case)).toBe(true);
        expect(result.truncated).toBe(false);
        if (profile.id === "typescript") {
          const bounded = await orient(session, { ...input, max_nodes: 1 });
          expect(bounded.callers).toHaveLength(1);
          expect(bounded.truncated).toBe(true);
        }
      } finally { await session.close(); }
    });
  });
}

it("updates TypeScript bodies and LSP state after edits in one session", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "rarefaction-edit-"));
  await cp(resolve("fixtures/SampleTypeScript"), root, { recursive: true });
  const session = new Session(root, typescriptProfile);
  try {
    const before = await orient(session, input);
    expect(before.body?.text).toContain("value * 2");
    const file = resolve(root, "engine.ts");
    await writeFile(file, (await readFile(file, "utf8")).replace("value * 2", "value * 7"));
    const after = await orient(session, input);
    expect(after.body?.text).toContain("value * 7");
    expect(after.stats.cold_start).toBe(false);
  } finally { await session.close(); await rm(root, { recursive: true, force: true }); }
});

it("Python degrades to references and enclosing symbols without inventing call edges", async () => {
  const { pythonProfile } = await import("../../src/profiles/python.js");
  const session = new Session(resolve("fixtures/SamplePython"), pythonProfile);
  try {
    const full = await orient(session, input);
    expect(full.callers.some(c => c.name === "render")).toBe(true);
    expect(full.tests.some(t => t.is_test_case)).toBe(true);
    // Simulate an LSP version without this optional capability on the same
    // real Pyright connection; reference queries still go to the server.
    const client = await session.lsp();
    client.capabilities.callHierarchyProvider = false;
    const result = await orient(session, input);
    expect(result.body?.text).toContain("value * 2");
    expect(result.symbol.callable).toBe(true);
    expect(result.callers).toEqual([]);
    expect(result.callees).toEqual([]);
    expect(result.references?.some(r => r.file === "render.py")).toBe(true);
    expect(result.reference_contexts?.some(r => r.name === "render")).toBe(true);
    expect(result.tests.some(t => t.name === "test_scale" && t.is_test_case)).toBe(true);
    expect(result.warnings?.join(" ")).toContain("Call hierarchy unavailable");
  } finally { await session.close(); }
});

it.skipIf(!await runs("clangd"))("analyzes separate JieLi and wasm32 C databases with clangd", async () => {
  const { execFileSync } = await import("node:child_process");
  const root = await mkdtemp(resolve(tmpdir(), "rarefaction-target-"));
  await cp(resolve("fixtures/SampleC"), root, { recursive: true });
  await rm(resolve(root, "compile_flags.txt"));
  try {
    for (const target of ["i386-unknown-none-elf", "wasm32-unknown-unknown"]) {
      const db = ["engine.c", "render.c", "test_engine.c"].map(file => ({ directory: root, file: resolve(root, file), arguments: ["clang", "-target", "pi32v2", "-mcpu=r3", "-std=c99", "-I.", "-c", resolve(root, file)] }));
      const inputDb = resolve(root, "firmware.json"), analysisDb = resolve(root, "compile_commands.json");
      await writeFile(inputDb, JSON.stringify(db));
      execFileSync("python3", [resolve("tools/prepare_clangd.py"), inputDb, analysisDb, "--jieli", "--analysis-target", target, "--force"], { stdio: "pipe" });
      const session = new Session(root, cProfile);
      try {
        const result = await orient(session, { ...input, symbol: resolve(root, "engine.c") + ":3:5" });
        expect(result.body?.text).toContain("value * 2");
        expect(result.callers.some(c => c.name === "render")).toBe(true);
        if (target.startsWith("i386")) {
          const file = resolve(root, "render.c");
          const text = await readFile(file, "utf8");
          await writeFile(file, text.replace("return scale(value)", "return value"));
          const updated = await orient(session, { ...input, symbol: resolve(root, "engine.c") + ":3:5" });
          expect(updated.callers.some(c => c.name === "render")).toBe(false);
          await writeFile(file, text);
        }
      } finally { await session.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
