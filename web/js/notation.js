// Phonemic /…/ and phonetic […] notation.
//
// The project stores plain IPA strings. Delimiters are a presentation-level
// claim about the level of representation, not part of the form: storing them
// would make the tokenizer read slashes and brackets as segments and break
// inheritance checks, phonotactics, import/export, and search. These helpers
// add and remove the marks at the edges of the app instead.

export function stripLevelMarks(value) {
  const text = String(value ?? "").normalize("NFC").trim();
  if (text.length < 2) return text;
  if (text.startsWith("/") && text.endsWith("/")) return text.slice(1, -1).trim();
  if (text.startsWith("[") && text.endsWith("]")) return text.slice(1, -1).trim();
  return text;
}

// Stress marks are properties of the syllable, so comparisons ignore them even
// when a user keeps them in a stored form for presentation.
export function stripStressMarks(value) {
  return String(value ?? "").replace(/[ˈˌ]/gu, "");
}

// A morpheme cut is a presentation-level boundary between segments, like
// stress: the lexicon stores it in the form string (`kat+ta`) so edits and
// exports keep it, but segment comparisons work on the bare tokens.
export function joinSegments(tokens, junctures = null) {
  const cuts = junctures instanceof Set ? junctures : new Set(junctures || []);
  let text = "";
  for (let index = 0; index < (tokens?.length || 0); index += 1) {
    if (index > 0 && cuts.has(index)) text += "+";
    text += tokens[index];
  }
  return text;
}

export function normalizeForm(value) {
  return String(value || "").normalize("NFC");
}

// Recorded forms are compared for identity across the lexicon, sound-change
// previews, and cognate tables. Stress and separators that are presentation
// only (syllable dots, hyphens, morpheme cuts, whitespace) do not make two
// forms different.
export function sameForm(left, right) {
  const normalize = (value) =>
    stripStressMarks(String(value || "").normalize("NFC"))
      .replace(/[.\-·+\s]+/gu, "")
      .trim();
  return normalize(left) === normalize(right);
}

export function sameTokens(left, right) {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function stressValue(value) {
  const stress = value && typeof value === "object" && !Array.isArray(value) ? value.stress : null;
  if (!stress || typeof stress !== "object") return null;
  const primary = Number.isInteger(stress.primary) && stress.primary >= 0 ? stress.primary : null;
  const secondary = Array.isArray(stress.secondary)
    ? [...new Set(stress.secondary.filter((index) => Number.isInteger(index) && index >= 0))].sort((a, b) => a - b)
    : [];
  return primary === null && !secondary.length ? null : { primary, secondary };
}

// Stress-aware identity for phonemic forms. The arguments may be stored word
// objects (form + stress field) or bare strings. In phonetic scope, or when
// either side has no recorded stress, this is exactly sameForm; only two
// explicit phonemic stress records can disagree about stress. Derived forms
// now carry remapped stress as well, so callers must pass that field with the
// derived form when they want a stress-sensitive comparison.
export function samePhonemicForm(left, right, { scope = "phonetic" } = {}) {
  const leftForm = typeof left === "string" ? left : left?.form;
  const rightForm = typeof right === "string" ? right : right?.form;
  if (!sameForm(leftForm, rightForm)) return false;
  if (scope !== "phonemic") return true;
  const leftStress = stressValue(left);
  const rightStress = stressValue(right);
  if (!leftStress || !rightStress) return true;
  return (
    leftStress.primary === rightStress.primary &&
    leftStress.secondary.length === rightStress.secondary.length &&
    leftStress.secondary.every((index, position) => index === rightStress.secondary[position])
  );
}

export function sameJunctures(left, right) {
  const leftCuts = left instanceof Set ? left : new Set(left || []);
  const rightCuts = right instanceof Set ? right : new Set(right || []);
  if (leftCuts.size !== rightCuts.size) return false;
  for (const value of leftCuts) if (!rightCuts.has(value)) return false;
  return true;
}

// Search and filters compare bare segment strings: level delimiters, stress
// marks, and morpheme cuts are presentation, so a stored kat+ta still matches
// a typed kata.
export function normalizeSearchText(value) {
  return stripStressMarks(stripLevelMarks(value))
    .replace(/\+/gu, "")
    .normalize("NFC")
    .toLowerCase();
}

export function formatPhonemic(value) {
  const text = stripLevelMarks(value);
  return text ? `/${text}/` : "";
}

export function formatPhonetic(value) {
  const text = stripLevelMarks(value);
  return text ? `[${text}]` : "";
}
