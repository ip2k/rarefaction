# rarefaction-lsp-mcp

This is a personal project. Read [CLAUDE.md](CLAUDE.md) for the existing
architecture, rules, inventory, and audit baseline; those instructions also
apply to Codex.

## Approved skills

- `openai-docs`: approved 2026-10-07 for Codex setup and MCP configuration.
  Load it when working on that area without asking again.

## Codex setup

The user-level `rarefaction` MCP registration launches a built clone's
`dist/index.js` with an absolute Node path. Leave its working directory and
`--root` unset so it follows the Codex chat's project directory. Build after
server changes. See README.md for registration and verification steps.

Supported profiles are Swift, Rust, C/C++, TypeScript/JavaScript, Python and
WebAssembly WAT. This repository's root is TypeScript; use its profile for
orientation and `fixtures/Sample*` for synthetic integration checks.
Mixed projects select by profile or workspace-relative source position.
Saved edits synchronize before queries; never infer cross-language/FFI edges.
The local `.rarefaction.json` defaults this workspace to TypeScript.

Do not bring commercial project code or symbol names into fixtures or documentation.

## Serena alongside Rarefaction

Both account instruction files require Rarefaction orientation and Serena's
navigation/diagnostics/semantic edits for substantive work. This package's Serena
project configuration selects TypeScript and excludes the multilingual fixtures;
the verifier creates isolated projects for those. See docs/serena.md. The local
Serena registration uses tools/serena_launcher.py to register the WAT adapter.

## Colours

Use Rosé Pine for every diagram, doc and UI colour unless something else is
specified: **Dawn** by default and for light themes, **Moon** for dark
themes. Values come from <https://github.com/rose-pine/palette>; offer both
variants where the medium can switch (README images use `<picture>` with
`prefers-color-scheme`). `tools/render_diagrams.py` holds both palettes.
