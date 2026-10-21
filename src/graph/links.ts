// Links a language server does not report (docs/measurement.md, "Scope
// round 2", stated before measuring): test ↔ code by file name, and
// configuration keys — key-shaped string literals in the seed's body found
// literally in a few other files. Naming and literal syntax come from the
// profile; the matching is language-agnostic.

import { basename, extname } from "node:path";
import type { Profile } from "../profiles/profile.js";

export const LINKS = {
  keyMin: 4,
  keyMax: 40,
  keyShape: /^[A-Za-z0-9][A-Za-z0-9_.-]*$/,
  keySeparator: /[-_.]/,
  maxKeyFiles: 5, // a key found in more other files than this is too common to link
  maxConfigFiles: 10,
} as const;

export interface Link { file: string; reason: string }

const stem = (rel: string) => basename(rel, extname(rel));

/** Test files named for a live code file, and code files named by a live test file. */
export function testLinks(profile: Profile, live: readonly string[], project: readonly string[]): Link[] {
  if (!profile.testedStem) return [];
  const testsByStem = new Map<string, string[]>();
  const codeByStem = new Map<string, string[]>();
  for (const f of project) {
    const tested = profile.testedStem(f);
    const [map, key] = tested !== undefined ? [testsByStem, tested] : [codeByStem, stem(f)];
    map.set(key, [...(map.get(key) ?? []), f]);
  }
  const out: Link[] = [];
  for (const f of live) {
    const tested = profile.testedStem(f);
    if (tested !== undefined) for (const code of codeByStem.get(tested) ?? []) out.push({ file: code, reason: `named by test ${f}` });
    else for (const test of testsByStem.get(stem(f)) ?? []) out.push({ file: test, reason: `test named for ${f}` });
  }
  return out.filter((l) => !live.includes(l.file));
}

/** Key-shaped string literals in `body`, in order of appearance. */
export function configKeys(profile: Profile, body: string): string[] {
  const keys: string[] = [];
  for (const m of body.matchAll(profile.stringLiteral ?? DOUBLE_QUOTED)) {
    const k = m.slice(1).find((g) => g !== undefined);
    if (k === undefined || k.length < LINKS.keyMin || k.length > LINKS.keyMax) continue;
    if (!LINKS.keyShape.test(k) || !LINKS.keySeparator.test(k) || keys.includes(k)) continue;
    keys.push(k);
  }
  return keys;
}

/** Files other than `seedFile` sharing a configuration key with the seed's body. */
export function configLinks(keys: readonly string[], seedFile: string, texts: ReadonlyMap<string, string>): Link[] {
  const out: Link[] = [];
  for (const key of keys) {
    const hits = [...texts].filter(([f, t]) => f !== seedFile && t.includes(key)).map(([f]) => f).sort();
    if (hits.length < 1 || hits.length > LINKS.maxKeyFiles) continue;
    for (const f of hits) {
      if (out.some((l) => l.file === f)) continue;
      if (out.length >= LINKS.maxConfigFiles) return out;
      out.push({ file: f, reason: `shares key "${key}"` });
    }
  }
  return out;
}

export const DOUBLE_QUOTED = /"((?:[^"\\\n]|\\.)*)"/g;
