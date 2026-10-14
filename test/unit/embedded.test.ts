import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
it("prepares a JieLi analysis database without altering the build database", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rarefaction-db-"))); const input = join(root, "input.json"), output = join(root, "analysis/compile_commands.json");
  const text = JSON.stringify([{ directory: "/remote/project", file: "/remote/project/main.c", arguments: ["/opt/jieli/clang", "-target", "pi32v2", "-mcpu=r3", "-Xclang", "-target-feature", "-Xclang", "+fprev1", "-mllvm", "-pi32-feature", "-I/remote/project/include", "-DAC791N", "-c", "/remote/project/main.c"] }]);
  writeFileSync(input, text);
  try {
    const tool = resolve("tools/prepare_clangd.py");
    expect(() => execFileSync("python3", [tool, input, output, "--jieli"], { stdio: "pipe" })).toThrow();
    execFileSync("python3", [tool, input, output, "--jieli", "--analysis-target", "i386-unknown-none-elf", "--map", "/remote/project=" + root], { stdio: "pipe" });
    expect(readFileSync(input, "utf8")).toBe(text);
    const db = JSON.parse(readFileSync(output, "utf8"));
    expect(db[0].arguments).toContain("-DAC791N"); expect(db[0].arguments).toContain("-I" + root + "/include");
    expect(db[0].arguments).toContain("--target=i386-unknown-none-elf"); expect(db[0].arguments.join(" ")).not.toContain("pi32");
    expect(() => execFileSync("python3", [tool, input, input], { stdio: "pipe" })).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
