import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SERVER_VERSION } from "../../src/server.js";

const json = (file: string) => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));

it("reports the package.json version in the MCP initialize response", () => {
  expect(SERVER_VERSION).toBe(json("package.json").version);
});

it("keeps every release version field in step with package.json", () => {
  const v = json("package.json").version;
  const server = json("server.json");
  expect(server.version).toBe(v);
  for (const p of server.packages) expect(p.version).toBe(v);
  expect(json("plugins/rarefaction/.claude-plugin/plugin.json").version).toBe(v);
  expect(json("plugins/rarefaction/.codex-plugin/plugin.json").version).toBe(v);
});
