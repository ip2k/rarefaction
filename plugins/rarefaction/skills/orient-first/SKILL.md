---
name: orient-first
description: Before reading whole files to understand or change a function, method or type, use Rarefaction's status and orient tools to get its signature, body, callers, callees, tests and live files from the language server in one call.
---

# Orient before reading

Rarefaction's MCP server answers "what is this symbol and what touches it"
from the project's language server. Use it before opening whole files.

1. In a new project, call `status` once. Check that `root` is the project and
   that the profile you need has `ok: true`; follow any setup advice it gives
   (missing language server, Xcode build-server config, compile database).
2. Call `orient` with the symbol: a bare name (`updateLocation`), a qualified
   name (`Engine.updateLocation`) or an exact workspace-relative position
   (`Sources/App/Engine.swift:204:10`). If the name is ambiguous the error
   lists exact positions; retry with one of them.
3. In repositories with several languages, pass `profile` (`swift`, `rust`,
   `c`, `typescript`, `python`, `wasm`) or use a position, and `project` for a
   nested package that is not a workspace member. A position without
   `project` is answered from the Cargo workspace that takes its crate in,
   else from its nearest project marker; a warning says when that leaves part
   of an enclosing project out and which `project` to pass. In a TypeScript
   monorepo with a `tsconfig.json` per package, callers in other packages are
   not listed even with `project`; search for them separately. `project` and
   positions are relative to the workspace root that `status` reports.
4. Start with the default bounds. Raise `up`, `down` or `max_nodes`, or set
   `include_body: false`, only when the answer is truncated or too large.
5. Read the warnings. A stale index, a server still indexing or a missing call
   hierarchy means the graph may be incomplete; say so instead of treating it
   as complete. Inspect FFI, generated bindings and string-keyed dispatch
   separately: they are not in the graph.
6. Use the "Tests that reach it" section and its "run only these" command to
   pick the tests to run after a change.
7. Before editing, call `scope` on the symbol you will change. It lists the
   files to read and check (call graph plus files that historically change
   with it), each with a reason. It is advisory: a change may still need
   files outside it, so look before editing elsewhere rather than refusing to.
