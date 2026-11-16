import { contextForInventory } from "./phonology.js";
import { compilePhonotactics, validateWord } from "./phonotactics.js";
import {
  normalizeStressScope,
  normalizeStressSystem,
  normalizeWordStress,
  pruneSecondaryStress,
  stressMarkedText,
} from "./prosody.js";

// One compiled checker can validate many forms: the inventory and
// phonotactics are fixed until the next render. It lives outside
// phonotactics.js so that module stays free of a phonology import and the rule
// engine can reuse its syllabifier without a cycle.
export function createPhonotacticsChecker(language) {
  const stress = normalizeStressSystem(language.phonotactics?.stress);
  const stressScope = normalizeStressScope(language.phonotactics?.stressScope);
  const context = contextForInventory(language.inventory, language.featureOverrides, {
    stress,
    stressScope,
  });
  const compiled = compilePhonotactics(language.phonotactics || {}, context);
  return {
    context,
    compiled,
    stress,
    stressScope,
    validate(form, wordStress = null) {
      return validateWord(form, compiled, context, wordStress);
    },
  };
}

// Rewrite a form with its primary and secondary stress marks before the
// stressed syllables. Returns null when the form has no analysis. A lexical
// override is honored even when the language has no default stress system.
// Explicit stress is written as stored: a secondary-only record must not gain
// a predicted primary, or a TSV round-trip would change the word. When the
// template is empty or unparseable the field is still real, so the maximal
// onset fallback supplies syllable positions for presentation and export.
export function stressMarkedForm(form, checker, wordStress = null) {
  if (!String(form || "").trim()) return null;
  const stored = normalizeWordStress(wordStress);
  if (checker.stress === "none" && !stored) return null;
  const result = checker.validate(form, stored);
  const fallback = result.displayText
    ? null
    : checker.context.prosodyFor(result.tokens, result.junctures, stored);
  const syllables = result.syllables?.length ? result.syllables : fallback?.syllables || [];
  const tokens = result.tokens || [];
  if (!tokens.length || !syllables.length) return null;

  if (stored) {
    const primary =
      stored.primary != null && stored.primary < syllables.length ? stored.primary : null;
    // With Auto primary, the language default still decides which syllable
    // cannot carry ˌ. Filter against either explicit or effective primary so
    // export agrees with the /…/ display instead of writing a mark that is
    // never shown.
    const effectivePrimary =
      primary ?? result.stressIndex ?? fallback?.stressIndex ?? -1;
    const secondary =
      pruneSecondaryStress(stored, effectivePrimary, syllables.length)?.secondary || [];
    return stressMarkedText(tokens, syllables, primary ?? -1, result.junctures, secondary) || null;
  }

  if (result.stressIndex >= 0 || result.secondaryIndices?.length) return result.marked;
  if (fallback && (fallback.stressIndex >= 0 || fallback.secondaryIndices.length)) {
    return fallback.marked;
  }
  return null;
}

// The phonemic presentation of a recorded word. In phonetic scope stress is
// surface-only, so the bare stored form is the phonemic form. In phonemic
// scope the stored stress field is part of the form, and the display keeps
// syllable dots so a reader can see which syllable carries it. Missing or
// invalid phonotactics affect checking, not whether stored stress is shown.
export function phonemicFormForWord(word, checker) {
  const form = String(word?.form || "");
  if (!form.trim()) return "";
  if (checker.stressScope !== "phonemic") return form;
  const result = checker.validate(form, word?.stress);
  if (result.displayText) return result.displayText;
  const fallback = checker.context.prosodyFor(result.tokens, result.junctures, word?.stress);
  return fallback.display || form;
}
