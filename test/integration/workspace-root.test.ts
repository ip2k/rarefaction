import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";
import { executable } from "../../src/profiles/common.js";
import { orient } from "../../src/tools/orient.js";
import { Workspace } from "../../src/workspace.js";

// A rustup proxy exists on PATH even without the rust-analyzer component, so
// the server must actually start to count as present.
async function runs(command: string): Promise<boolean> {
  if (!await executable(command)) return false;
  try { execFileSync(command, ["--version"], { stdio: "ignore", timeout: 10_000 }); return true; } catch { return false; }
}

const bounds = { up: 2, down: 1, max_nodes: 50, include_body: false, max_body_lines: 20 };

describe.skipIf(!await runs("rust-analyzer"))("a position in a Cargo workspace member", () => {
  it("is answered from the workspace, so callers in sibling crates are listed", async () => {
    // A copy, so rust-analyzer's Cargo.lock and target/ stay out of the fixture.
    const root = await realpath(await mkdtemp(join(tmpdir(), "rarefaction-cargo-ws-")));
    await cp(resolve("fixtures/SampleCargoWorkspace"), root, { recursive: true });
    const workspace = await Workspace.load(root);
    try {
      const position = "crates/core/src/lib.rs:2:8";
      const { session, warnings } = await workspace.route({ symbol: position });
      expect(session.rootPath).toBe(root);
      expect(warnings).toEqual([]);
      const whole = await orient(session, { ...bounds, symbol: workspace.symbolFor(session, position) });
      expect(whole.callers.map(c => c.name).sort()).toEqual(expect.arrayContaining(["render", "twice"]));
      expect(whole.callers.find(c => c.name === "render")?.file).toBe("crates/app/src/lib.rs");

      // The member crate alone, as every query without project was answered before.
      const member = (await workspace.route({ symbol: position, project: "crates/core" })).session;
      const narrow = await orient(member, { ...bounds, symbol: workspace.symbolFor(member, position) });
      expect(narrow.callers.map(c => c.name)).toContain("twice");
      expect(narrow.callers.map(c => c.name)).not.toContain("render");
    } finally { await workspace.close(); await rm(root, { recursive: true, force: true }); }
  });
});

it("says through MCP when a TypeScript workspace package is answered on its own", async () => {
  const root = resolve("fixtures/SampleTsWorkspace");
  const client = new Client({ name: "workspace-root", version: "1" });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve("node_modules/tsx/dist/cli.mjs"), resolve("src/index.ts"), "--root", root],
    cwd: resolve("."), env, stderr: "pipe" });
  try {
    await client.connect(transport);
    expect(client.getServerVersion()?.version).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
    const result = await client.callTool({ name: "orient", arguments: { symbol: "packages/core/src/engine.ts:2:17", up: 1, down: 1, include_body: false } });
    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as { callers: { name: string }[]; warnings?: string[] };
    expect(structured.callers.map(c => c.name)).toContain("twice");
    const warning = 'Answered from "packages/core" only, the nearest directory with a tsconfig.json. The workspace root groups it with other packages';
    expect(structured.warnings?.[0]).toContain(warning);
    const text = (result.content as { type: string; text?: string }[]).map(c => c.text ?? "").join("\n");
    expect(text).toContain(warning);
  } finally { await client.close(); }
});
