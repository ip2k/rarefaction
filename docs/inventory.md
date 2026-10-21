# Inventory

Every account, key, domain, licence and name this project depends on, and who
owns it. Personal project, so none of this is required — kept because it costs
nothing and is the difference between a weekend and a month of paperwork if the
project ever changes hands.

| what | owner | where referenced | notes |
|---|---|---|---|
| GitHub repository `ip2k/rarefaction` | Sean (personal, `ip2k`) | `README.md`, `package.json`, `server.json`, plugin manifests | public from 2026-10-14; one squashed initial commit |
| GitHub repository `ip2k/rarefaction-lsp-mcp` | Sean (personal, `ip2k`) | — | private; full development history before 2026-10-14 |
| npm package `rarefaction-lsp-mcp` | Sean (personal npm account) | `package.json`, `server.json`, plugin `.mcp.json` | 0.2.0 published 2026-10-14; 2FA required, tokens disallowed |
| npm Trusted Publisher (GitHub Actions, `ip2k/rarefaction`, `release.yml`) | Sean | `.github/workflows/release.yml` | OIDC; no npm token stored anywhere; package disallows tokens |
| MCP Registry name `io.github.ip2k/rarefaction-lsp-mcp` | Sean (GitHub `ip2k` namespace) | `server.json`, `package.json` `mcpName` | published by release workflow via GitHub OIDC; no secret |
| Plugin marketplaces `rarefaction` (Claude Code, Codex) | Sean | `.claude-plugin/`, `.agents/plugins/`, `plugins/rarefaction/` | served from this repository |
| GPL-3.0-or-later licence, copyright Sean | Sean | `LICENSE`, `package.json`, `README.md` | MIT until 2026-10-14 |

## Third-party code and its licences

| dependency | licence | commercial use | notes |
|---|---|---|---|
| `@modelcontextprotocol/server`, `/client` | Apache-2.0 (MIT before 2.3) | yes | v2.3.1 |
| `vscode-languageserver-protocol` (+ `vscode-jsonrpc`) | MIT | yes | |
| `zod` | MIT | yes | v4 |
| `typescript`, `vitest`, `tsx` | MIT / Apache-2.0 | yes | dev only |
| sourcekit-lsp | Apache-2.0 with runtime exception | yes | not bundled; runs from the user's toolchain |
| xcode-build-server | MIT | yes | not bundled; user installs via brew |
| rust-analyzer | MIT OR Apache-2.0 | yes | external rustup-installed tool; not bundled |
| clangd | Apache-2.0 with LLVM exception | yes | external Xcode/LLVM tool; not bundled |
| typescript-language-server | Apache-2.0 | yes | v6.0.1; bundled runtime dependency; licence checked in installed package |
| Pyright | MIT | yes | v1.1.414; bundled runtime dependency; licence checked in installed package |
| wat_server (g-plane/wasm-language-tools) | MIT | yes | external v0.11.0 arm64 macOS release; installed at ~/.local/bin; not bundled |


Girder (BSL 1.1) informed the design and is cited in `docs/decisions.md`; no
code from it is used.

## Client integration (2026-10-07)

Registering Rarefaction in Claude Code or Codex is per-user configuration on
each machine; nothing about it lives in this repository except the plugin
and the README instructions. No account, API key or hosted service is
involved. Language servers run on local source files. The fixtures are
synthetic and authored here; no vendor toolchain, SDK or firmware code is
in the repository.

## Serena integration (2026-10-08)

Serena is optional external tooling, installed via uv at upstream revision
`3b99f8b024dafd58c962ea6e74f37c8a730ef532` (`2.0.0.dev0`). SolidLSP is MIT;
the Serena application is GPL-3.0-or-later. See its authoritative component
[license overview](https://github.com/oraios/serena/blob/3b99f8b024dafd58c962ea6e74f37c8a730ef532/LICENSE).
The independent WAT launcher/adapter here contains no copied Serena application
code. No Serena code is bundled in the npm package. No paid JetBrains plugin,
new account/key, vendor SDK, cloud service, or hook is involved. See
[serena.md](serena.md) for installation, language IDs and verification.
