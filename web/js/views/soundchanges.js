import {
  ancestorsOf,
  getLineage,
  languageStats,
  uid,
} from "../model.js";
import {
  compileRule,
  compileRules,
  contextForLanguage,
  deriveForm,
  deriveTokens,
} from "../phonology.js";
import { esc, icon, toast } from "../ui.js";

function compileDirect(ctx) {
  const context = contextForLanguage(ctx.project, ctx.language.id);
  const rules = ctx.language.soundChanges.filter((rule) => rule.enabled !== false);
  return { context, compiled: compileRules(rules, context) };
}

function directDerivation(ctx, form) {
  const { context, compiled } = compileDirect(ctx);
  const tokens = context.tokenize(form);
  const result = deriveTokens(tokens, compiled, context);
  return {
    inputTokens: tokens,
    outputTokens: result.tokens,
    steps: result.steps,
    text: result.tokens.join(""),
  };
}

function sameForm(a, b) {
  const normalize = (value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  return normalize(a) === normalize(b);
}

function statusFor(rule, context) {
  if (!rule.notation.trim()) return { kind: "empty", label: "Empty rule" };
  const compiled = compileRule(rule.notation, context);
  if (compiled.ok) return { kind: "ok", label: "Valid" };
  return { kind: "error", label: compiled.error };
}

function statusMarkup(status) {
  const glyph = status.kind === "ok" ? "check" : status.kind === "error" ? "warning" : "info";
  return `${icon(glyph)}<span>${esc(status.label)}</span>`;
}

function updateRuleStatus(card, context, rule) {
  const element = card.querySelector("[data-rule-status]");
  if (!element) return;
  const status = rule.enabled === false ? { kind: "off", label: "Disabled" } : statusFor(rule, context);
  element.className = `rule-status status-${status.kind}`;
  element.innerHTML = statusMarkup(status);
  element.title = status.label;
}

function rulesMarkup(language, context) {
  if (!language.soundChanges.length) {
    return `
      <div class="rules-empty">
        <div class="empty-icon small">${icon("sound")}</div>
        <h3>No sound changes yet</h3>
        <p>Add the first ordered change from the ancestral language. Rules apply from top to bottom.</p>
        <button class="button button-primary button-small" type="button" data-add-rule>${icon("plus")}Add a rule</button>
      </div>`;
  }
  return `
    <div class="rules-list">
      ${language.soundChanges
        .map((rule, index) => {
          const status = rule.enabled === false ? { kind: "off", label: "Disabled" } : statusFor(rule, context);
          return `
            <article class="rule-card ${rule.enabled === false ? "is-disabled" : ""}" data-rule-id="${esc(rule.id)}">
              <div class="rule-number">${String(index + 1).padStart(2, "0")}</div>
              <div class="rule-body">
                <div class="rule-notation-row">
                  <input class="rule-input" type="text" value="${esc(rule.notation)}" placeholder="p > f / V _ V" autocomplete="off" spellcheck="false" aria-label="Sound change notation">
                  <span class="rule-status status-${status.kind}" data-rule-status title="${esc(status.label)}">${statusMarkup(status)}</span>
                </div>
                <input class="rule-note-input" type="text" value="${esc(rule.note)}" placeholder="Optional description, e.g. Verner’s law" autocomplete="off" aria-label="Rule note">
              </div>
              <div class="rule-controls">
                <label class="switch" title="${rule.enabled === false ? "Enable rule" : "Disable rule"}">
                  <input type="checkbox" data-rule-toggle ${rule.enabled === false ? "" : "checked"} aria-label="Enable rule">
                  <span class="switch-track"><span class="switch-thumb"></span></span>
                </label>
                <button class="icon-button icon-button-small" type="button" data-rule-up title="Move up" aria-label="Move rule up" ${index === 0 ? "disabled" : ""}>${icon("arrowUp")}</button>
                <button class="icon-button icon-button-small" type="button" data-rule-down title="Move down" aria-label="Move rule down" ${index === language.soundChanges.length - 1 ? "disabled" : ""}>${icon("arrowDown")}</button>
                <button class="icon-button icon-button-small danger-hover" type="button" data-rule-delete title="Delete rule" aria-label="Delete rule">${icon("trash")}</button>
              </div>
            </article>`;
        })
        .join("")}
    </div>`;
}

function testPanelMarkup(ctx) {
  const lineage = getLineage(ctx.project, ctx.language.id);
  const parent = lineage.length > 1 ? lineage[lineage.length - 2] : null;
  const suggestions = parent?.vocabulary.filter((word) => word.form.trim()).slice(0, 4) || [];
  return `
    <section class="panel test-panel" data-test-panel>
      <header class="panel-head">
        <div class="panel-title">
          <h2>Rule tester</h2>
          <p>${parent ? `Apply this language’s rules to a ${esc(parent.name)} form.` : "This is a root language."}</p>
        </div>
        <span class="panel-icon">${icon("eye")}</span>
      </header>
      ${
        parent
          ? `
            <div class="test-input-wrap">
              <label class="field-label" for="test-word">Input form <span class="field-optional">${esc(parent.name)}</span></label>
              <div class="input-with-button">
                <input class="input ipa-input" id="test-word" data-test-input value="${esc(parent.vocabulary.find((word) => word.form.trim())?.form || "")}" placeholder="e.g. kasa" autocomplete="off" spellcheck="false">
                <button class="button button-quiet button-small" type="button" data-test-run>Apply</button>
              </div>
              ${suggestions.length ? `<div class="word-suggestions">${suggestions.map((word) => `<button class="word-suggestion" type="button" data-test-word="${esc(word.form)}" title="${esc(word.gloss)}">${esc(word.form)}<span>${esc(word.gloss)}</span></button>`).join("")}</div>` : ""}
            </div>
            <div class="derivation" data-derivation>
              <div class="derivation-output-row">
                <span class="derivation-label">Output</span>
                <output class="derivation-output ipa" data-test-output>—</output>
              </div>
              <div class="derivation-parsed" data-test-parsed></div>
              <div class="derivation-steps" data-test-steps></div>
            </div>
          `
          : `
            <div class="notice notice-quiet">
              ${icon("info")}
              <p>A root language has no ancestral input, so there are no rules to apply. Create a daughter language and add rules there.</p>
            </div>
          `
      }
    </section>`;
}

function notationHelpMarkup() {
  return `
    <details class="panel help-panel" open>
      <summary class="panel-head help-summary">
        <div class="panel-title">
          <h2>Notation</h2>
          <p>A practical subset of standard sound-change notation.</p>
        </div>
        <span class="details-chevron">${icon("chevronDown")}</span>
      </summary>
      <div class="help-body">
        <div class="help-syntax">
          <code>input &gt; output / left _ right</code>
        </div>
        <ul class="help-list">
          <li><code>p &gt; f / V _ V</code><span>p becomes f between vowels.</span></li>
          <li><code>V &gt; ∅ / _ #</code><span>Delete word-final vowels.</span></li>
          <li><code>k &gt; tʃ / _ i</code><span>Palatalize k before i.</span></li>
          <li><code>[td] &gt; ∅ / _ #</code><span>Delete t or d word-finally.</span></li>
          <li><code>C &gt; ∅ / _ C</code><span>Delete a consonant before another consonant.</span></li>
        </ul>
        <dl class="help-terms">
          <div><dt>V, C</dt><dd>Any vowel or consonant in the language’s inventory.</dd></div>
          <div><dt>[…]</dt><dd>A set of sounds; <code>[^…]</code> negates it.</dd></div>
          <div><dt>#</dt><dd>Word boundary in an environment.</dd></div>
          <div><dt>_</dt><dd>Marks where the input sits in the environment.</dd></div>
          <div><dt>∅, 0</dt><dd>Deletion.</dd></div>
        </dl>
        <p class="help-foot">Rules are applied in order. Within one rule, matches are found left to right. Forms are read as IPA, using the sounds in the ancestry’s charts.</p>
      </div>
    </details>`;
}

function inheritedPanelMarkup(ctx) {
  return `
    <section class="panel inherited-panel" data-inherited-panel>
      <header class="panel-head">
        <div class="panel-title">
          <h2>Inherited vocabulary check</h2>
          <p>Compare each ancestral word with the form these rules produce.</p>
        </div>
        <span class="check-summary" data-check-summary></span>
      </header>
      <div data-check-body></div>
    </section>`;
}

function checkRows(ctx) {
  const parent = ancestorsOf(ctx.project, ctx.language.id).at(-1);
  if (!parent) {
    return {
      summary: "",
      html: `<div class="notice notice-quiet">${icon("info")}<p>This root language has no ancestor to inherit vocabulary from.</p></div>`,
    };
  }
  const parentWords = parent.vocabulary.filter((word) => word.form.trim() && word.gloss.trim());
  if (!parentWords.length) {
    return {
      summary: "",
      html: `
        <div class="notice notice-quiet">
          ${icon("book")}
          <p>${esc(parent.name)} has no words yet. Add a few in its Vocabulary tab to test these changes against real forms.</p>
          <button class="button button-quiet button-small" type="button" data-open-parent>${icon("arrowLeft")}Open ${esc(parent.name)}’s vocabulary</button>
        </div>`,
    };
  }
  const byGloss = new Map();
  for (const word of ctx.language.vocabulary) {
    if (word.gloss.trim()) byGloss.set(word.gloss.trim().toLowerCase(), word);
  }
  const rows = parentWords.map((word, index) => {
    const derived = deriveForm(word.form, ctx.project, ctx.language.id, { directOnly: true }).text;
    const recorded = byGloss.get(word.gloss.trim().toLowerCase()) || null;
    const status = !recorded?.form.trim() ? "missing" : sameForm(recorded.form, derived) ? "match" : "differs";
    return { word, derived, recorded, status, index };
  });
  const matches = rows.filter((row) => row.status === "match").length;
  const recordedCount = rows.filter((row) => row.status !== "missing").length;
  const summary =
    recordedCount === 0
      ? `${rows.length} ancestral ${rows.length === 1 ? "word" : "words"} · none recorded yet`
      : `${matches} of ${recordedCount} recorded ${recordedCount === 1 ? "form matches" : "forms match"}`;

  const html = `
    <div class="check-table-wrap">
      <table class="data-table check-table">
        <thead>
          <tr><th>Gloss</th><th>${esc(parent.name)}</th><th>Derived here</th><th>${esc(ctx.language.name)}</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td class="gloss-cell">${esc(row.word.gloss)}</td>
                  <td><code class="ipa">${esc(row.word.form)}</code></td>
                  <td><code class="ipa derived-form">${esc(row.derived) || "—"}</code></td>
                  <td>${row.recorded ? `<code class="ipa">${esc(row.recorded.form) || "—"}</code>` : `<span class="muted">not recorded</span>`}</td>
                  <td>
                    <span class="status-chip status-${row.status}">
                      ${row.status === "match" ? icon("check") : row.status === "differs" ? icon("warning") : icon("info")}
                      ${row.status === "match" ? "Matches" : row.status === "differs" ? "Differs" : "Missing"}
                    </span>
                  </td>
                  <td class="row-actions">
                    <button class="button button-quiet button-tiny" type="button" data-record-word="${row.index}" ${row.status === "match" ? "disabled" : ""}>
                      ${row.status === "missing" ? "Record" : "Use derived"}
                    </button>
                  </td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="check-foot">Comparison is by gloss, using only this language’s direct changes. Not every word needs to be inherited; use “Use derived” when a reflex is correct.</p>`;
  return { summary, html, rows, parent, byGloss };
}

function lineageMarkup(ctx) {
  const lineage = getLineage(ctx.project, ctx.language.id);
  return `
    <div class="lineage-inline">
      ${lineage
        .map((language, index) => {
          const current = index === lineage.length - 1;
          return `${index > 0 ? `<span class="lineage-arrow">${icon("chevronRight")}</span>` : ""}<span class="lineage-chip ${current ? "is-current" : ""}">${esc(language.name)}</span>`;
        })
        .join("")}
    </div>`;
}

export function renderChanges(container, ctx) {
  const language = ctx.language;
  const context = contextForLanguage(ctx.project, language.id);
  const parent = ancestorsOf(ctx.project, language.id).at(-1);
  const stats = languageStats(language);

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro changes-intro">
        <div>
          <p class="eyebrow">Sound changes</p>
          <h2>From ${parent ? esc(parent.name) : "an unattested ancestor"}</h2>
          <p class="section-copy">${parent ? `These ${stats.changes} ordered rules describe how ${esc(language.name)} develops from ${esc(parent.name)}.` : "This is a root language. Its daughter languages will define ordered changes from it."}</p>
          ${lineageMarkup(ctx)}
        </div>
        <div class="inventory-summary">
          <span><strong>${language.soundChanges.filter((rule) => rule.enabled !== false).length}</strong> active</span>
          <span><strong>${language.soundChanges.filter((rule) => rule.enabled === false).length}</strong> disabled</span>
        </div>
      </section>

      <div class="changes-layout">
        <div class="changes-main">
          <section class="panel rules-panel">
            <header class="panel-head">
              <div class="panel-title">
                <h2>Ordered rules</h2>
                <p>Each rule runs once, in order, after the one above it.</p>
              </div>
              <button class="button button-primary button-small" type="button" data-add-rule>${icon("plus")}Add rule</button>
            </header>
            ${rulesMarkup(language, context)}
          </section>
          ${inheritedPanelMarkup(ctx)}
        </div>
        <aside class="changes-aside">
          ${testPanelMarkup(ctx)}
          ${notationHelpMarkup()}
        </aside>
      </div>
    </div>
  `;

  const testPanel = container.querySelector("[data-test-panel]");
  const testInput = testPanel?.querySelector("[data-test-input]");
  const checkPanel = container.querySelector("[data-inherited-panel]");
  const checkBody = checkPanel?.querySelector("[data-check-body]");
  const checkSummary = checkPanel?.querySelector("[data-check-summary]");

  const runTest = () => {
    if (!testPanel || !testInput) return;
    const result = directDerivation(ctx, testInput.value);
    const output = testPanel.querySelector("[data-test-output]");
    const parsed = testPanel.querySelector("[data-test-parsed]");
    const steps = testPanel.querySelector("[data-test-steps]");
    output.textContent = result.text || "—";
    parsed.innerHTML = result.inputTokens.length
      ? `<span>Read as</span> ${result.inputTokens.map((token) => `<code>${esc(token)}</code>`).join(" ")}`
      : `<span>Type a form to test.</span>`;
    if (!language.soundChanges.length) {
      steps.innerHTML = `<p class="derivation-empty">No changes yet — the output stays identical to the input.</p>`;
      return;
    }
    steps.innerHTML = result.steps
      .map((step, index) => {
        if (step.error) {
          return `
            <div class="derivation-step is-error">
              <span class="step-index">${index + 1}</span>
              <div class="step-body">
                <div class="step-rule"><code>${esc(step.compiled.rule.source || "Empty rule")}</code></div>
                <div class="step-error">${esc(step.error)}</div>
              </div>
            </div>`;
        }
        const ruleSource = step.compiled.rule.source || "";
        return `
          <div class="derivation-step ${step.changed ? "is-changed" : ""}">
            <span class="step-index">${index + 1}</span>
            <div class="step-body">
              <div class="step-rule"><code>${esc(ruleSource)}</code>${step.changed ? "" : `<span class="step-skip">unchanged</span>`}</div>
              <div class="step-form"><code class="ipa">${esc(step.before.join("")) || "∅"}</code><span class="step-arrow">→</span><code class="ipa">${esc(step.after.join("")) || "∅"}</code></div>
            </div>
          </div>`;
      })
      .join("");
  };

  const refreshCheck = () => {
    if (!checkPanel || !checkBody) return;
    const data = checkRows(ctx);
    checkBody.innerHTML = data.html;
    if (checkSummary) checkSummary.textContent = data.summary;
  };

  if (testInput) {
    testInput.addEventListener("input", runTest);
    testInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runTest();
      }
    });
    testPanel.querySelector("[data-test-run]")?.addEventListener("click", runTest);
    testPanel.querySelectorAll("[data-test-word]").forEach((button) => {
      button.addEventListener("click", () => {
        testInput.value = button.dataset.testWord;
        runTest();
        testInput.focus();
      });
    });
    runTest();
  }

  refreshCheck();

  container.querySelectorAll("[data-add-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = { id: uid("rule"), notation: "", note: "", enabled: true };
      language.soundChanges.push(rule);
      ctx.touch();
      ctx.refresh();
      window.setTimeout(() => {
        document.querySelector(`[data-rule-id="${rule.id}"] .rule-input`)?.focus();
      }, 0);
    });
  });

  container.querySelectorAll(".rule-card").forEach((card) => {
    const rule = language.soundChanges.find((item) => item.id === card.dataset.ruleId);
    if (!rule) return;
    const notation = card.querySelector(".rule-input");
    const note = card.querySelector(".rule-note-input");
    const toggle = card.querySelector("[data-rule-toggle]");

    notation.addEventListener("input", () => {
      rule.notation = notation.value;
      ctx.touch();
      updateRuleStatus(card, context, rule);
      runTest();
      refreshCheck();
    });
    note.addEventListener("input", () => {
      rule.note = note.value;
      ctx.touch();
    });
    toggle.addEventListener("change", () => {
      rule.enabled = toggle.checked;
      card.classList.toggle("is-disabled", !rule.enabled);
      ctx.touch();
      updateRuleStatus(card, context, rule);
      runTest();
      refreshCheck();
    });

    card.querySelector("[data-rule-up]")?.addEventListener("click", () => {
      const index = language.soundChanges.indexOf(rule);
      if (index <= 0) return;
      [language.soundChanges[index - 1], language.soundChanges[index]] = [language.soundChanges[index], language.soundChanges[index - 1]];
      ctx.touch();
      ctx.refresh();
    });
    card.querySelector("[data-rule-down]")?.addEventListener("click", () => {
      const index = language.soundChanges.indexOf(rule);
      if (index < 0 || index >= language.soundChanges.length - 1) return;
      [language.soundChanges[index + 1], language.soundChanges[index]] = [language.soundChanges[index], language.soundChanges[index + 1]];
      ctx.touch();
      ctx.refresh();
    });
    card.querySelector("[data-rule-delete]")?.addEventListener("click", () => {
      const index = language.soundChanges.indexOf(rule);
      if (index < 0) return;
      const [removed] = language.soundChanges.splice(index, 1);
      ctx.touch();
      ctx.refresh();
      toast("Rule deleted.", {
        type: "info",
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            language.soundChanges.splice(index, 0, removed);
            ctx.touch();
            ctx.refresh();
          },
        },
      });
    });
  });

  if (checkPanel) {
    checkPanel.addEventListener("click", (event) => {
      const openParent = event.target.closest("[data-open-parent]");
      const parentLanguage = ancestorsOf(ctx.project, language.id).at(-1);
      if (openParent && parentLanguage) {
        ctx.navigate(`#/language/${parentLanguage.id}/vocabulary`);
        return;
      }
      const recordButton = event.target.closest("[data-record-word]");
      if (!recordButton || !parentLanguage) return;
      const words = parentLanguage.vocabulary.filter((word) => word.form.trim() && word.gloss.trim());
      const word = words[Number(recordButton.dataset.recordWord)];
      if (!word) return;
      const derived = deriveForm(word.form, ctx.project, language.id, { directOnly: true }).text;
      const normalizedGloss = word.gloss.trim().toLowerCase();
      let existing = language.vocabulary.find((entry) => entry.gloss.trim().toLowerCase() === normalizedGloss);
      if (existing) {
        existing.form = derived;
        if (!existing.note) existing.note = `Derived from ${parentLanguage.name}.`;
      } else {
        language.vocabulary.push({
          id: uid("word"),
          gloss: word.gloss,
          form: derived,
          note: `Derived from ${parentLanguage.name}.`,
        });
      }
      ctx.touch();
      ctx.refresh();
      toast(`Recorded “${word.gloss}” as ${derived || "∅"}.`, { type: "success" });
    });
  }

  // Recompute the test as soon as the tab is opened and chart context changes
  // are reflected by the next render.
  if (testInput && !testInput.value) runTest();
}
