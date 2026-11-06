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
