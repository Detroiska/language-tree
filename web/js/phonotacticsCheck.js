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

// The stress positions a form actually uses: an explicit word override when
// valid, otherwise the language default. Callers use this to edit, display, and
// export the same effective marks.
export function effectiveStressForForm(form, checker, wordStress = null) {
  const result = checker.validate(form, wordStress);
  const fallback =
    result.stressIndex == null && result.tokens?.length
      ? checker.context.prosodyFor(result.tokens, result.junctures, wordStress)
      : null;
  return {
    result,
    syllableCount: result.syllables?.length || fallback?.syllables?.length || 0,
    primaryIndex: result.stressIndex ?? fallback?.stressIndex ?? -1,
    secondaryIndices: result.secondaryIndices ?? fallback?.secondaryIndices ?? [],
  };
}

// Keep a stored stress record consistent with its form: drop secondary marks
// that collide with the effective primary or point past the current syllables.
// Without a checker or a form there is nothing to resolve against, so the
// normalized record is returned unchanged.
export function pruneWordStressForForm(form, checker, wordStress = null) {
  const stored = normalizeWordStress(wordStress);
  if (!checker || !String(form || "").trim()) return stored;
  const effective = effectiveStressForForm(form, checker, stored);
  if (!effective.syllableCount) return stored;
  return pruneSecondaryStress(
    stored,
    effective.primaryIndex >= 0 ? effective.primaryIndex : null,
    effective.syllableCount
  );
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
