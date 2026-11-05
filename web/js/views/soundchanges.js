import {
  allophonyRules,
  ancestorsOf,
  getLineage,
  languageStats,
  ruleGroups,
  uid,
} from "../model.js";
import {
  compileRule,
  compileRuleStages,
  contextForLanguage,
  deriveForm,
  deriveStages,
  surfaceForForm,
} from "../phonology.js";
import { formatPhonemic, formatPhonetic } from "../notation.js";
import { derivationStepsMarkup } from "../derivation.js";
import { esc, icon, toast } from "../ui.js";

function compileDirect(ctx) {
  const context = contextForLanguage(ctx.project, ctx.language.id);
  return { context, groups: compileRuleStages(ctx.language.soundChanges, context) };
}

function directDerivation(ctx, form) {
  const { context, groups } = compileDirect(ctx);
  const tokens = context.tokenize(form);
  const result = deriveStages(tokens, [{ language: ctx.language, groups }], context);
  const phonemic = result.tokens.join("");
  const surface = result.errors.length ? null : surfaceForForm(phonemic, ctx.project, ctx.language.id);
  return {
    inputTokens: tokens,
    outputTokens: result.tokens,
    steps: result.steps,
    text: phonemic,
    surface: surface?.errors.length ? null : surface?.text || "",
    surfaceError: surface?.errors[0] || "",
    errors: result.errors,
    fatal: result.fatal,
  };
}

function sameForm(a, b) {
  const normalize = (value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  return normalize(a) === normalize(b);
}

function statusFor(rule, context) {
  if (!rule.notation.trim()) return { kind: "empty", label: "Empty rule" };
  const compiled = compileRule(rule.notation, context);
  // A warning keeps the rule usable — the user may be mid-edit — while making
  // an inert rule (for example compact “CV > x” letter literals) visible.
  if (compiled.ok && compiled.warnings?.length) return { kind: "warn", label: compiled.warnings[0] };
  if (compiled.ok) return { kind: "ok", label: "Valid" };
  return { kind: "error", label: compiled.error };
}

function statusMarkup(status) {
  const glyph =
    status.kind === "ok" ? "check" : status.kind === "error" || status.kind === "warn" ? "warning" : "info";
  return `${icon(glyph)}<span>${esc(status.label)}</span>`;
}

function updateRuleStatus(card, context, rule, parentDisabled = false) {
  const element = card.querySelector("[data-rule-status]");
  if (!element) return;
  const status =
    rule.enabled === false
      ? { kind: "off", label: "Disabled" }
      : parentDisabled
        ? { kind: "off", label: "Parent disabled" }
        : statusFor(rule, context);
  element.className = `rule-status status-${status.kind}`;
  element.innerHTML = statusMarkup(status);
  element.title = status.label;
}

function ruleCardMarkup(
  rule,
  { index, childIndex = null, context, parentDisabled = false, canMoveUp = false, canMoveDown = false }
) {
  const isChild = childIndex !== null;
  const disabled = rule.enabled === false || parentDisabled;
  const status = rule.enabled === false
    ? { kind: "off", label: "Disabled" }
    : parentDisabled
      ? { kind: "off", label: "Parent disabled" }
      : statusFor(rule, context);
  const number = isChild ? `${index + 1}.${childIndex + 1}` : String(index + 1);
  return `
    <article class="rule-card ${isChild ? "is-child" : ""} ${disabled ? "is-disabled" : ""}" data-rule-id="${esc(rule.id)}">
      <div class="rule-number ${isChild ? "is-dotted" : ""}">${esc(number)}</div>
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
        ${isChild ? "" : `<button class="icon-button icon-button-small" type="button" data-add-child title="Add sequential rule" aria-label="Add sequential rule">${icon("plus")}</button>`}
        <button class="icon-button icon-button-small" type="button" data-rule-up title="Move up" aria-label="Move rule up" ${canMoveUp ? "" : "disabled"}>${icon("arrowUp")}</button>
        <button class="icon-button icon-button-small" type="button" data-rule-down title="Move down" aria-label="Move rule down" ${canMoveDown ? "" : "disabled"}>${icon("arrowDown")}</button>
        <button class="icon-button icon-button-small danger-hover" type="button" data-rule-delete title="Delete rule" aria-label="Delete rule">${icon("trash")}</button>
      </div>
    </article>`;
}

function rulesMarkup(language, context) {
  const groups = ruleGroups(language.soundChanges);
  if (!groups.length) {
    return `
      <div class="rules-empty">
        <div class="empty-icon small">${icon("sound")}</div>
        <h3>No sound changes yet</h3>
        <p>Add the first change from the ancestral language. Top-level rules are checked against the inherited form; sequential rules run after them.</p>
        <button class="button button-primary button-small" type="button" data-add-rule>${icon("plus")}Add a rule</button>
      </div>`;
  }
  return `
    <div class="rules-list">
      ${groups
        .map((group, index) => {
          return `
            <div class="rule-group">
              ${ruleCardMarkup(group.rule, {
                index,
                context,
                canMoveUp: index > 0,
                canMoveDown: index < groups.length - 1,
              })}
              ${
                group.children.length
                  ? `<div class="rule-children">${group.children
                      .map((child, childIndex) =>
                        ruleCardMarkup(child, {
                          index,
                          childIndex,
                          context,
                          parentDisabled: group.rule.enabled === false,
                          canMoveUp: childIndex > 0,
                          canMoveDown: childIndex < group.children.length - 1,
                        })
                      )
                      .join("")}</div>`
                  : ""
              }
            </div>`;
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
              <input class="input ipa-input" id="test-word" data-test-input value="${esc(parent.vocabulary.find((word) => word.form.trim())?.form || "")}" placeholder="e.g. kasa" autocomplete="off" spellcheck="false">
              ${suggestions.length ? `<div class="word-suggestions">${suggestions.map((word) => `<button class="word-suggestion" type="button" data-test-word="${esc(word.form)}" title="${esc(word.gloss)}">${esc(word.form)}<span>${esc(word.gloss)}</span></button>`).join("")}</div>` : ""}
            </div>
            <div class="derivation" data-derivation>
              <div class="derivation-output-row">
                <span class="derivation-label">Phonemic</span>
                <output class="derivation-output ipa" data-test-output>—</output>
              </div>
              <div class="derivation-output-row" data-test-surface-row ${allophonyRules(ctx.language.allophony).length ? "" : "hidden"}>
                <span class="derivation-label">Surface</span>
                <output class="derivation-output ipa allo-surface-output" data-test-surface>—</output>
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
          <li><code>[back] &gt; ∅ / _ #</code><span>Delete final back vowels — a chart class instead of a sound list.</span></li>
          <li><code>N &gt; ∅ / _ #</code><span>Delete a final member of the N category — categories come from Phonotactics.</span></li>
          <li><code>C &gt; ∅ / _ C</code><span>Delete a consonant before another consonant.</span></li>
          <li><code>∅ &gt; ʔ / V _ V</code><span>Insert a glottal stop between vowels.</span></li>
        </ul>
        <dl class="help-terms">
          <div><dt>V, C</dt><dd>Any vowel or consonant in the language’s inventory.</dd></div>
          <div><dt>[…]</dt><dd>A set of sounds; <code>[^…]</code> negates it. Items may be sounds, categories, or chart classes as separate words.</dd></div>
          <div><dt>N, G, …</dt><dd>A category defined in this language’s Phonotactics tab, such as <code>N</code> for nasals. It stands for its member sounds in the input and environment, including inside sets like <code>[N s]</code>.</dd></div>
          <div><dt>plosive.plain</dt><dd>A chart class: dotted labels read straight from the Phonology charts, on their own or inside sets. A sound belongs when every label applies on each axis that has it — write <code>back</code>, <code>V.back</code>, or dotted paths like <code>plosive.velar</code>; pin via <code>V.</code> / <code>C.</code>.</dd></div>
          <div><dt>#</dt><dd>Word boundary in an environment.</dd></div>
          <div><dt>_</dt><dd>Marks where the input sits in the environment.</dd></div>
          <div><dt>∅, 0</dt><dd>Zero: deletion on the output side, insertion on the input side.</dd></div>
        </dl>
        <p class="help-foot">Top-level rules are all checked against the form inherited from the parent, so their order does not change whether they apply. Dotted rules run after that pass, in order, against the changed form. Within one rule, matches are found left to right. Forms are read as IPA, using the sounds in the ancestry’s charts, and chart classes resolve against every chart in that ancestry. Categories are read from this language’s Phonotactics tab.</p>
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
    const derived = deriveForm(word.form, ctx.project, ctx.language.id, { directOnly: true });
    const recorded = byGloss.get(word.gloss.trim().toLowerCase()) || null;
    const status = derived.error
      ? "error"
      : !recorded?.form.trim()
        ? "missing"
        : sameForm(recorded.form, derived.text)
          ? "match"
          : "differs";
    const surface = derived.error ? null : surfaceForForm(derived.text, ctx.project, ctx.language.id);
    return {
      word,
      derived: derived.error ? "" : derived.text,
      surface: surface?.errors.length ? "" : surface?.text || "",
      recorded,
      status,
      error: derived.error,
      index,
    };
  });
  const matches = rows.filter((row) => row.status === "match").length;
  const recordedCount = rows.filter((row) => row.status !== "missing").length;
  const errorCount = rows.filter((row) => row.status === "error").length;
  const summary =
    recordedCount === 0
      ? `${rows.length} ancestral ${rows.length === 1 ? "word" : "words"} · none recorded yet`
      : `${matches} of ${recordedCount} recorded ${recordedCount === 1 ? "form matches" : "forms match"}${
          errorCount ? ` · ${errorCount} rule ${errorCount === 1 ? "error" : "errors"}` : ""
        }`;

  const html = `
    <div class="check-table-wrap">
      <table class="data-table check-table">
        <thead>
          <tr><th>Gloss</th><th>${esc(parent.name)}</th><th>Derived /…/</th>${allophonyRules(ctx.language.allophony).length ? "<th>Surface [ … ]</th>" : ""}<th>${esc(ctx.language.name)}</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td class="gloss-cell">${esc(row.word.gloss)}</td>
                  <td><code class="ipa">${esc(formatPhonemic(row.word.form))}</code></td>
                  <td><code class="ipa derived-form">${esc(formatPhonemic(row.derived)) || "—"}</code></td>
                  ${allophonyRules(ctx.language.allophony).length ? `<td><code class="ipa surface-form">${esc(formatPhonetic(row.surface)) || "—"}</code></td>` : ""}
                  <td>${row.recorded ? `<code class="ipa">${esc(formatPhonemic(row.recorded.form)) || "—"}</code>` : `<span class="muted">not recorded</span>`}</td>
                  <td>
                    <span class="status-chip status-${row.status}" ${row.error ? `title="${esc(row.error)}"` : ""}>
                      ${row.status === "match" ? icon("check") : row.status === "differs" || row.status === "error" ? icon("warning") : icon("info")}
                      ${row.status === "match" ? "Matches" : row.status === "differs" ? "Differs" : row.status === "error" ? "Rule error" : "Missing"}
                    </span>
                  </td>
                  <td class="row-actions">
                    <button class="button button-quiet button-tiny" type="button" data-record-word="${row.index}" ${row.status === "match" || row.status === "error" ? "disabled" : ""}>
                      ${row.status === "missing" ? "Record" : "Use derived"}
                    </button>
                  </td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="check-foot">Comparison is by gloss, using only this language’s direct changes. Not every word needs to be inherited; use “Use derived” when a reflex is correct. Top-level rules that change the same part of a word stop the derivation and appear as a rule error.</p>`;
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
          <p class="section-copy">${parent ? `These ${stats.changes} rules describe how ${esc(language.name)} develops from ${esc(parent.name)}.` : "This is a root language. Its daughter languages will define changes from it."}</p>
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
                <h2>Rules</h2>
                <p>Top-level rules match the inherited form together; sequential rules then run in order.</p>
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
    const surface = testPanel.querySelector("[data-test-surface]");
    const surfaceRow = testPanel.querySelector("[data-test-surface-row]");
    const parsed = testPanel.querySelector("[data-test-parsed]");
    const steps = testPanel.querySelector("[data-test-steps]");
    output.textContent = result.fatal ? "—" : formatPhonemic(result.text) || "—";
    if (surface && surfaceRow) {
      const showSurface = allophonyRules(language.allophony).length > 0;
      surfaceRow.hidden = !showSurface;
      surface.textContent = showSurface
        ? result.surfaceError
          ? "surface error"
          : formatPhonetic(result.surface) || "—"
        : "—";
    }
    parsed.innerHTML = result.inputTokens.length
      ? `<span>Read as</span> ${result.inputTokens.map((token) => `<code>${esc(token)}</code>`).join(" ")}`
      : `<span>Type a form to test.</span>`;
    if (!language.soundChanges.length) {
      steps.innerHTML = `<p class="derivation-empty">No changes yet — the output stays identical to the input.</p>`;
      return;
    }
    steps.innerHTML = derivationStepsMarkup(result.steps, {
      emptyText: "No rules change this form — it passes through unchanged.",
      hideEmpty: true,
    });
  };

  const refreshCheck = () => {
    if (!checkPanel || !checkBody) return;
    const data = checkRows(ctx);
    checkBody.innerHTML = data.html;
    if (checkSummary) checkSummary.textContent = data.summary;
  };

  if (testInput) {
    // The derivation updates live on every keystroke (and Enter re-runs it),
    // so no explicit Apply control is needed.
    testInput.addEventListener("input", runTest);
    testInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runTest();
      }
    });
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

  const moveRule = (rule, direction) => {
    if (!rule.parentId) {
      const groups = ruleGroups(language.soundChanges);
      const index = groups.findIndex((group) => group.rule.id === rule.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= groups.length) return false;
      [groups[index], groups[target]] = [groups[target], groups[index]];
      language.soundChanges = groups.flatMap((group) => [group.rule, ...group.children]);
      return true;
    }
    const siblings = language.soundChanges.filter((item) => item.parentId === rule.parentId);
    const index = siblings.indexOf(rule);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return false;
    const other = siblings[target];
    const a = language.soundChanges.indexOf(rule);
    const b = language.soundChanges.indexOf(other);
    [language.soundChanges[a], language.soundChanges[b]] = [language.soundChanges[b], language.soundChanges[a]];
    return true;
  };

  const addChildRule = (parent) => {
    const group = ruleGroups(language.soundChanges).find((item) => item.rule.id === parent.id);
    if (!group) return;
    const child = { id: uid("rule"), notation: "", note: "", enabled: true, parentId: parent.id };
    const anchor = group.children.at(-1) || parent;
    const index = language.soundChanges.indexOf(anchor);
    language.soundChanges.splice(index + 1, 0, child);
    ctx.touch({ label: "Add rule" });
    ctx.refresh();
    window.setTimeout(() => {
      document.querySelector(`[data-rule-id="${child.id}"] .rule-input`)?.focus();
    }, 0);
  };

  container.querySelectorAll("[data-add-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = { id: uid("rule"), notation: "", note: "", enabled: true, parentId: null };
      language.soundChanges.push(rule);
      ctx.touch({ label: "Add rule" });
      ctx.refresh();
      window.setTimeout(() => {
        document.querySelector(`[data-rule-id="${rule.id}"] .rule-input`)?.focus();
      }, 0);
    });
  });

  container.querySelectorAll(".rule-card").forEach((card) => {
    const rule = language.soundChanges.find((item) => item.id === card.dataset.ruleId);
    if (!rule) return;
    const parentRule = rule.parentId ? language.soundChanges.find((item) => item.id === rule.parentId) : null;
    const parentDisabled = parentRule?.enabled === false;
    const notation = card.querySelector(".rule-input");
    const note = card.querySelector(".rule-note-input");
    const toggle = card.querySelector("[data-rule-toggle]");

    notation.addEventListener("input", () => {
      rule.notation = notation.value;
      ctx.touch({ label: "Edit rule" });
      updateRuleStatus(card, context, rule, parentDisabled);
      runTest();
      refreshCheck();
    });
    note.addEventListener("input", () => {
      rule.note = note.value;
      ctx.touch({ label: "Edit rule" });
    });
    toggle.addEventListener("change", () => {
      rule.enabled = toggle.checked;
      ctx.touch({ label: rule.enabled ? "Enable rule" : "Disable rule" });
      // Re-render so children of a disabled parent also show that they are
      // inactive. The rule tester and inherited check rerun with the view.
      ctx.refresh();
    });

    card.querySelector("[data-add-child]")?.addEventListener("click", () => {
      addChildRule(rule);
    });
    card.querySelector("[data-rule-up]")?.addEventListener("click", () => {
      if (!moveRule(rule, -1)) return;
      ctx.touch({ label: "Move rule" });
      ctx.refresh();
    });
    card.querySelector("[data-rule-down]")?.addEventListener("click", () => {
      if (!moveRule(rule, 1)) return;
      ctx.touch({ label: "Move rule" });
      ctx.refresh();
    });
    card.querySelector("[data-rule-delete]")?.addEventListener("click", () => {
      if (rule.parentId) {
        const index = language.soundChanges.indexOf(rule);
        if (index < 0) return;
        const [removed] = language.soundChanges.splice(index, 1);
        ctx.touch({ label: "Delete rule" });
        ctx.refresh();
        toast("Rule deleted.", {
          type: "info",
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => {
              language.soundChanges.splice(index, 0, removed);
              ctx.touch({ label: "Restore rule" });
              ctx.refresh();
            },
          },
        });
        return;
      }
      const group = ruleGroups(language.soundChanges).find((item) => item.rule.id === rule.id);
      if (!group) return;
      const block = [group.rule, ...group.children];
      const index = language.soundChanges.indexOf(group.rule);
      const extra = block.length - 1;
      language.soundChanges.splice(index, block.length);
      ctx.touch({ label: extra ? "Delete rule group" : "Delete rule" });
      ctx.refresh();
      toast(
        extra
          ? `Rule and ${extra} sequential ${extra === 1 ? "rule" : "rules"} deleted.`
          : "Rule deleted.",
        {
          type: "info",
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => {
              language.soundChanges.splice(index, 0, ...block);
              ctx.touch({ label: "Restore rule group" });
              ctx.refresh();
            },
          },
        }
      );
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
      const derivation = deriveForm(word.form, ctx.project, language.id, { directOnly: true });
      if (derivation.error) {
        toast(`Cannot record “${word.gloss}”: ${derivation.error}`, { type: "error" });
        return;
      }
      const derived = derivation.text;
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
      ctx.touch({ label: "Record word" });
      ctx.refresh();
      toast(`Recorded “${word.gloss}” as ${derived || "∅"}.`, { type: "success" });
    });
  }

  // Recompute the test as soon as the tab is opened and chart context changes
  // are reflected by the next render.
  if (testInput && !testInput.value) runTest();
}
