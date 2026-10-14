#!/usr/bin/env node
// stdio entry point. Usage: rarefaction-lsp-mcp [--root <path>] [--profile <id>]
//
// stdout is the MCP wire; everything diagnostic goes to stderr (see log.ts).

import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { log } from "./log.js";
import { Workspace } from "./workspace.js";
import { createServer } from "./server.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const rootPath = resolve(arg("--root") ?? (process.env.CLAUDE_PROJECT_DIR || process.cwd()));
  const wanted = arg("--profile");
  const session = await Workspace.load(rootPath, wanted);
  const server = createServer(session);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await session.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);
  await server.connect(new StdioServerTransport());
  log(`[rarefaction] serving source profiles for ${rootPath}`);
}

main().catch((err) => {
  log(`[rarefaction] fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
