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

## Results

_None yet._

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
