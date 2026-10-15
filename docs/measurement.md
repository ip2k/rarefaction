# Measurement

The claim this project makes is quantitative — an agent starts work on a
symbol with fewer bytes in context and fewer tool calls — so it is measured,
and the thresholds are written down *before* the measurement, not fitted to
it. A miss is recorded as a miss. (The method is borrowed from Girder's
`docs/*-policy.json` + `*-observation.json` pairs, which are the most honest
thing about that project.)

## Phase 1 — `orient`

**Corpus.** 10–15 real tasks from Chauffeur's git history, each phrased as a
question about one symbol ("what would break if this scoring method changed
its default argument?"). The task list lives outside this repository (Chauffeur is a
product); only the aggregate numbers are recorded here.

**Baseline.** A Claude Code session with the native `LSP` tool, `Read`,
`Grep` and `Glob`, asked the same question, in the project root, cold.

**Treatment.** The same session with `orient` available and its description
saying to call it before reading files.

**Metrics, per task, until the first correct edit or the correct answer:**

| metric | how |
|---|---|
| bytes of tool output consumed | sum of tool-result sizes in the transcript |
| tool calls | count |
| caller recall | callers listed by `orient` ÷ callers found by `grep -w` + manual check |
| wall time to first correct edit | transcript timestamps |

**Thresholds, stated 2026-09-11 before any measurement:**

- median bytes ≤ **0.6×** baseline
- median tool calls ≤ **0.5×** baseline
- caller recall ≥ **0.95** on the corpus; every miss gets a root cause
  (dynamic dispatch, string-keyed coupling, stale index, bug)
- no task where `orient` makes the outcome worse (a wrong edit the baseline
  did not make)

**Per-call cost budget, measured on 2026-09-11 (not a threshold, a baseline):**
`orient` on one scoring method in the product's engine, up 2 / down 1 —
11 LSP requests, 605 ms including language-server cold start, 3.8 KB of text.

## Phase 2 — `scope` (tree-shaking)

Thresholds to be stated before phase 2 starts. The metric that matters is
**scope recall**: how often an agent under a `scope` hook needs to expand the
live set, and whether the expansion was a graph miss or a "fuzzy edge" miss
(string-keyed coupling, conventions). The 2026-09-11 probe on Chauffeur gave
live sets of 8/165 files (that scoring method, up 2) and 26/165
(a location-update method, up 3) in 77–113 ms; recall was not measured.

### Offline protocol and thresholds, stated 2026-10-14 before any measurement

`scope` is not built yet, but the set it would enforce is `orient`'s live
set, so scope recall can be measured offline against real history:

- **Corpus.** Per project, the most recent non-merge commits (up to 25)
  that change between 2 and 15 source files in the profile's language
  (tests count; lockfiles, generated files, renames and docs do not), and
  whose first changed hunk falls inside a function or method at the parent
  commit.
- **Seed.** That enclosing function or method, found with
  `textDocument/documentSymbol` at the parent commit: the edit an agent
  would start from.
- **Live set.** `orient` on the seed at the parent commit with the default
  bounds (up 2, down 1, 50 nodes per direction).
- **Scope recall** per commit = changed source files inside the live set ÷
  changed source files. A miss is a changed file outside it.
- **Live fraction** = live files ÷ project source files.
- **Bytes.** `orient` text + structured content ÷ the bytes of reading
  every live file once, and ÷ the bytes of every changed file.
- **Time.** `orient` wall time after the language server has indexed
  (cold start reported separately).

Thresholds:

- median scope recall ≥ **0.80** across the corpus, per language
- median live fraction ≤ **0.10**
- median `orient` bytes ≤ **0.25×** reading the live files once
- p90 warm `orient` time ≤ **5 s**
- every miss gets a root cause: dynamic dispatch, macro or generated code,
  string/config coupling, same-change co-edit with no graph edge (for
  example a new call added in the same commit), index gap, or tool bug

What this does not measure: whether an agent working under a `scope` hook
finishes the task, or token use in a real session; those need the phase-1
agent protocol.

### Widened scope: design and thresholds, stated 2026-10-15 before any measurement

The phase-2 result showed call edges alone miss half of a change. `scope`
adds co-change history, which records coupling a language server cannot
see (data, configuration, IPC, tests run as processes). The design is fixed
here, before any run, so it cannot be fitted to the data:

- **Scope** = `orient`'s live set (default bounds) ∪ the seed file's
  co-change neighbours.
- **Co-change neighbours.** From the project's git history before the
  working tree's `HEAD` (no merges, at most the last 1,000 commits), drop
  commits that touch more than 20 source files (sweeps). For each other
  source file *f*: support = commits touching both the seed's file and *f*;
  confidence = support ÷ commits touching the seed's file. Keep *f* when
  support ≥ 2 and confidence ≥ 0.15; at most 15 files, by support then
  confidence. No other tuning knobs.
- **Held-out corpus.** Same projects, revisions and qualifying rule as the
  phase-2 run, but the *next* 25 measured commits per project, skipping the
  25 already used. History for co-change is taken at each commit's parent,
  so the commit being predicted never informs its own scope.

Thresholds (the phase-2 bars, unchanged):

- median scope recall ≥ **0.80** per project
- median scope size ≤ **0.10** of project source files
- p90 warm `scope` time ≤ **5 s**

Reported alongside, not judged: recall of the live set alone and of
co-change alone on the same commits. Every miss is root-caused as before.
If `scope` misses, it still ships as an advisory working set with the
measured recall stated, and no enforcing hook is built.

## Results

### 2026-10-15 — widened `scope` on held-out commits (ripgrep, IronRDP)

Design and thresholds as stated above (commit `2845830`, before any run);
`scope` as shipped in `src/tools/scope.ts` with `src/graph/cochange.ts`. Same
revisions as the phase-2 run, full git history, the next 25 measured
commits per project (no overlap with the phase-2 set). Harness:
`scripts/measure-scope.ts --tool scope --skip-measured 25`.

| metric | threshold | ripgrep | IronRDP | verdict |
|---|---|---|---|---|
| median scope recall | ≥ 0.80 | **0.50** (pooled 0.37) | **0.50** (pooled 0.47) | **miss** |
| — call graph alone, same commits | — | 0.50 (mean 0.45) | 0.33 (mean 0.40) | |
| — co-change alone, same commits | — | 0.00 (mean 0.06) | 0.20 (mean 0.25) | |
| — scope, mean | — | 0.51 | 0.57 | |
| commits with full recall | — | 5 / 25 | 6 / 25 | |
| median scope size ÷ project files | ≤ 0.10 | 0.031 (3 files) | 0.012 (9 files) | pass |
| files added by co-change only, median | — | 0 | 4 | |
| warm `scope` time, median / p90 | p90 ≤ 5 s | 157 / 211 ms | 387 / 445 ms | pass |
| `scope` answer, median | — | 1.5 KB | 3.2 KB | |

**Scope recall is still a miss.** Co-change history raises coverage where a
file has a long history with its neighbours (IronRDP: median 0.33 → 0.50,
mean 0.40 → 0.57), but the median change still touches files the set does
not name. Every one of the 133 missed files was checked against the history
before its commit:

| why co-change did not include it | ripgrep | IronRDP |
|---|---|---|
| never changed with the seed's file before | 12 | 39 |
| changed with it only in sweeps of more than 20 source files (dropped by design) | 32 | 19 |
| changed with it, but below support 2 / confidence 0.15 | 13 | 18 |

New coupling (first-time co-edits) cannot come from history at all. The
sweep filter cost ripgrep the most, but changing it now would fit the
parameters to this test set; a different sweep rule has to be stated
before it is measured on fresh commits.

What ships: `scope` as an advisory working set that says so in every
answer, with this coverage linked from the README. No enforcing hook.

### 2026-10-14 — phase 2, scope recall offline (ripgrep, IronRDP)

Protocol and thresholds as stated above (commit `99ccaf8`, before any run).
One clarification fixed before the first run: files the commit *adds* cannot
be in a live set computed at the parent, so recall counts only files that
existed there; added files are recorded separately. Harness:
`scripts/measure-scope.ts`; root-cause pass: `scripts/diagnose-misses.ts`.
rust-analyzer 1.94.1 (IronRDP's pinned toolchain) and stable, Linux, 4 cores.

| | ripgrep | IronRDP |
|---|---|---|
| revision | `3fce3b5` (2026-08-04) | `7b976a6` (2026-10-13) |
| Rust source files | 100 | ~810 |
| commits scanned / qualifying / measured | 539 / 100 / 25 | 201 / 100 / 25 |
| skipped: first hunk not in a function | 11 | 44 |
| changed files per commit (median, p90) | 3, 4 | 3, 9 |

| metric | threshold | ripgrep | IronRDP | verdict |
|---|---|---|---|---|
| median scope recall | ≥ 0.80 | **0.50** (pooled 0.45) | **0.50** (pooled 0.36) | **miss** |
| commits with full recall | — | 4 / 25 | 5 / 25 | |
| median live fraction | ≤ 0.10 | 0.03 (3 of 100 files) | 0.004 (3 of ~810) | pass |
| median `orient` bytes ÷ reading the live files | ≤ 0.25× | 0.062× (7.7 KB vs 123 KB) | 0.074× (10.3 KB vs 138 KB) | pass |
| median `orient` bytes ÷ reading the changed files | — | 0.070× | 0.103× | |
| warm `orient` time, median / p90 | p90 ≤ 5 s | 80 ms / 177 ms | 219 ms / 434 ms | pass |
| cold start incl. indexing, median | — | 5.7 s | 15.9 s | |

**Scope recall is a miss.** The live set is small and cheap, but on real
commits it contained only half of the other files the change touched. Every
miss was root-caused (105 files across 41 commits):

| cause | ripgrep | IronRDP |
|---|---|---|
| no call edge: the files are coupled through data, configuration or a wire protocol (CLI flags read by the printer/searcher; agent ↔ daemon ↔ ActiveX over IPC; builder options consumed by the server) | 12 | 44 |
| no call edge: repository-wide sweep (lint fixes, typos, edition migration, a constant bumped across crates) — nothing could predict these | 9 | 0 |
| test or example file with no call edge to the seed (ripgrep's integration tests run the `rg` binary through a macro; IronRDP's test suites live in separate crates) | 15 | 16 |
| reachable, but beyond the default bounds (found with up 4 / down 3 / 200 nodes) | 4 | 3 |
| the commit itself adds the call (co-edit) | 1 | 1 |
| index gap or tool bug | 0 | 0 |

What the miss means: call edges alone do not make a safe `scope`. A hook
that confined an agent to the live set would have blocked a needed edit in
most of these commits. Widening the bounds recovers only a few files; the
bulk need edges a language server does not report (data, configuration,
IPC, tests run as processes). `scope` stays unbuilt until a measured way to
add those edges exists. The byte and time results stand on their own:
`orient` gives a small, fast answer about the code around one function.

Caveats: two Rust projects, one maintainer style each; commits are a proxy
for tasks (squash-merged feature PRs in IronRDP are larger than one task);
the seed is the first changed function, which may not be where a person
would start. No agent session or token count was measured. Raw rows for
these public projects are reproducible with the two scripts above; private
projects were also tried, but none had a qualifying commit, and Swift
could not be run in this environment (no toolchain download).

Found while measuring: IronRDP pins Rust 1.94.1, whose rustup proxy lacked
rust-analyzer, so every run failed at server start while `status` reported
the profile ready. Fixed in `src/profiles/rust.ts` (detection now runs the
proxy when a toolchain is pinned and names the `rustup component add` fix).

## 2026-10-07 — polyglot bytes-only spot check

Before capture: orient on the FM1 portable sequencer's `fm1_seq_create`
using its separate eight-file desktop analysis database, up 1/down 1,
max_nodes 20 and max_body_lines 12. Baseline is reading every whole file in
that result's live set once. Treatment counts **both** MCP text and structured
content, serialized together. The spot-check threshold is ≤0.6× baseline bytes.
This is a context-size check, not the phase-1 task corpus, caller recall,
completion accuracy or measured tokenizer/billing savings. A partial firmware
index cannot establish whole-firmware coverage. Record a miss without tuning.

Captured result: **3,423 bytes / 99,477 bytes = 0.0344×**, over two live
files; five direct callees; 2,997 ms including cold start. Threshold passed
for this slice. Output counted text plus structured content, with body capped
at 12 lines. No token count, broader task-completion claim or caller-recall
claim is inferred from it.
