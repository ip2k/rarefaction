// Breadth-first walk over the language server's call hierarchy.
//
// Two things the raw protocol gets "wrong" for an agent, fixed here:
//   - servers report a callee once per call site, so `outgoingCalls` lists the
//     same function several times — collapse by declaration;
//   - callees include the SDK (Double.*, max(_:_:) …) which is noise for a
//     task — drop them, but count them so the omission is visible.

import type { CallHierarchyItem, Range } from "vscode-languageserver-protocol";

/** The minimal interface the walk needs; LspClient satisfies it, tests fake it. */
export interface CallGraphSource {
  incomingCalls(item: CallHierarchyItem): Promise<{ from: CallHierarchyItem; fromRanges: Range[] }[] | null>;
  outgoingCalls(item: CallHierarchyItem): Promise<{ to: CallHierarchyItem; fromRanges: Range[] }[] | null>;
}

export interface WalkNode {
  key: string;
  item: CallHierarchyItem;
  /** 1 = directly connected to the root. */
  depth: number;
  /** 1-based lines of the call sites, in the caller (for callers) or the root (for callees). */
  callSiteLines: number[];
}

export interface WalkOptions {
  up: number;
  down: number;
  isExternal: (uri: string) => boolean;
  /** Stop expanding once this many nodes have been collected, and say so. */
  maxNodes?: number;
}

export interface WalkResult {
  callers: WalkNode[];
  callees: WalkNode[];
  externalCalleesOmitted: number;
  truncated: boolean;
}

export function itemKey(item: CallHierarchyItem): string {
  return `${item.uri}#${item.selectionRange.start.line}:${item.selectionRange.start.character}`;
}

export async function walkCalls(source: CallGraphSource, root: CallHierarchyItem, opts: WalkOptions): Promise<WalkResult> {
  const maxNodes = opts.maxNodes ?? 200;
  const rootKey = itemKey(root);
  let truncated = false;
  let externalCalleesOmitted = 0;

  const callers: WalkNode[] = [];
  const seenUp = new Set<string>([rootKey]);
  let frontier: CallHierarchyItem[] = [root];
  for (let depth = 1; depth <= opts.up && frontier.length > 0; depth++) {
    const next: CallHierarchyItem[] = [];
    for (const item of frontier) {
      for (const call of (await source.incomingCalls(item)) ?? []) {
        const key = itemKey(call.from);
        if (seenUp.has(key)) continue;
        seenUp.add(key);
        if (opts.isExternal(call.from.uri)) continue;
        if (callers.length >= maxNodes) {
          truncated = true;
          continue;
        }
        callers.push({ key, item: call.from, depth, callSiteLines: lines(call.fromRanges) });
        next.push(call.from);
      }
    }
    frontier = next;
  }

  const callees: WalkNode[] = [];
  const seenDown = new Set<string>([rootKey]);
  frontier = [root];
  for (let depth = 1; depth <= opts.down && frontier.length > 0; depth++) {
    const next: CallHierarchyItem[] = [];
    for (const item of frontier) {
      for (const call of (await source.outgoingCalls(item)) ?? []) {
        const key = itemKey(call.to);
        if (seenDown.has(key)) continue;
        seenDown.add(key);
        if (opts.isExternal(call.to.uri)) {
          externalCalleesOmitted += 1;
          continue;
        }
        if (callees.length >= maxNodes) {
          truncated = true;
          continue;
        }
        callees.push({ key, item: call.to, depth, callSiteLines: lines(call.fromRanges) });
        next.push(call.to);
      }
    }
    frontier = next;
  }

  return { callers, callees, externalCalleesOmitted, truncated };
}

function lines(ranges: Range[]): number[] {
  return [...new Set(ranges.map((r) => r.start.line + 1))].sort((a, b) => a - b);
}
