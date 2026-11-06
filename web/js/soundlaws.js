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
    description: "The first Germanic consonant shift: voiceless stops spiralize, voiced stops devoice, and voiced aspirates lose their aspiration.",
    rules: [
      { notation: "p > f", note: "voiceless labial stop becomes a fricative" },
      { notation: "t > θ", note: "voiceless dental stop becomes a fricative" },
      { notation: "k > x", note: "voiceless velar stop becomes a fricative (kʷ shifts dialectally)" },
      { notation: "b > p", note: "voiced labial stop devoices" },
      { notation: "d > t", note: "voiced dental stop devoices" },
      { notation: "g > k", note: "voiced velar stop devoices" },
      { notation: "bʰ > b", note: "breathy labial stop loses its aspiration" },
      { notation: "dʰ > d", note: "breathy dental stop loses its aspiration" },
      { notation: "gʰ > g", note: "breathy velar stop loses its aspiration" },
    ],
  },
  {
    id: "verners-law",
    name: "Verner's law",
    tag: "Proto-Germanic",
    description: "Grimm's voiceless fricatives voice outside word-initial position. PIE accent conditioned the change; this simplified rule voices fricatives after a vowel.",
    rules: [
      { notation: "f > v / V _", note: "v after a vowel" },
      { notation: "θ > ð / V _", note: "ð after a vowel" },
      { notation: "x > ɣ / V _", note: "ɣ after a vowel" },
      { notation: "s > z / V _", note: "z after a vowel (later rhotacized in Norse and English)" },
    ],
  },
  {
    id: "high-german-shift",
    name: "High German consonant shift",
    tag: "Old High German",
    description: "The second Germanic consonant shift: voiceless stops affricate word-initially in High German (Upper German; outcomes vary by dialect).",
    rules: [
      { notation: "p > p͡f / # _", note: "p affricates word-initially" },
      { notation: "t > t͡s / # _", note: "t affricates word-initially" },
      { notation: "k > k͡x / # _", note: "k affricates word-initially, often simplified to x later" },
    ],
  },
  {
    id: "slavic-palatalization",
    name: "Slavic palatalization",
    tag: "Common Slavic",
    description: "The first Slavic palatalization: velars become palatals before front vowels (i and e stand for the front-vowel series).",
    rules: [
      { notation: "k > t͡ʃ / _ [i e]", note: "k becomes a postalveolar affricate before a front vowel" },
      { notation: "g > ʒ / _ [i e]", note: "g becomes a postalveolar fricative before a front vowel" },
      { notation: "x > ʃ / _ [i e]", note: "x becomes a postalveolar fricative before a front vowel" },
    ],
  },
  {
    id: "celtic-lenition",
    name: "Insular Celtic lenition",
    tag: "Old Irish / Brittonic",
    description: "Single stops lenite to fricatives after a vowel — the ancestor of the later Initial Mutations.",
    rules: [
      { notation: "p > f / V _", note: "p lenites after a vowel" },
      { notation: "t > θ / V _", note: "t lenites after a vowel" },
      { notation: "k > x / V _", note: "k lenites after a vowel" },
      { notation: "b > v / V _", note: "b lenites after a vowel" },
      { notation: "d > ð / V _", note: "d lenites after a vowel" },
      { notation: "g > ɣ / V _", note: "g lenites after a vowel" },
    ],
  },
  {
    id: "latin-rhotacism",
    name: "Latin rhotacism",
    tag: "Old Latin",
    description: "Intervocalic s becomes r, which is why nominative s-forms diverge from their perfect and future stems.",
    rules: [
      { notation: "s > r / V _", note: "s becomes r after a vowel (the attested gener and honor also shifted vowels later)" },
    ],
  },
];

// Draft rule records for one group: disabled, self-describing notes, and the
// same shape the tab's own "Add rule" button produces.
export function newLibraryRules(group) {
  return (group?.rules || []).map((rule) => ({
    id: uid("rule"),
    notation: rule.notation,
    note: `${group.name} (illustrative): ${rule.note}`,
    enabled: false,
    optional: false,
    rate: DEFAULT_RULE_RATE,
    exceptions: [],
    parentId: null,
  }));
}
