// Stress and syllable presentation.
//
// Syllabification itself belongs to phonotactics.js, where the language's
// template is compiled. This module is deliberately dependency-free: it turns
// syllable records into a stress position, a per-token stress array for rule
// matching, and a display string with syllable dots. Keeping it separate lets
// the rule engine, the phonotactics checker, and the surface renderer share the
// same placement rules without importing each other.

export const STRESS_SYSTEMS = [
  { value: "none", label: "No stress" },
  { value: "initial", label: "Initial" },
  { value: "penult", label: "Penultimate" },
  { value: "antepenult", label: "Antepenultimate" },
  { value: "final", label: "Final" },
  { value: "weight", label: "Weight-sensitive (penult if heavy)" },
];

const STRESS_VALUES = new Set(STRESS_SYSTEMS.map((item) => item.value));

export function normalizeStressSystem(value) {
  return STRESS_VALUES.has(value) ? value : "none";
}

export function stressLabel(system) {
  return STRESS_SYSTEMS.find((item) => item.value === normalizeStressSystem(system))?.label || "No stress";
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

// The display mark sits before the whole syllable, as in ˈka.sa. Internally
// the stress array marks every token of the stressed syllable, which lets a
// rule condition on any segment in that syllable without special-casing
// onsets, nuclei, and codas.
export function prosodyFromSyllables(tokens, syllables, system) {
  const stressIndex = stressIndexOf(syllables, system);
  const stress = new Array(tokens.length).fill("");
  const boundaries = new Set([0, tokens.length]);
  let display = "";

  if (!syllables.length) {
    return {
      syllables: [],
      stressIndex: -1,
      stress,
      boundaries,
      display: tokens.join(""),
    };
  }

  for (const [index, syllable] of syllables.entries()) {
    boundaries.add(syllable.start);
    if (index === stressIndex) {
      for (let position = syllable.start; position < syllable.end; position += 1) {
        stress[position] = "ˈ";
      }
    }
  }

  display = syllables
    .map((syllable, index) =>
      `${index === stressIndex ? "ˈ" : ""}${syllable.tokens.join("")}`
    )
    .join(".");

  return { syllables, stressIndex, stress, boundaries, display };
}

// When no syllable template parses a word, stress still deserves a sensible
// preview. Treat each vowel run as a nucleus and give every inter-vocalic
// consonant to the following onset (the maximal-onset default). Word-final
// consonants stay in the last coda.
export function fallbackSyllables(tokens, isVowel) {
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

export function prosodyFallback(tokens, isVowel, system) {
  const syllables = fallbackSyllables(tokens, isVowel);
  if (!syllables.length) {
    return {
      syllables: [],
      stressIndex: -1,
      stress: new Array(tokens.length).fill(""),
      boundaries: new Set([0, tokens.length]),
      display: tokens.join(""),
    };
  }
  return prosodyFromSyllables(tokens, syllables, system);
}
