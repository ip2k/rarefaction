import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rustProfile } from "../../src/profiles/rust.js";

describe("rust profile detection", () => {
  const originalPath = process.env.PATH;
  let dir: string;
  afterEach(async () => { process.env.PATH = originalPath; await rm(dir, { recursive: true, force: true }); });

  async function workspace(analyzerExit: number, pin?: string): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "rarefaction-rust-"));
    const bin = join(dir, "bin");
    await mkdir(bin);
    // Stands in for rustup's proxy when the pinned toolchain lacks the component.
    await writeFile(join(bin, "rust-analyzer"), `#!/bin/sh\nexit ${analyzerExit}\n`);
    await chmod(join(bin, "rust-analyzer"), 0o755);
    process.env.PATH = `${bin}${delimiter}${originalPath}`;
    const root = join(dir, "ws");
    await mkdir(root);
    await writeFile(join(root, "Cargo.toml"), "[package]\nname = \"ws\"\nversion = \"0.1.0\"\n");
    if (pin) await writeFile(join(root, "rust-toolchain.toml"), `[toolchain]\nchannel = "${pin}"\n`);
    return root;
  }

  it("reports a pinned toolchain without rust-analyzer, with the command that fixes it", async () => {
    const d = await rustProfile.detect(await workspace(1, "1.94.1"));
    expect(d.ok).toBe(false);
    expect(d.advice.join(" ")).toContain("rustup component add rust-analyzer --toolchain 1.94.1");
  });

  it("accepts a pinned toolchain whose rust-analyzer starts", async () => {
    expect((await rustProfile.detect(await workspace(0, "1.94.1"))).ok).toBe(true);
  });

  it("does not spawn anything when no toolchain is pinned", async () => {
    expect((await rustProfile.detect(await workspace(1))).ok).toBe(true);
  });
});
