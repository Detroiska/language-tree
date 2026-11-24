// Attested sound-change library: rule groups written in this project's
// notation and offered as inspiration when a language needs a starting
// point. Every group is illustrative — the changes really happened, but in
// particular historical settings, not universally. Groups insert as
// disabled rules so nothing applies before they are reviewed against the
// language's own inventory.
//
// Keep this module DOM-free (a plain data module) so Node tests can import
// it: tests/engine.test.mjs compiles every rule against a reference
// inventory and checks the draft shape.

import { DEFAULT_RULE_RATE, uid } from "./model.js";

export const soundChangeLibrary = [
  {
    id: "grimms-law",
    name: "Grimm's law",
    tag: "Proto-Germanic",
    description: "The first Germanic consonant shift: voiceless stops spirantize, voiced stops devoice, and voiced aspirates lose their aspiration.",
    rules: [
      { notation: "p > f" },
      { notation: "t > θ" },
      { notation: "k > x", detail: "kʷ shifts dialectally" },
      { notation: "b > p" },
      { notation: "d > t" },
      { notation: "g > k" },
      { notation: "bʰ > b" },
      { notation: "dʰ > d" },
      { notation: "gʰ > g" },
    ],
  },
  {
    id: "verners-law",
    name: "Verner's law",
    tag: "Proto-Germanic",
    description: "Grimm's voiceless fricatives voice outside word-initial position. PIE accent conditioned the change; this simplified rule voices fricatives after a vowel.",
    rules: [
      { notation: "f > v / V _" },
      { notation: "θ > ð / V _" },
      { notation: "x > ɣ / V _" },
      { notation: "s > z / V _", detail: "later rhotacized in Norse and English" },
    ],
  },
  {
    id: "high-german-shift",
    name: "High German consonant shift",
    tag: "Old High German",
    description: "The second Germanic consonant shift: voiceless stops affricate word-initially in High German (Upper German; outcomes vary by dialect).",
    rules: [
      { notation: "p > p͡f / # _" },
      { notation: "t > t͡s / # _" },
      { notation: "k > k͡x / # _", detail: "often simplified to x later" },
    ],
  },
  {
    id: "slavic-palatalization",
    name: "Slavic palatalization",
    tag: "Common Slavic",
    description: "The first Slavic palatalization: velars become palatals before front vowels (i and e stand for the front-vowel series).",
    rules: [
      { notation: "k > t͡ʃ / _ [i e]" },
      { notation: "g > ʒ / _ [i e]" },
      { notation: "x > ʃ / _ [i e]" },
    ],
  },
  {
    id: "celtic-lenition",
    name: "Insular Celtic lenition",
    tag: "Old Irish / Brittonic",
    description: "Single stops lenite to fricatives after a vowel — the ancestor of the later Initial Mutations.",
    rules: [
      { notation: "p > f / V _" },
      { notation: "t > θ / V _" },
      { notation: "k > x / V _" },
      { notation: "b > v / V _" },
      { notation: "d > ð / V _" },
      { notation: "g > ɣ / V _" },
    ],
  },
  {
    id: "latin-rhotacism",
    name: "Latin rhotacism",
    tag: "Old Latin",
    description: "Intervocalic s becomes r, which is why nominative s-forms diverge from their perfect and future stems.",
    rules: [
      { notation: "s > r / V _ V", detail: "the attested gener and honor also shift vowels later" },
    ],
  },
];

// Comparison key for "is this rule already in the language?" - notation
// whitespace is not significant, so the panel and the insert handler agree.
export function normalizeLibraryNotation(notation) {
  return String(notation || "").trim().replace(/\s+/gu, " ");
}

// Draft rule records for one group: disabled, labeled with their source, and
// the same shape the tab's own "Add rule" button produces. `present` holds
// notations already recorded in the language; those rules are skipped so a
// partially inserted group only adds what is missing.
export function newLibraryRules(group, present = []) {
  const presentNotations = new Set(
    Array.from(present, (notation) => normalizeLibraryNotation(notation)).filter(Boolean)
  );
  return (group?.rules || [])
    .filter((rule) => !presentNotations.has(normalizeLibraryNotation(rule.notation)))
    .map((rule) => ({
      id: uid("rule"),
      notation: rule.notation,
      note: rule.detail ? `${group.name} (illustrative): ${rule.detail}` : `${group.name} (illustrative)`,
      enabled: false,
      optional: false,
      rate: DEFAULT_RULE_RATE,
      exceptions: [],
      parentId: null,
    }));
}
