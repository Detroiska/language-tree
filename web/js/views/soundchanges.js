import {
  DEFAULT_RULE_RATE,
  ancestorsOf,
  findLanguage,
  getLineage,
  languageStats,
  normalizeRuleDate,
  normalizeRuleExceptions,
  normalizeRuleRate,
  ruleGroups,
  uid,
} from "../model.js";
import {
  compileRule,
  compileRuleStages,
  contextForLanguage,
  deriveForm,
  deriveStages,
  exceptionRulesFromSteps,
  hasSurfaceDisplay,
  optionalRulesInStages,
  optionalSkippedRulesFromSteps,
  surfaceForForm,
} from "../phonology.js";
import { formatPhonemic, formatPhonetic, joinSegments, sameForm } from "../notation.js";
import { derivationStepsMarkup, optionalRulesPickerMarkup } from "../derivation.js";
import { diffPairMarkup } from "../diff.js";
import { reconstructForm, reconstructionAlternatives } from "../reconstruction.js";
import {
  exceptionSummary,
  exceptionSuggestionsMarkup as sharedExceptionSuggestionsMarkup,
  exceptionsMarkup as sharedExceptionsMarkup,
  ruleStatusFor,
  statusMarkup,
} from "../ruleEditor.js";
import { debounce, esc, icon, openModal, toast } from "../ui.js";
// Curated attested rule groups offered in the Rule library modal; the data
// module also builds the disabled draft records the insert button pushes.
import { soundChangeLibrary, newLibraryRules, normalizeLibraryNotation } from "../soundlaws.js";

// The tester input is re-created on every view render (which edits trigger),
// so the typed form is remembered per language — otherwise adding a rule or
// recording a word wipes what was being tested.
const testerMemory = new Map();
// Optional rules are view-only variants: remember the ticked ids per language
// so editing a rule does not clear the variant being explored.
const testerOptionalMemory = new Map();
// The inherited check can either follow the primary path or include every
// optional rule; the choice is remembered per language.
const checkOptionalMemory = new Map();
// The reconstruction field is remembered for the same reason. The value is
// `{ form, gloss }` so a selected vocabulary item keeps its gloss across
// re-renders and the parent-lexicon check can use it.
const reconstructionMemory = new Map();

function compileDirect(ctx) {
  const context = contextForLanguage(ctx.project, ctx.language.id);
  return { context, groups: compileRuleStages(ctx.language.soundChanges, context) };
}

function directDerivation(ctx, form, gloss = "", optionalRuleIds = []) {
  const { context, groups } = compileDirect(ctx);
  const parsed = context.tokenizeWithStress(form);
  const tokens = parsed.tokens;
  const result = deriveStages(tokens, [{ language: ctx.language, groups }], context, {
    gloss,
    junctures: parsed.junctures,
    optionalRuleIds,
  });
  const phonemic = joinSegments(result.tokens, result.junctures);
  const surface = result.errors.length
    ? null
    : surfaceForForm(phonemic, ctx.project, ctx.language.id, { gloss });
  return {
    inputTokens: tokens,
    outputTokens: result.tokens,
    steps: result.steps,
    text: phonemic,
    surface: surface?.errors.length ? null : surface?.display || "",
    surfaceError: surface?.errors[0] || "",
    errors: result.errors,
    fatal: result.fatal,
  };
}

function statusFor(rule, context) {
  // A warning keeps the rule usable — the user may be mid-edit — while making
  // an inert rule (for example compact “CV > x” letter literals) visible.
  return ruleStatusFor(rule, (notation) => compileRule(notation, context));
}

function exceptionsMarkup(rule) {
  return sharedExceptionsMarkup(rule, {
    countAttribute: "data-rule-exception-count",
    listId: "rule-exception-glosses",
  });
}

function exceptionSuggestionsMarkup(suggestions) {
  return sharedExceptionSuggestionsMarkup(suggestions, "rule-exception-glosses");
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
  const rate = normalizeRuleRate(rule.rate);
  return `
    <article class="rule-card ${isChild ? "is-child" : ""} ${rule.optional ? "is-optional" : ""} ${disabled ? "is-disabled" : ""}" data-rule-id="${esc(rule.id)}">
      <div class="rule-number ${isChild ? "is-dotted" : ""}">${esc(number)}</div>
      <div class="rule-body">
        <div class="rule-notation-row">
          <input class="rule-input" type="text" value="${esc(rule.notation)}" placeholder="p > f / V _ V" autocomplete="off" spellcheck="false" aria-label="Sound change notation">
          ${rule.optional ? `<span class="rule-optional-badge" title="Optional changes are skipped in the primary derivation">optional ${rate}%</span>` : ""}
          <span class="rule-status status-${status.kind}" data-rule-status title="${esc(status.label)}">${statusMarkup(status)}</span>
        </div>
        <input class="rule-note-input" type="text" value="${esc(rule.note)}" placeholder="Optional description, e.g. Verner’s law" autocomplete="off" aria-label="Rule note">
        <div class="rule-options">
          <label class="rule-option" title="Skip this rule in the primary derivation; include it in a variant when needed">
            <input type="checkbox" data-rule-optional ${rule.optional ? "checked" : ""}>
            <span>Optional</span>
          </label>
          <label class="rule-option" title="Descriptive likelihood; derivations stay deterministic">
            <span class="rule-option-label">Rate</span>
            <input class="rule-limit-input rule-rate-input" type="number" data-rule-rate min="0" max="100" step="5" value="${rate}" ${rule.optional ? "" : "disabled"}>
            <span>%</span>
          </label>
          <label class="rule-option" title="Relative stage shown in the Timeline view; derivation never reads it">
            <span class="rule-option-label">Stage</span>
            <input class="rule-limit-input rule-stage-input" type="number" data-rule-stage step="1" value="${rule.date ?? ""}" title="Relative stage (documentation only)" aria-label="Relative stage (documentation only)">
          </label>
        </div>
        ${exceptionsMarkup(rule)}
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

function rulesMarkup(language, context, exceptionSuggestions = []) {
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
    ${exceptionSuggestionsMarkup(exceptionSuggestions)}
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

function testPanelMarkup(ctx, optionalRules = []) {
  const lineage = getLineage(ctx.project, ctx.language.id);
  const parent = lineage.length > 1 ? lineage[lineage.length - 2] : null;
  const suggestions = parent?.vocabulary.filter((word) => word.form.trim()).slice(0, 4) || [];
  const selectedOptional = testerOptionalMemory.get(ctx.language.id) || new Set();
  const remembered = testerMemory.get(ctx.language.id);
  const initialValue =
    (typeof remembered === "string" ? remembered : remembered?.form) ??
    (parent?.vocabulary.find((word) => word.form.trim())?.form || "");
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
              <input class="input ipa-input" id="test-word" data-test-input value="${esc(initialValue)}" placeholder="e.g. kasa" autocomplete="off" spellcheck="false">
              ${suggestions.length ? `<div class="word-suggestions">${suggestions.map((word) => `<button class="word-suggestion" type="button" data-test-word="${esc(word.form)}" data-test-gloss="${esc(word.gloss)}" title="Test with the gloss “${esc(word.gloss)}”">${esc(word.form)}<span>${esc(word.gloss)}</span></button>`).join("")}</div>` : ""}
            </div>
            ${optionalRulesPickerMarkup(optionalRules, selectedOptional, "data-test-optional")}
            <div class="derivation" data-derivation>
              <div class="derivation-output-row">
                <span class="derivation-label">Phonemic</span>
                <output class="derivation-output ipa" data-test-output>—</output>
              </div>
              <div class="derivation-output-row" data-test-surface-row ${hasSurfaceDisplay(ctx.language) ? "" : "hidden"}>
                <span class="derivation-label">Surface</span>
                <output class="derivation-output ipa allo-surface-output" data-test-surface>—</output>
              </div>
              <div class="derivation-parsed" data-test-parsed></div>
              <div class="derivation-steps" data-test-steps></div>
              <div class="tester-conflict" data-test-conflict hidden></div>
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

function reconstructPanelMarkup(ctx) {
  const lineage = getLineage(ctx.project, ctx.language.id);
  const parent = lineage.length > 1 ? lineage[lineage.length - 2] : null;
  const suggestions = ctx.language.vocabulary.filter((word) => word.form.trim()).slice(0, 4);
  const remembered = reconstructionMemory.get(ctx.language.id);
  const initialValue = remembered?.form ?? (suggestions[0]?.form || "");
  return `
    <section class="panel test-panel reconstruct-panel" data-reconstruct-panel>
      <header class="panel-head">
        <div class="panel-title">
          <h2>Reconstruction</h2>
          <p>${parent ? `Invert these rules to propose the ${esc(parent.name)} form.` : "A root language has no ancestor to reconstruct."}</p>
        </div>
        <span class="panel-icon">${icon("refresh")}</span>
      </header>
      ${
        parent
          ? `
            <div class="test-input-wrap">
              <label class="field-label" for="reconstruct-word">Daughter form <span class="field-optional">${esc(ctx.language.name)}</span></label>
              <input class="input ipa-input" id="reconstruct-word" data-reconstruct-input value="${esc(initialValue)}" placeholder="e.g. kasa" autocomplete="off" spellcheck="false">
              ${suggestions.length ? `<div class="word-suggestions">${suggestions.map((word) => `<button class="word-suggestion" type="button" data-reconstruct-word="${esc(word.form)}" data-reconstruct-gloss="${esc(word.gloss)}" title="${esc(word.gloss)}">${esc(word.form)}<span>${esc(word.gloss)}</span></button>`).join("")}</div>` : ""}
            </div>
            <div class="derivation" data-reconstruct>
              <div class="derivation-output-row">
                <span class="derivation-label">${esc(parent.name)}</span>
                <output class="derivation-output ipa reconstruct-output" data-reconstruct-output>—</output>
              </div>
              <div class="derivation-parsed" data-reconstruct-parsed></div>
              <div class="reconstruct-notes" data-reconstruct-notes></div>
            </div>
          `
          : `
            <div class="notice notice-quiet">
              ${icon("info")}
              <p>A root language has no ancestral input, so there are no rules to invert. Reconstruction starts one generation below a root.</p>
            </div>
          `
      }
    </section>`;
}

function renderReconstruction(panel, result) {
  const output = panel.querySelector("[data-reconstruct-output]");
  const parsed = panel.querySelector("[data-reconstruct-parsed]");
  const notes = panel.querySelector("[data-reconstruct-notes]");
  if (!output || !parsed || !notes) return;
  const inputTokens = result.inputTokens || [];

  if (result.reason === "empty") {
    output.textContent = "—";
    parsed.innerHTML = `<span>Type a form to reconstruct.</span>`;
    notes.innerHTML = "";
    return;
  }

  parsed.innerHTML = inputTokens.length
    ? `<span>Read as</span> ${inputTokens.map((token) => `<code>${esc(token)}</code>`).join(" ")}`
    : "";

  if (!result.ok) {
    output.textContent = "—";
    const message =
      result.reason === "no-inverse"
        ? "No exact input produces this form with the current rules. Check the recorded form or the rule environments."
        : "This form could not be reconstructed.";
    notes.innerHTML = `<p class="reconstruct-warning">${icon("warning")}<span>${esc(message)}</span></p>`;
    return;
  }

  const alternatives = reconstructionAlternatives(result);
  output.textContent = alternatives.map((text) => `*${text || "∅"}`).join(" / ") || "—";
  const bits = [];
  const activeRules = result.language
    ? result.language.soundChanges.filter((rule) => rule.enabled !== false).length
    : 0;
  if (!activeRules) {
    bits.push("No sound changes to invert; the form passes through unchanged.");
  } else if (!result.ambiguous && result.unchanged) {
    bits.push("No rule needs to apply; the form can be inherited unchanged.");
  }
  const preferred = result.candidates?.[0];
  if (preferred?.parentMatch === "gloss") {
    bits.push(`Matches the parent’s recorded word for “${preferred.parentGloss}”.`);
  } else if (preferred?.parentMatch === "form") {
    bits.push("Matches a form recorded in the parent language.");
  }
  if (result.ambiguous) {
    bits.push(`${alternatives.length} possible reconstructions; the rules do not distinguish them.`);
    if (result.unchanged) {
      bits.push("One alternative is the daughter form itself, inherited without change.");
    }
  }
  if (result.lossy) {
    bits.push("At least one alternative restores material deleted by a rule; the lost segment is inferred.");
  }
  if (result.truncated) {
    bits.push("The search stopped early, so some alternatives may be missing.");
  }
  if (result.exceptions?.length) {
    bits.push(
      `Not inverted for “${result.gloss}”: ${result.exceptions.length === 1 ? "rule" : "rules"} ${result.exceptions.join(", ")} ${
        result.exceptions.length === 1 ? "is a lexical exception" : "are lexical exceptions"
      }.`
    );
  }
  if (result.optional?.length) {
    bits.push(
      `${result.optional.length} optional ${result.optional.length === 1 ? "change is" : "changes are"} treated as possible: ${
        result.optional.length === 1 ? "it may or may not" : "they may or may not"
      } have applied.`
    );
  }
  const warnings = (result.warnings || []).slice(0, 2);
  notes.innerHTML = [
    ...bits.map((bit) => `<p class="reconstruct-note">${icon("info")}<span>${esc(bit)}</span></p>`),
    ...warnings.map((warning) => `<p class="reconstruct-warning">${icon("warning")}<span>${esc(warning)}</span></p>`),
  ].join("");
}

function notationHelpMarkup() {
  return `
    <details class="panel help-panel">
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
          <li><code>[+nasal] &gt; ∅ / _ #</code><span>Delete final nasals — a feature bundle read from the IPA feature table.</span></li>
          <li><code>N &gt; ∅ / _ #</code><span>Delete a final member of the N category — categories come from Phonotactics.</span></li>
          <li><code>C &gt; ∅ / _ C</code><span>Delete a consonant before another consonant.</span></li>
          <li><code>∅ &gt; ʔ / V _ V</code><span>Insert a glottal stop between vowels.</span></li>
          <li><code>t &gt; [+voice] / V _ V</code><span>Voice t between vowels. The result must exist in this generation’s chart.</span></li>
          <li><code>n &gt; [αplace] / _ [αplace]</code><span>Copy the following consonant’s place: n becomes ŋ before k, ɲ before c, and so on.</span></li>
          <li><code>V &gt; [αround] / [αround] _</code><span>Spread rounding rightward; α is bound by the segment on the left.</span></li>
          <li><code>C V &gt; V C</code><span>Metathesis: an output word that names a class echoes the segment the input matched, so each pair swaps.</span></li>
          <li><code>V &gt; Vː / _ #</code><span>Lengthen final vowels — an echo may carry a glued diacritic, and the copy stays one token.</span></li>
        </ul>
        <dl class="help-terms">
          <div><dt>V, C</dt><dd>Any vowel or consonant in the language’s inventory.</dd></div>
          <div><dt>[…]</dt><dd>A set of sounds; <code>[^…]</code> negates it. Items may be sounds, categories, chart classes, or a feature bundle as separate words.</dd></div>
          <div><dt>[+f], [−f]</dt><dd>A feature bundle: <code>[+nasal]</code>, <code>[−voice]</code>, <code>[+syllabic +round]</code>. Features come from IPA symbols, not chart labels. Bare <code>[back]</code> keeps its chart-class meaning; write <code>[+back]</code> to force the feature.</dd></div>
          <div><dt>[αf]</dt><dd>An α-variable. It binds to the matching feature of a segment in the input or environment, then copies that one feature value into the output, as in <code>n &gt; [αplace] / _ [αplace]</code>. It does not copy the whole segment. Use β for a second independent variable.</dd></div>
          <div><dt>N, G, …</dt><dd>A category defined in this language’s Phonotactics tab, such as <code>N</code> for nasals. It stands for its member sounds in the input and environment, including inside sets like <code>[N s]</code>.</dd></div>
          <div><dt>echo (V in the output)</dt><dd>In the output, a class word (<code>V</code>, <code>C</code>), category, or chart class copies the segment matched by the k-th input atom of that kind: <code>C V &gt; V C</code> metathesizes every consonant-vowel pair, <code>a i &gt; i a</code> exchanges two vowels. A glued diacritic travels with the copy (<code>V &gt; Vː</code>), and segments the output never echoes are deleted. Insertions cannot echo, and a rule that echoes every match back into its own place is rejected as a change of nothing.</dd></div>
          <div><dt>plosive.plain</dt><dd>A chart class: dotted labels read straight from the Phonology charts, on their own or inside sets. A sound belongs when every label applies on each axis that has it — write <code>back</code>, <code>V.back</code>, or dotted paths like <code>plosive.velar</code>; pin via <code>V.</code> / <code>C.</code>.</dd></div>
          <div><dt>#</dt><dd>Word boundary in an environment.</dd></div>
          <div><dt>_</dt><dd>Marks where the input sits in the environment.</dd></div>
          <div><dt>∅, 0</dt><dd>Zero: deletion on the output side, insertion on the input side.</dd></div>
        </dl>
        <p class="help-foot">Precedence inside brackets is literal sound, then category, then chart class, then feature bundle. A bracketed output that contains signs is a feature change, not a surface symbol: it is applied as a delta to the matched segment and must resolve to a sound in the current chart, or the rule stops with a suggestion. Sound changes never synthesize off-chart surface symbols; an α-rule is total, so if a trigger binds a value the target cannot realize (for example <code>n &gt; [αplace] / _ [αplace]</code> before glottal <code>h</code>), the derivation stops — restrict the trigger set when that can happen. Outputs may also echo matched segments (see above) to reorder and copy them; insertions still need concrete sounds, since there is nothing to copy. Top-level rules are all checked against the form inherited from the parent, so their order does not change whether they apply. Dotted rules run after that pass, in order, against the changed form. Within one rule, matches are found left to right. Forms are read as IPA, using the sounds in the ancestry’s charts, and chart classes resolve against every chart in that ancestry. Categories are read from this language’s Phonotactics tab.</p>
      </div>
    </details>`;
}

function presentLibraryNotations(language) {
  // Normalized notations already recorded in this language, shared by the
  // panel's counts and the insert handler so they cannot disagree.
  return new Set(
    language.soundChanges.map((rule) => normalizeLibraryNotation(rule.notation)).filter(Boolean)
  );
}

function libraryTriggerMarkup() {
  return `
    <section class="panel help-panel">
      <button class="library-trigger" type="button" data-open-library>
        <span class="panel-icon">${icon("book")}</span>
        <span class="library-trigger-title">Rule library</span>
        <span class="details-chevron">${icon("external")}</span>
      </button>
    </section>`;
}

function libraryGroupsMarkup(language) {
  const present = presentLibraryNotations(language);
  return `
    ${soundChangeLibrary
      .map((group) => {
        const total = group.rules.length;
        const missingCount = group.rules.filter((rule) => !present.has(normalizeLibraryNotation(rule.notation))).length;
        const presentCount = total - missingCount;
        // Only a complete match means the group was already inserted;
        // a partial match offers just the rules that are still missing.
        const insertedTitle =
          presentCount === total
            ? "These notations already appear in this language’s rules."
            : `${presentCount === 1 ? "One of" : `${presentCount} of`} these ${total} notations already appear in this language’s rules — inserting adds the remaining ones.`;
        const insertButton =
          presentCount === total
            ? `<button class="button button-quiet button-small" type="button" data-insert-laws="${esc(group.id)}" disabled title="${esc(insertedTitle)}">Inserted</button>`
            : `<button class="button button-quiet button-small" type="button" data-insert-laws="${esc(group.id)}" title="${esc(insertedTitle)}">${icon("plus")}Insert ${missingCount} ${missingCount === 1 ? "rule" : "rules"}</button>`;
        return `
          <p class="field-label">${esc(group.name)}<span class="field-optional">${esc(group.tag)}</span></p>
          <p class="rule-exception-hint">${esc(group.description)}</p>
          ${insertButton}
          <ul class="help-list">
            ${group.rules
              .map((rule) => `<li><code>${esc(rule.notation)}</code><span>${esc(rule.note)}</span></li>`)
              .join("")}
          </ul>`;
      })
      .join("")}
    <p class="help-foot">Groups insert as disabled rules into this language’s sound changes. They are illustrative, not universal — review each rule against your inventory’s sounds and chart labels before enabling.</p>`;
}

function openRuleLibrary(language, ctx) {
  const languageId = language.id;
  openModal({
    title: "Rule library",
    width: "wide",
    body: `
      <p class="modal-copy library-modal-copy">Illustrative attested changes to insert, review, and adapt.</p>
      <div class="library-modal-body" data-library-body>${libraryGroupsMarkup(language)}</div>`,
    onMount({ root }) {
      const body = root.querySelector("[data-library-body]");
      // The modal and its toasts outlive the view that opened them, so resolve
      // the language at click time instead of mutating the render-time object.
      const currentLanguage = () => findLanguage(ctx.project, languageId);
      function bindInsertButtons() {
        body.querySelectorAll("[data-insert-laws]").forEach((button) => {
          button.addEventListener("click", () => {
            const target = currentLanguage();
            if (!target) return;
            const group = soundChangeLibrary.find((item) => item.id === button.dataset.insertLaws);
            if (!group) return;
            const drafts = newLibraryRules(group, presentLibraryNotations(target));
            if (!drafts.length) return;
            // The block lands at the end of the list; its ids let the undo
            // callback remove exactly these drafts even after other edits.
            target.soundChanges.push(...drafts);
            ctx.touch({ label: "Insert library rules" });
            ctx.refresh();
            refresh();
            toast(`Inserted ${drafts.length} disabled ${drafts.length === 1 ? "rule" : "rules"} from ${group.name}.`, {
              type: "info",
              duration: 6000,
              action: {
                label: "Undo",
                onClick: () => {
                  const current = currentLanguage();
                  if (!current) return;
                  const inserted = new Set(drafts.map((draft) => draft.id));
                  current.soundChanges = current.soundChanges.filter((rule) => !inserted.has(rule.id));
                  ctx.touch({ label: "Remove library rules" });
                  ctx.refresh();
                  if (body.isConnected) refresh();
                },
              },
            });
          });
        });
      }
      function refresh() {
        const target = currentLanguage();
        if (!target) return;
        const scrollTop = body.scrollTop;
        body.innerHTML = libraryGroupsMarkup(target);
        bindInsertButtons();
        body.scrollTop = scrollTop;
      }
      bindInsertButtons();
    },
  });
}

function inheritedPanelMarkup(ctx, optionalRules = []) {
  const includeOptional = checkOptionalMemory.get(ctx.language.id) === true;
  return `
    <section class="panel inherited-panel" data-inherited-panel>
      <header class="panel-head">
        <div class="panel-title">
          <h2>Inherited vocabulary check</h2>
          <p>Compare each ancestral word with the form these rules produce.</p>
        </div>
        ${optionalRules.length ? `<label class="rule-option check-optional-toggle" title="Include every optional sound change in this comparison"><input type="checkbox" data-check-optional ${includeOptional ? "checked" : ""}>Include optional changes (${optionalRules.length})</label>` : ""}
        <span class="check-summary" data-check-summary></span>
      </header>
      <div data-check-body></div>
    </section>`;
}

function checkRows(ctx, context = null, optionalRuleIds = []) {
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
    const derived = deriveForm(word.form, ctx.project, ctx.language.id, {
      directOnly: true,
      gloss: word.gloss,
      optionalRuleIds,
    });
    const recorded = byGloss.get(word.gloss.trim().toLowerCase()) || null;
    const status = derived.error
      ? "error"
      : !recorded?.form.trim()
        ? "missing"
        : sameForm(recorded.form, derived.text)
          ? "match"
          : "differs";
    const surface = derived.error
      ? null
      : surfaceForForm(derived.text, ctx.project, ctx.language.id, { gloss: word.gloss });
    return {
      word,
      derived: derived.error ? "" : derived.text,
      surface: surface?.errors.length ? "" : surface?.display || "",
      recorded,
      status,
      error: derived.error,
      exceptions: exceptionRulesFromSteps(derived.steps),
      skippedOptional: optionalSkippedRulesFromSteps(derived.steps),
      index,
    };
  });
  const matches = rows.filter((row) => row.status === "match").length;
  const recordedCount = rows.filter((row) => row.status !== "missing").length;
  const errorCount = rows.filter((row) => row.status === "error").length;
  const exceptionCount = rows.filter((row) => row.exceptions.length).length;
  const optionalCount = rows.filter((row) => row.skippedOptional.length).length;
  const summary =
    recordedCount === 0
      ? `${rows.length} ancestral ${rows.length === 1 ? "word" : "words"} · none recorded yet`
      : `${matches} of ${recordedCount} recorded ${recordedCount === 1 ? "form matches" : "forms match"}${
          errorCount ? ` · ${errorCount} rule ${errorCount === 1 ? "error" : "errors"}` : ""
        }${exceptionCount ? ` · ${exceptionCount} with lexical ${exceptionCount === 1 ? "exception" : "exceptions"}` : ""}${
          optionalCount ? ` · ${optionalCount} with optional changes skipped` : ""
        }`;

  const html = `
    <div class="check-table-wrap">
      <table class="data-table check-table">
        <thead>
          <tr><th>Gloss</th><th>${esc(parent.name)}</th><th>Derived /…/</th>${hasSurfaceDisplay(ctx.language) ? "<th>Surface [ … ]</th>" : ""}<th>${esc(ctx.language.name)}</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const diff =
                row.status === "differs" && context
                  ? diffPairMarkup(row.derived, row.recorded?.form || "", context)
                  : null;
              return `
                <tr>
                  <td class="gloss-cell">${esc(row.word.gloss)}</td>
                  <td><code class="ipa">${esc(formatPhonemic(row.word.form))}</code></td>
                  <td><code class="ipa derived-form">${diff ? diff.left : esc(formatPhonemic(row.derived)) || "—"}</code></td>
                  ${hasSurfaceDisplay(ctx.language) ? `<td><code class="ipa surface-form">${esc(formatPhonetic(row.surface)) || "—"}</code></td>` : ""}
                  <td>${diff ? `<code class="ipa">${diff.right}</code>` : row.recorded ? `<code class="ipa">${esc(formatPhonemic(row.recorded.form)) || "—"}</code>` : `<span class="muted">not recorded</span>`}</td>
                  <td class="status-cell">
                    <span class="status-chip status-${row.status}" ${row.error ? `title="${esc(row.error)}"` : ""}>
                      ${row.status === "match" ? icon("check") : row.status === "differs" || row.status === "error" ? icon("warning") : icon("info")}
                      ${row.status === "match" ? "Matches" : row.status === "differs" ? "Differs" : row.status === "error" ? "Rule error" : "Missing"}
                    </span>
                    ${
                      row.exceptions.length
                        ? `<span class="status-chip status-exception" title="${esc(exceptionChipTitle(row.exceptions))}">${icon("info")}${row.exceptions.length === 1 ? "Exception" : `${row.exceptions.length} exceptions`}</span>`
                        : ""
                    }
                    ${
                      row.skippedOptional.length
                        ? `<span class="status-chip status-optional" title="${esc(optionalChipTitle(row.skippedOptional))}">${icon("info")}${row.skippedOptional.length === 1 ? "Optional skipped" : `${row.skippedOptional.length} optional skipped`}</span>`
                        : ""
                    }
                  </td>
                  <td class="row-actions">
                    <button class="button button-quiet button-tiny" type="button" data-record-word="${row.index}" ${row.status === "match" || row.status === "error" ? "disabled" : ""}>
                      ${row.status === "missing" ? "Record" : "Use derived"}
                    </button>
                  </td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="check-foot">Comparison is by gloss, using only this language’s direct changes. Not every word needs to be inherited; use “Use derived” when a reflex is correct. Top-level rules that change the same part of a word stop the derivation and appear as a rule error.</p>`;
  return { summary, html, rows, parent, byGloss };
}

function exceptionChipTitle(exceptions) {
  return `Skipped by lexical exception: ${exceptions
    .map((exception) => `${exception.label}${exception.notation ? ` (${exception.notation})` : ""}`)
    .join("; ")}`;
}

function optionalChipTitle(optionalRules) {
  return `Skipped optional ${optionalRules.length === 1 ? "change" : "changes"}: ${optionalRules
    .map((rule) => `${rule.label}${rule.notation ? ` (${rule.notation})` : ""}`)
    .join("; ")}`;
}

function conflictFixMarkup(ctx, conflict) {
  const language = ctx.language;
  const groups = ruleGroups(language.soundChanges);
  const firstGroup = groups.find((group) => group.rule.id === conflict.firstId);
  const secondGroup = groups.find((group) => group.rule.id === conflict.secondId);
  if (!firstGroup || !secondGroup) {
    return `<p class="tester-conflict-copy">The rules named in this conflict can no longer be found — the list changed.</p>`;
  }
  // Turning the second rule into a child of the first works only for a
  // top-level rule without children of its own; nested children break the
  // one-level rule tree, so manual editing wins there.
  const blocked = secondGroup.children.length > 0;
  const reason = blocked
    ? `${conflict.secondLabel} already has sequential children, so it cannot be moved — restructure those rules by hand first.`
    : `${conflict.secondLabel} (${secondGroup.rule.notation || "empty rule"}) then runs after ${conflict.firstLabel} (${firstGroup.rule.notation || "empty rule"}) instead of matching the same spot in parallel.`;
  return `
    <p class="tester-conflict-copy">${icon("warning")}<strong>Top-level conflict.</strong> ${esc(reason)}</p>
    <button class="button button-quiet button-small" type="button" data-conflict-fix ${blocked ? "disabled" : ""}>
      ${icon("sliders")}<span>Make rule ${esc(conflict.secondLabel)} sequential under rule ${esc(conflict.firstLabel)}</span>
    </button>`;
}

function convertConflict(ctx, conflict) {
  const language = ctx.language;
  const array = language.soundChanges;
  const first = array.find((rule) => rule.id === conflict.firstId);
  const second = array.find((rule) => rule.id === conflict.secondId);
  if (!first || !second) return;
  if (array.some((rule) => rule.parentId === second.id)) {
    toast(`${conflict.secondLabel} has sequential children of its own — move them manually first.`, { type: "error" });
    return;
  }
  const existingChildren = array.filter((rule) => rule.parentId === first.id);
  const anchor = existingChildren.length ? existingChildren[existingChildren.length - 1] : first;
  const secondIndex = array.indexOf(second);
  array.splice(secondIndex, 1);
  // Slot in after any children `first` already has, so the new child runs
  // last instead of jumping ahead of an existing sequential chain.
  array.splice(array.indexOf(anchor) + 1, 0, second);
  second.parentId = first.id;
  ctx.touch({
    label: `Convert ${conflict.secondLabel} to a sequential rule of ${conflict.firstLabel}`,
  });
  ctx.refresh();
  toast(`Rule ${conflict.secondLabel} now runs after rule ${conflict.firstLabel} instead of in parallel.`, { type: "success" });
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
  const exceptionSuggestions = [
    ...new Set(
      getLineage(ctx.project, language.id).flatMap((item) =>
        item.vocabulary.map((word) => word.gloss.trim()).filter(Boolean)
      )
    ),
  ].sort((left, right) => left.localeCompare(right));
  const directOptionalRules = optionalRulesInStages([
    { language, groups: compileRuleStages(language.soundChanges, context) },
  ]);

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
          ${directOptionalRules.length ? `<span><strong>${directOptionalRules.length}</strong> optional</span>` : ""}
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
            ${rulesMarkup(language, context, exceptionSuggestions)}
          </section>
          ${inheritedPanelMarkup(ctx, directOptionalRules)}
        </div>
        <aside class="changes-aside">
          ${testPanelMarkup(ctx, directOptionalRules)}
          ${reconstructPanelMarkup(ctx)}
          ${notationHelpMarkup()}
          ${libraryTriggerMarkup()}
        </aside>
      </div>
    </div>
  `;

  const testPanel = container.querySelector("[data-test-panel]");
  const testInput = testPanel?.querySelector("[data-test-input]");
  const checkPanel = container.querySelector("[data-inherited-panel]");
  const checkBody = checkPanel?.querySelector("[data-check-body]");
  const checkSummary = checkPanel?.querySelector("[data-check-summary]");
  const rememberedTest = testerMemory.get(language.id);
  const defaultTestWord = parent?.vocabulary.find((word) => word.form.trim());
  let testGloss =
    typeof rememberedTest === "object"
      ? rememberedTest.gloss || ""
      : rememberedTest
        ? ""
        : defaultTestWord?.gloss || "";
  let includeOptional = checkOptionalMemory.get(language.id) === true;
  const optionalIdsForCheck = () => (includeOptional ? directOptionalRules.map((rule) => rule.id) : []);
  let testOptional = new Set(
    [...(testerOptionalMemory.get(language.id) || [])].filter((id) =>
      directOptionalRules.some((rule) => rule.id === id)
    )
  );
  testerOptionalMemory.set(language.id, new Set(testOptional));

  const runTest = () => {
    if (!testPanel || !testInput) return;
    const result = directDerivation(ctx, testInput.value, testGloss, [...testOptional]);
    testerMemory.set(language.id, { form: testInput.value, gloss: testGloss });
    const output = testPanel.querySelector("[data-test-output]");
    const surface = testPanel.querySelector("[data-test-surface]");
    const surfaceRow = testPanel.querySelector("[data-test-surface-row]");
    const parsed = testPanel.querySelector("[data-test-parsed]");
    const steps = testPanel.querySelector("[data-test-steps]");
    output.textContent = result.fatal ? "—" : formatPhonemic(result.text) || "—";
    if (surface && surfaceRow) {
      const showSurface = hasSurfaceDisplay(language);
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
    // The one-click remedy for an overlapping top-level pair, offered right
    // where the conflict is reported.
    const conflict = result.steps.find((step) => step.conflict)?.conflict || null;
    const conflictBox = testPanel.querySelector("[data-test-conflict]");
    if (conflictBox) {
      if (conflict) {
        conflictBox.innerHTML = conflictFixMarkup(ctx, conflict);
        conflictBox.hidden = false;
        conflictBox.querySelector("[data-conflict-fix]")?.addEventListener("click", () => {
          convertConflict(ctx, conflict);
        });
      } else {
        conflictBox.hidden = true;
        conflictBox.innerHTML = "";
      }
    }
  };

  const refreshCheck = () => {
    if (!checkPanel || !checkBody) return;
    const data = checkRows(ctx, context, optionalIdsForCheck());
    checkBody.innerHTML = data.html;
    if (checkSummary) checkSummary.textContent = data.summary;
  };

  // Typing a rule re-derives the tester *and* whole parent lexicon here; on
  // the keystroke path the inherited check waits for a 200 ms pause so a
  // large ancestor lexicon does not run per character. Actions that finish a
  // change (record, undo, initial render) call refreshCheck() directly.
  const refreshCheckSoon = debounce(() => {
    refreshCheck();
  }, 200);

  if (testInput) {
    // The derivation updates live on every keystroke (and Enter re-runs it),
    // so no explicit Apply control is needed.
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
    testPanel.querySelectorAll("[data-test-word]").forEach((button) => {
      button.addEventListener("click", () => {
        testInput.value = button.dataset.testWord;
        testGloss = button.dataset.testGloss || "";
        runTest();
        testInput.focus();
      });
    });
    testPanel.querySelectorAll("[data-test-optional]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) testOptional.add(input.dataset.testOptional);
        else testOptional.delete(input.dataset.testOptional);
        testerOptionalMemory.set(language.id, new Set(testOptional));
        runTest();
      });
    });
    runTest();
  }

  const reconstructPanel = container.querySelector("[data-reconstruct-panel]");
  const reconstructInput = reconstructPanel?.querySelector("[data-reconstruct-input]");
  if (reconstructPanel && reconstructInput) {
    const runReconstruction = () => {
      const remembered = reconstructionMemory.get(language.id);
      const gloss = remembered?.form === reconstructInput.value ? remembered.gloss : "";
      let result;
      try {
        result = reconstructForm(
          reconstructInput.value,
          ctx.project,
          language.id,
          gloss ? { gloss } : {}
        );
      } catch {
        result = {
          ok: false,
          reason: "error",
          inputTokens: [],
          candidates: [],
          warnings: [],
        };
      }
      reconstructionMemory.set(language.id, {
        form: reconstructInput.value,
        gloss: result?.gloss || gloss || "",
      });
      renderReconstruction(reconstructPanel, result);
    };
    reconstructInput.addEventListener("input", runReconstruction);
    reconstructInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runReconstruction();
      }
    });
    reconstructPanel.querySelectorAll("[data-reconstruct-word]").forEach((button) => {
      button.addEventListener("click", () => {
        reconstructionMemory.set(language.id, {
          form: button.dataset.reconstructWord,
          gloss: button.dataset.reconstructGloss || "",
        });
        reconstructInput.value = button.dataset.reconstructWord;
        runReconstruction();
        reconstructInput.focus();
      });
    });
    runReconstruction();
  }

  refreshCheck();

  checkPanel?.querySelector("[data-check-optional]")?.addEventListener("change", (event) => {
    includeOptional = event.target.checked;
    checkOptionalMemory.set(language.id, includeOptional);
    refreshCheck();
  });

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
    const child = {
      id: uid("rule"),
      notation: "",
      note: "",
      enabled: true,
      optional: false,
      rate: DEFAULT_RULE_RATE,
      date: null,
      exceptions: [],
      parentId: parent.id,
    };
    const anchor = group.children.at(-1) || parent;
    const index = language.soundChanges.indexOf(anchor);
    language.soundChanges.splice(index + 1, 0, child);
    ctx.touch({ label: "Add rule" });
    ctx.refresh();
    window.setTimeout(() => {
      document.querySelector(`[data-rule-id="${CSS.escape(child.id)}"] .rule-input`)?.focus();
    }, 0);
  };

  container.querySelectorAll("[data-add-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = {
        id: uid("rule"),
        notation: "",
        note: "",
        enabled: true,
        optional: false,
        rate: DEFAULT_RULE_RATE,
        // Documentation-only stage for the Timeline view; null = undated.
        date: null,
        exceptions: [],
        parentId: null,
      };
      language.soundChanges.push(rule);
      ctx.touch({ label: "Add rule" });
      ctx.refresh();
      window.setTimeout(() => {
        document.querySelector(`[data-rule-id="${CSS.escape(rule.id)}"] .rule-input`)?.focus();
      }, 0);
    });
  });

  container.querySelector("[data-open-library]")?.addEventListener("click", () => openRuleLibrary(language, ctx));

  container.querySelectorAll(".rule-card").forEach((card) => {
    const rule = language.soundChanges.find((item) => item.id === card.dataset.ruleId);
    if (!rule) return;
    const parentRule = rule.parentId ? language.soundChanges.find((item) => item.id === rule.parentId) : null;
    const parentDisabled = parentRule?.enabled === false;
    const notation = card.querySelector(".rule-input");
    const note = card.querySelector(".rule-note-input");
    const toggle = card.querySelector("[data-rule-toggle]");
    const optionalInput = card.querySelector("[data-rule-optional]");
    const rateInput = card.querySelector("[data-rule-rate]");
    const stageInput = card.querySelector("[data-rule-stage]");

    notation.addEventListener("input", () => {
      rule.notation = notation.value;
      ctx.touch({ label: "Edit rule", coalesceKey: rule.id });
      updateRuleStatus(card, context, rule, parentDisabled);
      runTest();
      refreshCheckSoon();
    });
    note.addEventListener("input", () => {
      rule.note = note.value;
      ctx.touch({ label: "Edit rule", coalesceKey: rule.id });
    });
    const exceptionsInput = card.querySelector(".rule-exception-input");
    const exceptionCount = card.querySelector("[data-rule-exception-count]");
    exceptionsInput?.addEventListener("input", () => {
      rule.exceptions = normalizeRuleExceptions(exceptionsInput.value.split(","));
      if (exceptionCount) exceptionCount.textContent = exceptionSummary(rule.exceptions);
      ctx.touch({ label: "Edit rule exceptions", coalesceKey: rule.id });
      runTest();
      refreshCheckSoon();
    });
    optionalInput?.addEventListener("change", () => {
      rule.optional = optionalInput.checked;
      rule.rate = normalizeRuleRate(rule.rate);
      ctx.touch({
        label: rule.optional ? "Mark rule optional" : "Make rule mandatory",
        coalesceKey: rule.id,
      });
      // Re-render so the optional picker and the rule badge reflect the change.
      ctx.refresh();
    });
    rateInput?.addEventListener("change", () => {
      rule.rate = normalizeRuleRate(rateInput.value);
      rateInput.value = String(rule.rate);
      ctx.touch({ label: "Change optional rule rate", coalesceKey: rule.id });
      runTest();
      refreshCheckSoon();
    });
    // Stage is documentation only: compilation, the tester, and card layout do
    // not depend on it, so unlike rate there is no runTest/refresh here.
    stageInput?.addEventListener("change", () => {
      rule.date = normalizeRuleDate(stageInput.value);
      stageInput.value = rule.date === null ? "" : String(rule.date);
      ctx.touch({ label: "Change rule stage", coalesceKey: rule.id });
    });
    toggle.addEventListener("change", () => {
      rule.enabled = toggle.checked;
      ctx.touch({
        label: rule.enabled ? "Enable rule" : "Disable rule",
        coalesceKey: rule.id,
      });
      // Re-render so children of a disabled parent also show that they are
      // inactive. The rule tester and inherited check rerun with the view.
      ctx.refresh();
    });

    card.querySelector("[data-add-child]")?.addEventListener("click", () => {
      addChildRule(rule);
    });
    card.querySelector("[data-rule-up]")?.addEventListener("click", () => {
      if (!moveRule(rule, -1)) return;
      ctx.touch({ label: "Move rule", coalesceKey: rule.id });
      ctx.refresh();
    });
    card.querySelector("[data-rule-down]")?.addEventListener("click", () => {
      if (!moveRule(rule, 1)) return;
      ctx.touch({ label: "Move rule", coalesceKey: rule.id });
      ctx.refresh();
    });
    card.querySelector("[data-rule-delete]")?.addEventListener("click", () => {
      if (rule.parentId) {
        const index = language.soundChanges.indexOf(rule);
        if (index < 0) return;
        const [removed] = language.soundChanges.splice(index, 1);
        ctx.touch({ label: "Delete rule", coalesceKey: rule.id });
        ctx.refresh();
        toast("Rule deleted.", {
          type: "info",
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => {
              // Resolve the language at click time: a global undo/redo replaces
              // the render-time language object with a deep clone.
              const current = findLanguage(ctx.project, language.id);
              if (!current || current.soundChanges.some((entry) => entry.id === removed.id)) return;
              current.soundChanges.splice(Math.min(index, current.soundChanges.length), 0, removed);
              ctx.touch({ label: "Restore rule", coalesceKey: removed.id });
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
      ctx.touch({ label: extra ? "Delete rule group" : "Delete rule", coalesceKey: rule.id });
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
              const current = findLanguage(ctx.project, language.id);
              if (!current) return;
              const ids = new Set(block.map((entry) => entry.id));
              if (current.soundChanges.some((entry) => ids.has(entry.id))) return;
              current.soundChanges.splice(Math.min(index, current.soundChanges.length), 0, ...block);
              ctx.touch({ label: "Restore rule group", coalesceKey: group.rule.id });
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
      const derivation = deriveForm(word.form, ctx.project, language.id, {
        directOnly: true,
        gloss: word.gloss,
        optionalRuleIds: optionalIdsForCheck(),
      });
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
}
