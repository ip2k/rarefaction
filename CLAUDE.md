# rarefaction-lsp-mcp — context for a Claude Code session

An MCP server that hands a coding agent the *rarefied* slice of a codebase a
task needs — one symbol's signature, body, callers, callees, implementations,
the tests that reach it and the handful of files that can matter — computed
from the language server's index in one call, instead of the agent reading
whole files and grepping. Language-agnostic core over LSP; per-language
**profiles** hold the only language-specific knowledge. Profiles now cover Swift, Rust, C/C++, TypeScript/JavaScript, Python and
WebAssembly WAT. Swift was the first profile for the original iOS projects.

**This is a personal project** — Sean's, open source under GPL-3.0-or-later
(relicensed from MIT and published as `ip2k/rarefaction` 2026-10-14; the
private `ip2k/rarefaction-lsp-mcp` holds the earlier history). It is used to build Chauffeur, which *is* a commercial product, so
**no Chauffeur code, symbol names or fixtures enter this repository**: the
integration fixture is the synthetic `fixtures/SamplePackage`. `docs/inventory.md`
is kept anyway.

## How it works

```
Claude Code ──MCP stdio──> rarefaction (this) ──LSP stdio──> sourcekit-lsp ──BSP──> xcode-build-server
                              │                                    │                      │
                              │ profiles/swift.ts                  │ reads Xcode's index   │ buildServer.json
                              └ graph/walk.ts (BFS, dedupe, drop SDK)                     └ → DerivedData
```

- `src/lsp/client.ts` — typed LSP client; knows nothing about languages.
- `src/profiles/` — the `Profile` contract and `swift.ts`. Launch command,
  workspace prerequisites, test recognition, external-path filter, index
  freshness model, "run only these tests" hint.
- `src/graph/symbols.ts` — a name the agent typed → a precise position and
  `CallHierarchyItem`; ambiguity is an actionable error with exact positions.
- `src/graph/walk.ts` — the walk. Collapses per-call-site duplicates, counts
  SDK callees instead of listing them, caps nodes.
- `src/tools/orient.ts` — the composer; `src/render.ts` — the Markdown the
  model reads; `src/server.ts` — `orient` and `status`.
- `scripts/try.ts` — manual driver over real stdio: `npx tsx scripts/try.ts
  --root <project> orient '{"symbol":"…"}'`.

## Rules

- **stdout is the MCP wire.** Nothing but protocol goes there; `log()` writes
  to stderr and so does the language server's stderr. A stray `console.log`
  breaks every client.
- **Measure before claiming.** `docs/measurement.md` states thresholds *before*
  a measurement is taken, Girder-style. A feature that does not beat its
  threshold is documented as a miss, not tuned until it passes.
- **Rust port: only on evidence.** Sean's decision 2026-09-11: TypeScript now;
  a Rust port is considered *if and only if* a measured, very large
  performance gain is demonstrated on real projects. Today the walk is tens of
  milliseconds; the language server dominates. Do not raise it otherwise.
- **Profiles own language knowledge; the core owns none.** If a language
  needs a special case, it goes in its profile or the `Profile` contract grows.
- **Capability-probe, degrade, never crash.** A server without call hierarchy
  (pyright) must still answer with references + enclosing symbols.
- **Freshness is part of the answer.** `on-build` indexes (Xcode, clangd) can
  be stale; the tool says so rather than answering confidently from old data.
- **Upstream candidates** live in `docs/decisions.md` under that heading and
  go through the `oss-contributions` skill; Sean signs off before anything is
  posted.

## Colours

Use Rosé Pine for every diagram, doc and UI colour unless something else is
specified: **Dawn** by default and for light themes, **Moon** for dark
themes. Values come from <https://github.com/rose-pine/palette>; offer both
variants where the medium can switch (README images use `<picture>` with
`prefers-color-scheme`). `tools/render_diagrams.py` holds both palettes.

## Running against a real project

Xcode projects need `buildServer.json` at the root (`brew install
xcode-build-server && xcode-build-server config -project X.xcodeproj -scheme
X`) and one build; keep the file out of git. SwiftPM packages need nothing —
sourcekit-lsp indexes in the background and the client waits for it once.
Claude Code's own `swift-lsp` plugin roots its server at the *session cwd*, so
open sessions in the project root; this server takes `--root` and defaults to
its cwd, which Claude Code sets to the project.

## Repository hygiene

Last read end to end for dead code, checks that no longer apply and legacy
support nobody needs: **2026-09-11**, at **1,844 lines** of TypeScript, tests,
scripts and fixture Swift (initial scaffold — nothing yet to audit). Next
audit due at roughly 11,800 lines.

## 2026-10-07 — polyglot Codex and Claude integration

The MCP routes per request through `src/workspace.ts`; language-specific
launch, prerequisites and test rules remain in `src/profiles/`. Optional
`.rarefaction.json` selects nested roots and overrides LSP settings.
`status` now returns a `profiles` inventory; `orient` accepts profile,
project and max_nodes. Saved source updates send didChange notifications.
TypeScript and Pyright are runtime dependencies; native language servers
remain external. See README.md and docs/embedded.md. JieLi pi32v2 analysis
uses an explicitly approximate, separate compilation database; it cannot
validate the device ABI or compile firmware. No vendor SDK/code is bundled.

Claude Code uses the user-scoped registration with absolute Node and built server
paths and a PATH that includes the external Rust and WAT servers. Explicit
`--root` overrides `CLAUDE_PROJECT_DIR`, which overrides cwd. Account instructions
require status followed by bounded orientation for all six profiles; mixed
repositories select profile/project or a workspace-relative source position.

## 2026-10-08 — Serena integration

Both clients also register Serena and have account-wide instructions for using
it alongside Rarefaction. tools/serena_launcher.py adds WAT via SolidLSP's external
registry without patching upstream. Serena is pinned to the revision documented
in docs/serena.md; scripts/verify-serena.mjs checks disposable synthetic projects.
Project .serena metadata/indexes are ignored except project.yml. No hooks added.

## 2026-10-14 — public release and distribution

GPL-3.0-or-later; public repository. Published to npm (Trusted Publishing,
no tokens) and the MCP Registry by running `.github/workflows/release.yml`
(Run workflow on main, or a `v*` tag); every version field must match. `plugins/rarefaction/` is the Claude Code and Codex plugin (npx server
plus `orient-first` skill); this repository is its marketplace for both. Keep
plugin, server.json and package versions in step. `docs/launch.md` is the
remaining manual checklist. See `docs/decisions.md`.
