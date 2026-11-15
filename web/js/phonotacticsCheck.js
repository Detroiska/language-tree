import { contextForInventory } from "./phonology.js";
import { compilePhonotactics, validateWord } from "./phonotactics.js";
import { normalizeStressScope, normalizeStressSystem, normalizeWordStress } from "./prosody.js";

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
export function stressMarkedForm(form, checker, wordStress = null) {
  if (!String(form || "").trim()) return null;
  const stored = normalizeWordStress(wordStress);
  if (checker.stress === "none" && !stored) return null;
  const result = checker.validate(form, stored);
  if (!result.checked || !result.syllables?.length) return null;
  if (result.stressIndex < 0 && !(result.secondaryIndices?.length)) return null;
  return result.marked;
}

// The phonemic presentation of a recorded word. In phonetic scope stress is
// surface-only, so the bare stored form is the phonemic form. In phonemic
// scope the stored stress field is part of the form, and the display keeps
// syllable dots so a reader can see which syllable carries it.
export function phonemicFormForWord(word, checker) {
  const form = String(word?.form || "");
  if (!form.trim()) return "";
  if (checker.stressScope !== "phonemic") return form;
  const result = checker.validate(form, word?.stress);
  if (!result.checked || !result.displayText) return form;
  return result.displayText;
}
