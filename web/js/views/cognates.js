import { allophonyRules, findLanguage, getLineage, uid } from "../model.js";
import { compileChainFrom, deriveStages, ruleCompileErrors, surfaceForForm } from "../phonology.js";
import { formatPhonemic, formatPhonetic } from "../notation.js";
import { derivationStepsMarkup } from "../derivation.js";
import { diffPairMarkup } from "../diff.js";
import { esc, icon, toast } from "../ui.js";

// The explorer follows one word (a gloss plus its form) through the family.
// Rule chains mirror the inherited vocabulary check: each language applies
// its own staged rules to what it receives from its ancestor, so a
// language's rules never re-apply to its own recorded forms. Chains compile
// once per render and are reused for every gloss in the matrix.

function normalizeGlossOf(value) {
  return String(value || "").trim().toLowerCase();
}

function sameForm(a, b) {
  const normalize = (value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  return normalize(a) === normalize(b);
}

function wordsWithForms(language) {
  return language.vocabulary.filter((word) => word.gloss.trim() && word.form.trim());
}

/* Root-first ordering that keeps sibling order at each depth. */
function languagesByDepth(project) {
  return project.languages
    .map((language, order) => ({ language, depth: getLineage(project, language.id).length - 1, order }))
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map((item) => item.language);
}

function recordedFor(targetLanguage, gloss) {
  const key = normalizeGlossOf(gloss);
  if (!key) return null;
  return (
    targetLanguage.vocabulary.find((entry) => entry.gloss.trim().toLowerCase() === key && entry.form.trim()) || null
  );
}

/*
 * One descriptor per language: whether it descends from the source, the
 * languages between them ("via Old Coastal"), and the compiled rule chain.
 * The source itself stays a row of its own with no chain — its recorded form
 * already contains its own rules.
 */
function buildRows(project, source) {
  const rows = [];
  for (const language of languagesByDepth(project)) {
    const depth = getLineage(project, language.id).length - 1;
    if (language.id === source.id) {
      rows.push({ language, depth, isSource: true, descended: true, path: [], chain: null, errors: [] });
      continue;
    }
    const lineage = getLineage(project, language.id);
    const sourceIndex = lineage.findIndex((item) => item.id === source.id);
    if (sourceIndex === -1) {
      rows.push({ language, depth, isSource: false, descended: false, path: [], chain: null, errors: [] });
      continue;
    }
    const chain = compileChainFrom(project, source.id, language.id);
    const errors = chain.ok ? ruleCompileErrors(chain.stages) : [];
    rows.push({
      language,
      depth,
      isSource: false,
      descended: true,
      path: lineage.slice(sourceIndex + 1, lineage.length - 1),
      chain,
      errors,
    });
  }
  return rows;
}

function deriveFor(row, sourceWord, project) {
  if (!row.descended || row.isSource || !row.chain.ok) {
    const recorded = recordedFor(row.language, sourceWord.gloss);
    const sourceForm = row.isSource ? sourceWord.form : recorded?.form || "";
    const surface = sourceForm ? surfaceForForm(sourceForm, project, row.language.id) : null;
    return {
      derived: row.isSource ? sourceWord.form : "",
      surface: surface?.errors.length ? "" : surface?.text || "",
      steps: [],
      error: "",
      recorded,
    };
  }
  const tokens = row.chain.context.tokenize(sourceWord.form);
  const result = deriveStages(tokens, row.chain.stages, row.chain.context);
  const derived = result.tokens.join("");
  const surface = result.errors.length ? null : surfaceForForm(derived, project, row.language.id);
  return {
    derived,
    surface: surface?.errors.length ? "" : surface?.text || "",
    steps: result.steps,
    error: row.errors[0] || result.errors[0] || "",
    recorded: recordedFor(row.language, sourceWord.gloss),
  };
}

function statusFor(sourceWord, row, cell) {
  if (!row.descended) return { kind: "outside", label: "—", icon: "info" };
  if (row.isSource) return { kind: "source", label: "Source", icon: "check" };
  if (cell.error) return { kind: "error", label: "Rule error", icon: "warning", detail: cell.error };
  if (!cell.recorded || !cell.recorded.form.trim()) {
    return {
      kind: "missing",
      label: "Missing",
      icon: "info",
      detail: `No word with the gloss “${sourceWord.gloss}” recorded in ${row.language.name}.`,
    };
  }
  if (sameForm(cell.recorded.form, cell.derived)) {
    return {
      kind: "match",
      label: "Matches",
      icon: "check",
      detail: `Rules predict ${formatPhonemic(cell.derived) || "∅"}.`,
    };
  }
  return {
    kind: "differs",
    label: "Differs",
    icon: "warning",
    detail: `Rules predict ${formatPhonemic(cell.derived) || "∅"} · recorded ${formatPhonemic(cell.recorded.form) || "∅"}.`,
  };
}

const CHIP_CLASS = {
  source: "status-match",
  match: "status-match",
  differs: "status-differs",
  error: "status-differs",
  missing: "status-missing",
  outside: "status-missing",
};

function chipMarkup(status, { compact = false } = {}) {
  const title = status.detail ? ` title="${esc(status.detail)}"` : "";
  if (compact) {
    return `<span class="status-chip chip-compact ${CHIP_CLASS[status.kind] || "status-missing"}"${title}>${icon(status.icon)}</span>`;
  }
  return `<span class="status-chip ${CHIP_CLASS[status.kind] || "status-missing"}"${title}>${icon(status.icon)}${esc(status.label)}</span>`;
}

function languageOptionsMarkup(project, ordered, selectedId) {
  return ordered
    .map((language) => {
      const depth = getLineage(project, language.id).length - 1;
      const prefix = depth ? `${"· ".repeat(depth)}` : "";
      return `<option value="${esc(language.id)}" ${language.id === selectedId ? "selected" : ""}>${esc(prefix + language.name)}</option>`;
    })
    .join("");
}

function wordOptionsMarkup(words, selectedId) {
  return words
    .map((word) => `<option value="${esc(word.id)}" ${word.id === selectedId ? "selected" : ""}>${esc(word.gloss)} — ${esc(formatPhonemic(word.form))}</option>`)
    .join("");
}

function pathMarkup(row) {
  if (row.isSource) return `<span class="muted">—</span>`;
  if (!row.path.length) return `<span class="cognate-path">direct</span>`;
  return `<span class="cognate-path">via ${esc(row.path.map((item) => item.name).join(" › "))}</span>`;
}

function stepsMarkup(cell, row = null) {
  return derivationStepsMarkup(cell.steps, {
    hideEmpty: true,
    showLanguage: true,
    emptyText: row?.isSource
      ? "This is the source language — the trail starts here: its rules are already baked into every daughter's chain, so its own step list is empty."
      : "No rules change this form — it passes through unchanged.",
  });
}

const singleHash = (languageId, wordId) => `#/cognates/${encodeURIComponent(languageId)}/${encodeURIComponent(wordId)}`;

function introSummary(words, targetRows, cellsForMatrix) {
  let differs = 0;
  let missing = 0;
  let errors = 0;
  if (cellsForMatrix) {
    for (const cell of cellsForMatrix) {
      if (cell.status.kind === "differs") differs += 1;
      else if (cell.status.kind === "error") errors += 1;
      else if (cell.status.kind === "missing") missing += 1;
    }
  }
  return `
    <div class="inventory-summary">
      <span><strong>${words.length}</strong> ${words.length === 1 ? "gloss" : "glosses"}</span>
      <span><strong>${targetRows.length}</strong> descended</span>
      ${differs ? `<span><strong>${differs}</strong> differ</span>` : ""}
      ${errors ? `<span><strong>${errors}</strong> rule ${errors === 1 ? "error" : "errors"}</span>` : ""}
      ${missing ? `<span><strong>${missing}</strong> unrecorded</span>` : ""}
    </div>`;
}

function emptyWordsPanel(source) {
  return `
    <section class="panel">
      <header class="panel-head">
        <div class="panel-title">
          <h2>${esc(source.name)}</h2>
          <p>No recorded words with both a gloss and a form.</p>
        </div>
      </header>
      <div class="panel-body">
        <div class="inline-empty">
          ${icon("book")}
          <span>Add words in the vocabulary tab, then come back to follow them through the family.</span>
          <a class="button button-quiet button-small" href="#/language/${esc(source.id)}/vocabulary">${icon("book")}Open vocabulary</a>
        </div>
      </div>
    </section>`;
}

function matrixMarkup(source, words, targetRows, matrixCells) {
  const columnTitles = targetRows.map((row) => {
    const via = row.path.length ? ` via ${row.path.map((item) => item.name).join(" › ")}` : " (direct daughter)";
    const broken = row.errors.length ? ` — rule error: ${row.errors[0]}` : "";
    return `${row.language.name}${via}${broken}`;
  });

  const rows = words
    .map((word) => {
      const cellStatuses = matrixCells.filter((item) => item.word.id === word.id);
      return `
        <tr data-matrix-word="${esc(word.id)}">
          <td class="cognate-sticky matrix-gloss">${esc(word.gloss)}</td>
          <td class="matrix-form-cell"><code class="ipa">${esc(formatPhonemic(word.form))}</code></td>
          ${cellStatuses
            .map((item) => `<td class="cognate-cell">${chipMarkup(item.status, { compact: true })}</td>`)
            .join("")}
          <td class="row-actions">
            <button class="icon-button icon-button-small" type="button" data-matrix-trace="${esc(word.id)}" title="Trace this word step by step" aria-label="Trace this word">${icon("chevronRight")}</button>
          </td>
        </tr>`;
    })
    .join("");

  const noDaughters = !targetRows.length;
  return `
    ${
      noDaughters
        ? `<div class="notice cognate-no-daughters">
            ${icon("tree")}
            <p>No daughter languages descend from <strong>${esc(source.name)}</strong> yet, so there is nothing to compare. Create a daughter in the family tree, give it rules and vocabulary, and its reflexes will appear as columns here.</p>
            <a class="button button-quiet button-tiny" type="button" href="#/tree">${icon("tree")}Open family tree</a>
          </div>`
        : ""
    }
    <div class="table-scroll">
      <table class="data-table cognate-matrix">
        <thead>
          <tr>
            <th class="cognate-sticky">Gloss</th>
            <th class="matrix-source-col">${esc(source.name)} <span class="th-note">form</span></th>
            ${targetRows
              .map((row, index) => `<th class="matrix-lang-col" title="${esc(columnTitles[index])}">${esc(row.language.name)}</th>`)
              .join("")}
            <th class="row-actions-head"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="check-foot">Each chip compares the recorded form with the output of that language’s chain of rules from ${esc(source.name)}. Click a row to see the derivation step by step.${words.length ? "" : " No glosses are recorded in the source language yet."}</p>`;
}

function traceMarkup(project, source, word, rows) {
  const usable = rows.filter((row) => row.descended);
  const outside = rows.length - usable.length;
  const showSurface = usable.some((row) => allophonyRules(row.language.allophony).length);

  const rowsMarkup = usable
    .map((row) => {
      const cell = deriveFor(row, word, project);
      const status = statusFor(word, row, cell);
      // A differing reflex colors the segments that diverged: minimal
      // alignment over the language's own tokenizer, so the user sees which
      // sound moved instead of a binary "Differs".
      const diff =
        status.kind === "differs" && row.chain.ok
          ? diffPairMarkup(cell.derived, cell.recorded?.form || "", row.chain.context)
          : null;
      const disabled =
        row.isSource || status.kind === "match" || status.kind === "source" || status.kind === "error"
          ? "disabled"
          : "";
      const recordLabel = status.kind === "differs" ? "Use derived" : "Record";
      return `
        <tr${row.isSource ? ' class="is-source-row"' : ""}>
          <td class="cognate-lang"><span class="cognate-lang-name" style="--cognate-depth:${row.depth}">${esc(row.language.name)}</span></td>
          <td>${pathMarkup(row)}</td>
          <td><code class="ipa derived-form">${diff ? diff.left : esc(formatPhonemic(cell.derived)) || "—"}</code></td>
          ${showSurface ? `<td><code class="ipa surface-form">${esc(formatPhonetic(cell.surface)) || "—"}</code></td>` : ""}
          <td>${diff ? `<code class="ipa">${diff.right}</code>` : cell.recorded && cell.recorded.form.trim() ? `<code class="ipa">${esc(formatPhonemic(cell.recorded.form))}</code>` : `<span class="muted">not recorded</span>`}</td>
          <td>${chipMarkup(status)}</td>
          <td class="row-actions">
            <button class="icon-button icon-button-small" type="button" data-toggle-steps="${esc(row.language.id)}" title="Show derivation steps" aria-label="Show derivation steps">${icon("chevronRight")}</button>
            <button class="button button-quiet button-tiny" type="button" data-record-for="${esc(row.language.id)}" ${disabled} title="${row.isSource ? "Recorded in the source language" : `Record the derived phonemic form in ${esc(row.language.name)}`}">${recordLabel}</button>
          </td>
        </tr>
        <tr class="cognate-detail" data-detail-row="${esc(row.language.id)}" hidden>
          <td colspan="${showSurface ? 7 : 6}">${stepsMarkup(cell, row)}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table class="data-table cognate-table">
        <thead>
          <tr>
            <th class="cognate-language-col">Language</th>
            <th>Chain</th>
            <th>Derived /…/</th>
            ${showSurface ? "<th>Surface [ … ]</th>" : ""}
            <th>Recorded /…/</th>
            <th>Status</th>
            <th class="row-actions-head"></th>
          </tr>
        </thead>
        <tbody>${rowsMarkup}</tbody>
      </table>
    </div>
    <p class="check-foot">
      The derived form applies every language’s staged sound changes along the path below ${esc(source.name)}; a language’s own rules never apply again to its recorded forms. Surface forms apply this language’s synchronic allophony afterwards, not as part of the chain.
      ${outside ? `${outside} language${outside === 1 ? "" : "s"} outside this line of descent ${outside === 1 ? "is" : "are"} not compared.` : ""}
      Record the derived form when a reflex is correct.
    </p>`;
}

export function renderCognates(container, ctx) {
  const { project, route } = ctx;
  const ordered = languagesByDepth(project);

  let source = route.id && findLanguage(project, route.id) ? findLanguage(project, route.id) : null;
  if (!source) {
    source = ordered.find((language) => wordsWithForms(language).length) || ordered[0] || null;
  }

  if (!source) {
    container.innerHTML = `
      <div class="workspace-stack">
        <section class="panel"><div class="panel-body"><div class="notice">${icon("info")}<p>There is nothing to explore yet.</p></div></div></section>
      </div>`;
    return;
  }

  const words = wordsWithForms(source);
  const rows = buildRows(project, source);
  const targetRows = rows.filter((row) => row.descended && !row.isSource);
  const word = words.find((entry) => entry.id === route.wordId) || null;
  const singleMode = Boolean(word);

  // Derive once per (target language, gloss). The matrix reuses these cells;
  // in single-gloss mode only the traced word is derived.
  const cellsByLanguage = new Map();
  for (const row of targetRows) {
    const traced = singleMode ? [word] : words;
    cellsByLanguage.set(
      row.language.id,
      traced.map((entry) => ({ word: entry, ...deriveFor(row, entry, project) }))
    );
  }

  let matrixCells = null;
  if (!singleMode) {
    matrixCells = [];
    for (const row of targetRows) {
      for (const cell of cellsByLanguage.get(row.language.id)) {
        matrixCells.push({ word: cell.word, cell, row, status: statusFor(cell.word, row, cell) });
      }
    }
  }

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Cognates</p>
          <h2>Cognate explorer</h2>
          <p class="section-copy">${
            singleMode
              ? `The trace of <strong>${esc(word.gloss)}</strong> from ${esc(source.name)} through every language it reaches.`
              : `Pick a language below, and follow every recorded gloss down through its daughters. Chains apply the staged rules of each language, from ${esc(source.name)} onward.`
          }</p>
        </div>
        ${singleMode ? "" : introSummary(words, targetRows, matrixCells)}
      </section>

      <section class="panel">
        <header class="panel-head">
          <div class="panel-title">
            <h2>${singleMode ? `Trace — ${esc(word.gloss)}` : `All glosses of ${esc(source.name)}`}</h2>
            <p>${singleMode ? `Recorded forms compared with the output of the rule chains from ${esc(source.name)}.` : `The matrix compares each language’s recorded form with its chain-derived form.`}</p>
          </div>
          <div class="cognate-picker">
            ${singleMode ? `<button class="button button-quiet button-small" type="button" data-matrix-back title="Back to all glosses">${icon("chevronLeft")}All glosses</button>` : ""}
            <select class="select" data-source-select aria-label="Source language" title="Source language">
              ${languageOptionsMarkup(project, ordered, source.id)}
            </select>
            ${singleMode ? `<select class="select" data-word-select aria-label="Gloss to trace" title="Gloss to trace">${wordOptionsMarkup(words, word.id)}</select>` : ""}
          </div>
          <span class="panel-icon">${icon("language")}</span>
        </header>
        ${
          singleMode
            ? traceMarkup(project, source, word, rows)
            : words.length
              ? matrixMarkup(source, words, targetRows, matrixCells)
              : emptyWordsPanel(source)
        }
      </section>
    </div>
  `;

  container.querySelector("[data-source-select]").addEventListener("change", (event) => {
    const next = event.target.value;
    if (next) ctx.navigate(`#/cognates/${encodeURIComponent(next)}`);
  });

  container.querySelector("[data-word-select]")?.addEventListener("change", (event) => {
    if (event.target.value) ctx.navigate(singleHash(source.id, event.target.value));
  });

  container.querySelector("[data-matrix-back]")?.addEventListener("click", () => {
    ctx.navigate(`#/cognates/${encodeURIComponent(source.id)}`);
  });

  container.querySelectorAll("[data-matrix-word]").forEach((rowElement) => {
    rowElement.addEventListener("click", (event) => {
      if (event.target.closest("button, a")) return;
      ctx.navigate(singleHash(source.id, rowElement.dataset.matrixWord));
    });
  });

  container.querySelectorAll("[data-matrix-trace]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      ctx.navigate(singleHash(source.id, button.dataset.matrixTrace));
    });
  });

  container.querySelectorAll("[data-toggle-steps]").forEach((button) => {
    button.addEventListener("click", () => {
      const detailRow = container.querySelector(`[data-detail-row="${button.dataset.toggleSteps}"]`);
      if (!detailRow) return;
      const open = !detailRow.hidden;
      detailRow.hidden = open;
      button.innerHTML = icon(open ? "chevronRight" : "chevronDown");
      button.setAttribute("aria-expanded", open ? "false" : "true");
    });
  });

  container.querySelectorAll("[data-record-for]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = rows.find((item) => item.language.id === button.dataset.recordFor);
      const cell = cellsByLanguage.get(button.dataset.recordFor)?.find((entry) => entry.word.id === word.id);
      if (!row || !cell) return;
      const target = row.language;
      const normalizedGloss = word.gloss.trim().toLowerCase();
      const existing = target.vocabulary.find((entry) => entry.gloss.trim().toLowerCase() === normalizedGloss);
      if (existing) {
        existing.form = cell.derived;
        if (!existing.note) existing.note = `Derived from ${source.name}.`;
      } else {
        target.vocabulary.push({
          id: uid("word"),
          gloss: word.gloss,
          form: cell.derived,
          note: `Derived from ${source.name}.`,
        });
      }
      ctx.touch({ label: "Record word" });
      ctx.refresh();
      toast(`Recorded “${word.gloss}” as ${formatPhonemic(cell.derived) || "∅"} in ${target.name}.`, { type: "success" });
    });
  });
}
