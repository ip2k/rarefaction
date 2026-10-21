<p align="center"><img src="docs/images/logo.svg" alt="rarefaction logo: a reactor core glowing Cherenkov blue, drawn as a call graph" width="144"></p>

# Rarefaction — LSP call graph MCP server for AI coding agents

[![CI](https://github.com/ip2k/rarefaction/actions/workflows/ci.yml/badge.svg)](https://github.com/ip2k/rarefaction/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/rarefaction-lsp-mcp)](https://www.npmjs.com/package/rarefaction-lsp-mcp)
[![License: GPL v3+](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![ip2k/rarefaction MCP server](https://glama.ai/mcp/servers/ip2k/rarefaction/badges/score.svg)](https://glama.ai/mcp/servers/ip2k/rarefaction)

**Rarefaction** is a Model Context Protocol (MCP) server that gives a coding
agent the **call graph and code context for one symbol** straight from the
project's language server (Language Server Protocol, LSP). Ask about a
function, method or type and get, in one call: its signature and doc, its
body, **who calls it** (tests marked), **what it calls**, who implements it,
**the tests that reach it** and the short list of **files a change can
affect**. The agent reads that instead of opening whole files and grepping,
which keeps its context window small and spends fewer tokens on exploration.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture-moon.svg">
  <img alt="How Rarefaction works: a coding agent calls orient over MCP; Rarefaction routes the request to a language profile, resolves the symbol, walks the call graph through the language server over LSP, and returns one bounded answer." src="docs/images/architecture-dawn.svg" width="100%">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/orient-moon.svg">
  <img alt="What one orient call returns, for Engine.updateLocation in the Swift fixture: callers at depth 1 and 2 with tests and a test helper marked, the tests that reach it with a command to run only them, and the 4 of 6 files that are live." src="docs/images/orient-dawn.svg" width="100%">
</picture>

Works with Claude Code, Codex and any MCP client over stdio. Profiles cover
Swift, Rust, C/C++, TypeScript/JavaScript, Python and WebAssembly text (WAT).

Run against the bundled TypeScript fixture (`fixtures/SampleTypeScript`):

````
# scale — engine.ts:2:17

```
function scale(value: number): number
```

Double one input sample.

## Callers (2, 1 in tests)
- render — render.ts:2 (calls at 3)
- · testScale — engine.test.ts:2 (calls at 3) [test]

## Tests that reach it (1)
- testScale — engine.test.ts:2

Run only these:
```
npm test -- "engine.test.ts"
```

## Live files (3 of 3)
- engine.test.ts
- engine.ts
- render.ts

_11 LSP requests, 6430 ms (includes language-server cold start); index on-open_
````

Once the language server has indexed, a call takes a fraction of a second
(median 80 ms on ripgrep, 220 ms on the 800-file IronRDP workspace); the
server's cold start, 6–16 s on those projects, is paid once per session.

## What it helps with

- **Reducing token usage in AI coding agents.** One bounded answer replaces
  several whole-file reads and searches. Measured on 50 real commits in
  ripgrep and IronRDP, the answer was a median 6–7% of the bytes of reading
  the files it names once. How much that saves in a whole agent session is
  not measured yet; see [docs/measurement.md](docs/measurement.md), including
  where the live set falls short.
- **Call graph and impact analysis.** "What calls this function, and what
  would break if I change it?" By default two levels of callers and one of
  callees, plus implementations and type hierarchy, each bounded and marked when truncated.
- **Choosing which tests to run.** Tests that reach the symbol, with a "run
  only these" command for the project's test runner.
- **Orientation in an unfamiliar codebase.** Bare names, qualified names or
  exact `path:line:column` positions; ambiguity comes back as a list of exact
  positions rather than a guess.
- **Honest answers about coverage.** Stale indexes, servers still indexing
  and servers without call hierarchy are reported in the answer, not hidden.

## Why an MCP server for LSP call graphs

Language servers already know the call graph precisely — that is what
"find references" and "call hierarchy" are. Editors and LSP tools expose
them one hop at a time, so an agent pays a tool call and a round of context
per hop. An agent needs the *closure*: everything within a couple of hops,
filtered to the project, with the tests picked out, small enough to read in
one go. That composition is what this server does. It is deliberately
language-agnostic: the core speaks LSP and nothing else, and everything a
language needs is a small **profile**.

How it relates to nearby tools:

| approach | what the agent gets |
|---|---|
| reading files and grep | whole files; text matches, not calls |
| per-request LSP tools (definition, references, call hierarchy) | precise answers, one hop per tool call |
| [Serena](https://github.com/oraios/serena) | symbol navigation and semantic editing over LSP; works well alongside this |
| Rarefaction | the bounded multi-hop call graph, tests and live files for one symbol in one call |

## Install

Requires Node 22.22.2 or later; used on macOS and Linux (CI runs on Ubuntu),
untested on Windows. The TypeScript and Python language servers
are bundled. Install the others you need and put them on the `PATH` your
client launches with — see [Languages and configuration](#languages-and-configuration).
Swift needs macOS with Xcode (or a Swift toolchain with sourcekit-lsp).

### As a plugin (Claude Code and Codex)

The plugin bundles the server, launched with `npx -y rarefaction-lsp-mcp`,
and an `orient-first` skill that tells the agent to call `status` and
`orient` before reading whole files, and `scope` before editing.

```bash
# Claude Code
claude plugin install rarefaction --marketplace ip2k/rarefaction

# Codex
codex plugin marketplace add ip2k/rarefaction
codex plugin add rarefaction@rarefaction
```

In a Claude Code session, `/plugin install rarefaction --marketplace ip2k/rarefaction`
does the same. Restart or reconnect the session afterwards.

### As an MCP server

```bash
claude mcp add --scope user --transport stdio rarefaction -- npx -y rarefaction-lsp-mcp
codex mcp add rarefaction -- npx -y rarefaction-lsp-mcp
```

Add `--env PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"` before the `--`
if rust-analyzer or wat_server live outside the client's `PATH`. The tools
are `status`, `orient` and `scope` (in Claude Code, `mcp__rarefaction__status`,
`mcp__rarefaction__orient` and `mcp__rarefaction__scope`); all three are
read-only, so you can allow them in your permissions to avoid repeated
prompts. For Codex, give the first index time
in `~/.codex/config.toml`:

```toml
[mcp_servers.rarefaction]
startup_timeout_sec = 20
tool_timeout_sec = 180
```

The server takes `--root <path>` and `--profile <id>`. Explicit `--root` takes
precedence over Claude Code's `CLAUDE_PROJECT_DIR`, then the working
directory. Leave both unset in a user-wide registration so every project can
use all supported profiles. See the MCP documentation for
[Claude Code](https://code.claude.com/docs/en/mcp) and
[Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### From a clone

To run your own changes, build and register the compiled entry instead:

```bash
git clone https://github.com/ip2k/rarefaction.git
cd rarefaction
npm ci && npm run build
claude mcp add --scope user --transport stdio rarefaction -- "$(command -v node)" "$PWD/dist/index.js"
```

Rebuild after changing the server, then restart or reconnect (`/mcp`) the
client session.

### Check it works

Start a new chat in a project and ask the agent to call `status`, then
`orient` on a symbol you know. `status.root` should match the project and the
selected entry in `status.profiles` should have `ok: true`. One registration
serves all supported languages; each language server starts lazily.

### Agent guidance

The plugin's skill covers this. Without the plugin, add this to `~/.claude/CLAUDE.md`, `AGENTS.md` or a
project instruction file:

> Use rarefaction's status tool once in a new project, then orient on the
> relevant symbol before reading whole files, and scope on a symbol before
> editing it (advisory: also look outside the files it lists). In mixed
> repositories pass profile or a workspace-relative path:line:column, and
> pass project for a nested package that is not a workspace member. Start
> with the default graph bounds; expand only when necessary. Follow freshness
> and coverage advice, and inspect FFI/generated bindings separately when
> relevant.

### Xcode projects

Xcode projects need a build-server config so sourcekit-lsp gets compiler
flags (SwiftPM packages need nothing):

```bash
brew install xcode-build-server
cd /path/to/App && xcode-build-server config -project App.xcodeproj -scheme App
echo buildServer.json >> .gitignore
```

Then build once in Xcode or with `xcodebuild`; the index is only as fresh as
the last build, and `orient` says so when a source file is newer. Saved
source edits are sent to open LSP documents before later queries, but Xcode
projects still need a new build to refresh their cross-file index.

## Tools

| tool | what |
|---|---|
| `orient` | `{symbol, profile?, project?, up?, down?, max_nodes?, include_body?, max_body_lines?}` — the bundle above. `symbol` may be `updateLocation`, `Engine.updateLocation`, or `path/File.swift:204:10`. Ambiguous names come back as an error listing exact positions. |
| `scope` | `{symbol, profile?, project?, up?, down?, max_nodes?}` — the working set for a change to that symbol: the call-graph files from `orient` plus files that have historically changed in the same commits as the symbol's file or the call-graph files (from git history), each with its reason. Advisory: it lists what to read and check, not what is safe to ignore ([measured coverage](docs/measurement.md#results)). |
| `status` | `{profile?, project?}` — what the server can see: the profile inventory and which one is selected, prerequisites such as a build-server config, index freshness, and which LSP features the server offers. Call this first if `orient` finds nothing. |

Planned: `impacted_tests` (the upward walk restricted to tests, as a
runnable selection).

## Languages and configuration

| Profile | Language server | Prerequisites / scope |
|---|---|---|
| `swift` | sourcekit-lsp | Xcode or a Swift toolchain; SwiftPM, or Xcode with a build-server config |
| `rust` | rust-analyzer | Cargo.toml or rust-project.json; embedded/no_std/Wasm target settings supported; a project that pins a toolchain needs `rustup component add rust-analyzer --toolchain <channel>` (`status` says so) |
| `c` | clangd | C/C++; compile_commands.json or compile_flags.txt for accurate include paths and defines |
| `typescript` | typescript-language-server | TypeScript/JavaScript, TSX/JSX; server and TypeScript bundled as dependencies |
| `python` | Pyright | Python and stubs; bundled; configure interpreter/import paths for your environment |
| `wasm` | wat_server | WebAssembly `.wat` text; install the [prebuilt server](https://github.com/g-plane/wasm-language-tools/releases) on PATH |

The server probes each language server's capabilities. When call hierarchy
is absent, `orient` reports references and enclosing symbols, without
claiming those references are calls. Native Rust/C sources compiled to
WebAssembly use `rust`/`c`; `.wasm` binaries need disassembly to `.wat`.
WAST test scripts, vendor assembly, indirect runtime dispatch and
cross-language FFI edges are not indexed as a unified graph.

Optional `.rarefaction.json` in the workspace root configures each profile.
Paths in `project`, profile `root`, and relative position queries are
relative to that workspace. A position query without `project` is answered
from the outermost Cargo workspace that takes the file's crate in (as a
member, a `package.workspace` pointer or a path dependency of the root
package), else from the nearest supported project marker. When that leaves
part of an enclosing project out, the answer carries a warning that says so
and which `project` to pass. TypeScript is the exception: the TypeScript
language server answers one `tsconfig.json` project at a time, so in an npm,
yarn or pnpm workspace with a `tsconfig.json` per package, callers in other
packages are not listed, with or without `project`, and the warning says
that too. A git worktree nested inside the workspace is reached by naming it
in `project` and giving positions its path as a prefix. Bare names in mixed workspaces need
`profile` or a configured `default_profile`:

```json
{
  "default_profile": "typescript",
  "profiles": {
    "rust": {
      "root": "firmware/rust",
      "initializationOptions": {
        "cargo": { "target": "thumbv7em-none-eabihf", "features": ["board"] }
      }
    },
    "c": { "args": ["--background-index", "-j=2", "--compile-commands-dir=/absolute/local/build"] },
    "python": {
      "initializationOptions": { "python": { "pythonPath": "/absolute/project/.venv/bin/python" } }
    }
  }
}
```

`command`, `args`, `env`, and `initializationOptions` may override each
profile's launch settings; initialization objects merge recursively.
`args` replaces the defaults. Rust cargo checks, build scripts and proc
macros are disabled by default to avoid incidental compilation; enable them
explicitly when your project needs generated/expanded code. After changing
this configuration, restart the MCP connection. Missing executables appear
in `status` with setup advice.

Graph output defaults to 50 nodes per direction, two caller levels, one
callee level and 80 body lines. Use `max_nodes`, `up`, `down`, or
`include_body: false` to adjust context size. Truncation is explicit. Name
lookup without a workspace index falls back to scanning at most 200 source
files; use an exact position or a smaller project when needed.

See [embedded C, JieLi and WebAssembly setup](docs/embedded.md) for analysis
compilation databases and target limitations.

## Serena alongside Rarefaction

[Serena](https://github.com/oraios/serena) complements this server with
symbol navigation, diagnostics and semantic edits. [docs/serena.md](docs/serena.md)
covers a pinned installation, a WAT adapter, project language settings,
limitations and verification.

## Privacy

Rarefaction runs entirely on your machine. It reads your project's files
and talks to language servers over local stdio; it makes no network
requests and collects no telemetry. The language servers it launches
behave as they do in your editor (for example, rust-analyzer runs
`cargo metadata`, which may fetch crate indexes). `npx` downloads the
package from npm on first use.

## Development

```bash
npm ci && npm run build
npm test                        # unit + real LSP integration; external servers skipped if absent
claude plugin validate .        # plugin and marketplace manifests
node scripts/verify-codex.mjs   # exercise the registered MCP through Codex, no model turn
npx tsx scripts/try.ts --root fixtures/SampleTypeScript orient '{"symbol":"scale"}'
```

The logo and icon (Rosé Pine Moon) come from `python3 tools/render_logo.py`;
the README diagrams (Dawn for light, Moon for dark) from `python3
tools/render_diagrams.py`. The fixtures under `fixtures/` are small
synthetic projects, one per language. CI runs the suite with clangd and
rust-analyzer installed. The Release workflow (a `v*` tag push, or "Run
workflow" on `main`) checks that every version field agrees (`package.json`,
`server.json`, both plugin manifests), publishes to npm and the [MCP
Registry](https://registry.modelcontextprotocol.io) as
`io.github.ip2k/rarefaction-lsp-mcp`, then creates the GitHub release.
`docs/measurement.md` states the thresholds the project holds itself to;
`docs/decisions.md` records why things are the way they are.

## Licence

Copyright (C) 2026 Sean (ip2k).

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed WITHOUT ANY WARRANTY; see [LICENSE](LICENSE) for
the full text.
