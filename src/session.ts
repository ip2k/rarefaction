// One Session per project root: the profile that serves it and a lazily
// started language server. The MCP server starts instantly; the language
// server's cold start (seconds, for an Xcode index) is paid on the first tool
// call and reported in that call's stats.

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LspClient } from "./lsp/client.js";
import type { Detection, Profile } from "./profiles/profile.js";
import { listSourceFiles } from "./fs.js";
import { pathToFileURL } from "node:url";
import { log } from "./log.js";

export class Session {
  private client: LspClient | undefined;
  private starting: Promise<LspClient> | undefined;
  private sourceTimes: Map<string, number> | undefined;

  constructor(
    readonly rootPath: string,
    readonly profile: Profile,
  ) { this.rootPath = realpathSync.native(rootPath); }

  /** Recheck workspace prerequisites after build/config changes. */
  detection(): Promise<Detection> {
    return this.profile.detect(this.rootPath);
  }

  async lsp(): Promise<LspClient> {
    if (this.starting) return this.starting;
    if (this.client) return this.client;
    if (!this.starting) {
      this.starting = (async () => {
        const launch = await this.profile.launch(this.rootPath);
        log(`[session] starting ${launch.command} for ${this.rootPath}`);
        const client = await LspClient.start({
          launch,
          rootPath: this.rootPath,
          languageId: (p) => this.profile.languageId(p),
        });
        this.client = client;
        await client.waitForIndexing();
        return client;
      })();
    }
    try { const client = await this.starting; this.starting = undefined; return client; } catch (error) {
      await (this.client as LspClient | undefined)?.stop(); this.client = undefined; this.starting = undefined; throw error;
    }
  }

  /** Notify changes even for callers that were indexed but never opened. */
  async syncSources(client: LspClient): Promise<void> {
    await client.syncOpenDocuments();
    const files = await listSourceFiles(this.rootPath, this.profile.extensions);
    const current = new Map(files.map(f => [f.path, f.mtimeMs]));
    if (this.sourceTimes) {
      const events: { uri: string; type: number }[] = [];
      for (const [path, time] of current) {
        if (this.sourceTimes.get(path) === time) continue;
        const uri = await client.open(path);
        await client.documentSymbols(uri); // wait for its updated AST/index
        events.push({ uri, type: this.sourceTimes.has(path) ? 2 : 1 });
      }
      for (const path of this.sourceTimes.keys()) if (!current.has(path)) events.push({ uri: pathToFileURL(path).href, type: 3 });
      if (events.length) await client.filesChanged(events);
    }
    this.sourceTimes = current;
  }

  get started(): boolean {
    return this.client !== undefined;
  }

  /** Read current source; the LSP receives matching change notifications on open. */
  async text(uri: string): Promise<string> { return readFile(fileURLToPath(uri), "utf8"); }

  async close(): Promise<void> {
    await this.client?.stop();
    this.client = undefined;
    this.starting = undefined;
    this.sourceTimes = undefined;
  }
}
