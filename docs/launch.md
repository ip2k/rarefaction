# Launch checklist

The manual steps that need Sean's accounts or sign-off. The repository side
(npm metadata, `server.json`, plugin manifests, CI and release workflows) is
done and validated; see `docs/decisions.md`, 2026-10-14.

## 1. Public repository — done 2026-10-14

Published as a fresh public repository, `ip2k/rarefaction`, from one squashed
commit, so no earlier history is public. The original private repository
(`ip2k/rarefaction-lsp-mcp`) keeps the full history and is not published.

## 2. First release (npm + MCP Registry)

- [ ] On npmjs.com: account with 2FA, then Access Tokens → Generate New Token
      → Granular, read/write on packages, **with "Bypass two-factor
      authentication" ticked** (otherwise CI fails with `EOTP`), scoped to
      `rarefaction-lsp-mcp` once it exists (first publish: all packages, then
      narrow it). Alternative: publish once locally with `npm publish --otp`,
      then set up npm trusted publishing for this workflow and drop the token.
- [ ] GitHub → Settings → Secrets and variables → Actions → New repository
      secret `NPM_TOKEN`.
- [ ] Actions → Release → Run workflow on `main` (or push tag `v0.2.0`); it
      publishes npm, the MCP Registry and the GitHub release.
- [ ] Check: `npx -y rarefaction-lsp-mcp` starts (it waits on stdin; Ctrl-C),
      <https://www.npmjs.com/package/rarefaction-lsp-mcp> and
      <https://registry.modelcontextprotocol.io/v0/servers?search=rarefaction>.
- [ ] Install the plugin from GitHub in both clients and orient once:
      `claude plugin install rarefaction --marketplace ip2k/rarefaction`;
      `codex plugin marketplace add ip2k/rarefaction && codex plugin add rarefaction@rarefaction`.

Later releases: bump the version in `package.json`, `server.json` (twice),
and both `plugins/rarefaction/.*-plugin/plugin.json`, then tag.

## 3. Repository presentation

GitHub's default repository search matches only the name, description and
topics; README text needs `in:readme` (and matters for web search). So the
About box carries the search terms.

- [ ] About → description (≈200 chars):
      "MCP server: LSP call graph for AI coding agents. One symbol's callers,
      callees, tests and impacted files in one call instead of reading whole
      files, saving tokens. Claude Code & Codex plugin."
- [ ] About → website: the npm page.
- [ ] About → topics (GitHub allows 20): `mcp`, `mcp-server`,
      `model-context-protocol`, `lsp`, `language-server-protocol`,
      `call-graph`, `call-hierarchy`, `code-intelligence`, `code-navigation`,
      `impact-analysis`, `static-analysis`, `context-engineering`,
      `token-optimization`, `coding-agent`, `ai-agents`, `claude-code`,
      `codex`, `llm`, `developer-tools`, `typescript`.

## 4. Directories

Everything posted publicly goes through Sean first (CLAUDE.md rule).

| where | how | notes |
|---|---|---|
| Anthropic directory (claude.ai, Cowork, Claude Code) | <https://claude.ai/directory/manage>, paid plan | run `claude plugin validate --strict plugins/rarefaction` and the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist) first; the portal may ask for support/privacy URLs (`supportUrl`, `privacyPolicyUrl` in the Claude manifest) |
| Codex plugin directory | curated by OpenAI; no public submission path confirmed 2026-10-14 | the GitHub marketplace works today |
| MCP Registry | automatic from the release workflow | aggregators below read it |
| awesome-mcp-servers (`punkpeye/awesome-mcp-servers`) | PR adding one line under developer tools | follow its CONTRIBUTING format |
| mcp.so, Smithery, Glama, PulseMCP | submission forms; several ingest GitHub or the registry on their own | check for an existing auto-listing before submitting |

One-line description for listings:

> Rarefaction — hands a coding agent one symbol's signature, body, callers
> (tests marked), callees, implementations and live files from the language
> server's index in one call. Swift, Rust, C/C++, TypeScript/JavaScript,
> Python, WAT. GPL-3.0-or-later.

## 5. Evidence

The strongest pitch is the phase-1 measurement in `docs/measurement.md`, run
on public open-source projects so the task list can be published. Until then,
listings claim only what is measured.
