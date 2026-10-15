# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- The MCP `initialize` response now reports the installed package version.
  It was hard-coded to `0.2.0`, so 0.2.1 still identified itself as 0.2.0.
