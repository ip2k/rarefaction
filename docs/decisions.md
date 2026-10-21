# Decisions

Dated, so a later session can tell which facts were true when.

## 2026-09-11 — why this exists, and why not the alternatives

The idea comes from evaluating [Girder](https://github.com/dhishwasher/Girder):
give the agent a semantic slice, not whole files. Girder was rejected for our
use (no Swift; BSL; four-day-old repo) but the idea was right. The survey of
what already exists:

| tool | what it gives | why it is not this |
|---|---|---|
| Claude Code's native `LSP` tool (via `swift-lsp` plugin) | every LSP primitive, model-callable, any language with a plugin | primitives only; a 40-request walk cannot go through the model one call at a time |
| Serena | primitives + symbol-level editing, 40 languages, MIT | no call hierarchy, no bundle, no scope; 15 s startup |
| Swift-Selena, swift-mcp-server | SwiftSyntax-based | disable LSP on `.xcodeproj`; no cross-file semantics |

So this is **composition only**: `orient`, later `scope` and `impacted_tests`.
The primitives are Anthropic's problem now.

## 2026-09-11 — TypeScript now, Rust only on evidence

Sean's words: "TypeScript now while we explore and potentially a Rust port
later once we verify where the actual value is and IF and ONLY IF it's a very
large performance improvement." The walk is 77 ms for 39 requests; the
language server dominates. TypeScript has the most mature MCP SDK
(`@modelcontextprotocol/server` v2), typed LSP for free
(`vscode-languageserver-protocol`), and runs wherever a project lives.

## 2026-09-11 — language-agnostic core, per-language profiles

LSP is the abstraction; the core speaks nothing else. A profile is: launch
command, workspace prerequisite, freshness model (`on-build` vs `on-open`),
test recognition, test-runner hint, external-path filter, and later the
"fuzzy edge" extractors for string-keyed coupling the index cannot see. The
deepest per-language difference is the freshness model, not the syntax.

Known capability gaps to design for: pyright has no call hierarchy (synthesise
from references + enclosing `documentSymbol`, as Serena does); tsserver has no
type hierarchy; Go interfaces are satisfied implicitly (walk through
`implementation`).

## 2026-09-11 — what sourcekit-lsp actually does, measured

- Cross-file `incomingCalls` works on an `.xcodeproj` via `xcode-build-server`.
  Cold start 0.6–9 s, then 1–8 ms per request.
- `outgoingCalls` lists a callee once per call site and includes SDK symbols
  with `../../../../Applications/Xcode-beta.app/…` paths → dedupe, drop, count.
- `workspace/symbol "Scorer"` returns 940 results / 336 KB → exact-match
  filter, dedupe, and an ambiguity error with positions instead of a list.
- The call-hierarchy item's `range` is the signature line only;
  `documentSymbol.range` is the whole declaration → body comes from there.
- SwiftPM packages index in the background after `initialize`; `workspace/
  symbol` is empty until `$/progress` goes quiet → the client waits once.
- Claude Code roots its own sourcekit-lsp at the session cwd; from another
  cwd it runs in fallback mode ("Cannot find 'X' in scope" for same-module
  types). Open sessions in the project root.

## 2026-09-11 — names and packaging

`rarefaction-lsp-mcp` (Sean's choice). npm name is free, unscoped. Tools are
named plainly (`orient`, `status`) because Claude Code already namespaces them
by server (`mcp__rarefaction__orient`).

## Upstream candidates

Per the house rule, kept here and raised proactively; nothing posted without
Sean's sign-off, drafted under the `oss-contributions` skill.

- **Serena: call hierarchy.** Generic LSP, would help all 40 of its languages.
  Draft after phase-1 numbers exist so the PR carries evidence.
- **Claude Code `swift-lsp` plugin / docs:** the plugins reference says LSP is
  passive; the `LSP` tool is model-callable in 2.1.260. And the plugin gives
  no hint that `.xcodeproj` needs `buildServer.json`. A docs issue, low effort.

## 2026-10-07 — polyglot profiles and Codex

Retain the TypeScript implementation and add source-language profiles for
Rust, clangd C/C++, TypeScript/JavaScript, Pyright Python, and WAT. Mixed
repositories route by profile or source position; optional local configuration
supplies nested roots and target settings. Language knowledge remains in the
profiles. Capability-probe the installed server instead of assuming older
Pyright limitations; its installed v1.1.414 provides call hierarchy. Reference
fallback is tested separately without claiming references are call edges.

Keep JieLi firmware build flags and clangd analysis flags separate. pi32v2 is
not a standard clangd or Rust backend. The database-preparation helper requires
an explicit approximation, remaps container paths and canonicalizes symlinks;
otherwise clangd can fail to enumerate a database under a different directory
spelling, or project filtering can drop valid callers. Collapse connected
header/body declarations only for the C/C++ profile; doing so generically
would incorrectly collapse Swift protocol conformers.

Saved edits synchronize open documents and changed source files; no lifetime
source-text cache. Bound orientation output with max_nodes (default 50), body
lines and depth. The global Codex MCP registration remains workspace-relative,
with absolute Node/entry paths and a PATH containing external server locations.
No editor-LSP registration is needed: Rarefaction consumes LSP and serves MCP.

## 2026-10-14 — GPL-3.0-or-later, public repository

Sean relicensed the project from MIT to GPL-3.0-or-later and published it
as a fresh public repository, `ip2k/rarefaction`, from one squashed commit;
the private `ip2k/rarefaction-lsp-mcp` keeps the earlier history, which named
private product symbols. The npm package and MCP Registry names keep
`rarefaction-lsp-mcp`. Every bundled dependency is MIT or Apache-2.0, both
compatible with GPLv3; external language servers are separate programs and
are not bundled. Private product symbol names were removed from the README,
tests and measurement notes; aggregate numbers are kept.

## 2026-10-14 — distribution: npm, MCP Registry, Claude and Codex plugins

To make adoption one command, the package is published to npm as
`rarefaction-lsp-mcp` and to the official MCP Registry as
`io.github.ip2k/rarefaction-lsp-mcp` (`server.json`, `mcpName`). A tag push
runs `.github/workflows/release.yml`, which refuses a tag that disagrees with
any version field. `plugins/rarefaction/` is one plugin directory serving both
Claude Code (`.claude-plugin/`) and Codex (`.codex-plugin/`): the npx-launched
server plus an `orient-first` skill carrying the orientation guidance. The
repository is its own marketplace for both (`.claude-plugin/marketplace.json`,
`.agents/plugins/marketplace.json`). It lives in a subdirectory so that
sessions opened in this repository do not pick up a project `.mcp.json`.
Both manifests were checked with the real CLIs (`claude plugin validate
--strict`, `codex plugin add`) and `mcp-publisher validate`.

CI installs clangd and rust-analyzer so the integration suite runs for real.
That exposed clangd 18 rejecting `callHierarchy/outgoingCalls` with
MethodNotFound although it advertises call hierarchy; `orient` crashed. The
client now treats MethodNotFound on hierarchy follow-up requests as "not
implemented", omits those results and says so in `warnings`. The polyglot
tests also skip a native server that is present but does not start (a rustup
proxy without the rust-analyzer component).

## 2026-10-14 — `scope` waits: call edges alone miss half of a change

The phase-2 offline benchmark (docs/measurement.md, Results) missed its
pre-stated scope-recall threshold: median 0.50 against 0.80 on ripgrep and
IronRDP. Most misses are files coupled through data, configuration, IPC or
tests run as processes, which no language server reports as calls; wider
bounds recover only a few. So `scope` is not built on today's live set. Any
attempt to widen it (for example co-change history, test-to-code maps or
configuration keys) gets its own thresholds before it is measured. `orient`
itself is unaffected: its answers were a median 6–7% of the bytes of the
files they name, in well under a second once indexed.

## 2026-10-15 — `scope` ships as advisory

Sean asked for `scope`. It combines the call graph with git co-change
history, using parameters fixed before measuring. On held-out commits its
median recall is 0.50 on ripgrep and IronRDP, a miss against 0.80, while
staying small (1–3% of files) and fast (warm p90 under 0.5 s). It ships
as an advisory working set: every answer says it is not a boundary, the
README links the measured coverage, and no hook blocks edits outside it.
Next candidates, each to be pre-registered and measured on fresh commits:
a sweep rule that weights large commits down instead of dropping them,
co-change anchored on the call-graph files as well as the seed's file, and
configuration-key and test-to-code links.

## 2026-10-15 — scope round 2: what to test next

Sean picked all three candidates for the next round:
- weight sweeps down instead of dropping them;
- anchor co-change on the call-graph files as well as the seed's file;
- profile-owned test-to-code and configuration-key links.

Lowering the support and confidence floors was left out as likely noise.
Other decisions:
- **Size budget.** Stays at 10% of project files.
- **Evaluation.** Fresh commits from ripgrep and IronRDP, plus one new
  TypeScript project and one new Python project, so a gain has to carry
  across languages.
- **If it passes.** `scope` stays advisory and never blocks edits.

`docs/measurement.md` ("Scope round 2") holds the exact rules and the
thresholds, written before any run. It also holds an ablation rule: a
component ships only if it earns recall.

## 2026-10-16 — scope round 2: call-graph anchors ship, the rest stays off

The candidate missed: median recall was 0.50 on ripgrep and 0.60 on
IronRDP against 0.80. hono and httpx passed.

By the pre-registered ablation, only call-graph anchors earned their
place. They added +0.06, +0.11 and +0.09 pooled recall on three of the
four projects. Weighted sweeps and links did not.

On httpx the set breaks the 10% size limit with or without anchors.
Sean ruled that anchors ship anyway, with the gap recorded.

Weighted sweeps and links stay in the code, switched off.

The next round must pre-register how small projects are judged. It
should look for signals beyond co-change, because 31–42% of the Rust
misses never changed together with the seed's file at all.

## 2026-10-20 — positions without `project` answer from the enclosing workspace

A position query without `project` used to root at the nearest project
marker. In a Cargo workspace that is the member crate, and callers in the
other member crates were dropped with no warning: on a 24-caller function
in a private Cargo workspace the answer listed 12.

Now a position in a Rust crate is answered from the outermost Cargo
workspace that takes the crate in: a `members` glob not undone by
`exclude`, the crate's own `package.workspace` pointer, or a path
dependency of the root package (the cases Cargo itself treats as members).
A crate with its own `[workspace]` stays where it is. When the answer still
comes from a narrower directory than an enclosing one with its own marker,
a warning names both and the `project` to pass.

TypeScript does not move. An experiment with an npm workspace of two
packages (each with its own `tsconfig.json`, one importing the other) found
the cross-package caller missing whether the language server started at
the package or at the workspace root, and also with a solution-style root
`tsconfig.json` that references both: tsserver answers call hierarchy
within the `tsconfig.json` project that owns the file. Moving the root
would cost a second server for nothing, so an npm, yarn or pnpm workspace
member stays at its package and the answer says that callers in other
packages are not listed. The earlier advice to pass `project: "."` in a
TypeScript monorepo was wrong and is withdrawn.

The walk outward stops at the first directory holding `.git`. A git
worktree under `.claude/worktrees/` in a Cargo workspace checkout has its
own workspace; 0.4.1 answered from it correctly but then warned that the
outer workspace did not list it and suggested `project: "."`, which cannot
reach a file under a dot directory. A worktree, submodule or vendored
checkout is its own project, so nothing above it is considered (0.4.2).

Candidates for reading `Cargo.toml`: `smol-toml` (BSD-3-Clause, no
dependencies, TOML 1.1 compliant, ships types), `@iarna/toml` (ISC,
last released in 2020) and a hand-written reader for the three tables
used. `smol-toml` was taken: target-specific dependency tables and inline
tables are easy to get wrong by hand. For workspace globs, Node's own
`path.matchesGlob` (stable since 22.20, below the 22.22.2 this package
requires) was taken over adding `picomatch`. `pnpm-workspace.yaml` is read
with a small line reader for its `packages` list rather than adding a YAML
parser for one key.

The structured result was measured against the Markdown text on the same
24-caller function: 7,522 bytes of JSON against 4,538 of text (1.66x);
for `scope` 2,117 against 1,292 (1.64x). Dropping false booleans and empty
arrays would save 9%; dropping `tests`, which repeats the callers that sit
in test files, would save 30%. Both change the declared output schema that
clients validate, so neither ships in a patch release; the numbers are
recorded for a later minor version.
