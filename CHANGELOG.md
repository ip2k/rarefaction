# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- The README and the plugin README named only `status` and `orient`; they now
  list `scope` too, so `mcp__rarefaction__scope` can be allowed with the
  others. The README, the agent-guidance snippet and the `orient-first` skill
  now say to pass `project` with position queries in a Cargo workspace or
  monorepo: without it the answer comes from the nearest member and leaves
  out callers in the other members.

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
