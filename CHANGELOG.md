# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `scope` tool: the working set for a change to one symbol — `orient`'s
  call-graph files plus files that historically change in the same commits
  as the symbol's file (git co-change), each with its reason. Advisory, not a
  boundary; its measured coverage is in `docs/measurement.md`.

## [0.2.2] - 2026-10-14

### Fixed
- The MCP `initialize` response now reports the installed package version.
  It was hard-coded to `0.2.0`, so 0.2.1 still identified itself as 0.2.0.
