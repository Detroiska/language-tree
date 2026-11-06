import { esc } from "./escape.js";
import { normalizeRuleExceptions } from "./model.js";
import { icon } from "./ui.js";

// Shared pieces of the sound-change and allophony rule editors. The two
// editors deliberately keep different cards and testers, but status wording,
// exception summaries, and the exception editor should not drift apart.

export function ruleStatusFor(rule, compile) {
  const notation = String(rule.notation || "").trim();
  if (!notation) return { kind: "empty", label: "Empty rule" };
  const compiled = compile(notation);
  if (compiled.ok && compiled.warnings?.length) return { kind: "warn", label: compiled.warnings[0] };
  if (compiled.ok) return { kind: "ok", label: "Valid" };
  return { kind: "error", label: compiled.error };
}

export function statusMarkup(status) {
  const glyph =
    status.kind === "ok" ? "check" : status.kind === "error" || status.kind === "warn" ? "warning" : "info";
  return `${icon(glyph)}<span>${esc(status.label)}</span>`;
}

export function exceptionSummary(exceptions) {
  const count = exceptions?.length || 0;
  return count ? `${count} ${count === 1 ? "word" : "words"}` : "none";
}

export function exceptionsMarkup(rule, { countAttribute, listId }) {
  const exceptions = normalizeRuleExceptions(rule.exceptions);
  return `
    <details class="rule-exceptions" ${exceptions.length ? "open" : ""}>
      <summary>
        <span>Exceptions</span>
        <span class="rule-exception-count" ${countAttribute}>${esc(exceptionSummary(exceptions))}</span>
      </summary>
      <div class="rule-exception-body">
        <input class="rule-exception-input" type="text" value="${esc(exceptions.join(", "))}" placeholder="Glosses, comma-separated — e.g. water, tooth" autocomplete="off" spellcheck="false" aria-label="Lexical exception glosses" list="${listId}">
        <p class="rule-exception-hint">This rule is skipped for words with these glosses. Suggestions come from this lineage’s vocabulary.</p>
      </div>
    </details>`;
}

export function exceptionSuggestionsMarkup(suggestions, listId) {
  if (!suggestions.length) return "";
  return `<datalist id="${listId}">${suggestions
    .map((gloss) => `<option value="${esc(gloss)}"></option>`)
    .join("")}</datalist>`;
}
