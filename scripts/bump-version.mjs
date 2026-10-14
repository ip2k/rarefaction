#!/usr/bin/env node
// Set every version field the Release workflow checks to one value.
//
//   node scripts/bump-version.mjs 0.2.2     # explicit
//   node scripts/bump-version.mjs patch     # next patch from package.json
//
// package.json and package-lock.json go through `npm version`; server.json
// (twice) and both plugin manifests are rewritten here. Prints the version.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const arg = process.argv[2];
if (!arg) { console.error("usage: bump-version.mjs <x.y.z|patch|minor|major>"); process.exit(2); }

const current = JSON.parse(readFileSync("package.json", "utf8")).version;
let next = arg;
if (["patch", "minor", "major"].includes(arg)) {
  const [ma, mi, pa] = current.split(".").map(Number);
  next = arg === "major" ? `${ma + 1}.0.0` : arg === "minor" ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next)) { console.error(`not a version: ${next}`); process.exit(2); }

execFileSync("npm", ["version", next, "--no-git-tag-version", "--allow-same-version"], { stdio: "ignore" });

const edit = (file, fn) => {
  const json = JSON.parse(readFileSync(file, "utf8"));
  fn(json);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
};
edit("server.json", (j) => { j.version = next; for (const p of j.packages) p.version = next; });
edit("plugins/rarefaction/.claude-plugin/plugin.json", (j) => { j.version = next; });
edit("plugins/rarefaction/.codex-plugin/plugin.json", (j) => { j.version = next; });

console.log(next);
