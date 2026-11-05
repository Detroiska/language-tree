import { esc } from "./ui.js";

// Shared renderer for derivation steps. Top-level rules produce one parallel
// step (all of them checked against the same ancestral form), while dotted
// sequential rules produce the familiar before→after step.

function formText(tokens) {
  return tokens && tokens.length ? tokens.join("") : "∅";
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
  return `
    <div class="derivation-step is-parallel ${step.changed ? "is-changed" : ""}">
      <span class="step-index step-index-wide">${esc(parallelLabel(entries))}</span>
      <div class="step-body">
        <div class="step-rule">
          <span class="step-phase">Ancestral form</span>
          ${languageTag(step, showLanguage)}
          <span class="step-skip">${matched} of ${entries.length} ${entries.length === 1 ? "rule" : "rules"} match</span>
        </div>
        <div class="step-form">
          <code class="ipa">${esc(formText(step.before))}</code>
          <span class="step-arrow">→</span>
          <code class="ipa">${esc(formText(step.after))}</code>
        </div>
        <ul class="step-rule-list">
          ${entries
            .map(
              (entry) => `
                <li class="${entry.matches > 0 ? "is-match" : ""}">
                  <span class="step-rule-label">${esc(entry.label || "")}</span>
                  <code>${esc(entry.notation || "Empty rule")}</code>
                  <span class="step-rule-count">${countLabel(entry.matches)}</span>
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
          ${step.changed ? "" : `<span class="step-skip">unchanged</span>`}
        </div>
        ${step.debug ? `<div class="step-why">${esc(step.debug)}</div>` : ""}
        <div class="step-form">
          <code class="ipa">${esc(formText(step.before))}</code>
          <span class="step-arrow">→</span>
          <code class="ipa">${esc(formText(step.after))}</code>
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
