# Launch checklist

The manual steps that need Sean's accounts or sign-off. The repository side
(npm metadata, `server.json`, plugin manifests, CI and release workflows) is
done and validated; see `docs/decisions.md`, 2026-10-14.

## 1. Public repository — done 2026-10-14

Published as a fresh public repository, `ip2k/rarefaction`, from one squashed
commit, so no earlier history is public. The original private repository
(`ip2k/rarefaction-lsp-mcp`) keeps the full history and is not published.

## 2. Releases — 0.2.0 done 2026-10-14

0.2.0 was published to npm by hand (the package had to exist before npm's
Trusted Publisher could be configured), then the Release workflow added the
MCP Registry entry and the GitHub release. npm now trusts
`ip2k/rarefaction` / `release.yml` (no environment, `npm publish` allowed)
and the package requires 2FA and disallows tokens; no npm token exists.
0.2.1 is the first release published by the workflow through OIDC.

To release by hand: `node scripts/bump-version.mjs patch` (or an explicit
`X.Y.Z`; it updates `package.json`, the lockfile, `server.json` and both
plugin manifests), push to `main`, then Actions → Release → Run workflow
(or push tag `vX.Y.Z`). The workflow refuses mismatched versions and skips
npm if the version is already there.

Monthly, without anyone: Dependabot opens grouped npm and GitHub Actions
updates on the 1st; on the 8th the Maintenance workflow merges the green
ones (npm major updates stay open for review), runs the full test suite and
`npm audit`, and, if anything shipped changed since the last release, bumps
the patch version and starts the Release workflow. CI also runs `npm audit`,
`npm pack --dry-run` and dependency review on pull requests; CodeQL runs on
pushes, pull requests and weekly.

Checks after a release: `npx -y rarefaction-lsp-mcp`,
<https://www.npmjs.com/package/rarefaction-lsp-mcp>,
<https://registry.modelcontextprotocol.io/v0/servers?search=rarefaction>,
`claude plugin install rarefaction --marketplace ip2k/rarefaction`.

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
