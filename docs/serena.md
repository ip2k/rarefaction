# Serena alongside Rarefaction

This workstation uses both MCPs in Claude Code and Codex. Rarefaction supplies
bounded orientation (callers/callees/tests); Serena supplies targeted symbol
navigation, diagnostics and semantic edits. Both account instruction files
require their use during substantive work, with project/root checks and normal
edit authorization. Small local edits can still use the clients' native tools.

## Installed revision and launcher

Serena is installed as a uv tool under `~/.local/share/uv/tools/serena-agent`.
The published 1.7.0 release lacks the external-adapter registration API. WAT
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

Both registrations use the uv environment's absolute Python executable, this
clone's absolute launcher path, a PATH containing native language servers,
`start-mcp-server --project-from-cwd`, and their respective `codex` or
`claude-code` context. Modes disable onboarding/memory workflows; account rules
also prohibit incidental memory writes. No hooks are installed. Browser/dashboard
auto-start is disabled. Codex startup/tool timeouts are 120/180 seconds.

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
adapters. The local global config reuses `/usr/bin/clangd`. Other adapters
manage their dependencies according to Serena's installed implementation.
Our WAT adapter is registered with normal auto-detection priority.

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
changes. Preserve this pin until a newer revision passes the verifier; do not
blindly upgrade the dev installation or point the MCP at the unwrapped CLI,
which would omit WAT registration.

Configuration backups are beside the modified account files, suffixed
`-serena`. Account-wide means local user scope on this workstation, not hosted
Claude/Codex cloud sessions or another machine. Those need separate setup.

Sources: [installation](https://oraios.github.io/serena/02-usage/010_installation.html),
[client configuration](https://oraios.github.io/serena/02-usage/030_clients.html),
[external adapters](https://oraios.github.io/serena/03-special-guides/external_language_server_registration.html).

Verified 2026-10-08 with the pinned revision: Swift, Rust, C/C++, TypeScript,
Python and WAT all completed diagnostics queries and returned symbol bodies
and cross-file/in-file references as
appropriate. TypeScript cross-file rename was verified and reverted in its
copy. Both Codex and Claude Code contexts returned TypeScript symbols/references;
Claude's user registration also passed its connection health check. No model
turn was required. Swift temporary paths were canonicalized before build/index
creation to avoid macOS `/var` versus `/private/var` mismatches.
