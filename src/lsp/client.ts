// A small, typed LSP client over a child process's stdio.
//
// Language-agnostic by construction: everything here is standard protocol. The
// only things a caller supplies are the command to launch and the languageId
// for a file, both of which come from a Profile.

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  createProtocolConnection,
  CancellationTokenSource,
  StreamMessageReader,
  StreamMessageWriter,
  type ProtocolConnection,
} from "vscode-languageserver-protocol/node";
import {
  ErrorCodes,
  ResponseError,
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  DefinitionRequest,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DocumentSymbolRequest,
  ExitNotification,
  HoverRequest,
  ImplementationRequest,
  InitializedNotification,
  InitializeRequest,
  ReferencesRequest,
  ShutdownRequest,
  TypeHierarchyPrepareRequest,
  TypeHierarchySubtypesRequest,
  TypeHierarchySupertypesRequest,
  WorkspaceSymbolRequest,
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  type DocumentSymbol,
  type Hover,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type MessageConnection,
  type LocationLink,
  type Position,
  type ServerCapabilities,
  type SymbolInformation,
  type TypeHierarchyItem,
  type WorkspaceSymbol,
} from "vscode-languageserver-protocol";
import { log } from "../log.js";

async function send<R>(conn: ProtocolConnection, method: string, params: unknown, timeoutMs: number): Promise<R> {
  const cancellation = new CancellationTokenSource();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      params === undefined ? conn.sendRequest<R>(method, cancellation.token) : conn.sendRequest<R>(method, params, cancellation.token),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
        cancellation.cancel(); reject(new Error(`LSP ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); cancellation.dispose(); }
}

export interface LaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  initializationOptions?: unknown;
}

export interface LspClientOptions {
  launch: LaunchSpec;
  rootPath: string;
  languageId: (filePath: string) => string;
}

/** Counts every request so tools can report what a call cost. */
export interface RequestStats {
  requests: number;
}

export class LspClient {
  readonly capabilities: ServerCapabilities;
  readonly stats: RequestStats = { requests: 0 };
  /** Methods the server rejected as not implemented although it advertised the capability (clangd < 20: outgoingCalls). */
  readonly unimplemented = new Set<string>();
  private readonly opened = new Map<string, { text: string; version: number; filePath: string }>();
  /** Work-done progress tokens the server has begun and not ended. */
  private readonly activeProgress = new Set<string | number>();
  private progressSeen = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly conn: ProtocolConnection,
    private readonly opts: LspClientOptions,
    capabilities: ServerCapabilities,
  ) {
    this.capabilities = capabilities;
    conn.onNotification("$/progress", (p: { token: string | number; value: { kind: string; title?: string } }) => {
      this.progressSeen = true;
      if (p.value.kind === "begin") {
        this.activeProgress.add(p.token);
        if (p.value.title) log(`[lsp] ${p.value.title}`);
      } else if (p.value.kind === "end") {
        this.activeProgress.delete(p.token);
      }
    });
  }

  /**
   * Servers that index in the background (sourcekit-lsp on SwiftPM,
   * rust-analyzer, gopls) report it as work-done progress and answer
   * workspace queries from an empty index until it finishes. Wait for that
   * once, on the first call. Servers that never report progress (a BSP-backed
   * Xcode workspace) cost only `startGraceMs`.
   */
  async waitForIndexing({ startGraceMs = 2000, quietMs = 750, timeoutMs = 120_000 } = {}): Promise<void> {
    const t0 = Date.now();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (!this.progressSeen && Date.now() - t0 < startGraceMs) await sleep(50);
    if (!this.progressSeen) return;
    let quietSince = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.activeProgress.size > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= quietMs) return;
      await sleep(50);
    }
    log(`[lsp] still indexing after ${timeoutMs} ms; continuing anyway`);
  }

  static async start(opts: LspClientOptions): Promise<LspClient> {
    const { command, args, env } = opts.launch;
    const child = spawn(command, args, {
      cwd: opts.rootPath,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      // The language server's stderr is diagnostic only; keep it off our stdout,
      // which is the MCP wire.
      log(`[lsp] ${chunk.toString().trimEnd()}`);
    });

    const conn = createProtocolConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    // Servers ask the client for things during startup. Answering with nothing
    // is always valid and keeps the server from stalling on us.
    conn.onRequest("workspace/configuration", (params: { items?: { section?: string }[] }) =>
      (params.items ?? []).map(item => {
        const section = item.section?.replace(/^rust-analyzer\.?/, "");
        if (!section) return opts.launch.initializationOptions ?? null;
        let value: unknown = opts.launch.initializationOptions;
        for (const part of section.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : null;
        return value ?? null;
      }),
    );
    conn.onRequest("client/registerCapability", () => null);
    conn.onRequest("client/unregisterCapability", () => null);
    conn.onRequest("window/workDoneProgress/create", () => null);
    conn.onRequest("window/showMessageRequest", () => null);
    // ProtocolConnection's typings omit the catch-all overload that the
    // underlying MessageConnection provides; the object is the same.
    (conn as unknown as MessageConnection).onRequest((method: string) => {
      log(`[lsp] unhandled server request ${method}; answering null`);
      return null;
    });
    conn.listen();

    const rootUri = pathToFileURL(opts.rootPath).href;
    const params: InitializeParams = {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: opts.rootPath.split("/").pop() ?? "root" }],
      capabilities: {
        textDocument: {
          callHierarchy: { dynamicRegistration: false },
          typeHierarchy: { dynamicRegistration: false },
          hover: { contentFormat: ["markdown", "plaintext"] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          implementation: { linkSupport: true },
          definition: { linkSupport: true },
        },
        workspace: { symbol: { dynamicRegistration: false }, configuration: true },
        window: { workDoneProgress: true },
      },
    };
    if (opts.launch.initializationOptions !== undefined) params.initializationOptions = opts.launch.initializationOptions;
    const failed = new Promise<never>((_resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) => reject(new Error(`Language server exited (${code ?? signal}) during initialization`)));
    });
    try {
      const init = await Promise.race([send<InitializeResult>(conn, InitializeRequest.type.method, params, 120_000), failed]);
      await conn.sendNotification(InitializedNotification.type, {});
      return new LspClient(child, conn, opts, init.capabilities);
    } catch (error) { conn.dispose(); child.kill(); throw error; }
  }

  get indexing(): boolean { return this.activeProgress.size > 0; }

  /** Which of the requests the walk depends on this server actually offers. */
  get support(): { callHierarchy: boolean; typeHierarchy: boolean; implementation: boolean; references: boolean } {
    const c = this.capabilities;
    return {
      callHierarchy: Boolean(c.callHierarchyProvider),
      typeHierarchy: Boolean(c.typeHierarchyProvider),
      implementation: Boolean(c.implementationProvider),
      references: Boolean(c.referencesProvider),
    };
  }

  /** Keep open documents synchronized with the saved source tree. */
  async open(filePath: string): Promise<string> {
    filePath = await realpath(filePath);
    const uri = pathToFileURL(filePath).href;
    const text = await readFile(filePath, "utf8");
    const previous = this.opened.get(uri);
    if (!previous) {
      await this.conn.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: this.opts.languageId(filePath), version: 1, text },
      });
      this.opened.set(uri, { text, version: 1, filePath });
    } else if (previous.text !== text) {
      const version = previous.version + 1;
      // A whole-document edit is valid for both full and incremental sync.
      await this.conn.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version }, contentChanges: [{ text }],
      });
      this.opened.set(uri, { text, version, filePath });
    }
    return uri;
  }

  async syncOpenDocuments(): Promise<void> {
    for (const doc of this.opened.values()) {
      try { await this.open(doc.filePath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const uri = pathToFileURL(doc.filePath).href;
        await this.conn.sendNotification("textDocument/didClose", { textDocument: { uri } });
        this.opened.delete(uri);
      }
    }
  }

  async filesChanged(changes: { uri: string; type: number }[]): Promise<void> {
    await this.conn.sendNotification("workspace/didChangeWatchedFiles", { changes });
  }

  private async req<P, R>(type: { method: string }, params: P): Promise<R> {
    this.stats.requests += 1;
    // ProtocolConnection's overloads are typed per request; the cast keeps
    // this helper generic without losing the caller's types.
    return (await send<R>(this.conn, type.method, params, 30_000)) as R;
  }

  /** As `req`, but a MethodNotFound answer degrades to null and is remembered. */
  private async optional<P, R>(type: { method: string }, params: P): Promise<R | null> {
    try {
      return await this.req<P, R>(type, params);
    } catch (err) {
      if (!(err instanceof ResponseError) || err.code !== ErrorCodes.MethodNotFound) throw err;
      this.unimplemented.add(type.method);
      return null;
    }
  }

  hover(uri: string, position: Position): Promise<Hover | null> {
    if (!this.capabilities.hoverProvider) return Promise.resolve(null);
    return this.req(HoverRequest.type, { textDocument: { uri }, position });
  }

  definition(uri: string, position: Position): Promise<Location | Location[] | LocationLink[] | null> {
    if (!this.capabilities.definitionProvider) return Promise.resolve(null);
    return this.req(DefinitionRequest.type, { textDocument: { uri }, position });
  }

  references(uri: string, position: Position, includeDeclaration = false): Promise<Location[] | null> {
    if (!this.capabilities.referencesProvider) return Promise.resolve(null);
    return this.req(ReferencesRequest.type, { textDocument: { uri }, position, context: { includeDeclaration } });
  }

  implementation(uri: string, position: Position): Promise<Location | Location[] | LocationLink[] | null> {
    if (!this.capabilities.implementationProvider) return Promise.resolve(null);
    return this.req(ImplementationRequest.type, { textDocument: { uri }, position });
  }

  documentSymbols(uri: string): Promise<DocumentSymbol[] | SymbolInformation[] | null> {
    if (!this.capabilities.documentSymbolProvider) return Promise.resolve(null);
    return this.req(DocumentSymbolRequest.type, { textDocument: { uri } });
  }

  workspaceSymbols(query: string): Promise<SymbolInformation[] | WorkspaceSymbol[] | null> {
    if (!this.capabilities.workspaceSymbolProvider) return Promise.resolve(null);
    return this.req(WorkspaceSymbolRequest.type, { query });
  }

  prepareCallHierarchy(uri: string, position: Position): Promise<CallHierarchyItem[] | null> {
    if (!this.capabilities.callHierarchyProvider) return Promise.resolve(null);
    return this.req(CallHierarchyPrepareRequest.type, { textDocument: { uri }, position });
  }

  incomingCalls(item: CallHierarchyItem): Promise<CallHierarchyIncomingCall[] | null> {
    return this.optional(CallHierarchyIncomingCallsRequest.type, { item });
  }

  outgoingCalls(item: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[] | null> {
    return this.optional(CallHierarchyOutgoingCallsRequest.type, { item });
  }

  prepareTypeHierarchy(uri: string, position: Position): Promise<TypeHierarchyItem[] | null> {
    if (!this.capabilities.typeHierarchyProvider) return Promise.resolve(null);
    return this.req(TypeHierarchyPrepareRequest.type, { textDocument: { uri }, position });
  }

  supertypes(item: TypeHierarchyItem): Promise<TypeHierarchyItem[] | null> {
    return this.optional(TypeHierarchySupertypesRequest.type, { item });
  }

  subtypes(item: TypeHierarchyItem): Promise<TypeHierarchyItem[] | null> {
    return this.optional(TypeHierarchySubtypesRequest.type, { item });
  }

  async stop(): Promise<void> {
    try {
      await send(this.conn, ShutdownRequest.type.method, undefined, 2000);
      await this.conn.sendNotification(ExitNotification.type);
    } catch (err) {
      log(`[lsp] shutdown failed: ${(err as Error).message}`);
    } finally {
      this.conn.dispose();
      this.child.kill();
    }
  }
}
