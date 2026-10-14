// A Profile is everything the core does not know about a language. The core
// speaks LSP; a profile says how to launch the server, what a test looks like,
// which callees are "outside" the project, and how fresh the index is.

import type { LaunchSpec } from "../lsp/client.js";

export interface Detection {
  /** True when the profile can serve this root at all. */
  ok: boolean;
  /** Human-readable facts about what was found (shown by `status`). */
  facts: string[];
  /** What to do when `ok` is false or results will be degraded. */
  advice: string[];
}

export type FreshnessModel = "on-build" | "on-open";

export interface Freshness {
  /** `on-build`: the index is only as new as the last build. `on-open`: the server indexes live. */
  model: FreshnessModel;
  indexedAt?: Date;
  newestSourceAt?: Date;
  /** True when a source file is newer than the index — answers may be wrong. */
  stale: boolean;
  advice?: string;
}

export interface TestRunHint {
  /** A command line the agent can run to exercise only the listed tests. */
  command: string;
  note?: string;
}

export interface Profile {
  readonly id: string;
  readonly displayName: string;
  /** File extensions the language server should be asked about, with the dot. */
  readonly extensions: readonly string[];

  /** Nearest ancestor project markers for position-query routing. */
  readonly rootMarkers?: readonly string[];
  /** This server reports header declarations separately from their bodies. */
  readonly collapseDeclarations?: boolean;
  /** Without a compilation database, this server only indexes open files. */
  needsSourceScan?(rootPath: string): Promise<boolean>;

  languageId(filePath: string): string;
  detect(rootPath: string): Promise<Detection>;
  launch(rootPath: string): Promise<LaunchSpec>;
  freshness(rootPath: string): Promise<Freshness>;

  /** Relative path (from root) is a test source file. */
  isTestFile(relPath: string): boolean;
  /**
   * Symbol name (as the language server reports it) plus the source line just
   * above it names a test case, not merely a helper inside a test file.
   */
  isTestCase(symbolName: string, lineAbove: string | undefined): boolean;
  /** A file URI is outside the project — SDK, package cache, build output. */
  isExternal(uri: string, rootPath: string): boolean;
  /** Turn a list of test-file symbols into something the agent can run. */
  testRunHint(tests: readonly { name: string; relPath: string }[]): TestRunHint;
}
