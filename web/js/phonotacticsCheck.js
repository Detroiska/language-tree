import { contextForInventory } from "./phonology.js";
import { compilePhonotactics, validateWord } from "./phonotactics.js";
import { normalizeStressSystem } from "./prosody.js";

// One compiled checker can validate many forms: the inventory and
// phonotactics are fixed until the next render. It lives outside
// phonotactics.js so that module stays free of a phonology import and the rule
// engine can reuse its syllabifier without a cycle.
export function createPhonotacticsChecker(language) {
  const stress = normalizeStressSystem(language.phonotactics?.stress);
  const context = contextForInventory(language.inventory, language.featureOverrides, { stress });
  const compiled = compilePhonotactics(language.phonotactics || {}, context);
  return {
    context,
    compiled,
    stress,
    validate(form) {
      return validateWord(form, compiled, context);
    },
  };
}

// Rewrite a form with its predicted primary stress mark before the stressed
// syllable. Returns null when the form has no analysis or the language has no
// stress system.
export function stressMarkedForm(form, checker) {
  if (!String(form || "").trim() || checker.stress === "none") return null;
  const result = checker.validate(form);
  if (!result.checked || !result.syllables?.length || result.stressIndex < 0) return null;
  const tokens = result.tokens;
  const stressed = result.syllables[result.stressIndex];
  const output = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (index === stressed.start) output.push("ˈ");
    output.push(tokens[index]);
  }
  return output.join("");
}
