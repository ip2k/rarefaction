import { describe, expect, it } from "vitest";
import { COCHANGE, countNeighbours, parseLog } from "../../src/graph/cochange.js";

describe("co-change neighbours", () => {
  it("counts files changed with the anchor and applies the support and confidence floors", () => {
    const commits = [
      ["a.rs", "b.rs"], ["a.rs", "b.rs"], ["a.rs", "b.rs", "c.rs"], ["a.rs"], ["a.rs"],
      ["b.rs", "c.rs"], ["c.rs", "d.rs"],
    ];
    const r = countNeighbours(commits, "a.rs");
    expect(r.anchorCommits).toBe(5);
    expect(r.neighbours).toEqual([{ file: "b.rs", support: 3, confidence: 0.6 }]); // c.rs has support 1
  });

  it("skips sweeps that touch more files than the limit", () => {
    const sweep = Array.from({ length: COCHANGE.sweepFiles + 1 }, (_, i) => (i === 0 ? "a.rs" : `f${i}.rs`));
    const r = countNeighbours([sweep, sweep, ["a.rs", "b.rs"]], "a.rs");
    expect(r.anchorCommits).toBe(1);
    expect(r.neighbours).toEqual([]);
  });

  it("drops low-confidence neighbours of a busy file and caps the list", () => {
    const commits: string[][] = [];
    for (let i = 0; i < 40; i++) commits.push(["hub.rs", `n${i % 20}.rs`]); // each neighbour: support 2, confidence 0.05
    for (let i = 0; i < 20; i++) commits.push(["hub.rs", "close.rs"]);
    const r = countNeighbours(commits, "hub.rs");
    expect(r.neighbours.map((n) => n.file)).toEqual(["close.rs"]);
    expect(r.neighbours.length).toBeLessThanOrEqual(COCHANGE.maxFiles);
  });

  it("parses git log output into project-relative source files", () => {
    const log = "\0\nsrc/a.rs\nREADME.md\nother/x.rs\n\0\nsrc/b.rs\n";
    const toProject = (p: string) => (p.startsWith("src/") ? p.slice(4) : undefined);
    expect(parseLog(log, toProject, (p) => p.endsWith(".rs"))).toEqual([["a.rs"], ["b.rs"]]);
  });
});
