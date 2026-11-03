import {
  chartLeaves,
  childrenOf,
  formatDate,
  getLineage,
  languageStats,
  projectStats,
  rootLanguages,
} from "./model.js";
import { esc, openMenu, toast } from "./ui.js";

// Family report & backup: a shareable snapshot of the whole tree as Markdown
// (plain text for notes tools and git) or a self-contained HTML page (opens
// anywhere, prints to PDF nicely), plus a one-click JSON backup of the exact
// project document. Everything is generated from the data as it is on screen —
// recorded forms, not derived ones — so the report never lies about the store.

const EMPTY_CELL = "";
const plural = (count, singular, many = `${singular}s`) => (count === 1 ? singular : many);

/* A code fence must be longer than any backtick run inside the fenced text,
   or the block breaks. Names are free text, so size the fence to the sketch. */
function backtickFence(lines) {
  let longest = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) || []) {
      longest = Math.max(longest, run.length);
    }
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/* ---- shared build helpers ---------------------------------------------- */

function treeOrder(project) {
  const order = [];
  const walk = (parentId) => {
    for (const child of childrenOf(project, parentId)) {
      order.push(child);
      walk(child.id);
    }
  };
  for (const root of rootLanguages(project)) {
    order.push(root);
    walk(root.id);
  }
  return order;
}

function familyTreeLines(project) {
  const collect = (parentId, prefix) => {
    const kids = childrenOf(project, parentId);
    const lines = [];
    kids.forEach((kid, index) => {
      const last = index === kids.length - 1;
      lines.push(`${prefix}${last ? "└── " : "├── "}${kid.name}`);
      lines.push(...collect(kid.id, `${prefix}${last ? "    " : "│   "}`));
    });
    return lines;
  };
  const lines = [];
  for (const root of rootLanguages(project)) {
    lines.push(root.name);
    lines.push(...collect(root.id, ""));
  }
  return lines;
}

function chartTableData(chart) {
  const rowLeaves = chartLeaves(chart.rows);
  const columnLeaves = chartLeaves(chart.columns);
  const labelOf = (leaf) => leaf.path.map((node) => node.label).join(" – ");
  const cellOf = (rowLeaf, columnLeaf) =>
    (chart.cells[`${rowLeaf.node.id}|${columnLeaf.node.id}`] || []).join(" ");
  return {
    headers: ["", ...columnLeaves.map(labelOf)],
    rows: rowLeaves.map((rowLeaf) => [
      labelOf(rowLeaf),
      ...columnLeaves.map((columnLeaf) => cellOf(rowLeaf, columnLeaf)),
    ]),
    notes: chart.notes || "",
  };
}

function normalizeGloss(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

// Cognate sets: glosses recorded with a form in two or more languages,
// grouped case-insensitively on the normalized gloss (the same convention the
// vocabulary tables and the cognate explorer use). First form per gloss wins.
function cognateData(project) {
  const order = treeOrder(project);
  const sets = new Map();
  for (const language of order) {
    for (const word of language.vocabulary) {
      const glossKey = normalizeGloss(word.gloss);
      const form = String(word.form || "").trim();
      if (!glossKey || !form) continue;
      if (!sets.has(glossKey)) sets.set(glossKey, { gloss: word.gloss.trim(), byLang: new Map() });
      const set = sets.get(glossKey);
      if (!set.byLang.has(language.id)) set.byLang.set(language.id, form);
    }
  }
  const shared = [...sets.values()].filter((set) => set.byLang.size >= 2);
  shared.sort((a, b) => a.gloss.localeCompare(b.gloss, undefined, { sensitivity: "base" }));
  const columnIds = new Set(shared.flatMap((set) => [...set.byLang.keys()]));
  return {
    sets: shared,
    columns: order.filter((language) => columnIds.has(language.id)),
  };
}

function phonotacticsRows(language) {
  const rows = [];
  const push = (label, value) => {
    if (String(value || "").trim()) rows.push([label, String(value)]);
  };
  const p = language.phonotactics || {};
  push("Syllable template", p.template);
  for (const category of Array.isArray(p.classes) ? p.classes : []) {
    const name = typeof category?.name === "string" ? category.name.trim() : "";
    const sounds = typeof category?.sounds === "string" ? category.sounds.trim() : "";
    if (name) push(`Category ${name}`, sounds);
  }
  push("Onset rules", p.onsets);
  push("Coda rules", p.codas);
  push("Forbidden clusters", p.forbidden);
  push("Notes", p.notes);
  return rows;
}

/* ---- Markdown ------------------------------------------------------------ */

function mdCell(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([|*_~[\]`])/g, "\\$1")
    .replace(/\r?\n/g, " ")
    .trim();
}

function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.map(mdCell).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  return [line(headers), divider, ...rows.map(line)].join("\n");
}

function mdHeading(project, language) {
  const depth = Math.max(0, getLineage(project, language.id).length - 1);
  // Cap at two levels so the inner sections (depth + 1 and + 2) never run
  // past h5; deeper families still keep a strictly nested outline.
  return "#".repeat(Math.min(depth, 2) + 2);
}

function mdLanguageSection(project, language) {
  const stats = languageStats(language);
  const chain = getLineage(project, language.id).map((item) => item.name);
  const heading = mdHeading(project, language);
  // Inner sections stay strictly below the language heading, whatever its
  // depth — a fixed "###" used to put them at or above their parent section.
  const section = `${heading}#`;
  const sub = `${heading}##`;
  const parts = [];

  parts.push(
    `${heading} ${mdCell(language.name)}\n\n_${chain.join(" → ")} · ${stats.consonants} consonants · ${stats.vowels} vowels · ${stats.changes} ${plural(stats.changes, "rule")} · ${stats.words} ${plural(stats.words, "word")}_`
  );

  if (String(language.notes || "").trim()) {
    parts.push(
      String(language.notes)
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => `> ${line}`)
        .join("\n")
    );
  }

  parts.push(`${section} Phonology`);
  for (const [title, chart] of [["Consonants", language.inventory.consonants], ["Vowels", language.inventory.vowels]]) {
    const table = chartTableData(chart);
    if (!table.rows.length && table.headers.length === 1) continue;
    parts.push(`${sub} ${title}\n\n${mdTable(table.headers, table.rows)}`);
    if (table.notes.trim()) parts.push(`*${title} notes: ${table.notes.trim()}*`);
  }

  const phonotactics = phonotacticsRows(language);
  if (phonotactics.length) {
    parts.push(`${section} Phonotactics\n\n${mdTable(["Setting", "Value"], phonotactics)}`);
  }

  if (language.soundChanges.length) {
    const rows = language.soundChanges.map((rule, index) => [
      String(index + 1),
      `${rule.notation}${rule.enabled === false ? " *(disabled)*" : ""}`,
      rule.note,
    ]);
    const disabledCount = language.soundChanges.filter((rule) => rule.enabled === false).length;
    parts.push(`${section} Sound changes\n\n${mdTable(["#", "Rule", "Note"], rows)}`);
    if (disabledCount) {
      parts.push(`_${disabledCount} of ${language.soundChanges.length} rule${language.soundChanges.length === 1 ? "" : "s"} disabled._`);
    }
  }

  if (language.vocabulary.length) {
    parts.push(
      `${section} Vocabulary\n\n${mdTable(
        ["Gloss", "Form", "Note"],
        language.vocabulary.map((word) => [word.gloss, word.form, word.note])
      )}`
    );
  } else {
    parts.push(`${section} Vocabulary\n\n_No words recorded._`);
  }

  return parts.join("\n\n");
}

function cognateMarkdown(project) {
  const { sets, columns } = cognateData(project);
  if (!sets.length || !columns.length) {
    return `## Cognate sets\n\n_No gloss shared by two or more languages with a recorded form._`;
  }
  const rows = sets.map((set) => [
    set.gloss,
    ...columns.map((language) => set.byLang.get(language.id) || EMPTY_CELL),
  ]);
  return [
    `## Cognate sets`,
    `_Words sharing a gloss across the family (matched case-insensitively; first form per gloss wins)._`,
    mdTable(["Gloss", ...columns.map((language) => language.name)], rows),
  ].join("\n\n");
}

export function buildMarkdown(project) {
  const stats = projectStats(project);
  const generated = `*Language Tree report — generated ${formatDate(new Date().toISOString())} · ${stats.languages} language${stats.languages === 1 ? "" : "s"} · ${stats.words} word${stats.words === 1 ? "" : "s"} · ${stats.changes} sound-change rule${stats.changes === 1 ? "" : "s"}*`;
  const sketch = familyTreeLines(project);
  const fence = backtickFence(sketch);
  const parts = [
    `# ${mdCell(project.title)}`,
    generated,
    `## Family tree\n\n${sketch.length ? `${fence}\n${sketch.join("\n")}\n${fence}` : "_No languages yet._"}`,
    ...treeOrder(project).map((language) => mdLanguageSection(project, language)),
    cognateMarkdown(project),
  ];
  return `${parts.join("\n\n").trim()}\n`;
}

/* ---- HTML ---------------------------------------------------------------- */

function htmlTable(headers, rows, { formColumns = null } = {}) {
  const isForm = formColumns
    ? (index) => formColumns.includes(index)
    : (index) => index > 0; // default: every non-label column is IPA-ish
  const headRow = headers
    .map((header, index) => `<th${index === 0 && rows.length ? ' class="corner"' : ""}>${esc(header)}</th>`)
    .join("");
  const bodyRows = rows
    .map((row) =>
      `<tr>${row
        .map((cell, index) => `<td${isForm(index) ? ' class="form"' : ""}>${esc(cell)}</td>`)
        .join("")}</tr>`
    )
    .join("");
  return `<table><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function htmlLanguageSection(project, language, index) {
  const stats = languageStats(language);
  const chain = getLineage(project, language.id).map((item) => item.name);
  const depth = chain.length - 1;
  const lineage = chain
    .map((name, position) => (position === chain.length - 1 ? `<strong>${esc(name)}</strong>` : esc(name)))
    .join(" → ");

  const charts = [
    ["Consonants", language.inventory.consonants],
    ["Vowels", language.inventory.vowels],
  ]
    .map(([title, chart]) => {
      const table = chartTableData(chart);
      if (!table.rows.length && table.headers.length === 1) return "";
      return `<h3>${esc(title)}</h3>${htmlTable(table.headers, table.rows)}${
        table.notes.trim() ? `<p class="chart-note">${esc(table.notes)}</p>` : ""
      }`;
    })
    .join("");

  const phonoRows = phonotacticsRows(language);
  const phonotacticsHtml = phonoRows.length
    ? htmlTable(["Setting", "Value"], phonoRows, { formColumns: [] })
    : "";

  const rulesHtml = language.soundChanges.length
    ? htmlTable(
        ["#", "Rule", "Note"],
        language.soundChanges.map((rule, ruleIndex) => [
          String(ruleIndex + 1),
          `${rule.notation}${rule.enabled === false ? " (disabled)" : ""}`,
          rule.note,
        ]),
        { formColumns: [1] }
      )
    : "";

  const vocabHtml = language.vocabulary.length
    ? htmlTable(["Gloss", "Form", "Note"], language.vocabulary.map((word) => [word.gloss, word.form, word.note]), {
        formColumns: [1],
      })
    : `<p class="report-empty">No words recorded.</p>`;

  return `
    <section class="report-language" id="lang-${index}" style="--depth:${depth}">
      <p class="report-kicker">${depth === 0 ? "Root language" : `Generation ${depth + 1}`}</p>
      <h2>${esc(language.name)}</h2>
      <p class="report-lineage">${lineage} <span class="report-stats">· ${stats.consonants} C · ${stats.vowels} V · ${stats.changes} ${plural(stats.changes, "rule")} · ${stats.words} ${plural(stats.words, "word")}</span></p>
      ${String(language.notes || "").trim() ? `<blockquote>${esc(language.notes).replace(/\r?\n/g, "<br>")}</blockquote>` : ""}
      <div class="report-block"><h3 class="block-title">Phonology</h3>${charts}</div>
      ${phonotacticsHtml ? `<div class="report-block"><h3 class="block-title">Phonotactics</h3>${phonotacticsHtml}</div>` : ""}
      ${rulesHtml ? `<div class="report-block"><h3 class="block-title">Sound changes</h3>${rulesHtml}</div>` : ""}
      <div class="report-block"><h3 class="block-title">Vocabulary</h3>${vocabHtml}</div>
    </section>`;
}

function cognateHtml(project) {
  const { sets, columns } = cognateData(project);
  const body =
    sets.length && columns.length
      ? htmlTable(
          ["Gloss", ...columns.map((language) => language.name)],
          sets.map((set) => [set.gloss, ...columns.map((language) => set.byLang.get(language.id) || EMPTY_CELL)])
        )
      : `<p class="report-empty">No gloss shared by two or more languages with a recorded form.</p>`;
  return `
    <section class="report-language" id="cognate-sets" style="--depth:0">
      <h2>Cognate sets</h2>
      <p class="report-lineage">Words sharing a gloss across the family (matched case-insensitively; first form per gloss wins).</p>
      ${body}
    </section>`;
}

const REPORT_CSS = `
:root { --ink: #1d2733; --muted: #66738a; --line: #dfe4ee; --soft: #f5f7fb; --accent: #2f5bd0; }
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: #fbfcfe; font: 15px/1.65 "Segoe UI", system-ui, -apple-system, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 32px 36px 72px; }
.report-head { padding-bottom: 18px; margin-bottom: 26px; border-bottom: 2px solid var(--ink); }
.report-kicker { margin: 0 0 2px; color: var(--accent); font-size: 11px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase; }
h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 32px; line-height: 1.25; }
.report-meta { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
.report-toc { margin: 0 0 30px; padding: 14px 18px; background: var(--soft); border: 1px solid var(--line); border-radius: 10px; font-size: 13px; }
.report-toc ol { margin: 4px 0 0; padding-left: 18px; }
.report-toc a { color: var(--accent); text-decoration: none; }
.report-language { margin: 0 0 42px; padding-left: 22px; border-left: 3px solid var(--line); }
.report-language > .report-kicker { color: var(--muted); }
h2 { margin: 0 0 2px; font-family: Georgia, serif; font-size: 24px; }
.report-lineage { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
blockquote { margin: 8px 0 14px; padding: 6px 14px; border-left: 3px solid var(--accent); background: var(--soft); border-radius: 0 8px 8px 0; font-style: italic; color: #42506a; }
h3 { margin: 18px 0 8px; font-size: 16px; }
.report-block { margin: 14px 0 0; padding-top: 10px; border-top: 1px dashed var(--line); }
.block-title { margin: 6px 0; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { padding: 5px 10px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
th { background: var(--soft); font-size: 12px; font-weight: 650; }
th.corner, td:first-child { background: var(--soft); font-weight: 600; }
td.form { font-family: "Cascadia Mono", Consolas, "Apple Symbols", monospace; background: #fff; }
.chart-note { margin: 6px 0 0; color: var(--muted); font-size: 12px; font-style: italic; }
.report-empty { margin: 0; color: var(--muted); font-size: 13px; font-style: italic; }
.report-tree { margin: 6px 0 0; padding: 14px 18px; background: var(--soft); border: 1px solid var(--line); border-radius: 10px; font: 13px/1.7 "Cascadia Mono", Consolas, monospace; overflow-x: auto; }
.report-footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
@media print {
  body { background: #fff; }
  main { max-width: none; padding: 0; }
  a { color: inherit; }
  th, th.corner, td:first-child { background: #f2f2f2; }
  tr { break-inside: avoid; }
  .report-toc { display: none; }
  h2 { break-after: avoid; }
}
`.trim();

export function buildHtml(project) {
  const order = treeOrder(project);
  const stats = projectStats(project);
  const generated = formatDate(new Date().toISOString());
  const sketch = familyTreeLines(project);
  const toc = [
    sketch.length ? `<li><a href="#family-tree">Family tree</a></li>` : "",
    ...order.map((language, index) => `<li><a href="#lang-${index}">${esc(language.name)}</a></li>`),
    `<li><a href="#cognate-sets">Cognate sets</a></li>`,
  ].join("");
  const languageSections = order.map((language, index) => htmlLanguageSection(project, language, index)).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.title)} — Language Tree report</title>
<style>
${REPORT_CSS}
</style>
</head>
<body>
<main>
  <header class="report-head">
    <p class="report-kicker">Language Tree report</p>
    <h1>${esc(project.title)}</h1>
    <p class="report-meta">Generated ${esc(generated)} · ${stats.languages} language${stats.languages === 1 ? "" : "s"} · ${stats.words} word${stats.words === 1 ? "" : "s"} · ${stats.changes} sound-change rule${stats.changes === 1 ? "" : "s"}</p>
  </header>
  <nav class="report-toc">
    <strong>Contents</strong>
    <ol>${toc}</ol>
  </nav>
  ${sketch.length ? `<div id="family-tree"><h2>Family tree</h2><pre class="report-tree">${esc(sketch.join("\n"))}</pre></div>` : ""}
  ${languageSections}
  ${cognateHtml(project)}
  <footer class="report-footer">Generated from Language Tree — a local tool for building language families. Forms are recorded data; sound changes are listed per language as maintained in the app.</footer>
</main>
</body>
</html>
`;
}

/* ---- downloads ------------------------------------------------------------ */

function fileStem(title) {
  const stem = String(title || "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  return stem || "language-family";
}

function downloadFile(content, filename, mimeType, message) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(message, { type: "success", duration: 3200 });
}

export function downloadMarkdown(project) {
  const stats = projectStats(project);
  const name = `${fileStem(project.title)}-report.md`;
  downloadFile(
    buildMarkdown(project),
    name,
    "text/markdown",
    `Downloading ${name} — ${stats.languages} language${stats.languages === 1 ? "" : "s"}, ${stats.words} word${stats.words === 1 ? "" : "s"}.`
  );
}

export function downloadHtml(project) {
  const name = `${fileStem(project.title)}-report.html`;
  downloadFile(buildHtml(project), name, "text/html", `Downloading ${name} — a standalone, print-friendly page.`);
}

export function downloadBackup(project) {
  // Local date, not UTC — the name should match what the user sees on the clock.
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const name = `${fileStem(project.title)}-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  downloadFile(
    JSON.stringify(project, null, 2),
    name,
    "application/json",
    `Downloading ${name} — the full project document.`
  );
}

export function openReportMenu(anchor, project) {
  openMenu(anchor, [
    { label: "Download Markdown report", icon: "book", shortcut: ".md", onClick: () => downloadMarkdown(project) },
    { label: "Download HTML report", icon: "external", shortcut: ".html", onClick: () => downloadHtml(project) },
    { separator: true },
    { label: "Download JSON backup", icon: "save", shortcut: ".json", onClick: () => downloadBackup(project) },
  ]);
}
