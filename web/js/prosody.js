// Stress and syllable presentation.
//
// Syllabification itself belongs to phonotactics.js, where the language's
// template is compiled. This module is deliberately dependency-free: it turns
// syllable records into a stress position, a per-token stress array for rule
// matching, and a display string with syllable dots. Keeping it separate lets
// the rule engine, the phonotactics checker, and the surface renderer share the
// same placement rules without importing each other.

import { joinSegments, stripLevelMarks } from "./notation.js";

function cutSet(junctures) {
  return junctures instanceof Set ? junctures : new Set(junctures || []);
}

export const STRESS_SYSTEMS = [
  { value: "none", label: "No stress" },
  { value: "initial", label: "Initial" },
  { value: "penult", label: "Penultimate" },
  { value: "antepenult", label: "Antepenultimate" },
  { value: "final", label: "Final" },
  { value: "weight", label: "Weight-sensitive (penult if heavy)" },
];

const STRESS_VALUES = new Set(STRESS_SYSTEMS.map((item) => item.value));

export const STRESS_SCOPES = [
  { value: "phonetic", label: "Phonetic only — shown in [ … ]" },
  { value: "phonemic", label: "Phonemic — shown in / … / and usable in sound changes" },
];

export function normalizeStressSystem(value) {
  return STRESS_VALUES.has(value) ? value : "none";
}

export function normalizeStressScope(value) {
  return value === "phonemic" ? "phonemic" : "phonetic";
}

export function stressScopeLabel(scope) {
  return normalizeStressScope(scope) === "phonemic" ? "Phonemic" : "Phonetic";
}

export function stressLabel(system) {
  return STRESS_SYSTEMS.find((item) => item.value === normalizeStressSystem(system))?.label || "No stress";
}

// A word-level override is stored as a 0-based syllable index. `null` means
// "use the language system"; `secondary` holds the other syllables that carry
// ˌ. Legacy forms keep their ˌ marks by migrating them into this field.
export function normalizeWordStress(value) {
  if (value == null) return null;
  const primaryRaw = typeof value === "number" ? value : value.primary;
  const primary =
    Number.isInteger(primaryRaw) && primaryRaw >= 0 ? primaryRaw : null;
  const secondaryRaw = typeof value === "object" && Array.isArray(value.secondary) ? value.secondary : [];
  const secondary = [
    ...new Set(
      secondaryRaw.filter((index) => Number.isInteger(index) && index >= 0 && index !== primary)
    ),
  ].sort((left, right) => left - right);
  if (primary === null && !secondary.length) return null;
  return { primary, secondary };
}

// Toggle secondary stress on one syllable. Secondary stress cannot share the
// primary syllable, so clicking that syllable is a no-op. The result is
// normalized (unique, sorted, no overlapping index) and may be null when the
// last mark is removed; callers store it directly or delete the field. Kept
// DOM-free so the vocabulary picker and the tests use the same rule.
export function toggleSecondaryStress(wordStress, index) {
  const stored = normalizeWordStress(wordStress);
  if (!Number.isInteger(index) || index < 0 || stored?.primary === index) return stored;
  const secondary = new Set(stored?.secondary || []);
  if (secondary.has(index)) secondary.delete(index);
  else secondary.add(index);
  return normalizeWordStress({
    primary: stored?.primary ?? null,
    secondary: [...secondary],
  });
}

// One-time migration from marks typed into a legacy word form. It counts vowel
// nuclei before each ˌ/ˈ, matching the maximal-onset fallback syllabifier, and
// only needs the inventory's vowel symbols. The caller strips the marks from
// the stored form; the returned indices are syllable positions.
const COMBINING_MARK = /\p{M}/u;
const SEGMENT_SEPARATORS = /[\s.·+\-]/u;
const NUCLEUS_MODIFIERS = new Set(["ː", "ˑ", "\u0361", "\u035c"]);

export function stressMarksToIndices(form, vowelSymbols = []) {
  const source = stripLevelMarks(form);
  const vowels = [...new Set(vowelSymbols)].filter(Boolean).sort((left, right) => right.length - left.length);
  if (!source || !vowels.length) return null;
  const vowelAt = (index) => vowels.find((symbol) => source.startsWith(symbol, index)) || "";
  let nuclei = 0;
  let inNucleus = false;
  let pending = [];
  let primary = null;
  const secondary = [];
  const record = () => {
    if (!pending.length) return;
    for (const mark of pending) {
      if (mark === "ˈ" && primary === null) primary = nuclei - 1;
      else if (mark === "ˌ") secondary.push(nuclei - 1);
    }
    pending = [];
  };
  for (let index = 0; index < source.length; ) {
    const character = source[index];
    if (character === "ˈ" || character === "ˌ") {
      pending.push(character);
      index += 1;
      continue;
    }
    if (SEGMENT_SEPARATORS.test(character)) {
      index += 1;
      continue;
    }
    if (COMBINING_MARK.test(character) || NUCLEUS_MODIFIERS.has(character)) {
      index += 1;
      continue;
    }
    const vowel = vowelAt(index);
    if (vowel) {
      if (!inNucleus) {
        nuclei += 1;
        inNucleus = true;
        record();
      }
      index += vowel.length;
      continue;
    }
    inNucleus = false;
    index += 1;
  }
  if (primary === null && !secondary.length) return null;
  return normalizeWordStress({ primary, secondary });
}

// A heavy syllable has a coda, a long nucleus, or more than one nucleus
// segment (a diphthong). The engine's tokenizer keeps length marks with the
// vowel when they are charted and otherwise leaves them as a following coda,
// so both spellings count.
//
// Long nuclei are written with the IPA length marks ː/ˑ or with a macron:
// precomposed ā (U+0101) and the decomposed a + U+0304 spell the same length
// (features.js marks both long), so NFD decomposition — which contains the
// combining macron for every precomposed macron vowel — decides weight.
const LENGTH_MARKS = /[ːˑ]/u;

function isLongNucleus(token) {
  return LENGTH_MARKS.test(token) || token.normalize("NFD").includes("\u0304");
}

export function isHeavySyllable(syllable) {
  if (!syllable) return false;
  if (syllable.coda?.length) return true;
  const nucleus = syllable.nucleus || [];
  if (nucleus.length > 1) return true;
  return nucleus.some(isLongNucleus);
}

// "weight" follows the Latin-style default: stress the penult if it is heavy,
// otherwise the antepenult, falling back to the first syllable in short words.
export function stressIndexOf(syllables, system) {
  const count = syllables?.length || 0;
  if (!count) return -1;
  const normalized = normalizeStressSystem(system);
  if (normalized === "none") return -1;
  if (normalized === "initial") return 0;
  if (normalized === "final") return count - 1;
  if (normalized === "penult") return Math.max(0, count - 2);
  if (normalized === "antepenult") return Math.max(0, count - 3);
  if (normalized === "weight") {
    if (count === 1) return 0;
    const penult = count - 2;
    if (isHeavySyllable(syllables[penult])) return penult;
    return count >= 3 ? count - 3 : 0;
  }
  return -1;
}

// Lexical marks win over the language's default placement. An out-of-range
// index is stale (the form or template changed), so the default takes over
// instead of silently stressing the wrong syllable. A secondary index is
// dropped only when the form no longer has that syllable.
export function resolveStress(syllables, system, wordStress = null) {
  const count = syllables?.length || 0;
  if (!count) return { primaryIndex: -1, secondaryIndices: [] };
  const stored = normalizeWordStress(wordStress);
  const primaryIndex =
    stored?.primary != null && stored.primary < count ? stored.primary : stressIndexOf(syllables, system);
  const secondaryIndices = (stored?.secondary || []).filter(
    (index) => index < count && index !== primaryIndex
  );
  return { primaryIndex, secondaryIndices };
}

// Stress marks before syllables, without the dots used by the surface display.
// This is the phonemic presentation: `ˈkasa` rather than `ˈka.sa`.
export function stressMarkedText(tokens, syllables, stressIndex, junctures = null, secondaryIndices = []) {
  const cuts = cutSet(junctures);
  if (!tokens?.length) return "";
  const marks = new Map();
  const primary = stressIndex >= 0 ? syllables?.[stressIndex] : null;
  if (primary) marks.set(primary.start, "ˈ");
  for (const index of secondaryIndices || []) {
    const syllable = syllables?.[index];
    if (syllable && !marks.has(syllable.start)) marks.set(syllable.start, "ˌ");
  }
  if (!marks.size) return joinSegments(tokens, cuts);
  let output = "";
  for (let index = 0; index < tokens.length; index += 1) {
    if (index > 0 && cuts.has(index)) output += "+";
    if (marks.has(index)) output += marks.get(index);
    output += tokens[index];
  }
  return output;
}

// Inline stress marks a user typed into a form before word stress was a
// field. The caller supplies the inventory's vowel symbols when it has them;
// the fallback covers an empty or hand-edited chart during migration.
const FALLBACK_STRESS_VOWELS = [
  "a", "e", "i", "o", "u", "y", "æ", "ɑ", "ɒ", "ɐ", "ə", "ɘ", "ɛ", "ɜ", "ɞ", "ɤ", "ɔ", "ø", "œ",
  "ɵ", "ɨ", "ɪ", "ʉ", "ʏ", "ʊ", "ɯ", "ʌ", "ɚ", "ɝ", "ɶ",
];

export function stressMarksFromForm(form, vowelSymbols = []) {
  return stressMarksToIndices(form, vowelSymbols?.length ? vowelSymbols : FALLBACK_STRESS_VOWELS);
}

// The display mark sits before the whole syllable, as in ˈka.sa. Internally
// the stress array marks every token of the stressed syllable, which lets a
// rule condition on any segment in that syllable without special-casing
// onsets, nuclei, and codas.
export function prosodyFromSyllables(tokens, syllables, system, junctures = null, wordStress = null) {
  const cuts = cutSet(junctures);
  const { primaryIndex: stressIndex, secondaryIndices } = resolveStress(syllables, system, wordStress);
  const stress = new Array(tokens.length).fill("");
  const boundaries = new Set([0, tokens.length]);

  if (!syllables.length) {
    return {
      syllables: [],
      stressIndex: -1,
      secondaryIndices: [],
      stress,
      boundaries,
      display: joinSegments(tokens, cuts),
      marked: joinSegments(tokens, cuts),
    };
  }

  for (const [index, syllable] of syllables.entries()) {
    boundaries.add(syllable.start);
    const mark = index === stressIndex ? "ˈ" : secondaryIndices.includes(index) ? "ˌ" : "";
    if (mark) {
      for (let position = syllable.start; position < syllable.end; position += 1) {
        stress[position] = mark;
      }
    }
  }

  // Dots mark syllable edges; a morpheme cut is a stronger boundary, so it
  // replaces the dot when both fall between the same two segments. A cut
  // inside a syllable still shows in place.
  let display = "";
  for (const [index, syllable] of syllables.entries()) {
    if (syllable.start > 0) display += cuts.has(syllable.start) ? "+" : ".";
    if (index === stressIndex) display += "ˈ";
    else if (secondaryIndices.includes(index)) display += "ˌ";
    for (let position = syllable.start; position < syllable.end; position += 1) {
      if (position > syllable.start && cuts.has(position)) display += "+";
      display += tokens[position];
    }
  }

  return {
    syllables,
    stressIndex,
    secondaryIndices,
    stress,
    boundaries,
    display,
    marked: stressMarkedText(tokens, syllables, stressIndex, cuts, secondaryIndices),
  };
}

// When no syllable template parses a word, stress still deserves a sensible
// preview. Treat each vowel run as a nucleus and give every inter-vocalic
// consonant to the following onset (the maximal-onset default). Word-final
// consonants stay in the last coda.
function fallbackSyllables(tokens, isVowel) {
  const nuclei = [];
  let index = 0;
  while (index < tokens.length) {
    if (!isVowel(tokens[index])) {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < tokens.length && isVowel(tokens[index])) index += 1;
    nuclei.push({ start, end: index });
  }
  if (!nuclei.length) return [];

  return nuclei.map((nucleus, position) => {
    const start = position === 0 ? 0 : nuclei[position - 1].end;
    const end = position === nuclei.length - 1 ? tokens.length : nucleus.end;
    return {
      start,
      end,
      tokens: tokens.slice(start, end),
      onset: tokens.slice(start, nucleus.start),
      nucleus: tokens.slice(nucleus.start, nucleus.end),
      coda: tokens.slice(nucleus.end, end),
      onsetLength: nucleus.start - start,
      codaLength: end - nucleus.end,
    };
  });
}

export function prosodyFallback(tokens, isVowel, system, junctures = null, wordStress = null) {
  const syllables = fallbackSyllables(tokens, isVowel);
  if (!syllables.length) {
    const text = joinSegments(tokens, cutSet(junctures));
    return {
      syllables: [],
      stressIndex: -1,
      secondaryIndices: [],
      stress: new Array(tokens.length).fill(""),
      boundaries: new Set([0, tokens.length]),
      display: text,
      marked: text,
    };
  }
  return prosodyFromSyllables(tokens, syllables, system, junctures, wordStress);
}
