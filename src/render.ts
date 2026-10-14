// Compact Markdown for the `content` block. The model reads this; the
// structuredContent carries the same facts for clients that want them typed.

import type { OrientOutputType } from "./tools/orient.js";

export function renderOrient(o: OrientOutputType): string {
  const out: string[] = [];
  const s = o.symbol;
  out.push(`# ${s.name} — ${s.file}:${s.line}:${s.column}`);
  if (s.signature) out.push("", "```", s.signature, "```");
  if (s.doc) out.push("", s.doc);

  for (const warning of o.warnings ?? []) out.push("", `> ${warning}`);
  if (o.freshness.stale) out.push("", `> ⚠ index stale: ${o.freshness.advice ?? "build before trusting callers/callees"}`);

  if (o.body) {
    out.push("", `## Body (lines ${o.body.start_line}–${o.body.end_line}${o.body.truncated ? ", truncated" : ""})`, "```", o.body.text, "```");
  }

  if (s.callable && !o.references) {
    const tests = o.callers.filter((c) => c.is_test_file).length;
    out.push("", `## Callers (${o.callers.length}${tests ? `, ${tests} in tests` : ""})`);
    if (o.callers.length === 0) out.push("(none in project)");
    for (const c of o.callers) {
      const tag = c.is_test_case ? " [test]" : c.is_test_file ? " [test helper]" : "";
      out.push(`- ${indent(c.depth)}${c.name} — ${c.file}:${c.line} (calls at ${c.call_sites.join(", ")})${tag}`);
    }
    out.push("", `## Callees (${o.callees.length}${o.external_callees_omitted ? `; ${o.external_callees_omitted} SDK/package calls omitted` : ""})`);
    if (o.callees.length === 0) out.push("(none in project)");
    for (const c of o.callees) out.push(`- ${indent(c.depth)}${c.name} — ${c.file}:${c.line}`);
  } else if (o.references) {
    out.push("", `## References by file (${o.references.reduce((n, r) => n + r.count, 0)})`);
    for (const r of o.references) out.push(`- ${r.file} ×${r.count}`);
  }

  if (o.reference_contexts?.length) out.push("", "## Enclosing symbols at references (not proven call edges)",
    ...o.reference_contexts.map(c => `- ${c.name} — ${c.file}:${c.line}${c.is_test_case ? " [test]" : ""}`));

  if (o.implementations.length) {
    out.push("", `## Implementations (${o.implementations.length})`);
    for (const i of o.implementations) out.push(`- ${i.file}:${i.line}`);
  }

  if (o.type_hierarchy) {
    const { supertypes, subtypes } = o.type_hierarchy;
    if (supertypes.length) out.push("", "## Supertypes", ...supertypes.map((t) => `- ${t.name} — ${t.file}:${t.line}`));
    if (subtypes.length) out.push("", "## Subtypes / conformers", ...subtypes.map((t) => `- ${t.name} — ${t.file}:${t.line}`));
  }

  if (o.tests.length) {
    out.push("", `## Tests that reach it (${o.tests.length})`);
    for (const t of o.tests) out.push(`- ${t.name} — ${t.file}:${t.line}${t.is_test_case ? "" : " (helper)"}`);
    if (o.test_run_hint) {
      out.push("", "Run only these:", "```", o.test_run_hint.command, "```");
      if (o.test_run_hint.note) out.push(o.test_run_hint.note);
    }
  }

  out.push(
    "",
    `## Live files (${o.live_files.length} of ${o.project_source_files})`,
    ...o.live_files.map((f) => `- ${f}`),
  );
  if (o.truncated) out.push("", "> graph or reference scan truncated at the cap; narrow `up`/`down` or ask about a more specific symbol");
  out.push(
    "",
    `_${o.stats.lsp_requests} LSP requests, ${o.stats.ms} ms${o.stats.cold_start ? " (includes language-server cold start)" : ""}; index ${o.freshness.model}${o.freshness.indexed_at ? `, built ${o.freshness.indexed_at}` : ""}_`,
  );
  return out.join("\n");
}

function indent(depth: number): string {
  return depth > 1 ? `${"·".repeat(depth - 1)} ` : "";
}
