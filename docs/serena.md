# Serena alongside Rarefaction

Rarefaction and [Serena](https://github.com/oraios/serena) work well side by
side in Claude Code and Codex. Rarefaction supplies bounded orientation
(callers, callees, tests, live files); Serena supplies targeted symbol
navigation, diagnostics and semantic edits. This page describes a setup that
adds WebAssembly text (WAT) to Serena so both cover the same six languages.
It is optional: Rarefaction does not need Serena.

## Installed revision and launcher

Install Serena as a uv tool. The published 1.7.0 release lacks the external-adapter registration API. WAT
requires the pinned upstream revision below, currently `2.0.0.dev0`:

```bash
uv tool install --force -p 3.13 --from \
  'git+https://github.com/oraios/serena.git@3b99f8b024dafd58c962ea6e74f37c8a730ef532' serena-agent
```

`tools/serena_launcher.py` registers an independent WAT adapter through
SolidLSP's supported external registration API before invoking Serena's CLI.
It launches the existing `wat_server` on PATH and supports only `.wat` files.
No Serena installation files are patched. The launcher honors Claude's
`CLAUDE_PROJECT_DIR`; otherwise Serena uses `--project-from-cwd`. Always check
activation in Codex desktop, and explicitly activate the actual project if needed.

Register it in each client with the uv environment's absolute Python
executable, the absolute path to `tools/serena_launcher.py` in a clone of this
repository, a PATH containing your native language servers,
`start-mcp-server --project-from-cwd`, and the `codex` or `claude-code`
context. Disabling Serena's onboarding/memory modes and dashboard auto-start
keeps it quiet; in Codex, startup and tool timeouts of 120/180 seconds leave
room for indexing.

## Project languages

Use `.serena/project.yml` to select the languages actually present:

```yaml
project_name: example
language_servers:
  - swift
  - rust
  - cpp
  - typescript
  - python
  - wat
```

Do not enable every server for every project. C/C++ use `cpp`; TS/JS/TSX/JSX
use `typescript`. Native Swift, Rust, C/C++, TS and Python use Serena's own
adapters. Serena's global config can point at an existing clangd. Other adapters
manage their dependencies according to Serena's installed implementation.
The WAT adapter is registered with normal auto-detection priority.

Rust/C Wasm projects use the original source language and real target/build
configuration. WAT is a separate text format; `.wasm` binaries need disassembly.
Swift cross-file references depend on a populated build index. C/C++ require
accurate compile commands. JieLi pi32v2 remains approximate clangd analysis;
see [embedded.md](embedded.md). Configuring Serena does not validate firmware
ABI, assembly, generated code, or hardware behavior.

## Verification and recovery

```bash
claude mcp get serena
codex mcp get serena
node scripts/verify-serena.mjs
```

The verifier uses disposable copies of our synthetic fixtures, creates their
project configurations/compilation database, and builds only the small Swift
fixture. It checks symbol bodies/references and a TypeScript cross-file rename,
then removes the copies. It does not invoke a model or modify real projects.
Native language-server availability and the pinned Serena installation are
prerequisites. Restart/reconnect existing client sessions after configuration
changes. Keep this pin until a newer revision passes the verifier, and point
the client at the launcher rather than Serena's own CLI, which would omit WAT
registration.

Sources: [installation](https://oraios.github.io/serena/02-usage/010_installation.html),
[client configuration](https://oraios.github.io/serena/02-usage/030_clients.html),
[external adapters](https://oraios.github.io/serena/03-special-guides/external_language_server_registration.html).

Verified 2026-10-08 with the pinned revision: Swift, Rust, C/C++, TypeScript,
Python and WAT all completed diagnostics queries and returned symbol bodies
and cross-file/in-file references as
appropriate. TypeScript cross-file rename was verified and reverted in its
copy. Both Codex and Claude Code contexts returned TypeScript symbols/references;
a Claude Code user registration also passed its connection health check. No model
turn was required. Swift temporary paths were canonicalized before build/index
creation to avoid macOS `/var` versus `/private/var` mismatches.
