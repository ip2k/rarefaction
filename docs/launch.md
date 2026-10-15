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

## 3. Repository presentation — done 2026-10-14

About description, website and topics are set; GitHub's default repository
search matches only the name, description and topics, so keep the search
terms there. The README carries the logo, two diagrams and the install
paths. Releases come from the Release workflow.

## 4. Directories

Everything posted publicly goes through Sean first (CLAUDE.md rule).

| where | how | notes |
|---|---|---|
| Anthropic directory (claude.ai, Cowork, Claude Code) | <https://claude.ai/directory/manage>, paid plan | run `claude plugin validate --strict plugins/rarefaction` and the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist) first; the portal may ask for support/privacy URLs (`supportUrl`, `privacyPolicyUrl` in the Claude manifest) |
| ChatGPT and Codex plugin directory (one shared catalog) | OpenAI Platform plugin submission ("Submit plugins" in the OpenAI developer docs) | review covers permissions, MCP checks and test cases; a local stdio server may only qualify as "Desktop only", if at all. The repo marketplace works today: `codex plugin marketplace add ip2k/rarefaction` |
| MCP Registry | automatic from the release workflow | aggregators below read it |
| awesome-mcp-servers (`punkpeye/awesome-mcp-servers`) | PR adding one line under developer tools | follow its CONTRIBUTING format |
| Glama | indexes public GitHub MCP servers on its own | claim the listing with a root `glama.json` naming `ip2k` as maintainer |
| mcp.so | Submit button, or an issue on its GitHub | local / stdio; install `npx -y rarefaction-lsp-mcp` |
| PulseMCP | Submit button | often imported from the MCP Registry; search first |
| Cline MCP Marketplace | issue on `cline/mcp-marketplace` | needs the 400×400 icon: `docs/images/icon-400.png` |

### Copy for listings

- **Name:** Rarefaction · **package:** `rarefaction-lsp-mcp` (npm) ·
  `io.github.ip2k/rarefaction-lsp-mcp` (MCP Registry) · **licence:** GPL-3.0-or-later
- **Repository:** https://github.com/ip2k/rarefaction · **support:**
  https://github.com/ip2k/rarefaction/issues · **privacy:**
  https://github.com/ip2k/rarefaction#privacy
- **Icon:** `docs/images/icon-400.png` (400×400), `plugins/rarefaction/assets/icon.png`
  (512×512), `docs/images/icon.svg`
- **Category:** developer tools / code intelligence · **transport:** local stdio,
  `npx -y rarefaction-lsp-mcp` · **tools:** `orient`, `scope`, `status`
- **Short (≤100 chars):** LSP call graph for coding agents: a symbol's callers,
  callees, tests and live files in one call.
- **Long:** Rarefaction is a local MCP server that gives coding agents the
  call graph and code context for one symbol, straight from the project's
  language server. One `orient` call returns the signature and body, callers
  (tests marked), callees, implementations, the tests that reach it with a
  command to run only them, and the short list of files a change can affect,
  so the agent reads that instead of whole files. On real commits in ripgrep
  and IronRDP the answer was a median 6–7% of the bytes of the files it
  names. Profiles cover Swift, Rust, C/C++, TypeScript/JavaScript, Python and
  WebAssembly text. Runs locally with no network calls or telemetry; also a
  Claude Code and Codex plugin.
- **awesome-mcp-servers line** (Developer Tools; check their legend first):
  `- [ip2k/rarefaction](https://github.com/ip2k/rarefaction) 📇 🏠 🍎 🐧 - LSP call graph for coding agents: one orient call returns a symbol's signature, body, callers (tests marked), callees, implementations and the files a change can affect, from Swift, Rust, C/C++, TypeScript, Python or WAT language servers.`
- **Glama claim file** (`glama.json` at the repo root, once the listing exists):
  `{"$schema": "https://glama.ai/mcp/schemas/server.json", "maintainers": ["ip2k"]}`

## 5. Evidence

Listings claim only what `docs/measurement.md` records. As of 2026-10-14
that is the phase-2 offline benchmark on ripgrep and IronRDP: `orient`'s
answer is a small fraction of the bytes of the files it names, and it is
fast once the language server has indexed; scope recall missed its
threshold. Phase 1 (agent sessions) is still to be run.
