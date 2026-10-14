import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, it } from "vitest";

it("uses Claude's project root and lets explicit --root override it", async () => {
  const claudeRoot = resolve("fixtures/SamplePython");
  const explicitRoot = resolve("fixtures/SampleTypeScript");
  for (const [args, root, profile] of [[[], claudeRoot, "python"], [["--root", explicitRoot], explicitRoot, "typescript"]] as const) {
    const client = new Client({ name: "root-verification", version: "1" });
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [resolve("node_modules/tsx/dist/cli.mjs"), resolve("src/index.ts"), ...args],
      cwd: resolve("."), env: { ...env, CLAUDE_PROJECT_DIR: claudeRoot }, stderr: "pipe" });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "status", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.root).toBe(root);
      expect((result.structuredContent?.profiles as { id: string; ok: boolean }[])[0]).toMatchObject({ id: profile, ok: true });
    } finally { await client.close(); }
  }
});
