// Manual driver: spawn the built server over stdio and call one tool.
//
//   npx tsx scripts/try.ts --root /path/to/project orient '{"symbol":"updateLocation"}'
//   npx tsx scripts/try.ts --root /path/to/project status
//
// Prints the text content, then the size of the structured result — the two
// numbers the measurement doc cares about.

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const root = resolve(arg("--root") ?? process.cwd());
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--root");
  const tool = positional[0] ?? "status";
  const args = positional[1] ? (JSON.parse(positional[1]) as Record<string, unknown>) : {};

  const client = new Client({ name: "try", version: "0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [resolve(import.meta.dirname, "..", "dist", "index.js"), "--root", root],
    stderr: "inherit",
  });
  await client.connect(transport);

  const t0 = Date.now();
  const result = await client.callTool({ name: tool, arguments: args });
  const ms = Date.now() - t0;
  const text = (result.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  process.stdout.write(text + "\n");
  const structured = result.structuredContent ? JSON.stringify(result.structuredContent) : "";
  process.stdout.write(
    `\n--- ${tool}: ${result.isError ? "ERROR " : ""}text ${text.length} bytes, structured ${structured.length} bytes, ${ms} ms round trip\n`,
  );
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
