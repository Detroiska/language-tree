import { createPhonotacticsChecker } from "../phonotactics.js";
import { esc, icon } from "../ui.js";

const PRESETS = [
  "(C)V(C)",
  "(C)V",
  "CV(C)",
  "(C)(C)V(C)",
  "(C)V(V)(C)",
  "(C)V(C)(C)",
];

function statusOf(result) {
  if (result.empty) return "empty";
  if (result.templateError) return "template-error";
  if (result.issues.length) return "invalid";
  if (!result.checked) return "off";
  return "valid";
}

function statusChip(result, { compact = false } = {}) {
  const status = statusOf(result);
  if (status === "empty") return `<span class="muted">—</span>`;
  if (status === "template-error") {
    return `<span class="status-chip status-differs" title="${esc(result.templateError)}">${icon("warning")}${compact ? "Template" : "Template error"}</span>`;
  }
  if (status === "invalid") {
    const title = result.issues.map((issue) => issue.message).join("\n");
    return `<span class="status-chip status-invalid" title="${esc(title)}">${icon("warning")}Invalid</span>`;
  }
  if (status === "off") {
    return `<span class="status-chip status-missing" title="No syllable template is set">${icon("info")}${compact ? "Off" : "Checks off"}</span>`;
  }
  return `<span class="status-chip status-match" title="Fits the inventory and syllable template">${icon("check")}Valid</span>`;
}

function issueListMarkup(result, limit = 4) {
  if (!result.issues.length) return "";
  const shown = result.issues.slice(0, limit);
  const remaining = result.issues.length - shown.length;
  return `
    <ul class="issue-list">
      ${shown.map((issue) => `<li>${esc(issue.message)}</li>`).join("")}
      ${remaining > 0 ? `<li class="issue-more">+${remaining} more</li>` : ""}
    </ul>`;
}

function templateStatusMarkup(compiled) {
  if (compiled.empty) return `<span class="count-pill">Checks off</span>`;
  if (!compiled.ok) return `<span class="count-pill count-pill-error">${icon("warning")}Template error</span>`;
  return `<span class="count-pill">${compiled.shapes.length} ${compiled.shapes.length === 1 ? "shape" : "shapes"}</span>`;
}

function templateFeedbackMarkup(compiled) {
  let html = "";
  if (compiled.empty) {
    html += `
      <div class="template-feedback is-muted">
        ${icon("info")}
        <span>No syllable template is set, so vocabulary forms are only checked against the inventory. Add a template to turn syllable checks on.</span>
      </div>`;
  } else if (!compiled.ok) {
    html += `
      <div class="template-feedback is-error">
        ${icon("warning")}
        <span>${esc(compiled.error)}</span>
      </div>`;
  } else {
    html += `
      <div class="template-feedback is-ok">
        ${icon("check")}
        <span>Template valid${compiled.shapes.length ? ` · ${compiled.shapes.length} possible syllable ${compiled.shapes.length === 1 ? "shape" : "shapes"}` : ""}.</span>
      </div>`;
  }
  if (compiled.warnings?.length) {
    html += compiled.warnings.map((warning) => `<p class="template-warning">${icon("info")}<span>${esc(warning)}</span></p>`).join("");
  }
  if (compiled.constraintErrors?.length) {
    html += `<div class="template-warning is-error">${icon("warning")}<span>${compiled.constraintErrors.map(esc).join("<br>")}</span></div>`;
  }
  return html;
}

function shapeMarkup(compiled) {
  if (!compiled.ok || !compiled.shapes.length) return "";
  return `
    <div class="template-shapes">
      <span class="field-label">Possible shapes</span>
      <div class="shape-chips">
        ${compiled.shapes.map((shape) => `<code class="shape-chip">${esc(shape.display)}</code>`).join("")}
      </div>
    </div>`;
}

function summaryCounts(results) {
  const recorded = results.filter((result) => !result.empty);
  const valid = recorded.filter((result) => statusOf(result) === "valid").length;
  const invalid = recorded.filter((result) => statusOf(result) === "invalid").length;
  return { recorded: recorded.length, valid, invalid };
}

function summaryText(results, compiled) {
  if (compiled?.empty) return "syllable template off";
  if (compiled && !compiled.ok) return "template error";
  const counts = summaryCounts(results);
  return `${counts.valid}/${counts.recorded} forms valid${counts.invalid ? ` · ${counts.invalid} to review` : ""}`;
}

function summaryMarkup(results, compiled) {
  if (compiled?.empty) return `<span>Phonotactic checks off</span>`;
  if (compiled && !compiled.ok) return `<span><strong>Template error</strong></span>`;
  const counts = summaryCounts(results);
  return `
    <span><strong>${counts.valid}/${counts.recorded}</strong> forms valid</span>
    ${counts.invalid ? `<span><strong>${counts.invalid}</strong> to review</span>` : ""}`;
}

function testResultMarkup(result) {
  if (!result.text) return `<p class="test-placeholder">Type a form to check it against the template and inventory.</p>`;
  return `
    <div class="phonotactics-test-result">
      <div class="test-output-row">
        <span class="derivation-label">Result</span>
        ${statusChip(result)}
      </div>
      <div class="test-reading">
        <span class="field-label">Read as</span>
        <span class="token-row">${result.tokens.map((token) => `<code>${esc(token)}</code>`).join("")}</span>
      </div>
      <div class="test-reading">
        <span class="field-label">Syllables</span>
        <code class="ipa">${esc(result.syllableText) || "—"}</code>
      </div>
      ${issueListMarkup(result, 6)}
    </div>`;
}

function wordCheckMarkup(language, checker) {
  if (!language.vocabulary.length) {
    return `
      <div class="notice notice-quiet">
        ${icon("book")}
        <p>No words yet. Add vocabulary, then return here to check the forms against the template.</p>
        <button class="button button-quiet button-small" type="button" data-open-vocabulary>${icon("book")}Open vocabulary</button>
      </div>`;
  }

  const results = language.vocabulary.map((word) => checker.validate(word.form));
  const rows = language.vocabulary
    .map((word, index) => {
      const result = results[index];
      const status = statusOf(result);
      return `
        <tr class="${status === "invalid" ? "is-invalid" : ""}">
          <td class="gloss-cell">${word.gloss.trim() ? esc(word.gloss) : `<span class="muted">untitled</span>`}</td>
          <td><code class="ipa">${word.form.trim() ? esc(word.form) : `<span class="muted">no form</span>`}</code></td>
          <td><code class="ipa">${esc(result.syllableText) || "—"}</code></td>
          <td>${statusChip(result, { compact: true })}</td>
          <td class="word-issues">${
            result.issues.length
              ? issueListMarkup(result, 5)
              : result.templateError
                ? `<span class="muted">Template needs attention.</span>`
                : `<span class="muted">—</span>`
          }</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table class="data-table phonotactics-check-table">
        <thead>
          <tr><th>Gloss</th><th>Form</th><th>Syllables</th><th>Status</th><th>Issues</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="table-foot">Syllables use the maximal onset principle. A dash in the syllable column means the form could not be fully parsed.</p>`;
}

export function renderPhonotactics(container, ctx) {
  const { language } = ctx;
  const phonotactics = language.phonotactics;
  let checker = createPhonotacticsChecker(language);

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Phonotactics</p>
          <h2>Syllable structure and word shape</h2>
          <p class="section-copy">Describe the shapes a syllable may take, then constrain onsets, codas, or sequences. Vocabulary forms are checked against the inventory and these rules.</p>
        </div>
        <div class="inventory-summary" data-phonotactics-summary></div>
      </section>

      <div class="phonotactics-layout">
        <div class="phonotactics-main">
          <section class="panel">
            <header class="panel-head">
              <div class="panel-title">
                <h2>Syllable template</h2>
                <p>Optional pieces go in parentheses. <strong>C</strong> is any charted consonant; <strong>V</strong> is any charted vowel.</p>
              </div>
              <span data-template-status></span>
            </header>
            <div class="panel-body form-stack">
              <label class="field">
                <span class="field-label">Template</span>
                <input class="input phonotactics-template-input" type="text" data-phonotactics-field="template" value="${esc(phonotactics.template)}" placeholder="(C)V(C)" autocomplete="off" spellcheck="false" aria-label="Syllable template">
                <span class="field-help">Examples: <code>(C)V(C)</code>, <code>(C)(C)V(C)</code>, <code>CV(C)</code>, <code>(C)V(V)(C)</code>. Leave it blank to turn phonotactic checks off.</span>
              </label>
              <div class="template-presets">
                <span class="field-label">Presets</span>
                <div class="preset-row">
                  ${PRESETS.map((preset) => `<button class="preset-button" type="button" data-template-preset="${esc(preset)}">${esc(preset)}</button>`).join("")}
                </div>
              </div>
              <div data-template-feedback></div>
              <div data-template-shapes></div>
            </div>
          </section>

          <section class="panel">
            <header class="panel-head">
              <div class="panel-title">
                <h2>Constraints</h2>
                <p>Optional filters layered on top of the syllable template.</p>
              </div>
            </header>
            <div class="panel-body form-stack">
              <div class="form-row">
                <label class="field">
                  <span class="field-label">Allowed onsets <span class="field-optional">optional</span></span>
                  <input class="input" type="text" data-phonotactics-field="onsets" value="${esc(phonotactics.onsets)}" placeholder="pr, tr, kl" autocomplete="off" spellcheck="false">
                  <span class="field-help">Comma-separated onset sounds or clusters. Empty allows every onset the template permits.</span>
                </label>
                <label class="field">
                  <span class="field-label">Allowed codas <span class="field-optional">optional</span></span>
                  <input class="input" type="text" data-phonotactics-field="codas" value="${esc(phonotactics.codas)}" placeholder="n, s, r" autocomplete="off" spellcheck="false">
                  <span class="field-help">Comma-separated coda sounds or clusters. Empty allows every coda the template permits.</span>
                </label>
              </div>
              <label class="field">
                <span class="field-label">Forbidden sequences <span class="field-optional">optional</span></span>
                <input class="input" type="text" data-phonotactics-field="forbidden" value="${esc(phonotactics.forbidden)}" placeholder="VV, CCC, #CC, CC#" autocomplete="off" spellcheck="false">
                <span class="field-help">Comma-separated patterns. <code>C</code>, <code>V</code>, <code>[ptk]</code>, and <code>#</code> (word edge) are supported; for example <code>VV</code> bans hiatus and <code>#CC</code> bans word-initial clusters.</span>
              </label>
              <label class="field">
                <span class="field-label">Notes <span class="field-optional">optional</span></span>
                <textarea class="textarea textarea-small" rows="2" data-phonotactics-field="notes" placeholder="Marginal clusters, allophonic exceptions, or questions…">${esc(phonotactics.notes)}</textarea>
              </label>
            </div>
          </section>
        </div>

        <aside class="phonotactics-aside">
          <section class="panel test-panel">
            <header class="panel-head">
              <div class="panel-title">
                <h2>Try a form</h2>
                <p>Check any word without adding it to the lexicon.</p>
              </div>
              <span class="panel-icon">${icon("eye")}</span>
            </header>
            <div class="phonotactics-test-body">
              <label class="field-label" for="phonotactics-test-form">Form <span class="field-optional">IPA</span></label>
              <input class="input ipa-input" id="phonotactics-test-form" data-phonotactics-test placeholder="e.g. kasa" autocomplete="off" spellcheck="false">
              <div data-phonotactics-test-result></div>
            </div>
          </section>

          <details class="panel help-panel" open>
            <summary class="panel-head help-summary">
              <div class="panel-title">
                <h2>Template syntax</h2>
                <p>A small, deterministic syllable grammar.</p>
              </div>
              <span class="details-chevron">${icon("chevronDown")}</span>
            </summary>
            <div class="help-body">
              <div class="help-syntax"><code>(C)V(C)</code></div>
              <ul class="help-list">
                <li><code>C</code><span>Any consonant in this language’s chart.</span></li>
                <li><code>V</code><span>Any vowel in this language’s chart.</span></li>
                <li><code>(C)</code><span>An optional consonant slot. Parentheses are optional groups.</span></li>
                <li><code>[ptk]</code><span>One of the listed literal sounds.</span></li>
                <li><code>(C|CC)</code><span>Optional alternatives inside a group.</span></li>
                <li><code>C?V</code><span>Optional single slot; equivalent to <code>(C)V</code>.</span></li>
              </ul>
              <dl class="help-terms">
                <div><dt>Onsets and codas</dt><dd>Empty lists mean “anything the template permits”; empty onsets or codas are always allowed.</dd></div>
                <div><dt>Forbidden sequences</dt><dd>Match anywhere in the word. <code>#</code> anchors to the start or end, so <code>#CC</code> means word-initial two-consonant cluster.</dd></div>
              </dl>
              <p class="help-foot">The template is expanded into a finite set of syllable shapes. Words are syllabified with the maximal onset principle, and every sound must be in the language’s own chart.</p>
            </div>
          </details>
        </aside>
      </div>

      <section class="panel">
        <header class="panel-head">
          <div class="panel-title">
            <h2>Vocabulary check</h2>
            <p>Every recorded form against the inventory and syllable template.</p>
          </div>
          <div class="panel-actions">
            <span class="check-summary" data-phonotactics-word-summary></span>
            <button class="button button-quiet button-small" type="button" data-open-vocabulary>${icon("book")}Open vocabulary</button>
          </div>
        </header>
        <div data-phonotactics-word-check></div>
      </section>
    </div>
  `;

  const summaryElement = container.querySelector("[data-phonotactics-summary]");
  const wordSummaryElement = container.querySelector("[data-phonotactics-word-summary]");
  const wordCheckElement = container.querySelector("[data-phonotactics-word-check]");
  const templateStatusElement = container.querySelector("[data-template-status]");
  const templateFeedbackElement = container.querySelector("[data-template-feedback]");
  const templateShapesElement = container.querySelector("[data-template-shapes]");
  const testInput = container.querySelector("[data-phonotactics-test]");
  const testResultElement = container.querySelector("[data-phonotactics-test-result]");

  const refresh = () => {
    checker = createPhonotacticsChecker(language);
    const results = language.vocabulary.map((word) => checker.validate(word.form));
    summaryElement.innerHTML = summaryMarkup(results, checker.compiled);
    wordSummaryElement.textContent = summaryText(results, checker.compiled);
    wordCheckElement.innerHTML = wordCheckMarkup(language, checker);
    templateStatusElement.innerHTML = templateStatusMarkup(checker.compiled);
    templateFeedbackElement.innerHTML = templateFeedbackMarkup(checker.compiled);
    templateShapesElement.innerHTML = shapeMarkup(checker.compiled);
    updateTest();
  };

  const updateTest = () => {
    if (!testInput || !testResultElement) return;
    testResultElement.innerHTML = testResultMarkup(checker.validate(testInput.value));
  };

  container.querySelectorAll("[data-phonotactics-field]").forEach((input) => {
    input.addEventListener("input", () => {
      language.phonotactics[input.dataset.phonotacticsField] = input.value;
      ctx.touch();
      refresh();
    });
  });

  container.querySelectorAll("[data-template-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const template = button.dataset.templatePreset;
      language.phonotactics.template = template;
      const templateInput = container.querySelector('[data-phonotactics-field="template"]');
      if (templateInput) templateInput.value = template;
      ctx.touch();
      refresh();
      templateInput?.focus();
    });
  });

  testInput?.addEventListener("input", updateTest);

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-vocabulary]")) {
      ctx.navigate(`#/language/${language.id}/vocabulary`);
    }
  });

  refresh();
}
