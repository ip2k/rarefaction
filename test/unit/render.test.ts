import { describe, expect, it } from "vitest";
import { renderOrient } from "../../src/render.js";
import type { OrientOutputType } from "../../src/tools/orient.js";

const base: OrientOutputType = {
  symbol: { name: "Engine.update(_:)", file: "Sources/Engine.swift", line: 10, column: 22, callable: true, signature: "func update(_ v: Int)" },
  body: { start_line: 10, end_line: 12, text: "func update(_ v: Int) {\n  x = v\n}", truncated: false },
  callers: [
    { name: "Recorder.record(_:)", file: "Sources/Recorder.swift", line: 4, depth: 1, call_sites: [6], is_test_file: false, is_test_case: false },
    { name: "EngineTests.testIt()", file: "Tests/EngineTests.swift", line: 9, depth: 2, call_sites: [10], is_test_file: true, is_test_case: true },
  ],
  callees: [],
  external_callees_omitted: 2,
  implementations: [],
  tests: [{ name: "EngineTests.testIt()", file: "Tests/EngineTests.swift", line: 9, depth: 2, is_test_case: true }],
  test_run_hint: { command: "swift test --filter EngineTests" },
  live_files: ["Sources/Engine.swift", "Sources/Recorder.swift", "Tests/EngineTests.swift"],
  project_source_files: 12,
  freshness: { model: "on-open", stale: false },
  truncated: false,
  stats: { lsp_requests: 7, ms: 42, cold_start: false },
};

describe("renderOrient", () => {
  it("puts the essentials in a compact, scannable order", () => {
    const text = renderOrient(base);
    const order = ["# Engine.update", "## Body", "## Callers (2, 1 in tests)", "[test]", "## Callees (0; 2 SDK/package calls omitted)", "## Tests that reach it (1)", "swift test --filter", "## Live files (3 of 12)", "7 LSP requests"];
    let last = -1;
    for (const needle of order) {
      const at = text.indexOf(needle);
      expect(at, `expected "${needle}" in output`).toBeGreaterThan(last);
      last = at;
    }
  });

  it("indents deeper callers so depth reads at a glance", () => {
    const text = renderOrient(base);
    expect(text).toContain("- Recorder.record(_:)");
    expect(text).toContain("- · EngineTests.testIt()");
  });

  it("warns loudly when the index is stale", () => {
    const text = renderOrient({ ...base, freshness: { model: "on-build", stale: true, advice: "build first" } });
    expect(text).toContain("⚠ index stale: build first");
  });

  it("falls back to references for a non-callable symbol", () => {
    const text = renderOrient({ ...base, symbol: { ...base.symbol, callable: false }, callers: [], references: [{ file: "A.swift", count: 3 }] });
    expect(text).toContain("## References by file (3)");
    expect(text).not.toContain("## Callers");
  });
});
