# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- A position in a git worktree, submodule or other checkout nested inside
  the workspace (a directory holding `.git`) is answered from that checkout
  without the outer project's warning. 0.4.1 answered from the right place
  but warned that the outer workspace did not list it and suggested
  `project: "."`, which cannot reach files under a dot directory such as
  `.claude/worktrees`.

## [0.4.1] - 2026-10-20

### Fixed
- A position query without `project` in a Cargo workspace member crate is
  now answered from the workspace, so callers in the other member crates are
  listed. It was answered from the member crate alone, which dropped them
  without a warning (12 of 24 callers on one real workspace). Members are
  found the way Cargo finds them: `members` globs less `exclude`, a
  `package.workspace` pointer, and path dependencies of the root package.
- When a position query is still answered from a narrower directory than an
  enclosing project, `orient` and `scope` say so in `warnings` and name the
  `project` to pass.
- The README, agent snippet and `orient-first` skill said `project: "."`
  keeps callers in other packages of a TypeScript monorepo. It does not: the
  TypeScript language server answers one `tsconfig.json` project at a time.
  They now say so, and so does a warning on positions in npm, yarn or pnpm
  workspace packages.
- The README and the plugin README named only `status` and `orient`; they now
  list `scope` too, so `mcp__rarefaction__scope` can be allowed with the
  others.

### Changed
- New runtime dependency `smol-toml` (BSD-3-Clause, no dependencies of its
  own) to read `Cargo.toml` workspace tables.

## [0.4.0] - 2026-10-20

### Changed
- `scope` also adds files that historically change with the call-graph
  files, not only with the symbol's own file (at most 15 more). On held-out
  commits this raised pooled recall on ripgrep, IronRDP and httpx; see
  `docs/measurement.md`, "Scope round 2". Weighted sweeps and test-name /
  configuration-key links were measured too and stay off.

## [0.3.1] - 2026-10-16

### Changed
- Dependency updates: the MCP SDK (`@modelcontextprotocol/server`) 2.0.0 →
  2.3.1, which is now Apache-2.0 rather than MIT (compatible with this
  project's GPL-3.0-or-later), plus patch updates to the test tooling.
- CI and release workflows use `actions/checkout` and `actions/setup-node` v7.

## [0.3.0] - 2026-10-15

### Added
- `scope` tool: the working set for a change to one symbol — `orient`'s
  call-graph files plus files that historically change in the same commits
  as the symbol's file (git co-change), each with its reason. Advisory, not a
  boundary; its measured coverage is in `docs/measurement.md`.

## [0.2.2] - 2026-10-14

### Fixed
- The MCP `initialize` response now reports the installed package version.
  It was hard-coded to `0.2.0`, so 0.2.1 still identified itself as 0.2.0.
