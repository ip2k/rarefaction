// Exercise the registered MCP through Codex's local app-server. No model turn
// is submitted; the verification thread is ephemeral and never persisted.
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
const codex = process.env.RAREFACTION_CODEX ?? "codex";
const inventory = spawnSync(codex, ["mcp", "list", "--json"], { encoding: "utf8" });
if (inventory.status !== 0) throw new Error(inventory.stderr);
const config = Object.fromEntries(JSON.parse(inventory.stdout).filter(s => s.name !== "rarefaction").flatMap(s => [[`mcp_servers.${s.name}.enabled`, false], [s.transport.type === "stdio" ? `mcp_servers.${s.name}.command` : `mcp_servers.${s.name}.url`, s.transport.command ?? s.transport.url]]));
const child = spawn(codex, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", () => {});
const pending = new Map(); let id = 0;
const deadline = setTimeout(() => { child.kill(); console.error("Codex verification timed out"); process.exitCode = 1; }, 180_000);
createInterface({ input: child.stdout }).on("line", line => {
  const response = JSON.parse(line);
  if (pending.has(response.id)) {
    const p = pending.get(response.id); pending.delete(response.id);
    response.error ? p.reject(new Error(JSON.stringify(response.error))) : p.resolve(response.result);
  } else if (response.id !== undefined) child.stdin.write(JSON.stringify({ id: response.id, error: { code: -32601, message: "Unsupported verification-client request" } }) + "\n");
});
child.on("error", error => { for (const p of pending.values()) p.reject(error); });
child.on("exit", () => { for (const p of pending.values()) p.reject(new Error("Codex app-server exited")); });
function request(method, params) {
  return new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject });
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + "\n");
  });
}
try {
  await request("initialize", { clientInfo: { name: "rarefaction-verification", version: "0.2.0" }, capabilities: { experimentalApi: true, explicitGatewayOauth: true } });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const { thread } = await request("thread/start", { cwd: resolve(import.meta.dirname, ".."), ephemeral: true, config });
  const servers = await request("mcpServerStatus/list", { threadId: thread.id, serverName: "rarefaction" });
  const server = servers.data.find(s => s.name === "rarefaction");
  if (!server?.tools.orient || !server.tools.status) throw new Error("Registered tools were not discovered");
  for (const [profile, project, symbol] of [
    ["swift", "fixtures/SamplePackage", "Engine.updateLocation"],
    ["rust", "fixtures/SampleRust", "scale"],
    ["c", "fixtures/SampleC", "scale"],
    ["typescript", "fixtures/SampleTypeScript", "scale"],
    ["python", "fixtures/SamplePython", "scale"],
    ["wasm", "fixtures/SampleWasm", "scale"],
  ]) {
    const call = (tool, arguments_) => request("mcpServer/tool/call", { threadId: thread.id, server: "rarefaction", tool, arguments: arguments_ });
    const status = await call("status", { profile, project });
    if (status.isError || !status.structuredContent?.profiles[0]?.ok) throw new Error(`${profile} status failed: ${JSON.stringify(status)}`);
    const result = await call("orient", { profile, project, symbol, max_nodes: 20, max_body_lines: 12 });
    if (result.isError || !result.structuredContent?.body) throw new Error(`${profile} orient failed: ${JSON.stringify(result)}`);
    console.log(`${profile}: ready, ${result.structuredContent.callers.length} callers, ${Buffer.byteLength(JSON.stringify(result))} result bytes`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { clearTimeout(deadline); child.stdin.end(); child.kill(); }
