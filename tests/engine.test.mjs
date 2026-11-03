// Engine tests for Language Tree — plain Node, no framework and no DOM.
//
//   node tests/engine.test.mjs
//
// The parser modules (model, phonology, phonotactics, naturalclasses) and the
// report builder are DOM-free ES modules, so they import and run directly.
// Every assertion prints a line; the process exits non-zero on any failure.

import { defaultInventory } from "../web/js/model.js";
import {
  contextForInventory,
  compileRule,
  applyRule,
  deriveForm,
} from "../web/js/phonology.js";
import { createPhonotacticsChecker } from "../web/js/phonotactics.js";
import { buildMarkdown } from "../web/js/report.js";

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
equal("direct rules apply in order", deriveForm("apas", project, "child", { directOnly: true }).text, "afa");
equal("disabled rules are skipped", deriveForm("kapta", project, "child", { directOnly: true }).text, "kapta");

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

/* ---- report builder ------------------------------------------------------ */

const markdown = buildMarkdown(project);
truthy(
  "report nests sections under each language",
  markdown.includes("### Child") && markdown.includes("#### Phonology"),
);
truthy("report includes the family sketch", markdown.includes("```") && markdown.includes("Root"));

/* ---- summary ------------------------------------------------------------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
