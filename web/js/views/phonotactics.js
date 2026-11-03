import { createPhonotacticsChecker } from "../phonotactics.js";
import { suggestClassRefs } from "../naturalclasses.js";
import { cellKey, chartLeaves, nodeLeafIds } from "../model.js";
import { esc, icon, toast } from "../ui.js";

const PRESETS = [
  "(C)V(C)",
  "(C)V",
  "CV(C)",
  "(C)(C)V(C)",
  "(C)V(V)(C)",
  "(C)V(C)(C)",
];

const CLASS_PRESETS = [
  { name: "N", label: "N · nasals", sounds: "m n ɲ ŋ" },
  { name: "G", label: "G · glides", sounds: "j w" },
  { name: "L", label: "L · liquids", sounds: "l r ɾ ʎ" },
  { name: "T", label: "T · stops", sounds: "p t k ʔ" },
  { name: "F", label: "F · fricatives", sounds: "f s ʃ x" },
];

// Row labels of both charts, with the sounds sitting under each row. These
// become "insert from the chart" buttons so category sound lists can be
// built without typing IPA by hand.
function chartSuggestions(inventory) {
  const items = [];
  const collect = (chart, mark) => {
    if (!chart) return;
    const columns = chartLeaves(chart.columns || []);
    for (const node of chart.rows || []) {
      const rowIds = nodeLeafIds(node);
      const sounds = new Set();
      for (const rowId of rowIds) {
        for (const leaf of columns) {
          for (const sound of chart.cells?.[cellKey(rowId, leaf.node.id)] || []) sounds.add(sound);
        }
      }
      if (!sounds.size) continue;
      items.push({ label: `${mark} · ${node.label}`, sounds: [...sounds].join(" ") });
    }
  };
  collect(inventory?.consonants, "Consonants");
  collect(inventory?.vowels, "Vowels");
  return items;
}

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

function classMetaMarkup(diag) {
  if (!diag) return "";
  const pieces = [];
  for (const message of diag.errors) {
    pieces.push(`<p class="class-message is-error">${icon("warning")}<span>${esc(message)}</span></p>`);
  }
  const warnings = [...new Set(diag.warnings)];
  for (const message of warnings) {
    pieces.push(`<p class="class-message">${icon("info")}<span>${esc(message)}</span></p>`);
  }
  if (!diag.errors.length && diag.values.length) {
    const shown = diag.values.slice(0, 12);
    const rest = diag.values.length - shown.length;
    const chips = shown.map((sound) => `<code class="shape-chip">${esc(sound)}</code>`).join("");
    pieces.push(
      `<div class="class-members">${chips}${rest > 0 ? `<span class="muted class-more">+${rest}</span>` : ""}</div>`
    );
    if (diag.allVowels) {
      pieces.push(`<span class="class-pill" title="Every member is a vowel, so this category can fill the nucleus slot.">nucleus-capable</span>`);
    }
  }
  return pieces.join("");
}

function classListMarkup(language) {
  const classes = language.phonotactics.classes;
  if (!classes.length) {
    return `<p class="class-empty">No categories yet. Define groups like <code>N</code> (nasals) or <code>G</code> (glides) and use those letters in the template and forbidden patterns.</p>`;
  }
  return classes
    .map(
      (entry, index) => `
    <div class="class-row" data-class-row data-class-index="${index}">
      <label class="field class-name-field">
        <span class="field-label">Letter</span>
        <input class="input class-name-input" type="text" data-class-field="name" value="${esc(entry.name)}" maxlength="6" autocomplete="off" spellcheck="false" aria-label="Category letter">
      </label>
      <label class="field class-sounds-field">
        <span class="field-label">Sounds</span>
        <input class="input class-sounds-input" type="text" data-class-field="sounds" value="${esc(entry.sounds)}" autocomplete="off" spellcheck="false" aria-label="Sounds in the category">
      </label>
      <button class="icon-button icon-button-small class-remove" type="button" data-class-remove aria-label="Remove category ${esc(entry.name || "row")}">${icon("trash")}</button>
      <div class="class-meta" data-class-meta></div>
    </div>`
    )
    .join("");
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

function wordCheckMarkup(language, checker, results) {
  if (!language.vocabulary.length) {
    return `
      <div class="notice notice-quiet">
        ${icon("book")}
        <p>No words yet. Add vocabulary, then return here to check the forms against the template.</p>
        <button class="button button-quiet button-small" type="button" data-open-vocabulary>${icon("book")}Open vocabulary</button>
      </div>`;
  }

  // results are computed once by refresh() and passed in: validating the
  // whole lexicon twice per keystroke doubles the cost for no benefit.
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
  const chartClasses = suggestClassRefs(checker.context.classIndex);

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
                <p>Optional pieces go in parentheses. <strong>C</strong> is any charted consonant and <strong>V</strong> any charted vowel; more letters come from the Categories panel below.</p>
              </div>
              <span data-template-status></span>
            </header>
            <div class="panel-body form-stack">
              <label class="field">
                <span class="field-label">Template</span>
                <input class="input phonotactics-template-input" type="text" data-phonotactics-field="template" value="${esc(phonotactics.template)}" placeholder="(C)V(C)" autocomplete="off" spellcheck="false" aria-label="Syllable template">
                <span class="field-help">Examples: <code>(C)V(C)</code>, <code>(C)(C)V(C)</code>, <code>CVN</code>, <code>(C)V(G)</code> — letters beyond <code>C</code> and <code>V</code> come from Categories below, and dotted chart labels like <code>plosive.plain</code> are classes read straight from the Phonology charts. Leave it blank to turn phonotactic checks off.</span>
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
                <h2>Categories</h2>
                <p>Named sound groups that behave like <code>C</code> and <code>V</code>: <strong>N</strong> nasals, <strong>G</strong> glides, <strong>L</strong> liquids, or whatever you define. Slots are checked individually, so <code>N</code> can sit inside <code>C</code> elsewhere in the word — subsets need no extra setup.</p>
              </div>
              <div class="panel-actions">
                <button class="button button-quiet button-small" type="button" data-class-add>Add category</button>
              </div>
            </header>
            <div class="panel-body form-stack">
              <div class="class-list" data-class-list></div>
              <div class="class-tools">
                <div class="template-presets">
                  <span class="field-label">Starter categories</span>
                  <div class="preset-row">
                    ${CLASS_PRESETS.map((preset) => `<button class="preset-button" type="button" data-class-preset="${esc(preset.name)}" title="sounds like ${esc(preset.sounds)}">${esc(preset.label)}</button>`).join("")}
                  </div>
                </div>
                <details class="class-from-chart">
                  <summary>Insert from the chart</summary>
                  <div class="preset-row" data-class-chart-row>
                    <button class="preset-button" type="button" data-chart-ref="C" title="All charted consonants, as a reference">All consonants (C)</button>
                    <button class="preset-button" type="button" data-chart-ref="V" title="All charted vowels, as a reference">All vowels (V)</button>
                    ${chartSuggestions(language.inventory)
                      .map(
                        (item, index) =>
                          `<button class="preset-button" type="button" data-chart-suggest="${index}" title="${esc(item.sounds)}">${esc(item.label)}</button>`
                      )
                      .join("")}
                  </div>
                </details>
                <details class="class-from-chart">
                  <summary>Chart classes</summary>
                  <div class="preset-row" data-chart-class-row>
                    ${
                      chartClasses.length
                        ? chartClasses
                            .map(
                              (item) =>
                                `<button class="preset-button" type="button" data-class-ref="${esc(item.ref)}" title="members: ${esc(
                                  item.members.join(" ")
                                )}">${esc(item.ref)}</button>`
                            )
                            .join("")
                        : `<span class="muted">No chart labels yet — add sounds to the Phonology charts first.</span>`
                    }
                  </div>
                  <p class="field-help">Chart classes are written straight from the tables: dotted labels like
                    <code>plosive.plain</code> or <code>V.back</code>. Every listed label must apply to the sound on each axis it appears in. A class also works in the template, forbidden patterns, and sound-change rules.</p>
                </details>
                <p class="field-help">A category's sounds list may also contain <code>C</code>, <code>V</code>, or another category's letter — for example list <code>N L G</code> under <code>S</code> for all sonorants.</p>
              </div>
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
                <span class="field-help">Comma-separated patterns. <code>C</code>, <code>V</code>, categories, chart classes, <code>[ptk]</code>, and <code>#</code> (word edge) are supported; for example <code>VV</code> bans hiatus and <code>#CC</code> bans word-initial clusters.</span>
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
                <li><code>N</code><span>A category defined for this language — any of its member sounds. Category letters may also list <code>C</code>, <code>V</code>, chart classes, or other letters in their own sounds field.</span></li>
                <li><code>plosive.plain</code><span>A chart class: chart labels dotted together, read against the Phonology charts. A sound belongs when every listed label applies on each axis where it appears — so <code>plosive.plain</code> is the plain oral stops and <code>back</code> (or <code>V.back</code>) is every back vowel. Pin a chart with <code>V.</code> / <code>C.</code>.</span></li>
                <li><code>(N)</code><span>An optional category slot, like any other optional group.</span></li>
                <li><code>[ptk]</code><span>One of the listed literal sounds.</span></li>
                <li><code>[Nt]</code><span>Sets accept categories and chart classes (<code>[back t]</code>), and <code>[^…]</code> matches any sound not listed — vowels included, so use with intention.</span></li>
                <li><code>(C|CC)</code><span>Optional alternatives inside a group.</span></li>
                <li><code>C?V</code><span>Optional single slot; equivalent to <code>(C)V</code>.</span></li>
              </ul>
              <dl class="help-terms">
                <div><dt>Nucleus rule</dt><dd>A shape needs at least one nucleus-capable slot: <code>V</code>, a literal vowel, or a category whose members are all vowels. Mixed sets like a glide+vowel category can’t carry the nucleus alone.</dd></div>
                <div><dt>Subsets</dt><dd>Slots are matched one at a time, so a category can be a subset of another: in <code>NVC</code> the <code>C</code> still admits nasals.</dd></div>
                <div><dt>Literal category letters</dt><dd>Write <code>\N</code> to use the literal sound “N” after you define N as a category.</dd></div>
                <div><dt>Onsets and codas</dt><dd>Empty lists mean “anything the template permits”; empty onsets or codas are always allowed. Cluster lists stay literal — categories don’t apply there.</dd></div>
                <div><dt>Forbidden sequences</dt><dd>Match anywhere in the word and honor categories too: <code>NN</code> bans adjacent nasals, <code>#CC</code> bans word-initial clusters.</dd></div>
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
    wordCheckElement.innerHTML = wordCheckMarkup(language, checker, results);
    templateStatusElement.innerHTML = templateStatusMarkup(checker.compiled);
    templateFeedbackElement.innerHTML = templateFeedbackMarkup(checker.compiled);
    templateShapesElement.innerHTML = shapeMarkup(checker.compiled);
    syncClassRows();
    updateTest();
  };

  const updateTest = () => {
    if (!testInput || !testResultElement) return;
    testResultElement.innerHTML = testResultMarkup(checker.validate(testInput.value));
  };

  const classListElement = container.querySelector("[data-class-list]");
  let activeClassIndex = -1;

  const focusClassInput = (index, field = "name") => {
    classListElement
      .querySelector(`[data-class-row][data-class-index="${index}"] [data-class-field="${field}"]`)
      ?.focus();
  };

  const syncClassRows = () => {
    const diags = checker.compiled.classes?.entries || [];
    classListElement.querySelectorAll("[data-class-row]").forEach((row) => {
      const meta = row.querySelector("[data-class-meta]");
      if (meta) meta.innerHTML = classMetaMarkup(diags[Number(row.dataset.classIndex)]);
    });
  };

  const renderClassList = () => {
    classListElement.innerHTML = classListMarkup(language);
    activeClassIndex = language.phonotactics.classes.length - 1;
    syncClassRows();
  };

  const appendClassSounds = (text) => {
    const classes = language.phonotactics.classes;
    if (!classes.length) {
      toast("Add a category first, then insert chart sounds into it.");
      return;
    }
    const index = activeClassIndex >= 0 && activeClassIndex < classes.length ? activeClassIndex : classes.length - 1;
    const entry = classes[index];
    const current = entry.sounds.trim();
    entry.sounds = current ? `${current.replace(/[,\s;]+$/u, "")} ${text}` : text;
    const input = classListElement.querySelector(
      `[data-class-row][data-class-index="${index}"] [data-class-field="sounds"]`
    );
    if (input) input.value = entry.sounds;
    ctx.touch();
    refresh();
  };

  const addClassRow = (entry = { name: "", sounds: "" }) => {
    const classes = language.phonotactics.classes;
    classes.push(entry);
    ctx.touch();
    renderClassList();
    refresh();
    focusClassInput(classes.length - 1);
  };

  classListElement.addEventListener("focusin", (event) => {
    const row = event.target.closest("[data-class-row]");
    if (row) activeClassIndex = Number(row.dataset.classIndex);
  });

  classListElement.addEventListener("input", (event) => {
    const field = event.target.closest("[data-class-field]");
    if (!field) return;
    const row = field.closest("[data-class-row]");
    const index = Number(row.dataset.classIndex);
    const entry = language.phonotactics.classes[index];
    if (!entry) return;
    entry[field.dataset.classField] = field.value;
    ctx.touch();
    refresh();
  });

  classListElement.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-class-remove]");
    if (removeButton) {
      const row = removeButton.closest("[data-class-row]");
      language.phonotactics.classes.splice(Number(row.dataset.classIndex), 1);
      ctx.touch();
      renderClassList();
      refresh();
      return;
    }
  });

  container.addEventListener("click", (event) => {
    const presetButton = event.target.closest("[data-class-preset]");
    if (presetButton) {
      const name = presetButton.dataset.classPreset;
      const classes = language.phonotactics.classes;
      if (classes.some((entry) => entry.name.trim() === name)) {
        toast(`Category ${name} already exists.`);
        return;
      }
      const preset = CLASS_PRESETS.find((item) => item.name === name);
      addClassRow({ name, sounds: preset?.sounds || "" });
      return;
    }
    const chartButton = event.target.closest("[data-chart-suggest]");
    if (chartButton) {
      const item = chartSuggestions(language.inventory)[Number(chartButton.dataset.chartSuggest)];
      if (item) appendClassSounds(item.sounds);
      return;
    }
    const refButton = event.target.closest("[data-chart-ref]");
    if (refButton) appendClassSounds(refButton.dataset.chartRef);
    const classRefButton = event.target.closest("[data-class-ref]");
    if (classRefButton) appendClassSounds(classRefButton.dataset.classRef);
  });

  container.querySelector("[data-class-add]").addEventListener("click", () => addClassRow());

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

  renderClassList();
  refresh();
}
