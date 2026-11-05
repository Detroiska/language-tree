// Engine tests for Language Tree — plain Node, no framework and no DOM.
//
//   node tests/engine.test.mjs
//
// The parser modules (model, phonology, phonotactics, naturalclasses) and the
// report builder are DOM-free ES modules, so they import and run directly.
// Every assertion prints a line; the process exits non-zero on any failure.

import {
  allophonyEntries,
  allophonyRules,
  createAncestor,
  createLanguage,
  createSibling,
  defaultInventory,
  ensureProject,
  groupAllophonyRules,
  ruleNumberMap,
} from "../web/js/model.js";
import {
  allophoneCandidates,
  allophoneTable,
  contextForAllophony,
  contextForInventory,
  contextForLanguage,
  compileRule,
  applyRule,
  compileChainFrom,
  deriveForm,
  deriveStages,
  explainRuleMiss,
  normalizeAllophonyNotation,
  surfaceForForm,
} from "../web/js/phonology.js";
import { formatPhonemic, formatPhonetic, stripLevelMarks } from "../web/js/notation.js";
import { compileClasses } from "../web/js/categories.js";
import {
  IPA_FEATURES,
  applyFeatureTerms,
  classifyFeatureWords,
  createFeatureResolver,
  defaultBundle,
  derivedFeatures,
  featureDistance,
  featureMembers,
  resolveFeatureBundle,
} from "../web/js/features.js";
import { compilePhonotactics, createPhonotacticsChecker } from "../web/js/phonotactics.js";
import { buildHtml, buildMarkdown } from "../web/js/report.js";
import { decodeHashPart } from "../web/js/routes.js";
import { alignSegments, diffPairMarkup, formDiffMarkup } from "../web/js/diff.js";
import { analyzeLexicon } from "../web/js/analytics.js";
import { filterSuggestions, matchesQuery, suggestQuery } from "../web/js/naturalclasses.js";

let passed = 0;
const failures = [];

function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    return;
  }
  failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
}

function truthy(name, condition) {
  if (condition) passed += 1;
  else failures.push(`${name}\n    expected a truthy result`);
}

/* ---- shared fixtures ---------------------------------------------------- */

function makeChart(rows, cols, cells) {
  const chart = defaultInventory().consonants;
  chart.rows = rows.map((label) => ({ id: `r_${label}`, label, children: [] }));
  chart.columns = cols.map((label) => ({ id: `c_${label}`, label, children: [] }));
  chart.cells = {};
  for (const [row, col, sounds] of cells) chart.cells[`r_${row}|c_${col}`] = sounds;
  return chart;
}

const consonants = makeChart(
  ["Plosive", "Nasal", "Fricative"],
  ["Bilabial", "Alveolar", "Velar"],
  [
    ["Plosive", "Bilabial", ["p"]],
    ["Plosive", "Alveolar", ["t"]],
    ["Plosive", "Velar", ["k"]],
    ["Nasal", "Bilabial", ["m"]],
    ["Nasal", "Alveolar", ["n"]],
    ["Fricative", "Alveolar", ["s"]],
    ["Fricative", "Velar", ["x"]],
  ]
);
const vowels = makeChart(
  ["Close", "Open"],
  ["Front", "Back"],
  [
    ["Close", "Front", ["i"]],
    ["Close", "Back", ["u"]],
    ["Open", "Front", ["a"]],
    ["Open", "Back", ["ɑ"]],
  ]
);
const inventory = { consonants, vowels };
const ctx = contextForInventory(inventory);

const apply = (notation, form) => {
  const compiled = compileRule(notation, ctx);
  if (!compiled.ok) return { error: compiled.error };
  const tokens = ctx.tokenize(form);
  return { out: applyRule(tokens, compiled.rule, ctx).tokens.join("") };
};

/* ---- hash routing ------------------------------------------------------- */

equal("valid hash segments decode", decodeHashPart("Proto%20North"), "Proto North");
equal("malformed hash escapes survive as text", decodeHashPart("%zz"), "%zz");

/* ---- rule engine -------------------------------------------------------- */

equal("lenition between vowels", apply("p > f / V _ V", "apa"), { out: "afa" });
equal("no lenition word-initial", apply("p > f / V _ V", "pat"), { out: "pat" });
equal("word-final vowel deletion", apply("V > ∅ / _ #", "kasa"), { out: "kas" });
equal("word-initial voicing", apply("s > z / # _", "sas"), { out: "zas" });
equal("set deletion", apply("[td] > ∅ / _ #", "kat"), { out: "ka" });
equal("cluster simplification", apply("C > ∅ / _ C", "akta"), { out: "ata" });
equal("arrow variant ->", apply("p -> f", "apa"), { out: "afa" });
equal("arrow variant →", apply("p → f", "apa"), { out: "afa" });
equal("zero as deletion", apply("a > 0 / _ #", "kasa"), { out: "kas" });
equal("multi-segment input", apply("ai > e", "kai"), { out: "ke" });
equal("non-overlapping matches", apply("aa > b", "aaa"), { out: "ba" });
equal("negated set", apply("[^a] > ∅ / _ #", "kamas"), { out: "kama" });
equal("boundaries on both sides", apply("a > b / # _ #", "a"), { out: "b" });
equal("boundaries reject longer words", apply("a > b / # _ #", "ka"), { out: "ka" });
equal("unconditional deletion", apply("a > ∅", "kasa"), { out: "ks" });
equal("insertion between vowels", apply("∅ > ʔ / V _ V", "aa"), { out: "aʔa" });
equal("insertion at every matching boundary", apply("∅ > ʔ / V _ V", "aaa"), { out: "aʔaʔa" });
equal("insertion respects its environment", apply("∅ > ʔ / V _ V", "apa"), { out: "apa" });

/* ---- chart-derived classes ---------------------------------------------- */

equal("chart class plosive.velar", apply("plosive.velar > ∅ / _ #", "tak"), { out: "ta" });
equal("chart class back vowels", apply("back > a / _ #", "ku"), { out: "ka" });
equal("class in environment", apply("t > k / _ back", "tu"), { out: "ku" });
const brokenClass = compileRule("t > k / _ nosuch.label", ctx);
truthy("broken dotted class fails loudly", !brokenClass.ok && /No chart row or column/.test(brokenClass.error));
const bareUnknown = compileRule("t > k / _ nosuchlabel", ctx);
truthy(
  "bare unknown label warns about uncharted sounds",
  bareUnknown.ok && bareUnknown.warnings?.length > 0,
);
const typoConsonants = makeChart(
  ["Plosive"],
  ["Bilabial", "Velar"],
  [
    ["Plosive", "Bilabial", ["b", "t"]],
    ["Plosive", "Velar", ["c", "k"]],
  ]
);
const typoVowels = makeChart(["Open"], ["Front"], [["Open", "Front", ["a"]]]);
const typoCtx = contextForInventory({ consonants: typoConsonants, vowels: typoVowels });
const chartedTypo = compileRule("t > k / _ back", typoCtx);
truthy(
  "a bare word made only of charted sounds still warns when it is not a class",
  chartedTypo.ok && chartedTypo.warnings?.some((warning) => warning.includes("back") && warning.includes("literal"))
);
equal(
  "the warning does not hide the literal fallback",
  chartedTypo.rule.right.map((atom) => atom.value),
  ["b", "a", "c", "k"]
);
const literalCluster = compileRule("t > k / _ bk", typoCtx);
truthy(
  "a consonant cluster is not mistaken for a mistyped class",
  literalCluster.ok && !literalCluster.warnings?.length
);

/* ---- tokenizer ---------------------------------------------------------- */

equal("tokenizes charted phonemes", ctx.tokenize("kasa"), ["k", "a", "s", "a"]);
const affricateChart = makeChart(
  ["Affricate", "Plosive"],
  ["Alveolar", "Velar"],
  [
    ["Affricate", "Alveolar", ["t͡ʃ"]],
    ["Plosive", "Alveolar", ["t"]],
    ["Plosive", "Velar", ["k"]],
  ]
);
const affricateVowels = makeChart(["Open"], ["Front"], [["Open", "Front", ["a"]]]);
const affricateCtx = contextForInventory({ consonants: affricateChart, vowels: affricateVowels });
equal("tie-bar affricate is one token", affricateCtx.tokenize("at͡ʃa"), ["a", "t͡ʃ", "a"]);

const looseTieChart = makeChart(
  ["Plosive", "Nasal", "Fricative"],
  ["Bilabial", "Alveolar", "Postalveolar"],
  [
    ["Plosive", "Bilabial", ["b"]],
    ["Plosive", "Alveolar", ["t"]],
    ["Nasal", "Bilabial", ["m"]],
    ["Fricative", "Postalveolar", ["ʃ"]],
  ]
);
const looseTieCtx = contextForInventory({ consonants: looseTieChart, vowels: affricateVowels });
equal(
  "uncharted tie-bar affricate keeps its charted first base",
  looseTieCtx.tokenize("at͡ʃa"),
  ["a", "t͡ʃ", "a"]
);
equal(
  "uncharted prenasalized tie-bar keeps its charted first base",
  looseTieCtx.tokenize("am͜ba"),
  ["a", "m͜b", "a"]
);

/* ---- inert-rule warnings ------------------------------------------------ */

const compact = compileRule("CV > x", ctx);
truthy("compact CV compiles", compact.ok);
truthy(
  "compact CV warns about literal letters",
  compact.ok && compact.warnings?.length > 0 && compact.warnings[0].includes("C"),
);
const uncharted = compileRule("q > k", ctx);
truthy("uncharted input warns", uncharted.ok && uncharted.warnings?.length > 0);
const charted = compileRule("p > f", ctx);
truthy("charted input does not warn", charted.ok && !(charted.warnings?.length > 0));
const aspiratedOnlyCtx = contextForInventory({
  consonants: makeChart(["Plosive"], ["Bilabial"], [["Plosive", "Bilabial", ["pʰ"]]]),
  vowels: makeChart(["Open"], ["Front"], [["Open", "Front", ["a"]]]),
});
const bareBase = compileRule("p > f", aspiratedOnlyCtx);
truthy(
  "a bare base of a charted aspirate counts as a known sound",
  bareBase.ok && !(bareBase.warnings?.length > 0)
);

/* ---- derivation across a lineage ---------------------------------------- */

const language = {
  inventory,
  phonotactics: { template: "(C)V(C)", onsets: "", codas: "", forbidden: "", notes: "", classes: [] },
};
const project = {
  title: "Fixture",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "r1", notation: "p > f / V _ V", note: "", enabled: true },
        { id: "r2", notation: "s > ∅ / _ #", note: "", enabled: true },
        { id: "r3", notation: "k > q", note: "", enabled: false },
      ],
      vocabulary: [],
    },
  ],
};
equal("direct rules apply to the ancestral form", deriveForm("apas", project, "child", { directOnly: true }).text, "afa");
equal("disabled rules are skipped", deriveForm("kapta", project, "child", { directOnly: true }).text, "kapta");

/* ---- two-tier rules ----------------------------------------------------- */

function stagedProject(soundChanges) {
  return {
    title: "Staged",
    languages: [
      { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
      { id: "child", name: "Child", parentId: "root", ...language, soundChanges, vocabulary: [] },
    ],
  };
}

const parallel = stagedProject([
  { id: "r1", notation: "i > ∅ / _ #", note: "", enabled: true, parentId: null },
  { id: "r2", notation: "a > e / _ i", note: "", enabled: true, parentId: null },
]);
equal(
  "top-level rules all match the ancestral form",
  deriveForm("pai", parallel, "child", { directOnly: true }).text,
  "pe"
);

const reversed = stagedProject([...parallel.languages[1].soundChanges].reverse());
equal(
  "top-level rule order does not change matching",
  deriveForm("pai", reversed, "child", { directOnly: true }).text,
  "pe"
);

const insertionStage = stagedProject([
  { id: "r1", notation: "∅ > ʔ / V _ V", note: "", enabled: true, parentId: null },
]);
equal(
  "top-level insertion applies to the ancestral form",
  deriveForm("aa", insertionStage, "child", { directOnly: true }).text,
  "aʔa"
);

const sequential = stagedProject([
  { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null },
  { id: "c1", notation: "a > e / f _", note: "", enabled: true, parentId: "r1" },
  { id: "c2", notation: "t > s / e _", note: "", enabled: true, parentId: "r1" },
]);
equal(
  "sequential rules run in order after the ancestral pass",
  deriveForm("pata", sequential, "child", { directOnly: true }).text,
  "fesa"
);

const childCannotFeedTopLevel = stagedProject([
  { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null },
  { id: "c1", notation: "a > e / f _", note: "", enabled: true, parentId: "r1" },
  { id: "r2", notation: "t > s / e _", note: "", enabled: true, parentId: null },
]);
equal(
  "a sequential rule cannot feed a top-level rule",
  deriveForm("pata", childCannotFeedTopLevel, "child", { directOnly: true }).text,
  "feta"
);

const overlapping = stagedProject([
  { id: "r1", notation: "t > s", note: "", enabled: true, parentId: null },
  { id: "r2", notation: "t > k", note: "", enabled: true, parentId: null },
]);
const conflict = deriveForm("pata", overlapping, "child", { directOnly: true });
truthy("overlapping top-level rules report an error", /overlapping parts/.test(conflict.error));
equal("a conflict leaves the ancestral form underived", conflict.text, "pata");

const sequentialOverlap = stagedProject([
  { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null },
  { id: "c1", notation: "f > v", note: "", enabled: true, parentId: "r1" },
]);
const sequentialResult = deriveForm("pata", sequentialOverlap, "child", { directOnly: true });
equal("sequential rules may change their parent's output", sequentialResult.text, "vata");
equal("sequential overlap is not a conflict", sequentialResult.error, "");

const disabledParent = stagedProject([
  { id: "r1", notation: "p > f", note: "", enabled: false, parentId: null },
  { id: "c1", notation: "a > e / f _", note: "", enabled: true, parentId: "r1" },
]);
equal(
  "disabling a top-level rule disables its sequential children",
  deriveForm("pata", disabledParent, "child", { directOnly: true }).text,
  "pata"
);

const emptyRule = stagedProject([{ id: "r1", notation: "", note: "", enabled: true, parentId: null }]);
const emptyResult = deriveForm("pata", emptyRule, "child", { directOnly: true });
equal("an empty rule leaves the form unchanged", emptyResult.text, "pata");
equal("an empty rule is not a hard derivation error", emptyResult.error, "");

const emptyParentWithChild = stagedProject([
  { id: "r1", notation: "", note: "", enabled: true, parentId: null },
  { id: "c1", notation: "a > e", note: "", enabled: true, parentId: "r1" },
]);
equal(
  "an empty parent does not block its sequential children",
  deriveForm("pata", emptyParentWithChild, "child", { directOnly: true }).text,
  "pete"
);

const interleaved = ensureProject({
  title: "Interleaved",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      soundChanges: [
        { id: "r1", notation: "a > e", note: "", enabled: true },
        { id: "r2", notation: "e > i", note: "", enabled: true },
        { id: "c1", notation: "i > u", note: "", enabled: true, parentId: "r1" },
      ],
      vocabulary: [],
    },
  ],
});
const normalizedRules = interleaved.languages[0].soundChanges;
equal(
  "rule normalization keeps sequential rules with their parent",
  normalizedRules.map((rule) => rule.id),
  ["r1", "c1", "r2"]
);
const normalizedNumbers = ruleNumberMap(normalizedRules);
equal("sequential rules receive dotted numbers", normalizedNumbers.get("c1"), "1.1");
equal("later top-level rules keep whole numbers", normalizedNumbers.get("r2"), "2");

const depthProject = {
  title: "Depth",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [{ id: "r1", notation: "p > f", note: "", enabled: true, parentId: null }],
      vocabulary: [],
    },
    {
      id: "grandchild",
      name: "Grandchild",
      parentId: "child",
      ...language,
      soundChanges: [{ id: "r2", notation: "f > v", note: "", enabled: true, parentId: null }],
      vocabulary: [],
    },
  ],
};
equal(
  "each generation applies its rules to the previous generation's output",
  deriveForm("pata", depthProject, "grandchild").text,
  "vata"
);

const chainConsonants = makeChart(
  ["Plosive", "Nasal"],
  ["Bilabial", "Alveolar", "Velar"],
  [
    ["Plosive", "Bilabial", ["p"]],
    ["Plosive", "Alveolar", ["t"]],
    ["Plosive", "Velar", ["k"]],
    ["Nasal", "Bilabial", ["m"]],
    ["Nasal", "Alveolar", ["n"]],
    ["Nasal", "Velar", ["ŋ"]],
  ]
);
const chainBase = {
  inventory: { consonants: chainConsonants, vowels },
  phonotactics: { template: "(C)V(C)", onsets: "", codas: "", forbidden: "", notes: "", classes: [] },
};
const chainCategoryProject = {
  title: "Chain categories",
  languages: [
    { id: "root", name: "Root", parentId: null, ...chainBase, soundChanges: [], vocabulary: [] },
    {
      id: "mid",
      name: "Mid",
      parentId: "root",
      ...chainBase,
      phonotactics: { ...chainBase.phonotactics, classes: [{ name: "N", sounds: "m n ŋ" }] },
      soundChanges: [{ id: "r1", notation: "N > ∅ / _ #", note: "", enabled: true }],
      vocabulary: [],
    },
    {
      id: "leaf",
      name: "Leaf",
      parentId: "mid",
      ...chainBase,
      phonotactics: { ...chainBase.phonotactics, classes: [{ name: "N", sounds: "m n" }] },
      soundChanges: [],
      vocabulary: [],
    },
  ],
};
equal(
  "a chain stage compiles its rules with that stage's categories",
  deriveForm("maŋ", chainCategoryProject, "leaf").text,
  "ma"
);
const categoryChain = compileChainFrom(chainCategoryProject, "root", "leaf");
const categoryChainResult = deriveStages(
  categoryChain.context.tokenize("maŋ"),
  categoryChain.stages,
  categoryChain.context
);
equal(
  "the cognate chain keeps each generation's category meaning",
  categoryChainResult.tokens.join(""),
  "ma"
);

/* ---- phonotactics ------------------------------------------------------- */

const checker = createPhonotacticsChecker({ ...language });
const validate = (form) => {
  const result = checker.validate(form);
  return { ok: result.ok, syllables: result.syllableText, issueTypes: result.issues.map((issue) => issue.type) };
};
equal("valid word syllabifies", validate("kasa"), { ok: true, syllables: "ka.sa", issueTypes: [] });
equal("invalid onset cluster rejected", validate("ssa"), { ok: false, syllables: "", issueTypes: ["syllable"] });

const constrained = createPhonotacticsChecker({
  ...language,
  phonotactics: {
    template: "(C)V(C)",
    onsets: "",
    codas: "",
    forbidden: "VV, #s, k#",
    notes: "",
    classes: [],
  },
});
const validate2 = (form) => constrained.validate(form).issues.map((issue) => issue.type);
equal("forbidden hiatus", validate2("pau"), ["forbidden"]);
equal("forbidden word-initial s", validate2("sasa"), ["forbidden"]);
equal("forbidden word-final k", validate2("tatak"), ["forbidden"]);
equal("clean form passes constraints", validate2("tatas"), []);

const onsetLimited = createPhonotacticsChecker({
  ...language,
  phonotactics: {
    template: "(C)V(C)",
    onsets: "p, t",
    codas: "",
    forbidden: "",
    notes: "",
    classes: [],
  },
});
const validate3 = (form) => onsetLimited.validate(form).issues.map((issue) => issue.type);
equal("onset not in allowed list", validate3("sa"), ["onset"]);
equal("allowed onset passes", validate3("ta"), []);

const forbiddenOnset = createPhonotacticsChecker({
  ...language,
  phonotactics: {
    template: "(C)V(C)",
    onsets: "t",
    codas: "",
    onsetsMode: "forbidden",
    codasMode: "allowed",
    forbiddenOnsets: "s, x",
    forbiddenCodas: "",
    forbidden: "",
    notes: "",
    classes: [],
  },
});
const validate4 = (form) => forbiddenOnset.validate(form).issues.map((issue) => issue.type);
equal("forbidden onset rejected", validate4("sa"), ["onset"]);
equal("other onset passes", validate4("ta"), []);
equal("inactive allowed list is ignored in forbidden mode", validate4("ka"), []);

const forbiddenCoda = createPhonotacticsChecker({
  ...language,
  phonotactics: {
    template: "(C)V(C)",
    onsets: "",
    codas: "",
    onsetsMode: "allowed",
    codasMode: "forbidden",
    forbiddenOnsets: "",
    forbiddenCodas: "n, s",
    forbidden: "",
    notes: "",
    classes: [],
  },
});
const validate5 = (form) => forbiddenCoda.validate(form).issues.map((issue) => issue.type);
equal("forbidden coda rejected", validate5("pan"), ["coda"]);
equal("other coda passes", validate5("pat"), []);
equal("open syllable passes forbidden coda list", validate5("pa"), []);

const migrated = ensureProject({
  title: "Modes",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      phonotactics: { template: "(C)V(C)", onsets: "p, t" },
      soundChanges: [],
      vocabulary: [],
    },
  ],
});
const migratedPhonotactics = migrated.languages[0].phonotactics;
equal(
  "phonotactic constraint modes default to allowed",
  [migratedPhonotactics.onsetsMode, migratedPhonotactics.codasMode],
  ["allowed", "allowed"],
);
equal(
  "missing forbidden lists normalize to empty",
  [migratedPhonotactics.forbiddenOnsets, migratedPhonotactics.forbiddenCodas],
  ["", ""],
);

const cyclic = createPhonotacticsChecker({
  ...language,
  phonotactics: {
    template: "NV",
    onsets: "",
    codas: "",
    forbidden: "",
    notes: "",
    classes: [
      { name: "A", sounds: "B" },
      { name: "B", sounds: "A" },
    ],
  },
});
truthy(
  "cyclic categories report errors",
  cyclic.compiled.classes.entries.every((entry) => entry.errors.length > 0),
);

// A bracketed chart class with a typo must surface as a constraint error,
// not escape compilePhonotactics as an exception (the README's own
// “[plosive.plain]#” example hits this on a chart without a Plain
// subdivision — it used to take the whole view down).
const brokenForbiddenSet = createPhonotacticsChecker({
  ...language,
  phonotactics: {
    template: "(C)V(C)",
    onsets: "",
    codas: "",
    forbidden: "VV, [nosuch.label], [plosive.plain]#",
    notes: "",
    classes: [],
  },
});
truthy(
  "broken class in a forbidden set is a constraint error, not a crash",
  brokenForbiddenSet.compiled.ok &&
    brokenForbiddenSet.compiled.constraintErrors.length === 2 &&
    /No chart row or column is labelled/.test(brokenForbiddenSet.compiled.constraintErrors[0]),
);
truthy(
  "words still validate while forbidden sets are broken",
  brokenForbiddenSet.validate("kasa").ok,
);

/* ---- notation ----------------------------------------------------------- */

equal("strip phonemic slashes", stripLevelMarks("/kasa/"), "kasa");
equal("strip phonetic brackets", stripLevelMarks("[kʰasa]"), "kʰasa");
equal("strip trims surrounding whitespace", stripLevelMarks("  /kasa/  "), "kasa");
equal("plain form is unchanged", stripLevelMarks("kasa"), "kasa");
equal("a lone slash is not a delimiter", stripLevelMarks("/"), "/");
equal("format phonemic", formatPhonemic("kasa"), "/kasa/");
equal("format phonetic replaces existing level marks", formatPhonetic("/kʰasa/"), "[kʰasa]");
equal("format empty form", formatPhonemic("  "), "");

/* ---- allophony ---------------------------------------------------------- */

equal(
  "normalizes standard allophony notation",
  normalizeAllophonyNotation("/p/ > [pʰ] / # _ V"),
  "p > pʰ / # _ V"
);
equal(
  "normalizes compact allophony notation",
  normalizeAllophonyNotation("p > pʰ / # _ V"),
  "p > pʰ / # _ V"
);
equal("normalizes the arrow variant", normalizeAllophonyNotation("/t/ → [t͡s] / _ i"), "t → t͡s / _ i");
equal(
  "allophone candidates keep affricates whole",
  allophoneCandidates([{ notation: "/t/ > [t͡s] / _ i" }]),
  ["t͡s"]
);

const allophonyProject = ensureProject({
  title: "Allophony",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      inventory,
      soundChanges: [],
      vocabulary: [
        { id: "rw", gloss: "water", form: "kasa" },
        { id: "rs", gloss: "stone", form: "pata" },
      ],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      inventory,
      soundChanges: [{ id: "r1", notation: "t > d / V _ V", note: "", enabled: true }],
      allophony: [
        { id: "a1", notation: "/k/ > [kʰ] / # _", note: "", enabled: true },
        { id: "a2", notation: "/s/ > [z] / V _ V", note: "", enabled: true },
        { id: "a3", notation: "/p/ > [f]", note: "", enabled: false },
      ],
      vocabulary: [{ id: "cw", gloss: "water", form: "kasa" }],
    },
  ],
});

const childSurface = surfaceForForm("/kasa/", allophonyProject, "child");
equal("allophony applies in list order", childSurface.text, "kʰaza");
equal("an uncharted allophone stays one token", childSurface.tokens, ["kʰ", "a", "z", "a"]);
equal("surface input accepts level delimiters", childSurface.input.join(""), "kasa");
equal("a disabled allophony rule is skipped", surfaceForForm("pata", allophonyProject, "child").text, "pata");

const orderProject = ensureProject({
  title: "Order",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [
        { id: "o1", notation: "/a/ > [e]", note: "", enabled: true },
        { id: "o2", notation: "/e/ > [i]", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});
equal("allophony rules chain", surfaceForForm("a", orderProject, "only").text, "i");
orderProject.languages[0].allophony.reverse();
equal("reversing allophony order changes the surface", surfaceForForm("a", orderProject, "only").text, "e");

const insertionProject = ensureProject({
  title: "Insertion",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [{ id: "i1", notation: "∅ -> [ʔ] / V_V", note: "", enabled: true }],
      vocabulary: [],
    },
  ],
});
equal(
  "allophony inserts a glottal stop between adjacent vowels",
  surfaceForForm("aa", insertionProject, "only").text,
  "aʔa"
);
equal("allophony insertion leaves other forms alone", surfaceForForm("apa", insertionProject, "only").text, "apa");

const groupedProject = ensureProject({
  title: "Groups",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [
        {
          id: "grp1",
          type: "group",
          name: "Intervocalic voicing",
          collapsed: false,
          enabled: true,
          rules: [
            { id: "g1", notation: "/p/ -> [b] / V_V", note: "", enabled: true },
            { id: "g2", notation: "/t/ -> [d] / V_V", note: "", enabled: true },
          ],
        },
        { id: "g3", notation: "/k/ -> [g] / V_V", note: "", enabled: true },
        {
          id: "grp2",
          type: "group",
          name: "Final lowering",
          collapsed: false,
          enabled: true,
          rules: [{ id: "g4", notation: "/a/ -> [ɑ] / _#", note: "", enabled: true }],
        },
      ],
      vocabulary: [],
    },
  ],
});
const groupedLanguage = groupedProject.languages[0];
equal(
  "grouped allophony gets dotted rule numbers",
  allophonyEntries(groupedLanguage.allophony).map((entry) => entry.number),
  ["1.1", "1.2", "2", "3.1"]
);
equal(
  "groups flatten back into their application order",
  allophonyRules(groupedLanguage.allophony).map((rule) => rule.id),
  ["g1", "g2", "g3", "g4"]
);
equal("grouped allophony applies in order", surfaceForForm("apata", groupedProject, "only").text, "abadɑ");
groupedLanguage.allophony[0].enabled = false;
equal("a disabled group is skipped by the engine", surfaceForForm("apata", groupedProject, "only").text, "apatɑ");
groupedLanguage.allophony[0].enabled = true;
const groupedTable = allophoneTable(groupedProject, "only");
equal(
  "the allophone table uses group-aware rule numbers",
  groupedTable.rows.map((row) => [row.phoneme, row.label]),
  [["p", "1.1"], ["t", "1.2"], ["k", "2"], ["a", "3.1"]]
);
const groupedCopy = createLanguage(
  "Copy",
  "only",
  groupedLanguage.inventory,
  groupedLanguage.phonotactics,
  groupedLanguage.allophony
);
equal(
  "a daughter copies grouped allophony",
  allophonyEntries(groupedCopy.allophony).map((entry) => [entry.number, entry.rule.id]),
  [["1.1", "g1"], ["1.2", "g2"], ["2", "g3"], ["3.1", "g4"]]
);
groupedCopy.allophony[0].rules[0].notation = "/p/ -> [v] / V_V";
equal("copied groups are independent", groupedLanguage.allophony[0].rules[0].notation, "/p/ -> [b] / V_V");

const groupRule = (id) => ({ id, notation: `/${id}/ -> [${id}]`, note: "", enabled: true });
const flatGrouping = {
  allophony: [groupRule("a"), groupRule("b"), groupRule("c"), groupRule("d")],
};
equal("grouping adjacent rules succeeds", groupAllophonyRules(flatGrouping, ["b", "c"]), "ok");
equal(
  "grouping names the new group after the selected rules",
  allophonyEntries(flatGrouping.allophony).map((entry) => [entry.number, entry.rule.id]),
  [["1", "a"], ["2.1", "b"], ["2.2", "c"], ["3", "d"]]
);
equal(
  "grouping keeps the flattened order",
  allophonyRules(flatGrouping.allophony).map((rule) => rule.id),
  ["a", "b", "c", "d"]
);

const splitGrouping = {
  allophony: [groupRule("a"), groupRule("b"), groupRule("c")],
};
equal("a non-contiguous selection is refused", groupAllophonyRules(splitGrouping, ["a", "c"]), "noncontiguous");
equal(
  "a refused selection leaves the rules alone",
  allophonyRules(splitGrouping.allophony).map((rule) => rule.id),
  ["a", "b", "c"]
);

const existingGroup = {
  allophony: [
    {
      id: "g",
      type: "group",
      name: "G",
      collapsed: false,
      enabled: true,
      rules: [groupRule("a"), groupRule("b"), groupRule("c")],
    },
    groupRule("d"),
  ],
};
equal("a selection from a group's middle is refused", groupAllophonyRules(existingGroup, ["b"]), "inside");
equal(
  "the refused middle selection leaves the group alone",
  allophonyRules(existingGroup.allophony).map((rule) => rule.id),
  ["a", "b", "c", "d"]
);
equal("a prefix of a group can move out", groupAllophonyRules(existingGroup, ["a", "b"]), "ok");
equal(
  "a prefix group stays in flattened order",
  allophonyEntries(existingGroup.allophony).map((entry) => [entry.number, entry.rule.id]),
  [["1.1", "a"], ["1.2", "b"], ["2.1", "c"], ["3", "d"]]
);

const suffixGrouping = {
  allophony: [
    {
      id: "g1",
      type: "group",
      name: "First",
      collapsed: false,
      enabled: true,
      rules: [groupRule("a"), groupRule("b")],
    },
    {
      id: "g2",
      type: "group",
      name: "Second",
      collapsed: false,
      enabled: true,
      rules: [groupRule("c"), groupRule("d")],
    },
  ],
};
equal("a suffix and the next group's prefix can be grouped", groupAllophonyRules(suffixGrouping, ["b", "c"]), "ok");
equal(
  "grouping across two groups preserves order and numbers",
  allophonyEntries(suffixGrouping.allophony).map((entry) => [entry.number, entry.rule.id]),
  [["1.1", "a"], ["2.1", "b"], ["2.2", "c"], ["3.1", "d"]]
);

const fedAllophony = ensureProject({
  title: "Fed allophony",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [
        { id: "f1", notation: "/p/ > [pʰ] / _ #", note: "", enabled: true },
        { id: "f2", notation: "/pʰ/ > [b] / _ #", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});
const fedSurface = surfaceForForm("ap", fedAllophony, "only");
equal("an allophony rule feeds the next rule's input", fedSurface.text, "ab");
truthy(
  "a fed surface symbol is not reported as uncharted",
  fedSurface.compiled[1].ok && !(fedSurface.compiled[1].warnings || []).some((warning) => warning.includes("pʰ")),
);

const table = allophoneTable(allophonyProject, "child");
equal(
  "allophone table derives phoneme → surface rows",
  table.rows.map((row) => [row.phoneme, row.allophone]),
  [["k", "kʰ"], ["s", "z"]]
);

const parentOnlyProject = ensureProject({
  title: "Parent allophony",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [{ id: "p1", notation: "/p/ > [f]", note: "", enabled: true }],
      vocabulary: [],
    },
    { id: "child", name: "Child", parentId: "root", inventory, soundChanges: [], allophony: [], vocabulary: [] },
  ],
});
equal("ancestor allophony affects its own surface", surfaceForForm("pata", parentOnlyProject, "root").text, "fata");
equal(
  "ancestor allophony never feeds historical derivation",
  deriveForm("pata", parentOnlyProject, "child").text,
  "pata"
);
equal(
  "ancestor allophony never applies to a daughter's surface",
  surfaceForForm("pata", parentOnlyProject, "child").text,
  "pata"
);

const rootLanguage = parentOnlyProject.languages.find((item) => item.id === "root");
const copied = createLanguage("Copy", "root", rootLanguage.inventory, rootLanguage.phonotactics, rootLanguage.allophony);
equal("a daughter starts with a copy of the allophony list", copied.allophony.map((rule) => rule.notation), ["/p/ > [f]"]);
copied.allophony[0].notation = "/p/ > [v]";
equal("copied allophony rules are independent", rootLanguage.allophony[0].notation, "/p/ > [f]");

const migratedNotation = ensureProject({
  title: "Notation migration",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory: {
        consonants: makeChart(["Plosive"], ["Bilabial"], [["Plosive", "Bilabial", ["/p/", "[b]"]]]),
        vowels: makeChart(["Open"], ["Front"], [["Open", "Front", ["a"]]]),
      },
      soundChanges: [],
      allophony: [{ notation: "/p/ > [pʰ] / # _ V" }],
      vocabulary: [
        { gloss: "word", form: "/kasa/" },
        { gloss: "phone", form: "[kʰasa]" },
      ],
    },
  ],
});
equal(
  "chart cell delimiters are stripped on load",
  migratedNotation.languages[0].inventory.consonants.cells["r_Plosive|c_Bilabial"],
  ["p", "b"]
);
equal(
  "word form delimiters are stripped on load",
  migratedNotation.languages[0].vocabulary.map((word) => word.form),
  ["kasa", "kʰasa"]
);
equal(
  "missing allophony fields are normalized",
  migratedNotation.languages[0].allophony.map((rule) => ({
    notation: rule.notation,
    note: rule.note,
    enabled: rule.enabled,
  })),
  [{ notation: "/p/ > [pʰ] / # _ V", note: "", enabled: true }]
);
truthy("migrated allophony rules receive an id", Boolean(migratedNotation.languages[0].allophony[0].id));

/* ---- custom categories in rules ----------------------------------------- */

const categoryProject = ensureProject({
  title: "Categories",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [],
      vocabulary: [],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      inventory,
      phonotactics: {
        classes: [{ name: "N", sounds: "m n" }],
      },
      soundChanges: [{ id: "n1", notation: "N > ∅ / _ #", note: "", enabled: true }],
      allophony: [
        { id: "c1", notation: "/N/ > [ɲ] / _ i", note: "", enabled: true },
        { id: "c2", notation: "/a/ > [e] / _ N", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});

const categoryContext = contextForLanguage(categoryProject, "child");
const categoryInput = compileRule("N > ∅ / _ #", categoryContext);
equal(
  "a Phonotactics category matches its members in a sound change",
  applyRule(categoryContext.tokenize("man"), categoryInput.rule, categoryContext).tokens.join(""),
  "ma"
);
const categoryEnv = compileRule("a > e / _ N", categoryContext);
equal(
  "a category works in a sound-change environment",
  applyRule(categoryContext.tokenize("an"), categoryEnv.rule, categoryContext).tokens.join(""),
  "en"
);
const categorySet = compileRule("[N s] > z", categoryContext);
equal(
  "a category works inside a rule set",
  applyRule(categoryContext.tokenize("mas"), categorySet.rule, categoryContext).tokens.join(""),
  "zaz"
);
const escapedCategory = compileRule("\\N > x", categoryContext);
equal(
  "an escaped category name stays a literal sound",
  applyRule(categoryContext.tokenize("N"), escapedCategory.rule, categoryContext).tokens.join(""),
  "x"
);
const categoryOutput = compileRule("a > N", categoryContext);
truthy("a category is rejected in the output", !categoryOutput.ok && /is a category/.test(categoryOutput.error));
equal("a category works in allophony input", surfaceForForm("mi", categoryProject, "child").text, "ɲi");
equal("a category works in an allophony environment", surfaceForForm("an", categoryProject, "child").text, "en");
equal("category sound changes still feed derivation", deriveForm("man", categoryProject, "child").text, "ma");

const brokenCategoryProject = ensureProject({
  title: "Broken category",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      phonotactics: { classes: [{ name: "Q", sounds: "" }] },
      soundChanges: [],
      allophony: [],
      vocabulary: [],
    },
  ],
});
const brokenCategory = compileRule("Q > x", contextForLanguage(brokenCategoryProject, "only"));
truthy("a broken category keeps its error", !brokenCategory.ok && /no sounds/.test(brokenCategory.error));

/* ---- distinctive features ----------------------------------------------- */

const featureConsonants = makeChart(
  ["Plosive", "Nasal", "Fricative", "Approximant"],
  ["Bilabial", "Alveolar", "Postalveolar", "Palatal", "Velar", "Glottal"],
  [
    ["Plosive", "Bilabial", ["p", "b"]],
    ["Plosive", "Alveolar", ["t", "d"]],
    ["Plosive", "Velar", ["k", "g"]],
    ["Nasal", "Bilabial", ["m"]],
    ["Nasal", "Alveolar", ["n"]],
    ["Nasal", "Palatal", ["ɲ"]],
    ["Nasal", "Velar", ["ŋ"]],
    ["Fricative", "Alveolar", ["s", "z"]],
    ["Fricative", "Postalveolar", ["ʃ", "ʒ"]],
    ["Fricative", "Velar", ["x"]],
    ["Fricative", "Glottal", ["h"]],
    ["Approximant", "Palatal", ["j"]],
    ["Approximant", "Velar", ["w"]],
  ]
);
const featureVowels = makeChart(
  ["Close", "Mid", "Open"],
  ["Front", "Central", "Back"],
  [
    ["Close", "Front", ["i", "y"]],
    ["Close", "Central", ["ɨ"]],
    ["Close", "Back", ["u"]],
    ["Mid", "Front", ["e", "ø"]],
    ["Mid", "Central", ["ə"]],
    ["Mid", "Back", ["o"]],
    ["Open", "Front", ["a"]],
    ["Open", "Central", ["ɐ"]],
    ["Open", "Back", ["ɑ"]],
  ]
);
const featureInventory = { consonants: featureConsonants, vowels: featureVowels };
const featureCtx = contextForInventory(featureInventory);
const featureApply = (notation, form) => {
  const compiled = compileRule(notation, featureCtx);
  if (!compiled.ok) return { error: compiled.error };
  const result = applyRule(featureCtx.tokenize(form), compiled.rule, featureCtx);
  return result.error ? { error: result.error } : { out: result.tokens.join("") };
};

truthy("the curated IPA table covers common symbols", Object.keys(IPA_FEATURES).length >= 180);

// The feature inventory cannot distinguish every IPA glyph; the pairs that
// intentionally collapse are documented at the IPA_FEATURES declaration.
// This audit makes an accidental collapse (such as o/ɔ before ɔ was lax) a
// test failure instead of a phantom "duplicate" error in someone's chart.
const documentedIpaCollisions = new Set(
  [
    ["g", "ɡ"],
    ["ʈ͡ʂ", "t͡ʂ"],
    ["ɖ͡ʐ", "d͡ʐ"],
    ["ŋ͡g", "ŋ͡ɡ"],
    ["ɪ", "ɩ"],
    ["ʊ", "ɷ"],
    ["ɘ", "ᴇ"],
    ["ɐ", "ᴀ"],
    ["ᵻ", "ɿ"],
    ["ᵻ", "ʅ"],
    ["ɿ", "ʅ"],
    ["ᵿ", "ʮ"],
    ["ᵿ", "ʯ"],
    ["ʮ", "ʯ"],
  ].map((pair) => [...pair].sort().join("|"))
);
const ipaSymbols = Object.keys(IPA_FEATURES);
const actualIpaCollisions = [];
for (let i = 0; i < ipaSymbols.length; i += 1) {
  for (let j = i + 1; j < ipaSymbols.length; j += 1) {
    const left = ipaSymbols[i];
    const right = ipaSymbols[j];
    if (JSON.stringify(IPA_FEATURES[left]) === JSON.stringify(IPA_FEATURES[right])) {
      actualIpaCollisions.push([left, right].sort().join("|"));
    }
  }
}
equal(
  "only documented IPA glyph variants share a feature bundle",
  actualIpaCollisions.sort(),
  [...documentedIpaCollisions].sort()
);
truthy(
  "o and ɔ are distinct vowels",
  featureDistance(IPA_FEATURES.o, IPA_FEATURES.ɔ) > 0
);
truthy(
  "an ejective stop and an ejective fricative stay distinct",
  featureDistance(IPA_FEATURES["tʼ"], IPA_FEATURES["sʼ"]) > 0
);
truthy(
  "ʜ and ħ stay distinct",
  featureDistance(IPA_FEATURES["ʜ"], IPA_FEATURES["ħ"]) > 0
);
const resolver = createFeatureResolver();
const nasalBundle = resolver.bundleFor("n");
equal(
  "a curated IPA bundle is complete",
  [nasalBundle.nasal, nasalBundle.voice, nasalBundle.place],
  [true, true, "alveolar"]
);
equal("place derives the coronal feature", derivedFeatures(nasalBundle), ["coronal"]);
equal(
  "tie-bar variants resolve to the same bundle",
  featureDistance(resolver.bundleFor("t͡ʃ"), resolver.bundleFor("t͜ʃ")),
  0
);
equal(
  "a derived affricate keeps aspiration from its release",
  resolver.bundleFor("t͡sʰ").spread_glottis,
  true
);
equal(
  "feature members enumerate the charted nasals",
  featureMembers(["m", "n", "s", "p"], resolver, [{ kind: "bool", feature: "nasal", value: true }]),
  ["m", "n"]
);
const voicedDelta = applyFeatureTerms(resolver.bundleFor("t"), [
  { kind: "bool", feature: "voice", value: true },
]);
equal("a feature delta changes the bundle", voicedDelta.bundle.voice, true);
equal(
  "a bundle resolves back to its charted symbol",
  resolveFeatureBundle(resolver.bundleFor("d"), featureCtx.chart, resolver).sound,
  "d"
);

const customSymbol = "☺";
const customBundle = {
  ...defaultBundle(),
  consonantal: true,
  sonorant: false,
  continuant: false,
  voice: false,
  click: true,
  place: "bilabial",
};
const customResolver = createFeatureResolver({ [customSymbol]: customBundle });
equal(
  "a per-language override supplies features for a custom symbol",
  [customResolver.bundleFor(customSymbol).click, customResolver.bundleFor(customSymbol).place],
  [true, "bilabial"]
);
equal(
  "an override wins over the curated table",
  createFeatureResolver({ t: { ...defaultBundle(), voice: true, place: "alveolar" } }).bundleFor("t").voice,
  true
);

const customConsonants = makeChart(
  ["Plosive"],
  ["Bilabial"],
  [["Plosive", "Bilabial", [customSymbol]]]
);
const customVowels = makeChart(["Open"], ["Front"], [["Open", "Front", ["a"]]]);
const customCtx = contextForInventory(
  { consonants: customConsonants, vowels: customVowels },
  { [customSymbol]: customBundle }
);
const customRule = compileRule("[+click] > ∅ / _ #", customCtx);
truthy("a custom sound with an override can be queried", customRule.ok);
equal(
  "the override drives feature matching",
  applyRule(customCtx.tokenize(`a${customSymbol}`), customRule.rule, customCtx).tokens.join(""),
  "a"
);

equal("a feature query selects nasals", featureApply("[+nasal] > ∅ / _ #", "kan"), { out: "ka" });
equal("a feature query works in an environment", featureApply("a > e / _ [+voice]", "ada"), { out: "eda" });
equal("a feature delta voices a stop", featureApply("t > [+voice] / V _ V", "ata"), { out: "ada" });
equal("a feature delta devoices a fricative", featureApply("z > [-voice] / _ #", "az"), { out: "as" });
equal("a categorical place mutation resolves", featureApply("n > [place=velar]", "an"), { out: "aŋ" });
equal(
  "alpha place copies the following place",
  featureApply("n > [αplace] / _ [αplace]", "anka"),
  { out: "aŋka" }
);
equal(
  "alpha place copies a palatal place",
  featureApply("n > [αplace] / _ [αplace]", "anɲa"),
  { out: "aɲɲa" }
);
equal(
  "alpha round spreads from the left",
  featureApply("V > [αround] / [αround] _", "øe"),
  { out: "øø" }
);
equal(
  "alpha round can copy an unrounded value",
  featureApply("V > [αround] / [αround] _", "ee"),
  { out: "ee" }
);
const alphaOffChart = featureApply("n > [αplace] / _ [αplace]", "anha");
truthy(
  "an alpha result that lands off the chart fails loudly",
  /No charted sound/.test(alphaOffChart.error) && /Nearest charted/.test(alphaOffChart.error)
);

const unboundAlpha = compileRule("n > [αplace]", featureCtx);
truthy("an unbound alpha variable is rejected", !unboundAlpha.ok && /not bound/.test(unboundAlpha.error));
const mixedFeature = compileRule("[+nasal p] > a", featureCtx);
truthy(
  "a bracket cannot mix sounds and features",
  !mixedFeature.ok && /mix sounds and features/.test(mixedFeature.error)
);
const multiFeature = compileRule("n > [+voice]s", featureCtx);
truthy(
  "a feature change must be the whole output",
  !multiFeature.ok && /whole output/.test(multiFeature.error)
);
const insertionFeature = compileRule("∅ > [+voice] / V _ V", featureCtx);
truthy(
  "an insertion cannot be a feature change",
  !insertionFeature.ok && /needs a segment/.test(insertionFeature.error)
);
const offChartFeature = compileRule("t > [+voice]", ctx);
truthy(
  "a static feature change with no charted result fails",
  !offChartFeature.ok && /Nearest charted sounds/.test(offChartFeature.error)
);

const backedSchwa = applyFeatureTerms(resolver.bundleFor("ə"), [
  { kind: "bool", feature: "back", value: true },
]);
equal(
  "an explicit back delta clears central instead of erasing itself",
  [backedSchwa.bundle.back, backedSchwa.bundle.central],
  [true, false]
);
equal(
  "a backed schwa resolves to the lax back vowel",
  featureDistance(backedSchwa.bundle, resolver.bundleFor("ʌ")),
  0
);

truthy(
  "the low-front pair is contrastive",
  featureDistance(resolver.bundleFor("a"), resolver.bundleFor("æ")) > 0
);
truthy(
  "the alveolo-palatal fricatives are contrastive",
  featureDistance(resolver.bundleFor("ʃ"), resolver.bundleFor("ɕ")) > 0 &&
    featureDistance(resolver.bundleFor("ʒ"), resolver.bundleFor("ʑ")) > 0
);
truthy(
  "the mid-central tense/lax pair is contrastive",
  featureDistance(resolver.bundleFor("ɘ"), resolver.bundleFor("ɜ")) > 0
);
equal("æ is marked lax", resolver.bundleFor("æ").atr, false);
equal("ɜ is marked lax", resolver.bundleFor("ɜ").atr, false);
equal("ɕ is marked palatalized", resolver.bundleFor("ɕ").palatalized, true);
equal("a macron marks length", resolver.bundleFor("ā").long, true);
truthy(
  "macron length is visible to feature changes",
  featureDistance(resolver.bundleFor("a"), resolver.bundleFor("ā")) > 0
);

const lowFrontCtx = contextForInventory({
  consonants: makeChart(["Plosive"], ["Bilabial"], [["Plosive", "Bilabial", ["p"]]]),
  vowels: makeChart(
    ["Open"],
    ["Front", "Back"],
    [
      ["Open", "Front", ["a", "æ"]],
      ["Open", "Back", ["ɑ"]],
    ]
  ),
});
const lowFrontRule = compileRule("ɑ > [-back]", lowFrontCtx);
const lowFrontResult = lowFrontRule.ok
  ? applyRule(lowFrontCtx.tokenize("ɑ"), lowFrontRule.rule, lowFrontCtx)
  : { error: lowFrontRule.error };
equal(
  "a de-duplicated low-front target resolves to one sound",
  lowFrontResult.error || lowFrontResult.tokens.join(""),
  "a"
);

const bundlelessCtx = contextForInventory({
  consonants: makeChart(["Other"], ["Cell"], [["Other", "Cell", ["Q", "n", "t"]]]),
  vowels: makeChart(["Open"], ["Front"], [["Open", "Front", ["a"]]]),
});
const bundlelessRule = compileRule("[+nasal] > ∅ / _ #", bundlelessCtx);
truthy(
  "a feature query warns when a charted sound has no bundle",
  bundlelessRule.ok &&
    bundlelessRule.warnings.some((warning) => warning.includes("Q") && warning.includes("override"))
);

equal(
  "a reserved bare word stays a chart class",
  classifyFeatureWords(["back"], { isReserved: () => true }).kind,
  "none"
);
equal(
  "a signed word is a feature bundle even when reserved",
  classifyFeatureWords(["+back"], { isReserved: () => true }).kind,
  "feature"
);
equal("a bare chart class still works in a rule", apply("[back] > a / _ #", "ku"), { out: "ka" });
equal("a signed feature bundle works in the same rule", featureApply("[+back] > a / _ #", "ku"), {
  out: "ka",
});

const featureClasses = compileClasses([{ name: "S", sounds: "[+sonorant]" }], featureCtx);
const sonorants = featureClasses.map.get("S");
truthy(
  "a category can be a feature bundle",
  sonorants && sonorants.values.includes("m") && sonorants.values.includes("i") && !sonorants.values.includes("t")
);
const featureAlphaClass = compileClasses([{ name: "S", sounds: "[αplace]" }], featureCtx);
truthy(
  "alpha variables are rejected in categories",
  featureAlphaClass.entries[0].errors.some((error) => /α-variables/.test(error))
);

const featureTemplate = compilePhonotactics(
  { template: "(C)V([+sonorant])", classes: [] },
  featureCtx
);
truthy("a phonotactic template accepts a feature bundle", featureTemplate.ok);
const featureLanguage = createLanguage("Feature grammar", null, featureInventory, {
  template: "(C)V([+sonorant])",
  classes: [],
  forbidden: "",
});
const featureChecker = createPhonotacticsChecker(featureLanguage);
equal("a feature template admits a sonorant coda", featureChecker.validate("kan").ok, true);
equal("a feature template rejects an obstruent coda", featureChecker.validate("kat").ok, false);
const nasalBan = createPhonotacticsChecker({
  ...featureLanguage,
  phonotactics: {
    ...featureLanguage.phonotactics,
    template: "(C)V(C)",
    forbidden: "[+nasal][+nasal]",
  },
});
truthy(
  "a feature bundle works in a forbidden sequence",
  nasalBan.validate("anma").issues.some((issue) => issue.type === "forbidden")
);
equal("a clean cluster passes the feature constraint", nasalBan.validate("asta").issues.length, 0);

const featureProject = ensureProject({
  title: "Feature grammar",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory: featureInventory,
      phonotactics: {
        template: "(C)V(C)",
        classes: [{ name: "S", sounds: "[+sonorant]" }],
      },
      featureOverrides: { [customSymbol]: customBundle },
      soundChanges: [{ id: "r1", notation: "S > ∅ / _ #", note: "", enabled: true }],
      allophony: [
        { id: "a1", notation: "/s/ → [+voice] / V _ V", note: "", enabled: true },
        { id: "a2", notation: "/n/ → [αplace] / _ [αplace]", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});
const featureContext = contextForLanguage(featureProject, "only");
const featureCategoryRule = compileRule("S > ∅ / _ #", featureContext);
truthy("a feature category compiles inside a language", featureCategoryRule.ok);
equal(
  "a feature category matches its expanded members",
  applyRule(featureContext.tokenize("kan"), featureCategoryRule.rule, featureContext).tokens.join(""),
  "ka"
);
equal("a feature category feeds derivation", deriveForm("kan", featureProject, "only").text, "ka");
equal("a feature allophone is applied", surfaceForForm("asa", featureProject, "only").text, "aza");
equal(
  "an alpha allophone copies the following place",
  surfaceForForm("anka", featureProject, "only").text,
  "aŋka"
);
const featureRows = allophoneTable(featureProject, "only").rows;
truthy(
  "the allophone table resolves a feature output",
  featureRows.some((row) => row.phoneme === "s" && row.allophone === "z")
);
truthy(
  "the allophone table keeps an alpha output symbolic",
  featureRows.some((row) => row.phoneme === "n" && row.allophone === "[αplace]")
);

/* ---- surface synthesis in allophony ------------------------------------- */

const syntheticInventory = {
  consonants: makeChart(
    ["Plosive", "Nasal", "Fricative"],
    ["Bilabial", "Alveolar", "Velar", "Glottal"],
    [
      ["Plosive", "Bilabial", ["p"]],
      ["Plosive", "Alveolar", ["t", "d"]],
      ["Plosive", "Velar", ["k", "g", "ɡ"]],
      ["Nasal", "Bilabial", ["m"]],
      ["Nasal", "Alveolar", ["n"]],
      ["Fricative", "Alveolar", ["s", "z"]],
      ["Fricative", "Glottal", ["h"]],
    ]
  ),
  vowels: makeChart(
    ["Close", "Mid", "Open"],
    ["Front", "Central", "Back"],
    [
      ["Close", "Front", ["i"]],
      ["Mid", "Central", ["ə"]],
      ["Mid", "Back", ["ɤ"]],
      ["Open", "Front", ["a", "æ"]],
      ["Open", "Back", ["ɑ"]],
    ]
  ),
};
const syntheticProject = ensureProject({
  title: "Surface synthesis",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory: syntheticInventory,
      soundChanges: [],
      allophony: [],
      vocabulary: [],
    },
  ],
});
const syntheticLanguage = syntheticProject.languages[0];
const allophonyFor = (notations) => {
  syntheticLanguage.allophony = notations.map((notation, index) => ({
    id: `s${index}`,
    notation,
    note: "",
    enabled: true,
  }));
  return syntheticProject;
};

const aspiratedSurface = surfaceForForm(
  "pa",
  allophonyFor(["p > [+spread_glottis] / # _ V"]),
  "only"
);
equal("allophony synthesizes aspiration for an off-chart bundle", aspiratedSurface.text, "pʰa");
equal("a synthesized allophone is not an error", aspiratedSurface.errors, []);
truthy(
  "the allophone table resolves a synthesized feature output",
  allophoneTable(syntheticProject, "only").rows.some(
    (row) => row.phoneme === "p" && row.allophone === "pʰ"
  )
);

const assimilatedSurface = surfaceForForm(
  "anka",
  allophonyFor(["n > [αplace] / _ [αplace]"]),
  "only"
);
equal("allophony synthesizes an off-chart alpha result", assimilatedSurface.text, "aŋka");

const backedSurface = surfaceForForm("ə", allophonyFor(["ə > [+back]"]), "only");
equal("backing a central vowel is not a silent no-op", backedSurface.text, "ʌ");
equal(
  "a real backing step is marked changed",
  backedSurface.steps.filter((step) => step.changed).length,
  1
);

const noOpSurface = surfaceForForm("ag", allophonyFor(["g > [+voice]"]), "only");
equal("an unchanged feature delta keeps the original glyph", noOpSurface.text, "ag");
equal(
  "an unchanged feature delta is not presented as a change",
  noOpSurface.steps.filter((step) => step.changed).length,
  0
);

allophonyFor([
  "p > pʰ / # _ V",
  "[+spread_glottis] > [-spread_glottis] / _ #",
]);
const featureRuleRows = allophoneTable(syntheticProject, "only").rows;
truthy(
  "the allophone table sees a literal surface symbol as a feature target",
  featureRuleRows.some((row) => row.phoneme === "pʰ" && row.allophone === "p")
);

const strictSynthesis = compileRule("p > [+spread_glottis] / # _ V", contextForInventory(syntheticInventory));
truthy(
  "sound changes remain chart-only while allophony synthesizes",
  !strictSynthesis.ok && /charted sound/.test(strictSynthesis.error)
);

const overrideProject = ensureProject({
  title: "Overrides",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      inventory: featureInventory,
      featureOverrides: {
        "t͜ʃ": {
          ...defaultBundle(),
          consonantal: true,
          delayed_release: true,
          continuant: false,
          voice: false,
          place: "postalveolar",
        },
      },
      soundChanges: [],
      allophony: [],
      vocabulary: [],
    },
  ],
});
const overrideLanguage = overrideProject.languages[0];
equal("override keys normalize tie bars on load", Object.keys(overrideLanguage.featureOverrides), ["t͡ʃ"]);
const overrideSibling = createSibling(overrideProject, "root", "Sibling");
const overrideAncestor = createAncestor(overrideProject, "root", "Ancestor");
truthy(
  "a sibling inherits feature overrides",
  overrideSibling.featureOverrides["t͡ʃ"]?.delayed_release === true
);
truthy(
  "an ancestor inherits feature overrides",
  overrideAncestor.featureOverrides["t͡ʃ"]?.delayed_release === true
);

/* ---- report builder ------------------------------------------------------ */

const markdown = buildMarkdown(project);
truthy(
  "report nests sections under each language",
  markdown.includes("### Child") && markdown.includes("#### Phonology"),
);
truthy("report includes the family sketch", markdown.includes("```") && markdown.includes("Root"));

const noteProject = {
  title: "Notes",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      ...language,
      notes: "# heading\n| table |\n`code`",
      soundChanges: [],
      allophony: [],
      vocabulary: [],
    },
  ],
};
const noteMarkdown = buildMarkdown(noteProject);
truthy("markdown notes keep line-start syntax inside the blockquote", noteMarkdown.includes("> \\# heading"));
truthy("markdown notes escape a leading table pipe", noteMarkdown.includes("> \\| table \\|"));
truthy("markdown notes escape a leading code span", noteMarkdown.includes("> \\`code\\`"));

const allophonyMarkdown = buildMarkdown(allophonyProject);
truthy("report formats lexical forms as phonemic", allophonyMarkdown.includes("/kasa/"));
truthy(
  "report includes an allophony section with surface forms",
  allophonyMarkdown.includes("Allophony") && allophonyMarkdown.includes("Synchronic rules") && allophonyMarkdown.includes("kʰ")
);
truthy("report labels sound changes as diachronic", allophonyMarkdown.includes("Diachronic rules"));

const allophonyHtml = buildHtml(allophonyProject);
truthy(
  "HTML report includes the allophony table",
  allophonyHtml.includes("Allophony") && allophonyHtml.includes("[kʰ]")
);
truthy("HTML report formats lexical forms as phonemic", allophonyHtml.includes("/kasa/"));

const overrideMarkdown = buildMarkdown(featureProject);
truthy(
  "Markdown report includes feature overrides",
  overrideMarkdown.includes("Feature overrides") && overrideMarkdown.includes(customSymbol)
);
truthy(
  "Markdown report writes the complete override bundle",
  overrideMarkdown.includes("+click") && overrideMarkdown.includes("place=bilabial")
);
const overrideHtml = buildHtml(featureProject);
truthy(
  "HTML report includes feature overrides",
  overrideHtml.includes("Feature overrides") && overrideHtml.includes(customSymbol)
);

/* ---- segment diff -------------------------------------------------------- */

equal(
  "alignment walks equal runs",
  alignSegments(["k", "a"], ["k", "a"]),
  [
    { left: "k", right: "k", kind: "equal" },
    { left: "a", right: "a", kind: "equal" },
  ]
);
equal(
  "a differing segment reads as a substitution",
  alignSegments(["t", "a"], ["s", "a"]),
  [
    { left: "t", right: "s", kind: "sub" },
    { left: "a", right: "a", kind: "equal" },
  ]
);
equal(
  "a missing segment is a deletion",
  alignSegments(["k", "a", "s"], ["k", "a"]),
  [
    { left: "k", right: "k", kind: "equal" },
    { left: "a", right: "a", kind: "equal" },
    { left: "s", right: null, kind: "del" },
  ]
);
equal(
  "an added segment is an insertion",
  alignSegments(["k", "a"], ["k", "a", "s"]),
  [
    { left: "k", right: "k", kind: "equal" },
    { left: "a", right: "a", kind: "equal" },
    { left: null, right: "s", kind: "ins" },
  ]
);
equal("aligning nothing is an empty list", alignSegments([], []), []);
equal(
  "inserting into an empty form",
  alignSegments([], ["a"]),
  [{ left: null, right: "a", kind: "ins" }]
);
truthy("unchanged forms skip the diff", formDiffMarkup(["k", "a"], ["k", "a"]) === null);
truthy(
  "changed forms mark the differing segment",
  /seg-diff[^>]*>t</u.test(formDiffMarkup(["k", "a", "t"], ["k", "a", "s"]).left)
);
const diffPair = diffPairMarkup("kat", "kas", ctx);
truthy(
  "diff pairs wrap colored sides in slashes",
  diffPair !== null &&
    diffPair.left.startsWith("/") &&
    diffPair.left.endsWith("/") &&
    /seg-diff[^>]*>t</u.test(diffPair.left) &&
    /seg-diff[^>]*>s</u.test(diffPair.right)
);
truthy("identical forms need no diff pair", diffPairMarkup("kat", "kat", ctx) === null);
truthy("diff pairs need a context", diffPairMarkup("kat", "kas", null) === null);

/* ---- why a rule did not apply -------------------------------------------- */

const missTarget = compileRule("p > f / V _ V", ctx);
truthy(
  "a missing input is explained",
  /matches no part of “kat”/u.test(explainRuleMiss(ctx.tokenize("kat"), missTarget.rule, ctx))
);
const missLeft = compileRule("k > x / s _ V", ctx);
truthy(
  "a failing left environment is named",
  /left environment/u.test(explainRuleMiss(ctx.tokenize("kasa"), missLeft.rule, ctx))
);
const missRight = compileRule("s > z / a _ #", ctx);
truthy(
  "a failing right environment is named",
  /right environment/u.test(explainRuleMiss(ctx.tokenize("kasa"), missRight.rule, ctx))
);
const missInsertion = compileRule("∅ > ʔ / u _ u", ctx);
truthy(
  "a blocked insertion names its environment",
  /environment/u.test(explainRuleMiss(ctx.tokenize("apa"), missInsertion.rule, ctx))
);
equal(
  "a matching rule produces no miss explanation",
  explainRuleMiss(ctx.tokenize("apa"), missTarget.rule, ctx),
  ""
);

const conflictProject = {
  title: "Conflict",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null },
        { id: "r2", notation: "p > h", note: "", enabled: true, parentId: null },
      ],
      vocabulary: [],
    },
  ],
};
const conflictStep = deriveForm("apa", conflictProject, "child", { directOnly: true }).steps.find(
  (step) => step.conflict
);
truthy("overlapping parallel rules are reported as a conflict", conflictStep && conflictStep.kind === "error");
equal("the conflict names the earlier rule as first", conflictStep.conflict.firstId, "r1");
equal("the conflict names the later rule as second", conflictStep.conflict.secondId, "r2");

const debugStep = deriveForm("kat", project, "child", { directOnly: true }).steps.find(
  (step) => step.kind === "parallel"
);
truthy(
  "parallel entries explain why they matched nothing",
  debugStep.entries.some((entry) => entry.notation === "p > f / V _ V" && /matches no part/u.test(entry.debug || ""))
);

const seqStaged = stagedProject([
  { id: "s1", notation: "a > e", note: "", enabled: true, parentId: null },
  { id: "s2", notation: "t > x / u _ a", note: "", enabled: true, parentId: "s1" },
]);
const seqStep = deriveForm("kata", seqStaged, "child", { directOnly: true }).steps.find(
  (step) => step.kind === "sequential"
);
truthy(
  "sequential steps explain a failed environment",
  seqStep && !seqStep.changed && /left environment/u.test(seqStep.debug || "")
);

/* ---- lexicon analytics ---------------------------------------------------- */

const analyticsChart = makeChart(
  ["Plosive", "Nasal", "Fricative"],
  ["Bilabial", "Alveolar", "Velar"],
  [
    ["Plosive", "Bilabial", ["p", "b"]],
    ["Plosive", "Alveolar", ["t"]],
    ["Plosive", "Velar", ["k"]],
    ["Nasal", "Bilabial", ["m"]],
    ["Fricative", "Alveolar", ["s"]],
  ]
);
const analyticsLanguage = {
  id: "ana",
  name: "Ana",
  parentId: null,
  inventory: { consonants: analyticsChart, vowels },
  phonotactics: { template: "(C)V(C)", onsets: "", codas: "", forbidden: "", notes: "", classes: [] },
  soundChanges: [],
  allophony: [],
  vocabulary: [
    { id: "w1", gloss: "apa", form: "apa", notes: "" },
    { id: "w2", gloss: "kama", form: "kama", notes: "" },
    { id: "w3", gloss: "edge", form: "aθa", notes: "" },
  ],
};
const analysis = analyzeLexicon({ title: "Analytics", languages: [analyticsLanguage] }, analyticsLanguage);
equal("analytics counts every recorded token", analysis.frequency[0], { value: "a", count: 6, charted: true });
equal(
  "analytics lists charted sounds with no tokens",
  [...analysis.neverUsed].sort(),
  ["ɑ", "b", "i", "s", "t", "u"].sort()
);
equal("analytics reports uncharted tokens", analysis.uncharted, [{ value: "θ", count: 1 }]);
equal("analytics counts consonant and vowel tokens", [analysis.consonantTokens, analysis.vowelTokens], [4, 6]);
truthy(
  "analytics syllabifies parseable words",
  analysis.parseableWords === 2 && analysis.syllablesTotal === 4
);
truthy(
  "analytics records an empty onset as ∅",
  analysis.onsets.some((row) => row.value === "∅" && row.count === 1)
);
equal("analytics counts codas", analysis.codas, [{ value: "∅", count: 4 }]);
equal(
  "analytics flags voiceless stops missing voiced twins in a series that contrasts voice",
  [...analysis.voicelessWithoutVoiced].sort(),
  ["k", "t"].sort()
);
equal(
  "analytics never flags sonorants or unpaired manners as voicing gaps",
  analysis.voicedWithoutVoiceless,
  []
);
const nasalGap = analysis.gaps.find((gap) => gap.manner === "Nasal");
equal(
  "analytics names the missing places in a manner row",
  [...(nasalGap?.missing || [])].sort(),
  ["Alveolar", "Velar"].sort()
);
equal("analytics sees no allophony to leak", [analysis.hasAllophony, analysis.leaks.length], [false, 0]);

allophonyFor(["s > θ / V _ V"]);
syntheticLanguage.vocabulary = [{ id: "lv1", gloss: "asthma", form: "aθa", notes: "" }];
const leakAnalysis = analyzeLexicon(syntheticProject, syntheticLanguage);
truthy(
  "analytics flags allophony outputs recorded in phonemic forms",
  leakAnalysis.hasAllophony &&
    leakAnalysis.leaks.some((leak) => leak.gloss === "asthma" && leak.symbols.includes("θ"))
);
syntheticLanguage.vocabulary = [];

const quietLanguage = {
  ...analyticsLanguage,
  id: "quiet",
  name: "Quiet",
  vocabulary: [{ id: "w0", gloss: "dud", form: "aθa", notes: "" }],
};
const quietAnalysis = analyzeLexicon({ title: "Quiet", languages: [quietLanguage] }, quietLanguage);
equal("a lexicon nothing syllabifies leaves no onset rows", quietAnalysis.onsets, []);
equal("a lexicon nothing syllabifies leaves no coda rows", quietAnalysis.codas, []);

/* ---- class autocomplete policy ------------------------------------------- */

equal("a single letter never triggers class suggestions", suggestQuery("V"), "");
truthy("two letters are a plausible class query", suggestQuery("ve") === "ve");
truthy("a dotted fragment triggers suggestions", suggestQuery("plosive.") === "plosive.");
equal("queries fold case before matching", suggestQuery("V.b"), "v.b");
truthy(
  "notation pieces never trigger suggestions",
  suggestQuery("[+na") === "" && suggestQuery("p >") === "" && suggestQuery("") === ""
);
truthy(
  "refs match by prefix and by later dotted segment",
  matchesQuery("plosive.plain", "plosive.") &&
    matchesQuery("plosive.plain", "plain") &&
    !matchesQuery("plosive.plain", "xyz")
);
equal(
  "filterSuggestions filters and caps the list",
  filterSuggestions([{ ref: "velar" }, { ref: "back" }, { ref: "voiced" }], "v", 2).map((item) => item.ref),
  ["velar", "voiced"]
);
equal(
  "filterSuggestions ranks exact and prefix matches above later segments",
  filterSuggestions(
    [{ ref: "series.plain" }, { ref: "plain.extra" }, { ref: "plain" }],
    "plain"
  ).map((item) => item.ref),
  ["plain", "plain.extra", "series.plain"]
);

/* ---- summary ------------------------------------------------------------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
