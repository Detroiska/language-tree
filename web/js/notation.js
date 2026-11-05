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

export function normalizeForm(value) {
  return String(value || "").normalize("NFC");
}

export function formatPhonemic(value) {
  const text = stripLevelMarks(value);
  return text ? `/${text}/` : "";
}

export function formatPhonetic(value) {
  const text = stripLevelMarks(value);
  return text ? `[${text}]` : "";
}
