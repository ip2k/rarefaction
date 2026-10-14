import { describe, expect, it } from "vitest";
import type { CallHierarchyItem, Range } from "vscode-languageserver-protocol";
import { itemKey, walkCalls, type CallGraphSource } from "../../src/graph/walk.js";

const zero: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

function item(name: string, uri: string, line: number): CallHierarchyItem {
  const r: Range = { start: { line, character: 4 }, end: { line, character: 4 + name.length } };
  return { name, kind: 12, uri, range: r, selectionRange: r };
}

const proj = (f: string) => `file:///proj/${f}`;
const A = item("a", proj("A.swift"), 10);
const B = item("b", proj("B.swift"), 20);
const C = item("c", proj("C.swift"), 30);
const T = item("testC", proj("Tests/T.swift"), 5);
const SDK = item("max(_:_:)", "file:///sdk/Swift.swiftinterface", 1);
const callSite = (line: number): Range => ({ start: { line, character: 0 }, end: { line, character: 1 } });

/** b calls a (twice), c calls b, testC calls c; a calls SDK max twice and b once. */
const graph: CallGraphSource = {
  async incomingCalls(x) {
    const k = itemKey(x);
    if (k === itemKey(A)) return [{ from: B, fromRanges: [callSite(21), callSite(25)] }];
    if (k === itemKey(B)) return [{ from: C, fromRanges: [callSite(31)] }];
    if (k === itemKey(C)) return [{ from: T, fromRanges: [callSite(6)] }];
    return [];
  },
  async outgoingCalls(x) {
    if (itemKey(x) === itemKey(A)) {
      return [
        { to: SDK, fromRanges: [callSite(11)] },
        { to: SDK, fromRanges: [callSite(12)] },
        { to: B, fromRanges: [callSite(13)] },
      ];
    }
    return [];
  },
};

const isExternal = (uri: string) => !uri.startsWith("file:///proj/");

describe("walkCalls", () => {
  it("walks callers to the requested depth with call-site lines", async () => {
    const r = await walkCalls(graph, A, { up: 2, down: 0, isExternal });
    expect(r.callers.map((n) => [n.item.name, n.depth])).toEqual([
      ["b", 1],
      ["c", 2],
    ]);
    expect(r.callers[0]?.callSiteLines).toEqual([22, 26]);
  });

  it("reaches the test at depth 3 and stops there", async () => {
    const r = await walkCalls(graph, A, { up: 3, down: 0, isExternal });
    expect(r.callers.map((n) => n.item.name)).toEqual(["b", "c", "testC"]);
  });

  it("collapses duplicate callees and counts external ones instead of listing them", async () => {
    const r = await walkCalls(graph, A, { up: 0, down: 1, isExternal });
    expect(r.callees.map((n) => n.item.name)).toEqual(["b"]);
    expect(r.externalCalleesOmitted).toBe(1);
  });

  it("does not revisit a node reachable by two paths", async () => {
    const diamond: CallGraphSource = {
      async incomingCalls(x) {
        const k = itemKey(x);
        if (k === itemKey(A)) return [{ from: B, fromRanges: [zero] }, { from: C, fromRanges: [zero] }];
        if (k === itemKey(B) || k === itemKey(C)) return [{ from: T, fromRanges: [zero] }];
        return [];
      },
      async outgoingCalls() {
        return [];
      },
    };
    const r = await walkCalls(diamond, A, { up: 2, down: 0, isExternal });
    expect(r.callers.filter((n) => n.item.name === "testC")).toHaveLength(1);
  });

  it("truncates at the node cap and says so", async () => {
    const r = await walkCalls(graph, A, { up: 3, down: 0, isExternal, maxNodes: 1 });
    expect(r.callers).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });
});
