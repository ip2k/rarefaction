# Rarefaction plugin

Bundles the [Rarefaction](https://github.com/ip2k/rarefaction) MCP
server (launched with `npx -y rarefaction-lsp-mcp`) and an `orient-first`
skill that tells the agent to call `status` and `orient` before reading whole
files. Works in Claude Code and Codex.

```bash
# Claude Code (or /plugin install … inside a session)
claude plugin install rarefaction --marketplace ip2k/rarefaction

# Codex
codex plugin marketplace add ip2k/rarefaction
codex plugin add rarefaction@rarefaction
```

Requires Node 22.22.2 or later. TypeScript and Python language servers are
bundled; install sourcekit-lsp (Xcode), rust-analyzer, clangd or wat_server
yourself for those languages, on the `PATH` your client launches with. See the
main README for per-language setup and `.rarefaction.json` options.

Licensed GPL-3.0-or-later.
