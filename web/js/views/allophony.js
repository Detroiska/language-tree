import {
  ALLOPHONY_REPEAT_LIMIT,
  DEFAULT_RULE_RATE,
  allophonyEntries,
  allophonyRules,
  ancestorsOf,
  findLanguage,
  groupAllophonyRules,
  isAllophonyGroup,
  normalizeAllophonyDomain,
  normalizeAllophonyRepeatLimit,
  normalizeRuleExceptions,
  normalizeRuleRate,
  restoreAllophonyGroup,
  restoreAllophonyRule,
  restoreUngroupedAllophonyRules,
  uid,
} from "../model.js";
import {
  allophoneTable,
  compileAllophonyRule,
  compileAllophonyRules,
  contextForAllophony,
  surfaceForForm,
} from "../phonology.js";
import { formatPhonemic, formatPhonetic, stripLevelMarks } from "../notation.js";
import { optionalRulesPickerMarkup } from "../derivation.js";
import {
  exceptionSummary,
  exceptionSuggestionsMarkup as sharedExceptionSuggestionsMarkup,
  exceptionsMarkup as sharedExceptionsMarkup,
  ruleStatusFor,
  statusMarkup,
} from "../ruleEditor.js";
import { esc, icon, toast } from "../ui.js";

// Allophony is the synchronic surface layer. It is deliberately separate from
// the Sound changes tab: historical rules run from an ancestor's phonemic form
// to this language's phonemic form and feed the cognate chain; allophony runs
// on this language's own phonemic forms and produces [surface] forms.

// Optional allophony is a view-only variant, remembered per language just like
// the sound-change tester's selection.
const alloTesterOptionalMemory = new Map();

function optionalAllophonyRules(compiled) {
  return (compiled || [])
    .filter(
      (entry) =>
        entry.rule?.optional === true &&
        entry.rule.enabled !== false &&
        !entry.groupDisabled
    )
    .map((entry) => ({
      id: entry.rule.id,
      label: entry.number || "",
      notation: entry.rule.notation || "",
      rate: normalizeRuleRate(entry.rule.rate),
    }));
}

function statusFor(rule, context) {
  return ruleStatusFor(rule, (notation) => compileAllophonyRule(notation, context));
}

function exceptionsMarkup(rule) {
  return sharedExceptionsMarkup(rule, {
    countAttribute: "data-allo-rule-exception-count",
    listId: "allo-exception-glosses",
  });
}

function exceptionSuggestionsMarkup(suggestions) {
  return sharedExceptionSuggestionsMarkup(suggestions, "allo-exception-glosses");
}

function ruleCardMarkup(rule, number, context, { canMoveUp, canMoveDown, groupDisabled = false }) {
  const disabled = rule.enabled === false || groupDisabled;
  const iterative = rule.iterative === true;
  const repeatLimit = normalizeAllophonyRepeatLimit(rule.repeatLimit);
  const domain = normalizeAllophonyDomain(rule.domain);
  const rate = normalizeRuleRate(rule.rate);
  const status =
    rule.enabled === false
      ? { kind: "off", label: "Disabled" }
      : groupDisabled
        ? { kind: "off", label: "Group disabled" }
        : statusFor(rule, context);
  return `
    <article class="rule-card ${rule.optional ? "is-optional" : ""} ${disabled ? "is-disabled" : ""}" data-allo-rule-id="${esc(rule.id)}">
      <div class="rule-number ${String(number).includes(".") ? "is-dotted" : ""}">${esc(number)}</div>
      <div class="rule-body">
        <div class="rule-notation-row">
          <input class="rule-input" type="text" value="${esc(rule.notation)}" placeholder="/p/ > [pʰ] / # _ V" autocomplete="off" spellcheck="false" aria-label="Allophony rule notation">
          ${rule.optional ? `<span class="rule-optional-badge" title="Optional allophony is skipped in the primary surface">optional ${rate}%</span>` : ""}
          <span class="rule-status status-${status.kind}" data-allo-rule-status title="${esc(status.label)}">${statusMarkup(status)}</span>
        </div>
        <input class="rule-note-input" type="text" value="${esc(rule.note)}" placeholder="Optional description, e.g. aspiration in onset" autocomplete="off" aria-label="Allophony rule note">
        <div class="rule-options">
          <label class="rule-option" title="Apply this rule repeatedly until the form stops changing">
            <input type="checkbox" data-allo-rule-iterative ${iterative ? "checked" : ""}>
            <span>Repeat until stable</span>
          </label>
          <label class="rule-option" title="Let the environment skip intervening segments. “Adjacent” keeps the usual touching-segment match.">
            <span class="rule-option-label">Domain</span>
            <select class="rule-domain-select" data-allo-rule-domain aria-label="Allophony environment domain">
              <option value="adjacent" ${domain === "adjacent" ? "selected" : ""}>Adjacent</option>
              <option value="syllable" ${domain === "syllable" ? "selected" : ""}>Within syllable</option>
              <option value="word" ${domain === "word" ? "selected" : ""}>Across word</option>
            </select>
          </label>
          <label class="rule-option" title="Maximum number of passes before the rule stops and warns">
            <span class="rule-option-label">Limit</span>
            <input class="rule-limit-input" type="number" data-allo-rule-limit min="1" max="100" step="1" value="${repeatLimit}" aria-label="Maximum allophony passes" ${iterative ? "" : "disabled"}>
          </label>
          <label class="rule-option" title="Skip this rule in the primary surface; include it in a tester variant when needed">
            <input type="checkbox" data-allo-rule-optional ${rule.optional ? "checked" : ""}>
            <span>Optional</span>
          </label>
          <label class="rule-option" title="Descriptive likelihood; surface derivations stay deterministic">
            <span class="rule-option-label">Rate</span>
            <input class="rule-limit-input rule-rate-input" type="number" data-allo-rule-rate min="0" max="100" step="5" value="${rate}" aria-label="Optional allophony rate" ${rule.optional ? "" : "disabled"}>
            <span>%</span>
          </label>
        </div>
        ${exceptionsMarkup(rule)}
      </div>
      <div class="rule-controls">
        <label class="rule-select" title="Select rule">
          <input type="checkbox" data-allo-rule-select aria-label="Select allophony rule">
        </label>
        <label class="switch" title="${rule.enabled === false ? "Enable rule" : "Disable rule"}">
          <input type="checkbox" data-allo-rule-toggle ${rule.enabled === false ? "" : "checked"} aria-label="Enable allophony rule">
          <span class="switch-track"><span class="switch-thumb"></span></span>
        </label>
        <button class="icon-button icon-button-small" type="button" data-allo-rule-up title="Move up" aria-label="Move rule up" ${canMoveUp ? "" : "disabled"}>${icon("arrowUp")}</button>
        <button class="icon-button icon-button-small" type="button" data-allo-rule-down title="Move down" aria-label="Move rule down" ${canMoveDown ? "" : "disabled"}>${icon("arrowDown")}</button>
        <button class="icon-button icon-button-small danger-hover" type="button" data-allo-rule-delete title="Delete rule" aria-label="Delete rule">${icon("trash")}</button>
      </div>
    </article>`;
}

function groupCardMarkup(group, number, context, { canMoveUp, canMoveDown }) {
  const disabled = group.enabled === false;
  const rules = group.rules || [];
  const children = rules
    .map((rule, index) =>
      ruleCardMarkup(rule, `${number}.${index + 1}`, context, {
        groupDisabled: disabled,
        canMoveUp: index > 0,
        canMoveDown: index < rules.length - 1,
      })
    )
    .join("");
  return `
    <section class="allo-group ${disabled ? "is-disabled" : ""}" data-allo-group-id="${esc(group.id)}">
      <header class="allo-group-head">
        <button class="icon-button icon-button-small" type="button" data-allo-group-collapse title="${group.collapsed ? "Expand group" : "Collapse group"}" aria-label="${group.collapsed ? "Expand group" : "Collapse group"}">${icon(group.collapsed ? "chevronRight" : "chevronDown")}</button>
        <span class="rule-number">${esc(number)}</span>
        <input class="allo-group-name" type="text" value="${esc(group.name)}" placeholder="Group name" autocomplete="off" spellcheck="false" aria-label="Allophony group name">
        <span class="allo-group-count">${rules.length} ${rules.length === 1 ? "rule" : "rules"}</span>
        <div class="allo-group-controls">
          <label class="switch" title="${disabled ? "Enable group" : "Disable group"}">
            <input type="checkbox" data-allo-group-toggle ${disabled ? "" : "checked"} aria-label="Enable allophony group">
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </label>
          <button class="icon-button icon-button-small" type="button" data-allo-group-add title="Add rule to group" aria-label="Add rule to group">${icon("plus")}</button>
          <button class="icon-button icon-button-small" type="button" data-allo-group-up title="Move group up" aria-label="Move group up" ${canMoveUp ? "" : "disabled"}>${icon("arrowUp")}</button>
          <button class="icon-button icon-button-small" type="button" data-allo-group-down title="Move group down" aria-label="Move group down" ${canMoveDown ? "" : "disabled"}>${icon("arrowDown")}</button>
          <button class="icon-button icon-button-small" type="button" data-allo-group-ungroup title="Ungroup (keep rules)" aria-label="Ungroup and keep rules">${icon("x")}</button>
          <button class="icon-button icon-button-small danger-hover" type="button" data-allo-group-delete title="Delete group and its rules" aria-label="Delete group and its rules">${icon("trash")}</button>
        </div>
      </header>
      ${
        group.collapsed
          ? ""
          : `<div class="rule-children">${
              rules.length
                ? children
                : `<div class="allo-group-empty"><span>No rules in this group yet.</span><button class="text-button" type="button" data-allo-group-add>Add a rule</button></div>`
            }</div>`
      }
    </section>`;
}

function rulesMarkup(language, context, exceptionSuggestions = []) {
  if (!language.allophony.length) {
    return `
      <div class="rules-empty">
        <div class="empty-icon small">${icon("sound")}</div>
        <h3>No allophony rules yet</h3>
        <p>Add a synchronic rule that turns a phoneme into a surface allophone — for example /p/ → [pʰ] word-initially. These rules do not feed the historical sound changes or descendants.</p>
        <button class="button button-primary button-small" type="button" data-add-allo-rule>${icon("plus")}Add a rule</button>
      </div>`;
  }
  return `
    ${exceptionSuggestionsMarkup(exceptionSuggestions)}
    <div class="rules-list">
      ${language.allophony
        .map((item, index) =>
          isAllophonyGroup(item)
            ? groupCardMarkup(item, String(index + 1), context, {
                canMoveUp: index > 0,
                canMoveDown: index < language.allophony.length - 1,
              })
            : ruleCardMarkup(item, String(index + 1), context, {
                canMoveUp: index > 0,
                canMoveDown: index < language.allophony.length - 1,
              })
        )
        .join("")}
    </div>`;
}

function activeAllophonyCount(language) {
  return allophonyEntries(language.allophony).filter(
    (entry) => entry.rule.enabled !== false && entry.group?.enabled !== false
  ).length;
}

function allophoneTableMarkup(data) {
  if (!data.rows.length) {
    return `<div class="notice notice-quiet">${icon("info")}<p>No allophones are active yet. Add an allophony rule to populate this table.</p></div>`;
  }
  const rows = data.rows
    .map(
      (row) => `
        <tr>
          <td><code class="ipa">${esc(formatPhonemic(row.phoneme))}</code></td>
          <td><code class="ipa">${esc(formatPhonetic(row.allophone))}</code></td>
          <td><code class="ipa">${esc(row.environment || "—")}</code></td>
          <td><span class="muted">${esc(row.label)}</span> <code class="rule-inline">${esc(row.notation)}</code></td>
        </tr>`
    )
    .join("");
  return `
    <div class="table-scroll">
      <table class="data-table allophone-table">
        <thead><tr><th>Phoneme</th><th>Allophone</th><th>Environment</th><th>Rule</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="table-foot">The table is derived from the active mandatory rules above. Optional rules appear in the surface tester when you tick them. Phonemes are written /…/ and surface allophones [ … ].</p>`;
}

function testPanelMarkup(language, optionalRules = []) {
  const sample = language.vocabulary.find((word) => word.form.trim())?.form || "";
  const suggestions = language.vocabulary.filter((word) => word.form.trim()).slice(0, 4);
  const selectedOptional = alloTesterOptionalMemory.get(language.id) || new Set();
  return `
    <section class="panel test-panel" data-allo-test-panel>
      <header class="panel-head">
        <div class="panel-title">
          <h2>Surface tester</h2>
          <p>Apply this language's allophony to a phonemic form.</p>
        </div>
        <span class="panel-icon">${icon("eye")}</span>
      </header>
      <div class="test-input-wrap">
        <label class="field-label" for="allo-test-word">Phonemic input <span class="field-optional">/…/</span></label>
        <input class="input ipa-input" id="allo-test-word" data-allo-test-input value="${esc(sample)}" placeholder="e.g. kasa" autocomplete="off" spellcheck="false">
        ${
          suggestions.length
            ? `<div class="word-suggestions">${suggestions
                .map(
                  (word) =>
                    `<button class="word-suggestion" type="button" data-allo-test-word="${esc(word.form)}" data-allo-test-gloss="${esc(word.gloss)}" title="Test with the gloss “${esc(word.gloss)}”">${esc(formatPhonemic(word.form))}<span>${esc(word.gloss)}</span></button>`
                )
                .join("")}</div>`
            : ""
        }
      </div>
      ${optionalRulesPickerMarkup(
        optionalRules,
        selectedOptional,
        "data-allo-test-optional",
        { hint: "The primary surface skips optional allophony. Tick a rule to include it in this variant." }
      )}
      <div class="derivation">
        <div class="derivation-output-row">
          <span class="derivation-label">Phonemic</span>
          <output class="derivation-output ipa" data-allo-phonemic>—</output>
        </div>
        <div class="derivation-output-row">
          <span class="derivation-label">Surface</span>
          <output class="derivation-output ipa allo-surface-output" data-allo-surface>—</output>
        </div>
        <div class="derivation-parsed" data-allo-parsed></div>
        <div class="derivation-steps" data-allo-steps></div>
      </div>
    </section>`;
}

function notationHelpMarkup() {
  return `
    <details class="panel help-panel" open>
      <summary class="panel-head help-summary">
        <div class="panel-title">
          <h2>Notation</h2>
          <p>Phoneme → surface allophone.</p>
        </div>
        <span class="details-chevron">${icon("chevronDown")}</span>
      </summary>
      <div class="help-body">
        <div class="help-syntax"><code>/p/ &gt; [pʰ] / # _ V</code></div>
        <ul class="help-list">
          <li><code>/p/ &gt; [pʰ] / # _ V</code><span>A word-initial p is aspirated on the surface.</span></li>
          <li><code>/t/ &gt; [t͡s] / _ i</code><span>t becomes an affricate before i.</span></li>
          <li><code>/n/ &gt; [ŋ] / _ k</code><span>n assimilates to a following k.</span></li>
          <li><code>∅ &gt; [ʔ] / V _ V</code><span>Insert a glottal stop between adjacent vowels.</span></li>
          <li><code>/N/ &gt; [ŋ] / _ k</code><span>A category from Phonotactics: every nasal becomes ŋ before k.</span></li>
          <li><code>p &gt; pʰ / # _ V</code><span>The slashes and brackets are optional; the section supplies the level.</span></li>
          <li><code>/t/ &gt; [+voice] / V _ V</code><span>Voice t between vowels. A charted result is used first; otherwise the surface symbol is synthesized from the curated IPA table and its diacritics.</span></li>
          <li><code>/p/ &gt; [+spread_glottis] / # _ V</code><span>Aspirate p word-initially. The result is pʰ even when pʰ is not on the phoneme chart.</span></li>
          <li><code>/n/ &gt; [αplace] / _ [αplace]</code><span>Copy the following place: n becomes ŋ before k, ɲ before c, and so on.</span></li>
          <li><code>/V/ &gt; [αround] / [αround] _</code><span>Spread rounding from the preceding vowel.</span></li>
          <li><code>/a/ &gt; [u] / u _</code><span>With <strong>Repeat until stable</strong>, spread u through later vowels. Set <strong>Domain</strong> to <em>Across word</em> to skip intervening consonants, or <em>Within syllable</em> to keep the trigger in the target's syllable.</span></li>
        </ul>
        <dl class="help-terms">
          <div><dt>/…/</dt><dd>A phonemic input: a sound from the language's inventory (or a class, category, feature bundle, or set of them).</dd></div>
          <div><dt>[…]</dt><dd>A surface allophone. It may be absent from the phoneme chart; that is the point. A bracketed output with signs, like <code>[+voice]</code>, is instead a feature change applied to the matched segment.</dd></div>
          <div><dt>V, C</dt><dd>Any vowel or consonant in the charted ancestry.</dd></div>
          <div><dt>[+f], [−f]</dt><dd>A feature bundle used to select sounds: <code>[+nasal]</code>, <code>[−voice]</code>, <code>[+syllabic +round]</code>. Features come from IPA symbols, never chart labels, so custom sounds need an override in the Features panel. Bare <code>[back]</code> keeps its chart-class meaning.</dd></div>
          <div><dt>[αf]</dt><dd>An α-variable that copies a feature value from the environment, as in <code>[αplace]</code>. Use β for a second independent variable.</dd></div>
          <div><dt>N, G, …</dt><dd>A category defined in this language's Phonotactics tab. It stands for its member sounds in the input and environment, including inside sets like <code>[N s]</code>.</dd></div>
          <div><dt>[…] set</dt><dd>On the input or in the environment, bracketed sets still select sounds. On the output side the outer brackets are read as surface notation unless the content is a feature bundle.</dd></div>
          <div><dt>#</dt><dd>Word boundary in an environment.</dd></div>
          <div><dt>_</dt><dd>Marks where the input sits in the environment.</dd></div>
          <div><dt>∅, 0</dt><dd>Zero: deletion on the output side, insertion on the input side.</dd></div>
          <div><dt>Repeat until stable</dt><dd>Apply the rule again to its own output until a pass changes nothing. The default cap is 12 passes; a rule that is still changing at the cap stops there and reports a runaway warning.</dd></div>
          <div><dt>Domain</dt><dd><em>Adjacent</em> matches only touching segments. <em>Across word</em> lets each environment atom match across intervening segments anywhere in the word; <em>Within syllable</em> does the same but stops at the target's syllable edges. Domains are most useful with repeating harmony rules.</dd></div>
        </dl>
        <p class="help-foot">Precedence inside brackets is literal sound, then category, then chart class, then feature bundle. Feature changes are deltas: they resolve against the current generation’s chart first, then fall back to a synthesized surface symbol from the curated IPA table and its documented diacritics. If neither can spell the result, the rule stops and the derivation reports the nearest charted candidates. An α-variable copies one feature, not the whole segment, and an α-rule is total: if a trigger binds a value the target cannot realize, the derivation stops — restrict the trigger set when that can happen. Rules run in list order; each applies once unless <strong>Repeat until stable</strong> is on, in which case it runs to a fixed point and the tester shows how many passes it took. A repeat rule that still changes the form at its limit stops and warns instead of looping forever. <strong>Domain</strong> controls whether the environment may skip segments: adjacent only by default, or across the word / within the target's syllable when selected. Groups are visual only: <strong>Group rules</strong> selects adjacent rules, <strong>Group selected</strong> wraps them in a numbered container (2.1, 2.2, …), and the engine still applies every rule in the same flattened order. A group switch turns off its rules together without changing their individual switches. Allophony is synchronic: it applies to this language's recorded phonemic forms and is not part of the historical derivation or the cognate chain. It is copied to a daughter as a starting grammar, just like the inventory and phonotactics. Categories are read from this language's Phonotactics tab.</p>
      </div>
    </details>`;
}

function allophonyStepsMarkup(steps) {
  const visible = (steps || []).filter(
    (step) => step.changed || step.error || step.excepted || step.optionalSkipped
  );
  if (!visible.length) {
    return `<p class="derivation-empty">No allophony rule changes this form — the surface stays identical.</p>`;
  }
  return visible
    .map((step) => {
      if (step.error) {
        return `
          <div class="derivation-step is-error">
            <span class="step-index">${esc(step.label)}</span>
            <div class="step-body">
              <div class="step-rule"><code>${esc(step.rule?.notation || "")}</code></div>
              <div class="step-error">${esc(step.error)}</div>
            </div>
          </div>`;
      }
      return `
        <div class="derivation-step ${step.changed ? "is-changed" : ""} ${step.excepted ? "is-excepted" : ""} ${step.optionalSkipped ? "is-optional-skipped" : ""} ${step.warning ? "has-warning" : ""}">
          <span class="step-index">${esc(step.label)}</span>
          <div class="step-body">
            <div class="step-rule">
              <code>${esc(step.rule?.notation || "")}</code>
              ${
                step.optionalSkipped
                  ? `<span class="step-badge step-badge-optional">optional${step.rule?.rate != null ? ` ${normalizeRuleRate(step.rule.rate)}%` : ""} skipped</span>`
                  : step.excepted
                    ? `<span class="step-badge">lexical exception</span>`
                    : step.optional
                      ? `<span class="step-badge step-badge-optional">optional${step.rule?.rate != null ? ` ${normalizeRuleRate(step.rule.rate)}%` : ""}</span>`
                      : step.iterative && step.passes
                        ? `<span class="step-badge">${esc(`${step.passes} ${step.passes === 1 ? "pass" : "passes"}`)}</span>`
                        : ""
              }
            </div>
            <div class="step-form">
              <code class="ipa">${esc(formatPhonemic(step.before.join("")))}</code>
              <span class="step-arrow">→</span>
              <code class="ipa">${esc(formatPhonetic(step.after.join("")))}</code>
            </div>
            ${
              step.warning
                ? `<div class="step-warning">${icon("warning")}<span>${esc(step.warning)}</span></div>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");
}

export function renderAllophony(container, ctx) {
  const language = ctx.language;
  const context = contextForAllophony(ctx.project, language.id);
  const table = allophoneTable(ctx.project, language.id);
  const optionalRules = optionalAllophonyRules(compileAllophonyRules(language.allophony, context));
  const parent = ancestorsOf(ctx.project, language.id).at(-1);
  const exceptionSuggestions = [
    ...new Set(
      [...ancestorsOf(ctx.project, language.id), language].flatMap((item) =>
        item.vocabulary.map((word) => word.gloss.trim()).filter(Boolean)
      )
    ),
  ].sort((left, right) => left.localeCompare(right));

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro changes-intro">
        <div>
          <p class="eyebrow">Phonology</p>
          <h2>Allophony</h2>
          <p class="section-copy">Synchronic rules that turn this language's phonemes into surface allophones. They apply to recorded forms and derived reflexes, but they are not historical changes: a daughter does not run its parent's allophony as part of its derivation.${parent ? ` They start as a copy of ${esc(parent.name)}'s allophony when you create a daughter.` : ""}</p>
          <div class="lineage-inline"><span class="phonemic-note">Input <code>/…/</code></span><span class="lineage-arrow">${icon("chevronRight")}</span><span class="phonemic-note">Output <code>[ … ]</code></span></div>
        </div>
        <div class="inventory-summary">
          <span><strong data-allo-active>${activeAllophonyCount(language)}</strong> active</span>
          <span><strong data-allo-total>${table.rows.length}</strong> <span data-allo-total-label>allophone${table.rows.length === 1 ? "" : "s"}</span></span>
        </div>
      </section>

      <div class="changes-layout">
        <div class="changes-main">
          <section class="panel rules-panel" data-allo-rules-panel>
            <header class="panel-head">
              <div class="panel-title">
                <h2>Rules</h2>
                <p>Applied in list order; each runs once unless it repeats. Groups are organizational only.</p>
              </div>
              <div class="panel-actions">
                <button class="button button-quiet button-small" type="button" data-allo-select-mode>${icon("check")}Group rules</button>
                <button class="button button-quiet button-small" type="button" data-add-allo-group>${icon("plus")}New group</button>
                <button class="button button-primary button-small" type="button" data-add-allo-rule>${icon("plus")}Add rule</button>
              </div>
            </header>
            <div class="allo-select-bar" data-allo-select-bar>
              <span><strong data-allo-select-count>0</strong> selected</span>
              <button class="button button-primary button-small" type="button" data-allo-group-selected disabled>Group selected</button>
              <button class="button button-quiet button-small" type="button" data-allo-select-cancel>Cancel</button>
            </div>
            ${rulesMarkup(language, context, exceptionSuggestions)}
          </section>

          <section class="panel" data-allo-table-panel>
            <header class="panel-head">
              <div class="panel-title">
                <h2>Allophones</h2>
                <p>The phoneme → surface mapping currently in force.</p>
              </div>
            </header>
            ${allophoneTableMarkup(table)}
          </section>
        </div>
        <aside class="changes-aside">
          ${testPanelMarkup(language, optionalRules)}
          ${notationHelpMarkup()}
        </aside>
      </div>
    </div>
  `;

  const testPanel = container.querySelector("[data-allo-test-panel]");
  const testInput = testPanel?.querySelector("[data-allo-test-input]");
  const tablePanel = container.querySelector("[data-allo-table-panel]");
  let testGloss = language.vocabulary.find((word) => word.form.trim())?.gloss || "";
  let testOptional = new Set(
    [...(alloTesterOptionalMemory.get(language.id) || [])].filter((id) =>
      optionalRules.some((rule) => rule.id === id)
    )
  );
  alloTesterOptionalMemory.set(language.id, new Set(testOptional));

  const runTest = () => {
    if (!testPanel || !testInput) return;
    const result = surfaceForForm(stripLevelMarks(testInput.value), ctx.project, language.id, {
      gloss: testGloss,
      optionalRuleIds: [...testOptional],
    });
    const phonemic = testPanel.querySelector("[data-allo-phonemic]");
    const surface = testPanel.querySelector("[data-allo-surface]");
    const parsed = testPanel.querySelector("[data-allo-parsed]");
    const steps = testPanel.querySelector("[data-allo-steps]");
    const inputText = result.input.join("");
    const outputText = result.errors.length ? "" : result.display;
    if (phonemic) phonemic.textContent = inputText ? formatPhonemic(inputText) : "—";
    if (surface) surface.textContent = outputText ? formatPhonetic(outputText) : "—";
    if (parsed) {
      parsed.innerHTML = result.input.length
        ? `<span>Read as</span> ${result.input.map((token) => `<code>${esc(token)}</code>`).join(" ")}`
        : `<span>Type a form to test.</span>`;
    }
    if (steps) steps.innerHTML = allophonyStepsMarkup(result.steps);
  };

  const refreshStats = (next) => {
    const active = container.querySelector("[data-allo-active]");
    const total = container.querySelector("[data-allo-total]");
    const label = container.querySelector("[data-allo-total-label]");
    if (active) active.textContent = String(activeAllophonyCount(language));
    if (total) total.textContent = String(next.rows.length);
    if (label) label.textContent = next.rows.length === 1 ? "allophone" : "allophones";
  };

  const refreshTable = () => {
    if (!tablePanel) return null;
    const next = allophoneTable(ctx.project, language.id);
    tablePanel.innerHTML = `
      <header class="panel-head">
        <div class="panel-title">
          <h2>Allophones</h2>
          <p>The phoneme → surface mapping currently in force.</p>
        </div>
      </header>
      ${allophoneTableMarkup(next)}`;
    refreshStats(next);
    return next;
  };

  const rulesPanel = container.querySelector("[data-allo-rules-panel]");
  const selectBar = container.querySelector("[data-allo-select-bar]");
  const selectCount = container.querySelector("[data-allo-select-count]");
  const groupSelectedButton = container.querySelector("[data-allo-group-selected]");
  const selectModeButton = container.querySelector("[data-allo-select-mode]");
  const selectedRules = new Set();

  const updateSelection = () => {
    if (selectCount) selectCount.textContent = String(selectedRules.size);
    if (groupSelectedButton) groupSelectedButton.disabled = selectedRules.size === 0;
    rulesPanel?.querySelectorAll("[data-allo-rule-select]").forEach((input) => {
      input.closest(".rule-card")?.classList.toggle("is-selected", input.checked);
    });
  };

  const setSelecting = (active) => {
    rulesPanel?.classList.toggle("is-selecting", active);
    selectBar?.classList.toggle("is-active", active);
    if (!active) {
      selectedRules.clear();
      rulesPanel?.querySelectorAll("[data-allo-rule-select]").forEach((input) => {
        input.checked = false;
      });
    }
    updateSelection();
  };

  selectModeButton?.addEventListener("click", () => {
    setSelecting(!rulesPanel?.classList.contains("is-selecting"));
  });
  container.querySelector("[data-allo-select-cancel]")?.addEventListener("click", () => setSelecting(false));
  groupSelectedButton?.addEventListener("click", () => {
    if (!selectedRules.size) return;
    const result = groupAllophonyRules(language, selectedRules);
    if (result === "noncontiguous") {
      toast("Select adjacent rules to group them without changing their order.", { type: "error" });
      return;
    }
    if (result === "inside") {
      toast("Cannot group rules from the middle of an existing group. Ungroup it first, or include the rules on one side.", { type: "error" });
      return;
    }
    if (result !== "ok") return;
    ctx.touch({ label: "Group allophony rules" });
    ctx.refresh();
  });

  container.querySelectorAll("[data-add-allo-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = {
        id: uid("allogroup"),
        type: "group",
        name: "",
        collapsed: false,
        enabled: true,
        rules: [],
      };
      language.allophony.push(group);
      ctx.touch({ label: "Add allophony group" });
      ctx.refresh();
      window.setTimeout(() => {
        document.querySelector(`[data-allo-group-id="${CSS.escape(group.id)}"] .allo-group-name`)?.focus();
      }, 0);
    });
  });

  container.querySelectorAll("[data-add-allo-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = {
        id: uid("allo"),
        notation: "",
        note: "",
        enabled: true,
        optional: false,
        rate: DEFAULT_RULE_RATE,
        iterative: false,
        repeatLimit: ALLOPHONY_REPEAT_LIMIT,
        domain: "adjacent",
        exceptions: [],
      };
      language.allophony.push(rule);
      ctx.touch({ label: "Add allophony rule" });
      ctx.refresh();
      window.setTimeout(() => {
        document.querySelector(`[data-allo-rule-id="${CSS.escape(rule.id)}"] .rule-input`)?.focus();
      }, 0);
    });
  });

  container.querySelectorAll("[data-allo-group-id]").forEach((card) => {
    const group = language.allophony.find((item) => isAllophonyGroup(item) && item.id === card.dataset.alloGroupId);
    if (!group) return;
    const name = card.querySelector(".allo-group-name");
    const toggle = card.querySelector("[data-allo-group-toggle]");

    name?.addEventListener("input", () => {
      group.name = name.value;
      ctx.touch({ label: "Rename allophony group" });
    });
    card.querySelector("[data-allo-group-collapse]")?.addEventListener("click", () => {
      group.collapsed = !group.collapsed;
      ctx.touch({ label: group.collapsed ? "Collapse allophony group" : "Expand allophony group" });
      ctx.refresh();
    });
    toggle?.addEventListener("change", () => {
      group.enabled = toggle.checked;
      ctx.touch({ label: group.enabled ? "Enable allophony group" : "Disable allophony group" });
      ctx.refresh();
    });

    card.querySelectorAll("[data-allo-group-add]").forEach((button) => {
      button.addEventListener("click", () => {
        const rule = {
          id: uid("allo"),
          notation: "",
          note: "",
          enabled: true,
          optional: false,
          rate: DEFAULT_RULE_RATE,
          iterative: false,
          repeatLimit: ALLOPHONY_REPEAT_LIMIT,
          domain: "adjacent",
          exceptions: [],
        };
        group.rules.push(rule);
        group.collapsed = false;
        ctx.touch({ label: "Add allophony rule" });
        ctx.refresh();
        window.setTimeout(() => {
          document.querySelector(`[data-allo-rule-id="${CSS.escape(rule.id)}"] .rule-input`)?.focus();
        }, 0);
      });
    });

    card.querySelector("[data-allo-group-up]")?.addEventListener("click", () => {
      const index = language.allophony.indexOf(group);
      if (index <= 0) return;
      [language.allophony[index - 1], language.allophony[index]] = [
        language.allophony[index],
        language.allophony[index - 1],
      ];
      ctx.touch({ label: "Move allophony group" });
      ctx.refresh();
    });
    card.querySelector("[data-allo-group-down]")?.addEventListener("click", () => {
      const index = language.allophony.indexOf(group);
      if (index < 0 || index >= language.allophony.length - 1) return;
      [language.allophony[index], language.allophony[index + 1]] = [
        language.allophony[index + 1],
        language.allophony[index],
      ];
      ctx.touch({ label: "Move allophony group" });
      ctx.refresh();
    });

    card.querySelector("[data-allo-group-ungroup]")?.addEventListener("click", () => {
      const index = language.allophony.indexOf(group);
      if (index < 0) return;
      const rules = [...group.rules];
      language.allophony.splice(index, 1, ...rules);
      ctx.touch({ label: rules.length ? "Ungroup allophony rules" : "Remove allophony group" });
      ctx.refresh();
      toast(
        rules.length
          ? `Group removed; ${rules.length} ${rules.length === 1 ? "rule" : "rules"} kept.`
          : "Empty group removed.",
        {
          type: "info",
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => {
              const current = findLanguage(ctx.project, language.id);
              if (!current || !restoreUngroupedAllophonyRules(current, group, index, rules)) return;
              ctx.touch({ label: "Restore allophony group" });
              ctx.refresh();
            },
          },
        }
      );
    });
    card.querySelector("[data-allo-group-delete]")?.addEventListener("click", () => {
      const index = language.allophony.indexOf(group);
      if (index < 0) return;
      const count = group.rules.length;
      const [removed] = language.allophony.splice(index, 1);
      ctx.touch({ label: "Delete allophony group" });
      ctx.refresh();
      toast(
        count
          ? `Group and ${count} ${count === 1 ? "rule" : "rules"} deleted.`
          : "Empty group deleted.",
        {
          type: "info",
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => {
              const current = findLanguage(ctx.project, language.id);
              if (!current || !restoreAllophonyGroup(current, removed, index)) return;
              ctx.touch({ label: "Restore allophony group" });
              ctx.refresh();
            },
          },
        }
      );
    });
  });

  container.querySelectorAll("[data-allo-rule-id]").forEach((card) => {
    const rule = allophonyRules(language.allophony).find((item) => item.id === card.dataset.alloRuleId);
    if (!rule) return;
    const parentGroup = language.allophony.find((item) => isAllophonyGroup(item) && item.rules.includes(rule)) || null;
    const parentDisabled = parentGroup?.enabled === false;
    const notation = card.querySelector(".rule-input");
    const note = card.querySelector(".rule-note-input");
    const toggle = card.querySelector("[data-allo-rule-toggle]");
    const status = card.querySelector("[data-allo-rule-status]");
    const selector = card.querySelector("[data-allo-rule-select]");
    const iterativeInput = card.querySelector("[data-allo-rule-iterative]");
    const domainInput = card.querySelector("[data-allo-rule-domain]");
    const limitInput = card.querySelector("[data-allo-rule-limit]");
    const optionalInput = card.querySelector("[data-allo-rule-optional]");
    const rateInput = card.querySelector("[data-allo-rule-rate]");

    selector?.addEventListener("change", () => {
      if (selector.checked) selectedRules.add(rule.id);
      else selectedRules.delete(rule.id);
      updateSelection();
    });

    notation.addEventListener("input", () => {
      rule.notation = notation.value;
      ctx.touch({ label: "Edit allophony rule", coalesceKey: rule.id });
      const next = parentDisabled
        ? { kind: "off", label: "Group disabled" }
        : statusFor(rule, contextForAllophony(ctx.project, language.id));
      status.className = `rule-status status-${next.kind}`;
      status.innerHTML = statusMarkup(next);
      status.title = next.label;
      runTest();
      refreshTable();
    });
    note.addEventListener("input", () => {
      rule.note = note.value;
      ctx.touch({ label: "Edit allophony note", coalesceKey: rule.id });
    });
    const exceptionsInput = card.querySelector(".rule-exception-input");
    const exceptionCount = card.querySelector("[data-allo-rule-exception-count]");
    exceptionsInput?.addEventListener("input", () => {
      rule.exceptions = normalizeRuleExceptions(exceptionsInput.value.split(","));
      if (exceptionCount) exceptionCount.textContent = exceptionSummary(rule.exceptions);
      ctx.touch({ label: "Edit allophony rule exceptions", coalesceKey: rule.id });
      runTest();
      refreshTable();
    });
    iterativeInput?.addEventListener("change", () => {
      rule.iterative = iterativeInput.checked;
      if (limitInput) limitInput.disabled = !iterativeInput.checked;
      ctx.touch({
        label: rule.iterative ? "Repeat allophony until stable" : "Apply allophony once",
        coalesceKey: rule.id,
      });
      runTest();
    });
    domainInput?.addEventListener("change", () => {
      rule.domain = normalizeAllophonyDomain(domainInput.value);
      ctx.touch({ label: "Change allophony domain", coalesceKey: rule.id });
      runTest();
      refreshTable();
    });
    limitInput?.addEventListener("change", () => {
      rule.repeatLimit = normalizeAllophonyRepeatLimit(limitInput.value);
      limitInput.value = String(rule.repeatLimit);
      ctx.touch({ label: "Change allophony pass limit", coalesceKey: rule.id });
      runTest();
    });
    optionalInput?.addEventListener("change", () => {
      rule.optional = optionalInput.checked;
      rule.rate = normalizeRuleRate(rule.rate);
      ctx.touch({ label: rule.optional ? "Mark allophony rule optional" : "Make allophony rule mandatory" });
      // Re-render so the badge, picker, and allophone table stay in sync.
      ctx.refresh();
    });
    rateInput?.addEventListener("change", () => {
      rule.rate = normalizeRuleRate(rateInput.value);
      rateInput.value = String(rule.rate);
      ctx.touch({ label: "Change optional allophony rate", coalesceKey: rule.id });
      runTest();
    });
    toggle.addEventListener("change", () => {
      rule.enabled = toggle.checked;
      ctx.touch({
        label: rule.enabled ? "Enable allophony rule" : "Disable allophony rule",
        coalesceKey: rule.id,
      });
      ctx.refresh();
    });

    card.querySelector("[data-allo-rule-up]")?.addEventListener("click", () => {
      const collection = parentGroup ? parentGroup.rules : language.allophony;
      const index = collection.indexOf(rule);
      if (index <= 0) return;
      [collection[index - 1], collection[index]] = [collection[index], collection[index - 1]];
      ctx.touch({ label: "Move allophony rule", coalesceKey: rule.id });
      ctx.refresh();
    });
    card.querySelector("[data-allo-rule-down]")?.addEventListener("click", () => {
      const collection = parentGroup ? parentGroup.rules : language.allophony;
      const index = collection.indexOf(rule);
      if (index < 0 || index >= collection.length - 1) return;
      [collection[index], collection[index + 1]] = [collection[index + 1], collection[index]];
      ctx.touch({ label: "Move allophony rule", coalesceKey: rule.id });
      ctx.refresh();
    });
    card.querySelector("[data-allo-rule-delete]")?.addEventListener("click", () => {
      const collection = parentGroup ? parentGroup.rules : language.allophony;
      const index = collection.indexOf(rule);
      if (index < 0) return;
      const [removed] = collection.splice(index, 1);
      ctx.touch({ label: "Delete allophony rule", coalesceKey: rule.id });
      ctx.refresh();
      toast("Allophony rule deleted.", {
        type: "info",
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            const current = findLanguage(ctx.project, language.id);
            if (!current || !restoreAllophonyRule(current, removed, parentGroup, index)) return;
            ctx.touch({ label: "Restore allophony rule", coalesceKey: removed.id });
            ctx.refresh();
          },
        },
      });
    });
  });

  if (testInput) {
    testInput.addEventListener("input", () => {
      testGloss = "";
      runTest();
    });
    testInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runTest();
      }
    });
    testPanel.querySelectorAll("[data-allo-test-word]").forEach((button) => {
      button.addEventListener("click", () => {
        testInput.value = button.dataset.alloTestWord;
        testGloss = button.dataset.alloTestGloss || "";
        runTest();
        testInput.focus();
      });
    });
    testPanel.querySelectorAll("[data-allo-test-optional]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) testOptional.add(input.dataset.alloTestOptional);
        else testOptional.delete(input.dataset.alloTestOptional);
        alloTesterOptionalMemory.set(language.id, new Set(testOptional));
        runTest();
      });
    });
    runTest();
  }
}
