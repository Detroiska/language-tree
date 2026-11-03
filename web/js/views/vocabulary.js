import { ancestorsOf, uid } from "../model.js";
import { applyWordList, copyWords, downloadWords, parseWordList, rowStatus, toTsv, toJson } from "../bulk.js";
import { deriveForm } from "../phonology.js";
import { createPhonotacticsChecker } from "../phonotactics.js";
import { esc, icon, openModal, toast } from "../ui.js";

function parentFor(ctx) {
  return ancestorsOf(ctx.project, ctx.language.id).at(-1) || null;
}

function normalizeGloss(value) {
  return String(value || "").trim().toLowerCase();
}

// Filter state lives at module level so it survives the full re-render that
// follows every edit (add word, delete word, undo, …).
const lexiconFilter = { text: "", status: "all" };

function expectedFor(ctx, word, parent) {
  if (!parent) return null;
  const parentWord = parent.vocabulary.find(
    (candidate) => candidate.form.trim() && normalizeGloss(candidate.gloss) === normalizeGloss(word.gloss) && word.gloss.trim()
  );
  if (!parentWord) return null;
  const derived = deriveForm(parentWord.form, ctx.project, ctx.language.id, { directOnly: true });
  return {
    parentWord,
    derived: derived.text,
    error: derived.error,
  };
}

function sameForm(a, b) {
  const normalize = (value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  return normalize(a) === normalize(b);
}

function checkCellMarkup(word, expected) {
  if (!expected) return `<span class="muted">—</span>`;
  if (expected.error) {
    return `<span class="status-chip status-differs" title="${esc(expected.error)}">${icon("warning")}Rule error</span>`;
  }
  if (!word.form.trim()) return `<span class="status-chip status-missing">${icon("info")}No form</span>`;
  if (sameForm(word.form, expected.derived)) {
    return `<span class="status-chip status-match" title="Matches the derived form">${icon("check")}Matches</span>`;
  }
  return `<span class="status-chip status-differs" title="Expected ${esc(expected.derived)}">${icon("warning")}Expected ${esc(expected.derived) || "∅"}</span>`;
}

function updateRowCheck(row, ctx, word, parent) {
  const cell = row.querySelector("[data-word-check]");
  if (!cell) return;
  cell.innerHTML = checkCellMarkup(word, expectedFor(ctx, word, parent));
}

function phonotacticStatus(result) {
  if (result.empty) return "empty";
  if (result.templateError) return "template-error";
  if (result.issues.length) return "invalid";
  if (!result.checked) return "off";
  return "valid";
}

function phonotacticCellMarkup(result) {
  const status = phonotacticStatus(result);
  if (status === "empty") return `<span class="muted">—</span>`;
  if (status === "template-error") {
    return `<span class="status-chip status-differs" title="${esc(result.templateError)}">${icon("warning")}Template error</span>`;
  }
  if (status === "invalid") {
    const title = result.issues.map((issue) => issue.message).join("\n");
    return `<span class="status-chip status-invalid" title="${esc(title)}">${icon("warning")}Invalid</span>`;
  }
  if (status === "off") {
    return `<span class="status-chip status-missing" title="No syllable template is set">${icon("info")}Checks off</span>`;
  }
  return `<span class="status-chip status-match" title="Fits the inventory and syllable template">${icon("check")}Valid</span>`;
}

function phonotacticIssueMarkup(result) {
  if (!result.issues.length || result.empty) return "";
  const first = result.issues[0].message;
  const extra = result.issues.length > 1 ? ` · +${result.issues.length - 1} more` : "";
  return `<span class="word-issue" title="${esc(result.issues.map((issue) => issue.message).join("\n"))}">${esc(first + extra)}</span>`;
}

function validitySummary(words, checker) {
  if (checker.compiled.empty) return "syllable template off";
  if (!checker.compiled.ok) return "template error";
  let recorded = 0;
  let valid = 0;
  let invalid = 0;
  for (const word of words) {
    const result = checker.validate(word.form);
    if (result.empty) continue;
    recorded += 1;
    const status = phonotacticStatus(result);
    if (status === "valid") valid += 1;
    if (status === "invalid") invalid += 1;
  }
  return `${valid}/${recorded} forms valid${invalid ? ` · ${invalid} invalid` : ""}`;
}

function updateRowPhonotactics(row, result) {
  const cell = row.querySelector("[data-word-phonotactics]");
  if (cell) cell.innerHTML = phonotacticCellMarkup(result);
  const issue = row.querySelector("[data-word-issue]");
  if (issue) issue.innerHTML = phonotacticIssueMarkup(result);
}

/* ---- Bulk import / export -------------------------------------------- */

const BULK_STATUS_META = {
  add: { label: "Add", cls: "status-match" },
  update: { label: "Update", cls: "status-differs" },
  skip: { label: "Keep", cls: "status-missing" },
  invalid: { label: "Invalid", cls: "status-differs" },
};

function bulkPreviewMarkup(rows, language, mode) {
  const verdicts = rows.map((row) => ({ row, verdict: rowStatus(row, language, mode) }));
  const counts = { add: 0, update: 0, skip: 0, invalid: 0 };
  for (const { verdict } of verdicts) counts[verdict.status] += 1;
  const items = verdicts
    .slice(0, 50)
    .map(({ row, verdict }) => {
      const meta = BULK_STATUS_META[verdict.status];
      return `
        <div class="bulk-row">
          <span class="status-chip ${meta.cls}">${meta.label}</span>
          <span class="bulk-row-gloss">${esc(row.gloss || "(no gloss)")}</span>
          <code class="ipa bulk-row-form">${esc(row.form) || "∅"}</code>
          ${row.note ? `<span class="bulk-row-note">${esc(row.note)}</span>` : ""}
          <span class="bulk-row-reason" title="${esc(verdict.reason)}">${esc(verdict.reason)}</span>
        </div>`;
    })
    .join("");
  const overflow = verdicts.length > 50 ? `<p class="bulk-more">…and ${verdicts.length - 50} more rows.</p>` : "";
  const summary = [
    counts.add ? `${counts.add} to add` : "",
    counts.update ? `${counts.update} to update` : "",
    counts.skip ? `${counts.skip} kept` : "",
    counts.invalid ? `${counts.invalid} invalid` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div class="bulk-preview-summary">${summary || "Nothing ready to import yet."}</div><div class="bulk-preview-list">${items}</div>${overflow}`;
}

function openBulkDialog(ctx, language, words) {
  let mode = "skip";
  let format = "tsv";
  let parsed = parseWordList("");
  const modal = openModal({
    title: `Import / export — ${language.name}`,
    width: "large",
    body: `
      <div class="bulk-tabs" role="tablist">
        <button type="button" class="bulk-tab is-active" data-bulk-tab="import">Import</button>
        <button type="button" class="bulk-tab" data-bulk-tab="export">Export</button>
      </div>
      <div data-bulk-pane="import">
        <textarea class="bulk-input" data-bulk-input rows="7" spellcheck="false" placeholder="gloss → IPA form → note&#10;house&#9;kasa&#9;dwelling" aria-label="Word list to import"></textarea>
        <p class="bulk-hint">One word per line: gloss, IPA form, optional note. Tabs, semicolons, or commas separate columns; 2+ spaces make an aligned table (multi-word glosses keep their spaces). A JSON array — or a single <code>{gloss, form, note}</code> object — works too. A header row is skipped when the first cell is “gloss”.</p>
        <div class="bulk-mode-row">
          <label class="bulk-mode"><input type="radio" name="bulk-mode" value="skip" checked> Keep existing glosses (add new only)</label>
          <label class="bulk-mode"><input type="radio" name="bulk-mode" value="update"> Update existing glosses with the pasted forms</label>
        </div>
        <div class="bulk-preview" data-bulk-preview></div>
      </div>
      <div data-bulk-pane="export" hidden>
        <div class="bulk-export-row">
          <label class="bulk-format-label">Format
            <select class="select" data-bulk-format>
              <option value="tsv">TSV (spreadsheets)</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <button type="button" class="button button-quiet button-small" data-bulk-copy>${icon("copy")}Copy</button>
          <button type="button" class="button button-quiet button-small" data-bulk-download>${icon("download")}Download file</button>
        </div>
        <textarea class="bulk-output" data-bulk-output rows="10" readonly spellcheck="false" aria-label="Exported word list"></textarea>
        <p class="bulk-hint">${words.length} word${words.length === 1 ? "" : "s"} export${words.length === 1 ? "s" : ""} cleanly — drafts without a form are included, marked empty in the form column.</p>
      </div>`,
    footer: `
      <span class="bulk-foot-summary" data-bulk-summary></span>
      <span class="bulk-foot-actions">
        <button type="button" class="button button-quiet" data-bulk-cancel>Cancel</button>
        <button type="button" class="button button-primary" data-bulk-import disabled>${icon("save")}Import words</button>
      </span>`,
    onMount({ root, close }) {
      const input = root.querySelector("[data-bulk-input]");
      const preview = root.querySelector("[data-bulk-preview]");
      const output = root.querySelector("[data-bulk-output]");
      const summary = root.querySelector("[data-bulk-summary]");
      const importButton = root.querySelector("[data-bulk-import]");
      const panes = { import: root.querySelector('[data-bulk-pane="import"]'), export: root.querySelector('[data-bulk-pane="export"]') };

      const readyRows = () => parsed.rows.filter((row) => ["add", "update"].includes(rowStatus(row, language, mode).status));
      let readyCount = 0;
      let exportOpen = false;

      root.querySelector("[data-bulk-cancel]").addEventListener("click", () => close());

      const refreshSummary = () => {
        if (exportOpen) {
          summary.textContent = `Exporting ${words.length} word${words.length === 1 ? "" : "s"}.`;
        } else {
          summary.textContent = readyCount
            ? `Ready: ${readyCount} word${readyCount === 1 ? "" : "s"} into ${language.name}.`
            : "Nothing to import yet.";
        }
      };

      const refreshExport = () => {
        if (exportOpen) output.value = format === "json" ? toJson(words) : toTsv(words);
      };

      root.querySelectorAll("[data-bulk-tab]").forEach((tab) => {
        tab.addEventListener("click", () => {
          exportOpen = tab.dataset.bulkTab === "export";
          panes.import.hidden = exportOpen;
          panes.export.hidden = !exportOpen;
          root.querySelectorAll("[data-bulk-tab]").forEach((other) => other.classList.toggle("is-active", other === tab));
          importButton.parentElement.hidden = exportOpen;
          if (exportOpen) refreshExport();
          refreshSummary();
        });
      });

      root.querySelector("[data-bulk-format]").addEventListener("change", (event) => {
        format = event.target.value;
        refreshExport();
      });

      root.querySelector("[data-bulk-copy]").addEventListener("click", () => {
        copyWords(words, format);
      });

      root.querySelector("[data-bulk-download]").addEventListener("click", () => {
        downloadWords(words, language.name, format);
      });

      const refreshImport = () => {
        parsed = parseWordList(input.value);
        const ready = readyRows();
        readyCount = ready.length;
        const warnings = parsed.warnings
          .map((line) => `<p class="bulk-warning">${icon("warning")}${esc(line)}</p>`)
          .join("");
        preview.innerHTML = warnings + bulkPreviewMarkup(parsed.rows, language, mode);
        importButton.disabled = !ready.length;
        refreshSummary();
      };

      input.addEventListener("input", refreshImport);
      root.querySelectorAll("[name='bulk-mode']").forEach((radio) => {
        radio.addEventListener("change", (event) => {
          mode = event.target.value;
          refreshImport();
        });
      });
      refreshImport();

      importButton.addEventListener("click", () => {
        const ready = readyRows();
        if (!ready.length) return;
        const result = applyWordList(language, ready, mode);
        close();
        ctx.touch({ label: `Import ${ready.length} word${ready.length === 1 ? "" : "s"}` });
        ctx.refresh();
        const parts = [
          `${result.added} added`,
          result.updated ? `${result.updated} updated` : "",
          result.skipped ? `${result.skipped} kept` : "",
          result.drafts ? `${result.drafts} without a form yet` : "",
        ].filter(Boolean);
        toast(`Imported into ${language.name}: ${parts.join(", ")}.`, { type: "success" });
      });
    },
  });
  return modal;
}

export function renderVocabulary(container, ctx) {
  const { language } = ctx;
  const parent = parentFor(ctx);
  const hasParent = Boolean(parent);
  const words = language.vocabulary;
  const checker = createPhonotacticsChecker(language);
  let checks = 0;
  let matches = 0;
  if (parent) {
    for (const word of words) {
      const expected = expectedFor(ctx, word, parent);
      if (!expected || expected.error) continue;
      checks += 1;
      if (word.form.trim() && sameForm(word.form, expected.derived)) matches += 1;
    }
  }

  const rows = words
    .map((word) => {
      const result = checker.validate(word.form);
      return `
        <tr data-word-id="${esc(word.id)}">
          <td class="word-gloss"><input class="table-input gloss-input" data-word-field="gloss" value="${esc(word.gloss)}" placeholder="meaning" autocomplete="off" aria-label="Gloss"></td>
          <td class="word-form">
            <input class="table-input ipa-input" data-word-field="form" value="${esc(word.form)}" placeholder="IPA form" autocomplete="off" spellcheck="false" aria-label="Word form">
            <div class="word-issue-wrap" data-word-issue>${phonotacticIssueMarkup(result)}</div>
          </td>
          <td class="word-phonotactics" data-word-phonotactics>${phonotacticCellMarkup(result)}</td>
          ${hasParent ? `<td class="word-check" data-word-check>${checkCellMarkup(word, expectedFor(ctx, word, parent))}</td>` : ""}
          <td class="word-note"><input class="table-input" data-word-field="note" value="${esc(word.note)}" placeholder="optional note" autocomplete="off" aria-label="Word note"></td>
          <td class="row-actions">
            <button class="icon-button icon-button-small" type="button" data-trace-word title="Trace in the cognate explorer" aria-label="Trace in the cognate explorer">${icon("language")}</button>
            <button class="icon-button icon-button-small danger-hover" type="button" data-delete-word title="Delete word" aria-label="Delete word">${icon("trash")}</button>
          </td>
        </tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Lexicon</p>
          <h2>Vocabulary</h2>
          <p class="section-copy">A small working list in IPA. ${hasParent ? `Forms are compared with the output of this language’s rules applied to ${esc(parent.name)} words with the same gloss.` : "Add words here; daughter languages can use them to test inherited forms."} Each form is also checked against the inventory and <a href="#/language/${language.id}/phonotactics">phonotactics</a>.</p>
        </div>
        <div class="inventory-summary">
          <span><strong>${words.length}</strong> ${words.length === 1 ? "word" : "words"}</span>
          ${hasParent ? `<span><strong>${matches}/${checks}</strong> checks match</span>` : ""}
          <span data-phonotactics-summary>${validitySummary(words, checker)}</span>
        </div>
      </section>

      <section class="panel lexicon-panel">
        <header class="panel-head">
          <div class="panel-title">
            <h2>${esc(language.name)} lexicon</h2>
            <p>${hasParent ? `Expected forms come from ${esc(parent.name)} via the staged sound changes.` : "Root vocabulary is the starting point for descendant checks."}</p>
          </div>
          <span class="bulk-actions">
            <button class="button button-quiet button-small" type="button" data-bulk-words title="Import or export the word list" aria-label="Import or export the word list">${icon("external")}Import / export</button>
          </span>
          <button class="button button-primary button-small" type="button" data-add-word>${icon("plus")}Add word</button>
        </header>
        ${
          words.length
            ? `
              <div class="lexicon-filters">
                <input class="input lexicon-filter-input" data-word-filter type="text" value="${esc(lexiconFilter.text)}" placeholder="Filter by gloss, form, or note" autocomplete="off" spellcheck="false" aria-label="Filter words">
                <select class="select lexicon-filter-select" data-word-status-filter aria-label="Filter words by status">
                  <option value="all">All words</option>
                  <option value="issues">Needs attention</option>
                  <option value="drafts">Drafts (no form)</option>
                  <option value="invalid">Phonotactics: invalid</option>
                  ${hasParent ? `<option value="differs">Inherited: differs</option>` : ""}
                </select>
                <span class="lexicon-filter-count" data-filter-count></span>
              </div>
              <div class="table-scroll lexicon-scroll">
                <table class="data-table word-table">
                  <thead>
                    <tr>
                      <th class="gloss-col">Gloss</th>
                      <th class="form-col">Form <span class="th-note">IPA</span></th>
                      <th class="phonotactics-col">Phonotactics</th>
                      ${hasParent ? `<th class="check-col">Inherited check</th>` : ""}
                      <th>Note</th>
                      <th class="row-actions-head"></th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
              <p class="table-foot">${hasParent ? "A dash means no word with that gloss exists in the ancestor. The inherited check uses only this language’s direct sound changes; top-level rules match the ancestor’s form together, then sequential rules run in order." : "Add descendant languages to compare their forms against these roots."} The phonotactics column checks this language’s own inventory and syllable template.</p>
              <p class="lexicon-filter-empty" data-filter-empty hidden>No words match the current filter.</p>
            `
            : `
              <div class="lexicon-empty">
                <div class="empty-icon small">${icon("book")}</div>
                <h3>No words yet</h3>
                <p>Start with a handful of basic vocabulary items. They will become the test bed for sound changes and phonotactics.</p>
                <button class="button button-primary button-small" type="button" data-add-word>${icon("plus")}Add the first word</button>
              </div>`
        }
      </section>
    </div>
  `;

  // Status buckets reused by the filter: draft (no form), phonotactically
  // invalid, inherited-check differs, or rule error on the derivation.
  const wordStatus = (word) => {
    if (!word.form.trim()) return "draft";
    const phono = phonotacticStatus(checker.validate(word.form));
    if (phono === "invalid" || phono === "template-error") return "invalid";
    if (parent) {
      const expected = expectedFor(ctx, word, parent);
      if (expected?.error) return "error";
      if (expected && !sameForm(word.form, expected.derived)) return "differs";
    }
    return "ok";
  };
  const issueStatuses = new Set(["draft", "invalid", "differs", "error"]);

  const applyFilters = () => {
    const query = lexiconFilter.text.trim().toLowerCase();
    const filtering = Boolean(query) || lexiconFilter.status !== "all";
    let visible = 0;
    container.querySelectorAll("[data-word-id]").forEach((row) => {
      const word = language.vocabulary.find((entry) => entry.id === row.dataset.wordId);
      if (!word) return;
      const haystack = [word.gloss, word.form, word.note].join(" ").toLowerCase();
      const matchesText = !query || haystack.includes(query);
      const status = wordStatus(word);
      const statusFilter = lexiconFilter.status;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "issues" && issueStatuses.has(status)) ||
        (statusFilter === "drafts" && status === "draft") ||
        (statusFilter === "invalid" && status === "invalid") ||
        (statusFilter === "differs" && status === "differs");
      const show = matchesText && matchesStatus;
      row.hidden = !show;
      if (show) visible += 1;
    });
    const count = container.querySelector("[data-filter-count]");
    if (count) count.textContent = filtering ? `${visible} of ${words.length} shown` : "";
    const empty = container.querySelector("[data-filter-empty]");
    if (empty) empty.hidden = visible > 0;
  };

  const addWord = () => {
    // Adding is entering, not reviewing: clear the filters so the new draft
    // row is guaranteed visible (its empty fields match no text or status).
    lexiconFilter.text = "";
    lexiconFilter.status = "all";
    const word = { id: uid("word"), gloss: "", form: "", note: "" };
    language.vocabulary.push(word);
    ctx.touch({ label: "Add word" });
    ctx.refresh();
    window.setTimeout(() => {
      const row = document.querySelector(`[data-word-id="${word.id}"]`);
      row?.querySelector('[data-word-field="gloss"]')?.focus();
    }, 0);
  };
  container.querySelectorAll("[data-add-word]").forEach((button) => button.addEventListener("click", addWord));

  container.querySelector("[data-bulk-words]")?.addEventListener("click", () => {
    openBulkDialog(ctx, language, words);
  });

  const filterInput = container.querySelector("[data-word-filter]");
  const statusSelect = container.querySelector("[data-word-status-filter]");
  if (filterInput && statusSelect) {
    statusSelect.value = lexiconFilter.status;
    if (statusSelect.value !== lexiconFilter.status) lexiconFilter.status = "all"; // option absent (no parent)
    filterInput.addEventListener("input", () => {
      lexiconFilter.text = filterInput.value;
      applyFilters();
    });
    statusSelect.addEventListener("change", () => {
      lexiconFilter.status = statusSelect.value;
      applyFilters();
    });
    applyFilters();
  }

  container.querySelectorAll("[data-word-id]").forEach((row) => {
    const word = language.vocabulary.find((entry) => entry.id === row.dataset.wordId);
    if (!word) return;
    row.querySelectorAll("[data-word-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.wordField;
        word[field] = input.value;
        ctx.touch({ label: "Edit word" });
        if (field === "gloss" || field === "form") updateRowCheck(row, ctx, word, parent);
        if (field === "form") {
          const result = checker.validate(word.form);
          updateRowPhonotactics(row, result);
          const summary = container.querySelector("[data-phonotactics-summary]");
          if (summary) summary.textContent = validitySummary(words, checker);
        }
        applyFilters();
      });
      if (input.dataset.wordField === "gloss") {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            row.querySelector('[data-word-field="form"]')?.focus();
          }
        });
      }
      if (input.dataset.wordField === "form") {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            row.querySelector('[data-word-field="note"]')?.focus();
          }
        });
      }
      if (input.dataset.wordField === "note") {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            // Finishing the gloss → form → note chain rolls straight into
            // the next entry, like a spreadsheet.
            addWord();
          }
        });
      }
    });
    row.querySelector("[data-trace-word]")?.addEventListener("click", () => {
      if (!word.gloss.trim() || !word.form.trim()) {
        toast("Give the word a gloss and an IPA form before tracing it.", { type: "info" });
        return;
      }
      ctx.navigate(`#/cognates/${encodeURIComponent(language.id)}/${encodeURIComponent(word.id)}`);
    });
    row.querySelector("[data-delete-word]")?.addEventListener("click", () => {
      const index = language.vocabulary.indexOf(word);
      if (index < 0) return;
      const [removed] = language.vocabulary.splice(index, 1);
      ctx.touch({ label: "Delete word" });
      ctx.refresh();
      toast("Word deleted.", {
        type: "info",
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            // Resolve the language at click time: after a global undo/redo the
            // vocabulary object captured at delete time is a detached clone.
            const target = ctx.language;
            if (!target || target.vocabulary.some((entry) => entry.id === removed.id)) return;
            target.vocabulary.splice(Math.min(index, target.vocabulary.length), 0, removed);
            ctx.touch({ label: "Restore word" });
            ctx.refresh();
          },
        },
      });
    });
  });
}
