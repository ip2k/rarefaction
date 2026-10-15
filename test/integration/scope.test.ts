import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typescriptProfile } from "../../src/profiles/typescript.js";
import { Session } from "../../src/session.js";
import { scope, type ScopeOutputType } from "../../src/tools/scope.js";

// A copy of the TypeScript fixture with a made-up history in which config.ts,
// which no code calls, keeps changing together with engine.ts.
describe("scope", () => {
  let root: string;
  let session: Session;
  let result: ScopeOutputType;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rarefaction-scope-"));
    await cp(resolve("fixtures/SampleTypeScript"), root, { recursive: true });
    const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "root");
    for (let i = 0; i < 3; i++) {
      await writeFile(join(root, "config.ts"), `export const VERSION = ${i};\n`);
      await writeFile(join(root, "engine.ts"), `/** Double one input sample. */\nexport function scale(value: number): number {\n  return value * 2;\n}\n// ${i}\n`);
      git("add", "-A");
      git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", `change ${i}`);
    }
    session = new Session(root, typescriptProfile);
    result = await scope(session, { symbol: "scale", up: 2, down: 1, max_nodes: 50 });
  }, 120_000);

  afterAll(async () => {
    await session?.close();
    await rm(root, { recursive: true, force: true });
  });

  it("starts from the symbol's file and keeps orient's call-graph files", () => {
    expect(result.files[0]?.file).toBe("engine.ts");
    expect(result.files[0]?.sources).toContain("symbol");
    const files = result.files.map((f) => f.file);
    expect(files).toEqual(expect.arrayContaining(["engine.ts", "render.ts", "engine.test.ts"]));
    expect(result.files.find((f) => f.file === "render.ts")?.reasons.join(" ")).toContain("caller render");
  });

  it("adds a file the call graph cannot see, from co-change history, with its reason", () => {
    const config = result.files.find((f) => f.file === "config.ts");
    expect(config?.sources).toEqual(["co_change"]);
    expect(config?.reasons[0]).toBe("changed with engine.ts in 3 of 3 commits");
    expect(result.counts.co_change_only).toBe(1);
    expect(result.co_change.anchor_commits).toBe(3);
  });

  it("says it is advisory", () => {
    expect(result.warnings.join(" ")).toContain("not a boundary");
  });
});
