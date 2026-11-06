import { esc } from "./ui.js";
import { joinSegments } from "./notation.js";
import { normalizeRuleRate } from "./model.js";

// Shared renderer for derivation steps. Top-level rules produce one parallel
// step (all of them checked against the same ancestral form), while dotted
// sequential rules produce the familiar before→after step.

function formText(tokens, junctures = null) {
  return tokens && tokens.length ? joinSegments(tokens, junctures) : "∅";
}

function countLabel(count) {
  return `${count} ${count === 1 ? "match" : "matches"}`;
}

function languageTag(step, showLanguage) {
  return showLanguage && step.languageName ? `<span class="step-stage">${esc(step.languageName)}</span>` : "";
}

function parallelLabel(entries) {
  const labels = entries.map((entry) => entry.label).filter(Boolean);
  if (!labels.length) return "anc";
  return labels.length === 1 ? labels[0] : `${labels[0]}–${labels[labels.length - 1]}`;
}

function parallelMarkup(step, showLanguage) {
  const entries = step.entries || [];
  const matched = entries.filter((entry) => entry.matches > 0).length;
  const excepted = entries.filter((entry) => entry.excepted).length;
  const optionalSkipped = entries.filter((entry) => entry.optionalSkipped).length;
  return `
    <div class="derivation-step is-parallel ${step.changed ? "is-changed" : ""}">
      <span class="step-index step-index-wide">${esc(parallelLabel(entries))}</span>
      <div class="step-body">
        <div class="step-rule">
          <span class="step-phase">Ancestral form</span>
          ${languageTag(step, showLanguage)}
          <span class="step-skip">${matched} of ${entries.length} ${entries.length === 1 ? "rule" : "rules"} match</span>
          ${excepted ? `<span class="step-badge">${excepted} lexical ${excepted === 1 ? "exception" : "exceptions"}</span>` : ""}
          ${optionalSkipped ? `<span class="step-badge step-badge-optional">${optionalSkipped} optional skipped</span>` : ""}
        </div>
        <div class="step-form">
          <code class="ipa">${esc(formText(step.before, step.beforeJunctures))}</code>
          <span class="step-arrow">→</span>
          <code class="ipa">${esc(formText(step.after, step.afterJunctures))}</code>
        </div>
        <ul class="step-rule-list">
          ${entries
            .map(
              (entry) => `
                <li class="${entry.matches > 0 ? "is-match" : ""}${entry.excepted ? " is-excepted" : ""}${entry.optionalSkipped ? " is-optional-skipped" : ""}">
                  <span class="step-rule-label">${esc(entry.label || "")}</span>
                  <code>${esc(entry.notation || "Empty rule")}</code>
                  <span class="step-rule-count">${entry.optionalSkipped ? `optional${entry.rate != null ? ` ${entry.rate}%` : ""} skipped` : entry.excepted ? "exception" : `${countLabel(entry.matches)}${entry.optional ? " · optional" : ""}`}</span>
                  ${entry.debug ? `<span class="step-rule-why" title="${esc(entry.debug)}">${esc(entry.debug)}</span>` : ""}
                </li>`
            )
            .join("")}
        </ul>
      </div>
    </div>`;
}

function sequentialMarkup(step, index, showLanguage) {
  const notation = step.rule?.notation || step.compiled?.rule?.source || "";
  return `
    <div class="derivation-step ${step.changed ? "is-changed" : ""}">
      <span class="step-index">${esc(step.label || String(index + 1))}</span>
      <div class="step-body">
        <div class="step-rule">
          <code>${esc(notation)}</code>
          ${languageTag(step, showLanguage)}
          ${
            step.optionalSkipped
              ? `<span class="step-badge step-badge-optional">${
                  step.optionalParentSkipped ? "parent optional skipped" : "optional skipped"
                }</span>`
              : step.excepted
                ? `<span class="step-badge">lexical exception</span>`
                : step.optional
                  ? `<span class="step-badge step-badge-optional">optional${step.rate != null ? ` ${step.rate}%` : ""}</span>`
                  : step.changed
                    ? ""
                    : `<span class="step-skip">unchanged</span>`
          }
        </div>
        ${step.debug ? `<div class="step-why">${esc(step.debug)}</div>` : ""}
        <div class="step-form">
          <code class="ipa">${esc(formText(step.before, step.beforeJunctures))}</code>
          <span class="step-arrow">→</span>
          <code class="ipa">${esc(formText(step.after, step.afterJunctures))}</code>
        </div>
      </div>
    </div>`;
}

function errorMarkup(step, index, showLanguage) {
  const notation = step.rule?.notation || step.compiled?.rule?.source || "";
  return `
    <div class="derivation-step is-error">
      <span class="step-index">${esc(step.label || String(index + 1))}</span>
      <div class="step-body">
        <div class="step-rule">
          ${notation ? `<code>${esc(notation)}</code>` : `<span class="step-phase">Ancestral rules</span>`}
          ${languageTag(step, showLanguage)}
        </div>
        <div class="step-error">${esc(step.error)}</div>
      </div>
    </div>`;
}

// A compact picker for optional rules. The primary derivation skips them; a
// checked rule is forced into the current variant. Selection is view state and
// is never persisted with the project.
export function optionalRulesPickerMarkup(
  rules,
  selected,
  attribute,
  {
    hint = "The primary derivation skips optional changes. Tick a rule to include it in this variant.",
    showLanguage = false,
  } = {}
) {
  if (!rules?.length) return "";
  const checked = selected instanceof Set ? selected : new Set(selected || []);
  return `
    <details class="optional-rules" ${checked.size ? "open" : ""}>
      <summary>
        <span class="optional-rules-title">Optional changes</span>
        <span class="optional-rules-count">${rules.length}</span>
      </summary>
      <div class="optional-rules-body">
        <p class="optional-rules-hint">${esc(hint)}</p>
        ${rules
          .map(
            (rule) => `
              <label class="rule-option optional-rule-option">
                <input type="checkbox" ${attribute}="${esc(rule.id)}" ${checked.has(rule.id) ? "checked" : ""}>
                <span class="optional-rule-label">${esc(rule.label || "")}</span>
                <code>${esc(rule.notation || "Empty rule")}</code>
                <span class="optional-rule-rate">${esc(`${normalizeRuleRate(rule.rate)}%`)}</span>
                ${showLanguage && rule.languageName ? `<span class="optional-rule-language">${esc(rule.languageName)}</span>` : ""}
              </label>`
          )
          .join("")}
      </div>
    </details>`;
}

export function derivationStepsMarkup(
  steps,
  { emptyText = "No rules change this form — it passes through unchanged.", hideEmpty = false, showLanguage = false } = {}
) {
  const visible = (steps || []).filter((step) => !(hideEmpty && step.error && step.compiled?.empty));
  if (!visible.length) return `<p class="derivation-empty">${esc(emptyText)}</p>`;
  return visible
    .map((step, index) => {
      if (step.kind === "parallel") return parallelMarkup(step, showLanguage);
      if (step.error) return errorMarkup(step, index, showLanguage);
      return sequentialMarkup(step, index, showLanguage);
    })
    .join("");
}
