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
  DEFAULT_RULE_RATE,
  defaultInventory,
  deleteLanguage,
  ensureProject,
  groupAllophonyRules,
  languagesInTreeOrder,
  normalizeRuleDate,
  normalizeRuleExceptions,
  normalizeRuleRate,
  restoreAllophonyGroup,
  restoreAllophonyRule,
  restoreDeletedLanguages,
  restoreUngroupedAllophonyRules,
  ruleExceptsGloss,
  ruleNumberMap,
} from "../web/js/model.js";
import {
  allophoneCandidates,
  allophoneTable,
  applyAllophony,
  compileAllophonyRules,
  contextForAllophony,
  contextForInventory,
  contextForLanguage,
  compileRule,
  compileRuleStages,
  applyRule,
  compileChainFrom,
  deriveForm,
  deriveStages,
  exceptionRulesFromSteps,
  explainRuleMiss,
  normalizeAllophonyNotation,
  optionalRulesInStages,
  optionalSkippedRulesFromSteps,
  surfaceForForm,
} from "../web/js/phonology.js";
import {
  formatPhonemic,
  formatPhonetic,
  joinSegments,
  normalizeSearchText,
  sameForm,
  sameJunctures,
  sameTokens,
  stripLevelMarks,
} from "../web/js/notation.js";
import { esc, escapeDialogCopy } from "../web/js/escape.js";
import { normalizeGloss } from "../web/js/gloss.js";
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
  matchFeatureTerms,
  resolveFeatureBundle,
} from "../web/js/features.js";
import { compilePhonotactics } from "../web/js/phonotactics.js";
import { createPhonotacticsChecker, stressMarkedForm } from "../web/js/phonotacticsCheck.js";
import { buildHtml, buildMarkdown } from "../web/js/report.js";
import { isHeavySyllable, normalizeStressSystem, stressIndexOf, stressLabel } from "../web/js/prosody.js";
import { decodeHashPart, languageHref } from "../web/js/routes.js";
import {
  LANGUAGE_TOOLS,
  defaultToolForTab,
  normalizeTool,
  toolsForTab,
} from "../web/js/languageTools.js";
import {
  CHECK_PAGE_SIZE,
  MATRIX_PAGE_SIZE,
  clampPage,
  focusPager,
  pageCount,
  pagerMarkup,
  paginate,
} from "../web/js/paging.js";
import { alignSegments, diffPairMarkup, formDiffMarkup } from "../web/js/diff.js";
import { analyzeLexicon } from "../web/js/analytics.js";
import { alignCognate, buildCorrespondences } from "../web/js/correspondences.js";
import { invertRule, invertRules, reconstructForm, reconstructionAlternatives } from "../web/js/reconstruction.js";
import { subgroupingEvidence } from "../web/js/subgrouping.js";
import { filterSuggestions, matchesQuery, suggestQuery } from "../web/js/naturalclasses.js";
import { applyWordList, rowStatus } from "../web/js/bulk.js";
import { newLibraryRules, normalizeLibraryNotation, soundChangeLibrary } from "../web/js/soundlaws.js";
import { ipaToXSampa, xSampaToIPA } from "../web/js/xsampa.js";
import { timelineStages } from "../web/js/timeline.js";

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

/* ---- language tool segments --------------------------------------------- */

equal(
  "tool ids stay in documented order",
  toolsForTab("changes").map((tool) => tool.id),
  ["rules", "test", "reconstruct", "check"]
);
equal("unknown tools fall back to the tab default", normalizeTool("changes", "bogus"), "rules");
equal("missing tools fall back to the tab default", normalizeTool("phonotactics"), "template");
equal("tabs without tools normalize to an empty string", normalizeTool("vocabulary", "rules"), "");
equal("every tool group has a default that exists", Object.entries(LANGUAGE_TOOLS).every(([tab, group]) =>
  group.tools.some((tool) => tool.id === group.defaultTool) && defaultToolForTab(tab) === group.defaultTool
), true);

const toolLinkLanguage = { id: "Proto North" };
equal(
  "language links encode the id and omit the default tool",
  languageHref(toolLinkLanguage, "changes"),
  "#/language/Proto%20North/changes"
);
equal(
  "language links omit an explicitly named default tool",
  languageHref(toolLinkLanguage, "changes", "rules"),
  "#/language/Proto%20North/changes"
);
equal(
  "language links keep an explicit non-default tool",
  languageHref(toolLinkLanguage, "changes", "test"),
  "#/language/Proto%20North/changes/test"
);
equal(
  "language links ignore tools on tabs without tool groups",
  languageHref(toolLinkLanguage, "overview", "test"),
  "#/language/Proto%20North/overview"
);
equal(
  "language links drop unknown tools",
  languageHref(toolLinkLanguage, "allophony", "bogus"),
  "#/language/Proto%20North/allophony"
);

/* ---- table paging ------------------------------------------------------- */

const pagingItems = Array.from({ length: 121 }, (_, index) => index + 1);
const emptyPage = paginate([], 9, CHECK_PAGE_SIZE);
equal(
  "empty tables stay on a single empty page",
  [emptyPage.page, emptyPage.pages, emptyPage.first, emptyPage.last, emptyPage.items.length],
  [1, 1, 0, 0, 0]
);
equal("page counts round up and never drop below one", [pageCount(0, 50), pageCount(121, 50), pageCount(120, 50)], [1, 3, 3]);
equal("pages clamp into range", [clampPage(0, 121, 50), clampPage(99, 121, 50)], [1, 3]);

const firstPage = paginate(pagingItems, 1, CHECK_PAGE_SIZE);
equal(
  "the first page fills its window",
  [firstPage.items.length, firstPage.items[0], firstPage.items.at(-1), firstPage.first, firstPage.last],
  [50, 1, 50, 1, 50]
);
equal("the first page knows the table total", [firstPage.total, firstPage.pages], [121, 3]);

const middlePage = paginate(pagingItems, 2, CHECK_PAGE_SIZE);
equal("a middle page slices its own window", [middlePage.items[0], middlePage.items.at(-1), middlePage.start, middlePage.end], [51, 100, 50, 100]);

const lastPage = paginate(pagingItems, 99, CHECK_PAGE_SIZE);
equal(
  "an out-of-range page clamps to the last window",
  [lastPage.page, lastPage.items.length, lastPage.first, lastPage.last],
  [3, 21, 101, 121]
);
equal("check and matrix page sizes stay bounded", [CHECK_PAGE_SIZE, MATRIX_PAGE_SIZE], [50, 25]);

const firstPager = pagerMarkup(firstPage, { noun: "words", label: "Check pages" });
truthy("the pager shows the visible range", firstPager.includes("1–50 of 121 words"));
truthy("the pager labels the current page", firstPager.includes("Page 1 of 3"));
truthy("the pager disables the first and previous buttons on page one", firstPager.includes('data-pager-page="1" disabled'));
truthy("the pager offers the next page", firstPager.includes('data-pager-page="2"'));
truthy("the pager is a labelled navigation landmark", firstPager.includes('<nav class="table-pager" aria-label="Check pages"'));
equal("a single-page table gets a range without page buttons", pagerMarkup(paginate([1, 2], 1, 50)).includes("data-pager-page"), false);

// Minimal DOM stand-in: focusPager only reads data-pager-action, disabled, and
// calls focus(), so a handful of plain objects covers the keyboard contract.
function pagerStub(buttons) {
  const controls = buttons.map(([action, disabled]) => ({
    dataset: { pagerAction: action },
    disabled,
    focused: false,
    focus() {
      this.focused = true;
    },
  }));
  return {
    controls,
    querySelector: (selector) =>
      selector === "[data-pager]" ? { querySelectorAll: () => controls } : null,
  };
}

const middlePagerStub = pagerStub([
  ["first", false],
  ["previous", false],
  ["next", false],
  ["last", false],
]);
equal("focus restoration reports success", focusPager(middlePagerStub, "next"), true);
equal(
  "focus returns to the same pager control after paging",
  middlePagerStub.controls.find((control) => control.dataset.pagerAction === "next").focused,
  true
);

const boundaryPagerStub = pagerStub([
  ["first", false],
  ["previous", false],
  ["next", true],
  ["last", true],
]);
focusPager(boundaryPagerStub, "next");
equal(
  "a disabled Next hands focus to Previous instead of dropping it",
  boundaryPagerStub.controls.find((control) => control.dataset.pagerAction === "previous").focused,
  true
);

const openingPagerStub = pagerStub([
  ["first", true],
  ["previous", true],
  ["next", false],
  ["last", false],
]);
focusPager(openingPagerStub, "previous");
equal(
  "a disabled Previous hands focus to Next on the first page",
  openingPagerStub.controls.find((control) => control.dataset.pagerAction === "next").focused,
  true
);
equal("focus restoration is a no-op without a pager", focusPager(null, "next"), false);

/* ---- language tree order ------------------------------------------------ */

// The array is deliberately depth-major: A's daughters sit after B, so a
// depth sort would flatten the two branches into one generation block.
const treeOrderFixture = {
  languages: [
    { id: "root", parentId: null },
    { id: "a", parentId: "root" },
    { id: "b", parentId: "root" },
    { id: "a1", parentId: "a" },
    { id: "a2", parentId: "a" },
    { id: "b1", parentId: "b" },
    { id: "island", parentId: null },
    { id: "island1", parentId: "island" },
    { id: "orphan", parentId: "missing" },
  ],
};
equal(
  "tree order puts each subtree before its next sibling",
  languagesInTreeOrder(treeOrderFixture).map((language) => language.id),
  ["root", "a", "a1", "a2", "b", "b1", "island", "island1", "orphan"]
);

/* ---- rule engine -------------------------------------------------------- */

equal("lenition between vowels", apply("p > f / V _ V", "apa"), { out: "afa" });
equal("no lenition word-initial", apply("p > f / V _ V", "pat"), { out: "pat" });
equal("word-final vowel deletion", apply("V > ∅ / _ #", "kasa"), { out: "kas" });
equal("word-initial voicing", apply("s > z / # _", "sas"), { out: "zas" });
equal("set deletion", apply("[td] > ∅ / _ #", "kat"), { out: "ka" });
equal("cluster simplification", apply("C > ∅ / _ C", "akta"), { out: "ata" });
equal("arrow variant ->", apply("p -> f", "apa"), { out: "afa" });
equal("arrow variant →", apply("p → f", "apa"), { out: "afa" });
const chainedArrow = compileRule("a → b → c", ctx);
truthy(
  "a second arrow is rejected instead of becoming literal output",
  !chainedArrow.ok && /exactly one arrow/u.test(chainedArrow.error)
);
const chainedAsciiArrow = compileRule("a -> b -> c", ctx);
truthy(
  "a second ASCII arrow is rejected too",
  !chainedAsciiArrow.ok && /exactly one arrow/u.test(chainedAsciiArrow.error)
);
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
const shortTypo = compileRule("t > k / _ bak", typoCtx);
truthy(
  "a three-letter literal run still warns",
  shortTypo.ok && shortTypo.warnings?.some((warning) => warning.includes("bak") && warning.includes("literal"))
);
const glideConsonants = makeChart(
  ["Plosive", "Glide"],
  ["Bilabial", "Alveolar", "Palatal"],
  [
    ["Plosive", "Bilabial", ["p"]],
    ["Plosive", "Alveolar", ["t"]],
    ["Glide", "Bilabial", ["w"]],
    ["Glide", "Palatal", ["j"]],
  ]
);
const glideVowels = makeChart(
  ["Open", "Mid"],
  ["Front", "Back"],
  [
    ["Open", "Front", ["a"]],
    ["Open", "Back", ["ɑ"]],
    ["Mid", "Front", ["e"]],
    ["Mid", "Back", ["o"]],
  ]
);
const glideCtx = contextForInventory({ consonants: glideConsonants, vowels: glideVowels });
const glideApply = (notation, form) => {
  const compiled = compileRule(notation, glideCtx);
  if (!compiled.ok) return { error: compiled.error };
  const tokens = glideCtx.tokenize(form);
  return { out: applyRule(tokens, compiled.rule, glideCtx).tokens.join("") };
};
const diphthongAw = compileRule("aw > o", glideCtx);
truthy(
  "a two-letter diphthong stays quiet about its literal reading",
  diphthongAw.ok && !(diphthongAw.warnings?.length > 0)
);
const diphthongAj = compileRule("aj > e", glideCtx);
truthy(
  "a palatal two-letter diphthong stays quiet too",
  diphthongAj.ok && !(diphthongAj.warnings?.length > 0)
);
equal("the diphthong rule still applies as written", glideApply("aw > o", "paw"), { out: "po" });
equal("the palatal diphthong rule still applies", glideApply("aj > e", "paj"), { out: "pe" });

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
// Spacing modifier letters attach to the preceding segment even when the
// full compound is absent from the chart. Otherwise a stray length or
// aspiration mark becomes its own token and counts as a consonant.
equal("an uncharted long vowel stays one segment", ctx.tokenize("kaːtu"), ["k", "aː", "t", "u"]);
equal("an uncharted aspirated stop stays one segment", ctx.tokenize("pʰa"), ["pʰ", "a"]);
equal(
  "an uncharted long vowel is still a vowel",
  [ctx.isVowel("aː"), ctx.isConsonant("aː")],
  [true, false]
);
equal("a stranded modifier is not a consonant", ctx.isConsonant("ː"), false);
equal(
  "vowel deletion keeps an uncharted length mark attached",
  apply("V > ∅ / _ C", "kaːtu"),
  { out: "ktu" }
);
equal(
  "consonant deletion does not remove an uncharted length mark",
  apply("C > ∅ / V _ C", "kaːtu"),
  { out: "kaːtu" }
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
const charted = compileRule("p > s", ctx);
truthy("charted input and output do not warn", charted.ok && !(charted.warnings?.length > 0));
const unchartedOutput = compileRule("t > θ", ctx);
truthy(
  "uncharted output sounds warn like uncharted inputs",
  unchartedOutput.ok &&
    unchartedOutput.warnings?.some(
      (warning) => warning.includes("output") && warning.includes("θ")
    )
);
const aspiratedOnlyCtx = contextForInventory({
  consonants: makeChart(["Plosive"], ["Bilabial"], [["Plosive", "Bilabial", ["pʰ"]]]),
  vowels: makeChart(["Open"], ["Front"], [["Open", "Front", ["a"]]]),
});
const bareBase = compileRule("p > pʰ", aspiratedOnlyCtx);
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

/* ---- reconstruction helper ---------------------------------------------- */

const invert = (notation, form) => {
  const compiled = compileRule(notation, ctx);
  if (!compiled.ok) return { error: compiled.error };
  return invertRule(ctx.tokenize(form), compiled.rule, ctx);
};
const inverseTexts = (result) => result.candidates.map((candidate) => candidate.tokens.join(""));

equal(
  "a one-to-one change keeps the unchanged source as an alternative",
  inverseTexts(invert("p > f", "afa")),
  ["afa", "apa"]
);
equal(
  "an environment can stop an inversion",
  inverseTexts(invert("p > f / V _ V", "fa")),
  ["fa"]
);
equal(
  "a merger reports the unchanged source and every changed source",
  inverseTexts(invert("[p t k] > ʔ", "ʔa")),
  ["ʔa", "pa", "ta", "ka"]
);
equal(
  "an insertion keeps the unchanged form and removes the inserted segment",
  inverseTexts(invert("∅ > ʔ / V _ V", "aʔa")),
  ["aʔa", "aa"]
);

const reconstructAffricateConsonants = makeChart(
  ["Affricate"],
  ["Alveolar", "Velar"],
  [
    ["Affricate", "Alveolar", ["n͜d"]],
    ["Affricate", "Velar", ["ŋ͡g"]],
  ]
);
const reconstructAffricateCtx = contextForInventory({
  consonants: reconstructAffricateConsonants,
  vowels,
});
const reconstructAffricateRule = compileRule("ŋ͡g > n͜d / _ a", reconstructAffricateCtx);
const affricateInverse = invertRule(
  reconstructAffricateCtx.tokenize("n͜da"),
  reconstructAffricateRule.rule,
  reconstructAffricateCtx
);
equal(
  "a rule output does not exclude the unchanged inheritance",
  inverseTexts(affricateInverse),
  ["n͜da", "ŋ͡ga"]
);

const deletionInverse = invert("s > ∅ / _ #", "kasa");
equal(
  "a deletion offers both the unchanged form and the restored consonant",
  inverseTexts(deletionInverse),
  ["kasa", "kasas"]
);
truthy(
  "the restored deletion candidate is marked lossy",
  deletionInverse.candidates.find((candidate) => candidate.tokens.join("") === "kasas")?.loss === 1
);
equal(
  "a vowel deletion offers the unchanged form and every possible vowel",
  inverseTexts(invert("V > ∅ / _ #", "kas")),
  ["kas", "kasi", "kasu", "kasa", "kasɑ"]
);

const sequentialInverse = invertRules(
  ctx.tokenize("vata"),
  compileRuleStages(
    [
      { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null },
      { id: "c1", notation: "f > v", note: "", enabled: true, parentId: "r1" },
    ],
    ctx
  ),
  ctx
);
equal(
  "a sequential chain reports every possible ancestor",
  sequentialInverse.candidates.map((candidate) => candidate.tokens.join("")),
  ["vata", "fata", "pata"]
);

const parallelInverse = invertRules(
  ctx.tokenize("vata"),
  compileRuleStages(
    [
      { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null },
      { id: "r2", notation: "f > v", note: "", enabled: true, parentId: null },
    ],
    ctx
  ),
  ctx
);
equal(
  "parallel rules report the unchanged form and every valid source",
  parallelInverse.candidates.map((candidate) => candidate.tokens.join("")),
  ["vata", "fata"]
);

// A chain shift is the classic parallel interaction: each rule changes a
// segment that a sister rule targets, and both match the frozen ancestral
// form. Inverting one rule at a time must not reject an unchanged sister rule
// merely because that sister would apply to the intermediate output.
const chainShiftConsonants = makeChart(
  ["Plosive"],
  ["Alveolar"],
  [["Plosive", "Alveolar", ["t"]]]
);
const chainShiftVowels = makeChart(
  ["Close", "Open"],
  ["Central"],
  [
    ["Close", "Central", ["o", "oː"]],
    ["Open", "Central", ["a", "aː"]],
  ]
);
const chainShiftCtx = contextForInventory({
  consonants: chainShiftConsonants,
  vowels: chainShiftVowels,
});
const chainShiftChanges = [
  { id: "r1", notation: "aː > oː", note: "", enabled: true, parentId: null },
  { id: "r2", notation: "oː > aː", note: "", enabled: true, parentId: null },
];
const chainShiftGroups = compileRuleStages(chainShiftChanges, chainShiftCtx);
equal(
  "a parallel chain shift inverts against the frozen ancestral form",
  invertRules(chainShiftCtx.tokenize("toː"), chainShiftGroups, chainShiftCtx).candidates.map(
    (candidate) => candidate.tokens.join("")
  ),
  ["taː"]
);
const reversedChainShiftGroups = compileRuleStages(
  [...chainShiftChanges].reverse(),
  chainShiftCtx
);
equal(
  "a parallel chain shift inverts the same way in either display order",
  invertRules(chainShiftCtx.tokenize("toː"), reversedChainShiftGroups, chainShiftCtx).candidates.map(
    (candidate) => candidate.tokens.join("")
  ),
  ["taː"]
);
const chainShiftProject = {
  title: "Chain shift",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      inventory: { consonants: chainShiftConsonants, vowels: chainShiftVowels },
      phonotactics: { template: "(C)V(C)", onsets: "", codas: "", forbidden: "", notes: "", classes: [] },
      soundChanges: [],
      vocabulary: [],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      inventory: { consonants: chainShiftConsonants, vowels: chainShiftVowels },
      phonotactics: { template: "(C)V(C)", onsets: "", codas: "", forbidden: "", notes: "", classes: [] },
      soundChanges: chainShiftChanges,
      vocabulary: [],
    },
  ],
};
const chainShiftReconstruction = reconstructForm("toː", chainShiftProject, "child");
equal(
  "reconstructForm reverses a derivation under parallel rules",
  [chainShiftReconstruction.ok, chainShiftReconstruction.candidates.map((candidate) => candidate.text)],
  [true, ["taː"]]
);

const noInverse = invert("a > e", "aka");
equal("a form the rules cannot produce has no inverse", noInverse.candidates, []);

const voicedConsonants = makeChart(
  ["Plosive"],
  ["Bilabial", "Alveolar"],
  [
    ["Plosive", "Bilabial", ["p", "b"]],
    ["Plosive", "Alveolar", ["t", "d"]],
  ]
);
const voicedCtx = contextForInventory({ consonants: voicedConsonants, vowels });
const voicedRule = compileRule("t > [+voice] / V _ V", voicedCtx);
const voicedInverse = invertRule(voicedCtx.tokenize("ada"), voicedRule.rule, voicedCtx);
equal(
  "a feature change keeps the unchanged source as an alternative",
  voicedInverse.candidates.map((candidate) => candidate.tokens.join("")),
  ["ada", "ata"]
);

const reconstructionProject = stagedProject([
  { id: "r1", notation: "p > f / V _ V", note: "", enabled: true, parentId: null },
]);
const reconstruction = reconstructForm("afa", reconstructionProject, "child");
equal("reconstruction names the immediate ancestor", reconstruction.parent?.id, "root");
equal("reconstruction prefers the unchanged form", reconstruction.text, "afa");
equal(
  "reconstruction alternatives include the unchanged and changed forms",
  reconstructionAlternatives(reconstruction),
  ["afa", "apa"]
);
equal("a root language has nothing to reconstruct", reconstructForm("kasa", project, "root").reason, "root");
equal("an empty form is not reconstructed", reconstructForm("", project, "child").reason, "empty");
const mergerProject = stagedProject([
  { id: "r1", notation: "[p t k] > ʔ", note: "", enabled: true, parentId: null },
]);
const mergerReconstruction = reconstructForm("ʔa", mergerProject, "child");
truthy("reconstructForm flags merger ambiguity", mergerReconstruction.ambiguous);
truthy("reconstructForm keeps the unchanged merger source", mergerReconstruction.unchanged);
equal(
  "reconstructForm surfaces the unchanged source and every merger alternative",
  mergerReconstruction.candidates.map((candidate) => candidate.text),
  ["ʔa", "pa", "ta", "ka"]
);

const affricateBase = {
  inventory: { consonants: reconstructAffricateConsonants, vowels },
  phonotactics: { template: "(C)V(C)", onsets: "", codas: "", forbidden: "", notes: "", classes: [] },
};
const affricateProject = {
  title: "Affricates",
  languages: [
    { id: "root", name: "Root", parentId: null, ...affricateBase, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...affricateBase,
      soundChanges: [
        { id: "r1", notation: "ŋ͡g > n͜d / _ a", note: "", enabled: true, parentId: null },
      ],
      vocabulary: [],
    },
  ],
};
const affricateReconstruction = reconstructForm("n͜da", affricateProject, "child");
equal(
  "a rule output does not make the unchanged form impossible",
  affricateReconstruction.candidates.map((candidate) => candidate.text),
  ["n͜da", "ŋ͡ga"]
);
truthy("reconstructForm flags inherited/derived ambiguity", affricateReconstruction.ambiguous);
truthy("reconstructForm marks the unchanged candidate", affricateReconstruction.unchanged);

const parentEvidenceProject = {
  title: "Parent evidence",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      ...affricateBase,
      soundChanges: [],
      vocabulary: [{ id: "w1", gloss: "you (sg.)", form: "ŋ͡ga", note: "" }],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...affricateBase,
      soundChanges: [
        { id: "r1", notation: "ŋ͡g > n͜d / _ a", note: "", enabled: true, parentId: null },
      ],
      vocabulary: [],
    },
  ],
};
const parentGlossEvidence = reconstructForm("n͜da", parentEvidenceProject, "child", {
  gloss: "you (sg.)",
});
equal(
  "a parent gloss match outranks a lower-cost reconstruction",
  parentGlossEvidence.text,
  "ŋ͡ga"
);
equal(
  "parent gloss evidence is recorded on the candidate",
  parentGlossEvidence.candidates[0].parentMatch,
  "gloss"
);
equal(
  "parent evidence still lists every exact alternative",
  parentGlossEvidence.candidates.map((candidate) => candidate.text),
  ["ŋ͡ga", "n͜da"]
);

const punctuationEvidence = reconstructForm("n͜da", parentEvidenceProject, "child", {
  gloss: "You (sg)",
});
equal(
  "punctuation drift in a gloss still counts as a parent gloss match",
  punctuationEvidence.candidates[0].parentMatch,
  "gloss"
);
equal("punctuation drift uses the parent gloss wording", punctuationEvidence.candidates[0].parentGloss, "you (sg.)");

const parentFormEvidence = reconstructForm("n͜da", parentEvidenceProject, "child");
equal("a parent form match is also evidence", parentFormEvidence.text, "ŋ͡ga");
equal(
  "form-only parent evidence is weaker than a gloss match but still recorded",
  parentFormEvidence.candidates[0].parentMatch,
  "form"
);

parentEvidenceProject.languages[1].vocabulary.push({
  id: "w_child",
  gloss: "you (sg.)",
  form: "n͜da",
  note: "",
});
const inferredGlossEvidence = reconstructForm("n͜da", parentEvidenceProject, "child");
equal(
  "reconstruction infers the gloss from the daughter lexicon",
  inferredGlossEvidence.gloss,
  "you (sg.)"
);
equal("inferred gloss uses the parent lexicon", inferredGlossEvidence.text, "ŋ͡ga");

const subgroupProject = {
  title: "Subgrouping",
  languages: [
    { id: "root", name: "Root", parentId: null, soundChanges: [] },
    {
      id: "x",
      name: "X",
      parentId: "root",
      soundChanges: [
        { id: "x1", notation: "p > f", note: "", enabled: true },
        { id: "x2", notation: "a > e", note: "", enabled: true },
      ],
    },
    {
      id: "a",
      name: "A",
      parentId: "x",
      soundChanges: [
        { id: "a1", notation: "t > s", note: "", enabled: true },
        { id: "a2", notation: "m > n", note: "", enabled: false },
      ],
    },
    { id: "single", name: "Single", parentId: "a", soundChanges: [] },
    {
      id: "b",
      name: "B",
      parentId: "x",
      soundChanges: [
        { id: "b1", notation: "t  >  s", note: "", enabled: true },
        { id: "b2", notation: "k > g", note: "", enabled: true },
      ],
    },
    {
      id: "c",
      name: "C",
      parentId: "root",
      soundChanges: [{ id: "c1", notation: "k > g", note: "", enabled: true }],
    },
    {
      id: "d",
      name: "D",
      parentId: "root",
      soundChanges: [{ id: "d1", notation: "p > f", note: "", enabled: true }],
    },
  ],
};
const subgroup = subgroupingEvidence(subgroupProject);
const subgroupRoot = subgroup.nodes.find((node) => node.language.id === "root");
const subgroupX = subgroup.nodes.find((node) => node.language.id === "x");
equal("subgrouping tests only nodes with two or more daughters", subgroup.tested, 2);
truthy(
  "a node with one daughter is not a subgrouping test",
  !subgroup.nodes.some((node) => node.language.id === "single")
);
equal("a clade with shared branch innovations is supported", subgroupX.status, "supported");
equal(
  "branch innovations are listed on the node",
  subgroupX.ancestral.map((rule) => rule.key),
  ["p > f", "a > e"]
);
equal(
  "the same change on every descendant branch is shared",
  subgroupX.shared.map((rule) => rule.key),
  ["t > s"]
);
truthy("a shared change can be unique to the clade", subgroupX.shared[0].unique);
equal(
  "support counts unique branch and shared rules",
  subgroupX.support,
  2
);
truthy(
  "a branch rule also recorded outside the clade is not unique",
  subgroupX.ancestral.find((rule) => rule.key === "p > f")?.unique === false
);
equal("a clade with no shared change is unsupported", subgroupRoot.status, "unsupported");
truthy(
  "an unsupported node explains why",
  subgroupRoot.warning.includes("No shared sound change")
);
truthy(
  "partially shared changes are still listed",
  subgroupRoot.partial.some(
    (rule) => rule.key === "p > f" && rule.count === 2 && rule.sources.join(",") === "X,D"
  )
);
truthy(
  "rules below a daughter branch are not counted at the parent node",
  !subgroupRoot.partial.some((rule) => rule.key === "t > s")
);
truthy(
  "disabled rules are ignored",
  ![...subgroupX.ancestral, ...subgroupX.shared, ...subgroupRoot.partial].some(
    (rule) => rule.key === "m > n"
  )
);
equal(
  "subgrouping summary counts supported and unsupported nodes",
  [subgroup.supported, subgroup.unsupported],
  [1, 1]
);
equal(
  "a family with no branching node has nothing to test",
  subgroupingEvidence({
    languages: [{ id: "lonely", name: "Lonely", parentId: null, soundChanges: [] }],
  }).tested,
  0
);

const weakSubgroupProject = {
  title: "Weak subgrouping",
  languages: [
    { id: "root", name: "Root", parentId: null, soundChanges: [] },
    { id: "x", name: "X", parentId: "root", soundChanges: [] },
    {
      id: "a",
      name: "A",
      parentId: "x",
      soundChanges: [{ id: "a1", notation: "t > s", note: "", enabled: true }],
    },
    {
      id: "b",
      name: "B",
      parentId: "x",
      soundChanges: [{ id: "b1", notation: "t > s", note: "", enabled: true }],
    },
    {
      id: "c",
      name: "C",
      parentId: "root",
      soundChanges: [{ id: "c1", notation: "t > s", note: "", enabled: true }],
    },
  ],
};
const weakSubgroup = subgroupingEvidence(weakSubgroupProject);
const weakX = weakSubgroup.nodes.find((node) => node.language.id === "x");
equal(
  "a shared change found outside the clade does not uniquely support it",
  weakX.status,
  "weak"
);
truthy(
  "weak support explains the outgroup match",
  weakX.warning.includes("outside this clade")
);
equal(
  "weak support still lists the shared change",
  weakX.shared.map((rule) => rule.key),
  ["t > s"]
);
truthy("the weak shared change is marked non-unique", weakX.shared[0].unique === false);

const spacingSubgroup = subgroupingEvidence({
  languages: [
    { id: "root", name: "Root", parentId: null, soundChanges: [] },
    { id: "a", name: "A", parentId: "root", soundChanges: [{ id: "a1", notation: "p > f" }] },
    { id: "b", name: "B", parentId: "root", soundChanges: [{ id: "b1", notation: "p->f" }] },
  ],
});
equal(
  "arrow spacing does not hide a shared innovation",
  spacingSubgroup.nodes.find((node) => node.language.id === "root").shared.map((rule) => rule.key),
  ["p > f"],
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

const emptyProject = ensureProject({ title: "Empty", languages: [] });
equal("an empty project stays empty", emptyProject.languages, []);
equal("an empty project keeps its title", emptyProject.title, "Empty");

/* ---- id normalization ---------------------------------------------------- */

const hostileId = 'x" onmouseover="alert(1) t="';
const idProject = ensureProject({
  title: "Ids",
  languages: [
    {
      id: 5,
      name: "Numeric",
      parentId: 5,
      soundChanges: [
        { id: 1, notation: "p > f" },
        { id: 2, notation: "b > v / V _ V", parentId: 1 },
      ],
      vocabulary: [{ id: 7, gloss: "x", form: "y" }],
    },
    { id: hostileId, name: "Crafted", parentId: 5 },
    { id: "ok", name: "Fine", parentId: hostileId },
    { id: "ok", name: "Duplicate", parentId: null },
  ],
});
const [numericId, craftedId, fineId, duplicateId] = idProject.languages;
equal("numeric language ids become strings", numericId.id, "5");
truthy("a self-parent is detached", numericId.parentId === null);
equal(
  "rule ids become strings and keep their parent link",
  [numericId.soundChanges[0].id, numericId.soundChanges[1].id, numericId.soundChanges[1].parentId],
  ["1", "2", "1"]
);
equal("word ids become strings", numericId.vocabulary[0].id, "7");
truthy(
  "an unsafe id is regenerated",
  craftedId.id !== hostileId && /^[A-Za-z0-9_-]+$/.test(craftedId.id)
);
equal("parent links follow a regenerated id", fineId.parentId, craftedId.id);
truthy("duplicate ids get a fresh id", duplicateId.id !== "ok" && duplicateId.id !== craftedId.id);

const repairedCycleProject = ensureProject({
  title: "Cycle repair",
  languages: [
    { id: "a", name: "A", parentId: "b" },
    { id: "b", name: "B", parentId: "c" },
    { id: "c", name: "C", parentId: "c" },
  ],
});
equal(
  "cycle repair detaches only the language that closes the loop",
  repairedCycleProject.languages.map((item) => [item.id, item.parentId]),
  [["a", "b"], ["b", "c"], ["c", null]],
);
const dupWordProject = ensureProject({
  title: "Dup",
  languages: [
    {
      id: "L",
      name: "L",
      vocabulary: [
        { id: "w", gloss: "a", form: "p" },
        { id: "w", gloss: "b", form: "q" },
      ],
    },
  ],
});
truthy(
  "duplicate word ids are deduped",
  dupWordProject.languages[0].vocabulary[0].id === "w" &&
    dupWordProject.languages[0].vocabulary[1].id !== "w"
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

/* ---- stress and syllable notation -------------------------------------- */

const stressCtx = contextForInventory(inventory, null, { stress: "initial" });
const finalCtx = contextForInventory(inventory, null, { stress: "final" });
const stressApply = (context, notation, form) => {
  const compiled = compileRule(notation, context);
  if (!compiled.ok) return { error: compiled.error };
  return { out: applyRule(context.tokenize(form), compiled.rule, context).tokens.join("") };
};

const parsedStress = ctx.tokenizeWithStress("ˌka.sa");
equal("stress marks are not segments", parsedStress.tokens, ["k", "a", "s", "a"]);
equal("a stress mark belongs to the next segment", parsedStress.stress, ["ˌ", "", "", ""]);
equal("explicit stress is reported", parsedStress.explicit, true);
equal("plain tokenize ignores stress and dots", ctx.tokenize("ˈka.sa"), ["k", "a", "s", "a"]);

const light = () => ({ nucleus: ["a"], coda: [] });
const heavy = () => ({ nucleus: ["a"], coda: ["n"] });
const long = () => ({ nucleus: ["aː"], coda: [] });
const diphthong = () => ({ nucleus: ["a", "i"], coda: [] });
equal("initial stress", stressIndexOf([light(), light(), light()], "initial"), 0);
equal("final stress", stressIndexOf([light(), light(), light()], "final"), 2);
equal("penultimate stress", stressIndexOf([light(), light(), light()], "penult"), 1);
equal("antepenultimate stress", stressIndexOf([light(), light(), light(), light()], "antepenult"), 1);
equal("weight stress takes a heavy penult", stressIndexOf([light(), heavy(), light()], "weight"), 1);
equal("weight stress falls back to the antepenult", stressIndexOf([light(), light(), light()], "weight"), 0);
equal("weight stress falls back to the initial in a short word", stressIndexOf([light(), light()], "weight"), 0);
truthy("a closed syllable is heavy", isHeavySyllable(heavy()));
truthy("a long nucleus is heavy", isHeavySyllable(long()));
truthy("a diphthong is heavy", isHeavySyllable(diphthong()));
truthy("an open short syllable is light", !isHeavySyllable(light()));
const macron = () => ({ nucleus: ["ā"], coda: [] });
const combiningMacron = () => ({ nucleus: ["a\u0304"], coda: [] });
truthy("a precomposed macron nucleus is heavy", isHeavySyllable(macron()));
truthy("a combining macron nucleus is heavy", isHeavySyllable(combiningMacron()));
equal("weight stress takes a macron penult", stressIndexOf([light(), macron(), light()], "weight"), 1);
equal(
  "weight stress treats a macron like a length mark",
  stressIndexOf([light(), macron(), light()], "weight"),
  stressIndexOf([light(), long(), light()], "weight")
);
const macronVowels = makeChart(["Open"], ["Front"], [["Open", "Front", ["a", "aː", "ā"]]]);
const macronChecker = createPhonotacticsChecker({
  inventory: { consonants: makeChart(["Plosive"], ["Bilabial"], [["Plosive", "Bilabial", ["p"]]]), vowels: macronVowels },
  phonotactics: { template: "CV(C)", stress: "weight" },
});
equal("macron penult is stressed end to end", macronChecker.validate("papāpa").displayText, "pa.ˈpā.pa");
equal(
  "macron and length-mark penults stress the same syllable",
  macronChecker.validate("papāpa").stressIndex,
  macronChecker.validate("papaːpa").stressIndex
);
equal("unknown stress systems normalize to none", normalizeStressSystem("loud"), "none");
equal("stress labels read naturally", stressLabel("weight"), "Weight-sensitive (penult if heavy)");
equal("missing stress defaults to none", migratedPhonotactics.stress, "none");

const initialChecker = createPhonotacticsChecker({
  ...language,
  phonotactics: { ...language.phonotactics, stress: "initial" },
});
const initialWord = initialChecker.validate("kasa");
equal("validation reports the stress display", initialWord.displayText, "ˈka.sa");
equal("validation exposes the stress index", initialWord.stressIndex, 0);
equal("mark stress helper writes the predicted mark", stressMarkedForm("kasa", initialChecker), "ˈkasa");
equal(
  "a daughter inherits the stress system",
  createLanguage("Daughter", "only", inventory, {
    ...language.phonotactics,
    stress: "initial",
  }).phonotactics.stress,
  "initial"
);

const weightChecker = createPhonotacticsChecker({
  ...language,
  phonotactics: { ...language.phonotactics, stress: "weight" },
});
equal("a heavy penult is stressed", weightChecker.validate("kasantan").displayText, "ka.ˈsan.tan");
equal("a light penult falls back to the antepenult", weightChecker.validate("kasantaka").displayText, "ka.ˈsan.ta.ka");

equal("stress-conditioned rule targets the stressed syllable", stressApply(stressCtx, "a > ə / ˈ _", "kasa"), { out: "kəsa" });
equal("stress-conditioned rule ignores unstressed syllables", stressApply(finalCtx, "a > ə / ˈ _", "kasa"), { out: "kasə" });
equal("right syllable edge matches a coda", stressApply(stressCtx, "s > z / _ .", "kas"), { out: "kaz" });
equal("right syllable edge rejects an onset", stressApply(stressCtx, "s > z / _ .", "kasa"), { out: "kasa" });
equal("left syllable edge matches an onset", stressApply(stressCtx, "s > z / . _", "kasa"), { out: "kaza" });
equal("sigma is an alias for the syllable edge", stressApply(stressCtx, "s > z / _ σ", "kas"), { out: "kaz" });

const targetStress = compileRule("ˈ > ∅", stressCtx);
truthy(
  "stress marks are rejected in the input",
  !targetStress.ok && /only work in the environment/.test(targetStress.error)
);
const targetDot = compileRule(". > z", stressCtx);
truthy(
  "syllable edges are rejected in the input",
  !targetDot.ok && /only work in the environment/.test(targetDot.error)
);
const noStressRule = compileRule("a > ə / ˈ _", ctx);
truthy(
  "a stress environment warns when the language has no stress system",
  noStressRule.ok && noStressRule.warnings.some((warning) => warning.includes("no stress system"))
);
const gluedStressRule = compileRule("a > e / aˈ _", stressCtx);
equal(
  "a stress mark glued to an environment chunk becomes its own atom",
  gluedStressRule.rule?.left.map((atom) => atom.type),
  ["literal", "stress"],
);

const stressProject = ensureProject({
  title: "Stress display",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      phonotactics: { ...language.phonotactics, stress: "initial" },
      soundChanges: [],
      allophony: [],
      vocabulary: [],
    },
  ],
});
const stressSurface = surfaceForForm("kasa", stressProject, "only");
equal("surface display includes stress and syllables", stressSurface.display, "ˈka.sa");
equal("surface text remains bare segments", stressSurface.text, "kasa");

const stressChangeProject = ensureProject({
  title: "Stress changes",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      inventory,
      phonotactics: { ...language.phonotactics, stress: "none" },
      soundChanges: [],
      allophony: [],
      vocabulary: [],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      inventory,
      phonotactics: { ...language.phonotactics, stress: "initial" },
      soundChanges: [{ id: "r1", notation: "a > ə / ˈ _", note: "", enabled: true }],
      allophony: [],
      vocabulary: [],
    },
  ],
});
equal("sound changes can condition on stress", deriveForm("kasa", stressChangeProject, "child").text, "kəsa");
equal(
  "stress marks in a stored form do not affect derivation",
  deriveForm("ˈkasa", stressChangeProject, "child").text,
  "kəsa"
);

const stressAllophonyProject = ensureProject({
  title: "Stress allophony",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      phonotactics: { ...language.phonotactics, stress: "final" },
      soundChanges: [],
      allophony: [{ id: "a1", notation: "a > ə / ˈ _", note: "", enabled: true }],
      vocabulary: [],
    },
  ],
});
equal(
  "allophony can condition on stress",
  surfaceForForm("kasa", stressAllophonyProject, "only").text,
  "kasə"
);

/* ---- morpheme boundaries ------------------------------------------------ */

const cutApply = (notation, form, context = ctx) => {
  const compiled = compileRule(notation, context);
  if (!compiled.ok) return { error: compiled.error };
  const parsed = context.tokenizeWithStress(form);
  const result = applyRule(parsed.tokens, compiled.rule, context, parsed.junctures);
  return {
    out: joinSegments(result.tokens, result.junctures),
    cuts: [...result.junctures].sort((a, b) => a - b),
  };
};

const parsedCuts = ctx.tokenizeWithStress("kat+ta");
equal("morpheme cuts are not segments", parsedCuts.tokens, ["k", "a", "t", "t", "a"]);
equal("a morpheme cut is recorded between segments", [...parsedCuts.junctures], [3]);
equal("cuts and stress coexist", ctx.tokenizeWithStress("ˈka+ta").junctures.has(2), true);
equal("edge cuts duplicate the word boundary", [...ctx.tokenizeWithStress("+kata+").junctures], []);
equal("plain tokenize ignores cuts", ctx.tokenize("kat+ta"), ["k", "a", "t", "t", "a"]);

equal("a cut conditions a following segment", cutApply("t > d / + _", "at+ta"), {
  out: "at+da",
  cuts: [2],
});
equal("a cut does not match a plain cluster", cutApply("t > d / + _", "atta"), {
  out: "atta",
  cuts: [],
});
equal("a cut conditions a preceding segment", cutApply("t > d / _ +", "at+ta"), {
  out: "ad+ta",
  cuts: [2],
});
equal("a compact environment splits the cut from its neighbour", cutApply("t > d / a+ _", "a+ta"), {
  out: "a+da",
  cuts: [1],
});
equal("both sides can require a cut", cutApply("a > ə / + _ +", "k+a+k"), {
  out: "k+ə+k",
  cuts: [1, 2],
});
equal("a word boundary stays distinct from a cut", cutApply("t > d / # _", "ta+ta"), {
  out: "da+ta",
  cuts: [2],
});
equal("a cut is not a word boundary", cutApply("t > d / + _", "tata"), {
  out: "tata",
  cuts: [],
});
equal("insertion after a cut stays in the right morpheme", cutApply("∅ > t / + _", "a+a"), {
  out: "a+ta",
  cuts: [1],
});
equal("insertion before a cut stays in the left morpheme", cutApply("∅ > t / _ +", "a+a"), {
  out: "at+a",
  cuts: [2],
});
equal("rewriting across a cut removes it", cutApply("tt > t", "at+ta"), {
  out: "ata",
  cuts: [],
});
equal("unrelated rewrites keep their cuts", cutApply("a > e", "kat+ta"), {
  out: "ket+te",
  cuts: [3],
});
equal("a cut that reaches a word edge is dropped", cutApply("a > ∅ / # _", "a+ta"), {
  out: "ta",
  cuts: [],
});

const cutParallelProject = ensureProject({
  title: "Parallel cuts",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "r1", notation: "∅ > nn / # _", note: "", enabled: true },
        { id: "r2", notation: "t > ∅ / a _", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});
equal(
  "parallel edits shift cuts by their combined effect",
  deriveForm("a+t+a", cutParallelProject, "child", { directOnly: true }).text,
  "nna+a"
);

const cutTarget = compileRule("+ > -", ctx);
truthy(
  "morpheme boundaries are rejected in the input",
  !cutTarget.ok && /only valid in the environment/.test(cutTarget.error)
);

const cutAlloRules = compileAllophonyRules(
  [{ id: "a1", notation: "t > d / + _", note: "", enabled: true }],
  ctx
);
const cutAlloInput = ctx.tokenizeWithStress("at+ta");
const cutAllo = applyAllophony(cutAlloInput.tokens, cutAlloRules, ctx, {
  junctures: cutAlloInput.junctures,
});
equal("allophony can condition on a cut", cutAllo.text, "at+da");
equal("allophony keeps the cut", [...cutAllo.junctures], [2]);

const cutChangeProject = ensureProject({
  title: "Morpheme cuts",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [{ id: "r1", notation: "t > d / + _", note: "", enabled: true }],
      vocabulary: [],
    },
  ],
});
equal(
  "sound changes preserve morpheme cuts in the derived form",
  deriveForm("at+ta", cutChangeProject, "child").text,
  "at+da"
);

const cutSurface = surfaceForForm("kat+ta", stressProject, "only");
equal("surface text preserves the cut", cutSurface.text, "kat+ta");
equal("surface display keeps the cut instead of a dot", cutSurface.display, "ˈkat+ta");

const cutReconstruction = reconstructForm("at+da", cutChangeProject, "child");
equal("reconstruction keeps the daughter's cut", cutReconstruction.inputText, "at+da");
truthy(
  "reconstruction restores the parent form with its cut",
  reconstructionAlternatives(cutReconstruction).includes("at+ta")
);
equal(
  "reconstruction candidates carry the cut",
  cutReconstruction.candidates.map((candidate) => [...candidate.junctures]),
  [[2], [2]]
);

const cutChecker = createPhonotacticsChecker({
  ...language,
  phonotactics: { ...language.phonotactics, stress: "initial" },
});
equal("phonotactic display shows the cut", cutChecker.validate("kat+ta").displayText, "ˈkat+ta");
equal("marking stress keeps the cut", stressMarkedForm("kat+ta", cutChecker), "ˈkat+ta");

equal("search normalization ignores morpheme cuts", normalizeSearchText("Kat+ta"), "katta");

/* ---- notation ----------------------------------------------------------- */

equal("strip phonemic slashes", stripLevelMarks("/kasa/"), "kasa");
equal("strip phonetic brackets", stripLevelMarks("[kʰasa]"), "kʰasa");
equal("strip trims surrounding whitespace", stripLevelMarks("  /kasa/  "), "kasa");
equal("plain form is unchanged", stripLevelMarks("kasa"), "kasa");
equal("a lone slash is not a delimiter", stripLevelMarks("/"), "/");
equal("format phonemic", formatPhonemic("kasa"), "/kasa/");
equal("format phonetic replaces existing level marks", formatPhonetic("/kʰasa/"), "[kʰasa]");
equal("format empty form", formatPhonemic("  "), "");
equal("search normalization ignores stress marks", normalizeSearchText("kaˈsa"), "kasa");
equal("search normalization ignores level marks and case", normalizeSearchText("/KaˈSa/"), "kasa");
equal("search normalization keeps ordinary forms", normalizeSearchText("kasa"), "kasa");

equal("same form ignores stress marks", sameForm("kaˈsa", "kasa"), true);
equal("same form ignores morpheme cuts and syllable dots", sameForm("kat+ta", "kat.ta"), true);
equal("same form ignores hyphens and whitespace", sameForm("ka-ta", "kata"), true);
equal("same form compares actual segments", sameForm("kasa", "kaza"), false);
equal("same tokens compares order", sameTokens(["k", "a"], ["a", "k"]), false);
equal("same tokens accepts equal arrays", sameTokens(["k", "a"], ["k", "a"]), true);
equal("same junctures compares sets", sameJunctures(new Set([2, 4]), new Set([4, 2])), true);
equal("same junctures rejects a different cut", sameJunctures(new Set([2]), new Set([3])), false);

equal(
  "gloss normalization collapses whitespace, unicode, and case",
  normalizeGloss("  Ka\u0301t\t ta "),
  "kát ta"
);
equal("gloss normalization tolerates null", normalizeGloss(null), "");
equal("escape covers markup characters", esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#039;");
equal("dialog copy escapes markup by default", escapeDialogCopy("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
equal("dialog copy keeps explicit markup", escapeDialogCopy("<b>x</b>", true), "<b>x</b>");

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

// An unspaced multi-symbol output is two segments, just as it would be in a
// sound-change rule. Teaching the tokenizer the whole chunk made `ea` a single
// unfettered token with no feature bundle.
const fusedAllophoneProject = ensureProject({
  title: "Fused allophone",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [
        { id: "f1", notation: "/a/ > [ea]", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});
const fusedAllophoneSurface = surfaceForForm("ka", fusedAllophoneProject, "only");
equal(
  "an unspaced allophone output is not taught as one segment",
  fusedAllophoneSurface.tokens,
  ["k", "e", "a"]
);
equal("an unspaced allophone output keeps its segment count", fusedAllophoneSurface.text, "kea");
fusedAllophoneProject.languages[0].allophony = [
  { id: "f1", notation: "/a/ > [aa]", note: "", enabled: true },
  { id: "f2", notation: "/V/ > [e] / _ #", note: "", enabled: true },
];
const fusedCascadeSurface = surfaceForForm("ka", fusedAllophoneProject, "only");
equal(
  "a multi-symbol allophone output feeds later rules as separate segments",
  [fusedCascadeSurface.text, fusedCascadeSurface.tokens],
  ["kae", ["k", "a", "e"]]
);

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

// Toast undo must survive edits made while the toast is visible. In this
// scenario a group was ungrouped, then one of its rules was deleted before
// Undo; the old index+span splice removed the adjacent rule instead.
const ungroupUndo = {
  allophony: [
    { id: "ug", type: "group", name: "G", collapsed: false, enabled: true, rules: [groupRule("a"), groupRule("b")] },
    groupRule("c"),
  ],
};
const ungroupedGroup = ungroupUndo.allophony[0];
const ungroupedRules = [...ungroupedGroup.rules];
ungroupUndo.allophony.splice(0, 1, ...ungroupedRules);
ungroupUndo.allophony.splice(1, 1); // delete "b" during the undo window
truthy(
  "ungroup undo restores the group instead of a stale span",
  restoreUngroupedAllophonyRules(ungroupUndo, ungroupedGroup, 0, ungroupedRules)
);
equal(
  "ungroup undo keeps the deleted rule deleted and the neighbour present",
  allophonyEntries(ungroupUndo.allophony).map((entry) => entry.rule.id),
  ["a", "c"]
);
equal(
  "ungroup undo rebuilds the group around the surviving rules",
  ungroupedGroup.rules.map((rule) => rule.id),
  ["a"]
);
truthy(
  "a second ungroup undo does not duplicate the group",
  !restoreUngroupedAllophonyRules(ungroupUndo, ungroupedGroup, 0, ungroupedRules)
);

const groupUndo = { allophony: [groupRule("a"), groupRule("c")] };
const deletedGroup = { id: "dg", type: "group", name: "D", collapsed: false, enabled: true, rules: [groupRule("b")] };
truthy("group undo inserts by identity", restoreAllophonyGroup(groupUndo, deletedGroup, 1));
equal(
  "group undo does not remove the rules now at the captured index",
  allophonyEntries(groupUndo.allophony).map((entry) => entry.rule.id),
  ["a", "b", "c"]
);
truthy("a second group undo is a no-op", !restoreAllophonyGroup(groupUndo, deletedGroup, 1));

const detachedRuleUndo = { allophony: [groupRule("a"), groupRule("c")] };
truthy(
  "rule undo falls back to the top level when its group is gone",
  restoreAllophonyRule(detachedRuleUndo, groupRule("b"), { id: "gone", type: "group", rules: [] }, 1)
);
equal(
  "rule undo restores only the missing rule",
  allophonyEntries(detachedRuleUndo.allophony).map((entry) => entry.rule.id),
  ["a", "b", "c"]
);

const languageUndo = {
  title: "Undo",
  languages: [
    { id: "a", name: "A", parentId: null },
    { id: "b", name: "B", parentId: "a" },
    { id: "c", name: "C", parentId: null },
  ],
};
const removedBranch = languageUndo.languages
  .map((language, index) => ({ language, index }))
  .filter(({ language }) => language.id === "b");
deleteLanguage(languageUndo, "b");
languageUndo.languages.push({ id: "new", name: "New", parentId: null });
equal(
  "language undo restores only the deleted branch",
  restoreDeletedLanguages(languageUndo, removedBranch),
  1
);
equal(
  "language undo preserves languages created during the window",
  languageUndo.languages.map((language) => language.id),
  ["a", "b", "c", "new"]
);
equal(
  "language undo leaves an already-restored branch alone",
  restoreDeletedLanguages(languageUndo, removedBranch),
  0
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

const harmonyLanguage = (allophony) => ({
  title: "Harmony",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony,
      vocabulary: [],
    },
  ],
});
const iterativeProject = ensureProject(
  harmonyLanguage([
    {
      id: "h1",
      notation: "a > u / u _",
      note: "",
      enabled: true,
      iterative: true,
      repeatLimit: 12,
      domain: "adjacent",
    },
  ])
);
const iterativeSurface = surfaceForForm("uaa", iterativeProject, "only");
equal("a repeating rule feeds its own environment", iterativeSurface.text, "uuu");
equal("the tester counts repeat passes", iterativeSurface.steps[0].passes, 2);
equal("a converged repeat rule reports no warnings", iterativeSurface.warnings, []);
iterativeProject.languages[0].allophony[0].iterative = false;
equal("without repeat the rule applies once", surfaceForForm("uaa", iterativeProject, "only").text, "uua");
iterativeProject.languages[0].allophony[0].iterative = true;

const wordDomainProject = ensureProject(
  harmonyLanguage([
    {
      id: "h2",
      notation: "a > u / u _",
      note: "",
      enabled: true,
      iterative: true,
      repeatLimit: 12,
      domain: "word",
    },
  ])
);
equal(
  "word-domain harmony skips intervening consonants",
  surfaceForForm("ukata", wordDomainProject, "only").text,
  "ukutu"
);

const syllableDomainProject = ensureProject(
  harmonyLanguage([
    {
      id: "h3",
      notation: "a > i / k _",
      note: "",
      enabled: true,
      iterative: false,
      repeatLimit: 12,
      domain: "syllable",
    },
  ])
);
const syllableSurface = surfaceForForm("kata", syllableDomainProject, "only");
const syllableContext = contextForAllophony(syllableDomainProject, "only");
equal(
  "the fixture syllabifies as ka.ta",
  syllableContext
    .prosodyFor(syllableContext.tokenize("kata"))
    .syllables.map((syllable) => syllable.tokens.join("")),
  ["ka", "ta"]
);
equal("a syllable domain does not cross a syllable edge", syllableSurface.text, "kita");
syllableDomainProject.languages[0].allophony[0].domain = "word";
equal("the same rule reaches across the word", surfaceForForm("kata", syllableDomainProject, "only").text, "kiti");

const runawayProject = ensureProject(
  harmonyLanguage([
    {
      id: "h4",
      notation: "∅ > a / # _",
      note: "",
      enabled: true,
      iterative: true,
      repeatLimit: 3,
      domain: "adjacent",
    },
  ])
);
const runawaySurface = surfaceForForm("k", runawayProject, "only");
equal("a runaway repeat stops at its pass limit", runawaySurface.text, "aaak");
equal("the runaway step records the limit", runawaySurface.steps[0].passes, 3);
truthy("a still-changing rule is marked runaway", runawaySurface.steps[0].runaway === true);
truthy(
  "a runaway repeat warns instead of looping",
  runawaySurface.warnings.some((warning) => warning.includes("Stopped after 3 passes"))
);

const repeatDefaults = ensureProject(
  harmonyLanguage([
    {
      id: "h5",
      notation: "a > u",
      note: "",
      enabled: true,
      iterative: true,
      repeatLimit: 999,
      domain: "over-the-hill",
    },
  ])
);
equal(
  "allophony repeat fields are normalized on load",
  [
    repeatDefaults.languages[0].allophony[0].repeatLimit,
    repeatDefaults.languages[0].allophony[0].domain,
    repeatDefaults.languages[0].allophony[0].iterative,
  ],
  [100, "adjacent", true]
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

// Interior groups migrate their cell to the group's leftmost leaf. Earlier
// versions wrote that result back into the object being iterated, so a later
// leaf entry for the same column could overwrite it depending on JSON order.
function chartMigrationProject(cells) {
  return ensureProject({
    title: "Chart migration order",
    languages: [
      {
        id: "only",
        name: "Only",
        parentId: null,
        inventory: {
          consonants: {
            rows: [
              {
                id: "r_group",
                label: "Group",
                children: [
                  { id: "r_first", label: "First", children: [] },
                  { id: "r_second", label: "Second", children: [] },
                ],
              },
            ],
            columns: [{ id: "c_only", label: "Only", children: [] }],
            cells,
            notes: "",
          },
          vowels: defaultInventory().vowels,
        },
        soundChanges: [],
        allophony: [],
        vocabulary: [],
      },
    ],
  }).languages[0].inventory.consonants;
}
const interiorFirstCells = {
  "r_group|c_only": ["ʔ"],
  "r_second|c_only": ["m"],
};
const leafFirstCells = {
  "r_second|c_only": ["m"],
  "r_group|c_only": ["ʔ"],
};
const interiorFirstChart = chartMigrationProject(interiorFirstCells);
const leafFirstChart = chartMigrationProject(leafFirstCells);
equal(
  "an interior chart cell migrates to the first leaf",
  interiorFirstChart.cells["r_first|c_only"],
  ["ʔ"]
);
equal(
  "chart migration is independent of JSON key order",
  Object.entries(leafFirstChart.cells).sort(),
  Object.entries(interiorFirstChart.cells).sort()
);
equal(
  "the leaf cell keeps its own sounds next to the migrated ones",
  leafFirstChart.cells["r_second|c_only"],
  ["m"]
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

/* ---- lexical exceptions ------------------------------------------------- */

const exceptionProject = ensureProject({
  title: "Lexical exceptions",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      ...language,
      soundChanges: [],
      allophony: [],
      vocabulary: [
        { id: "w1", gloss: "water", form: "pata" },
        { id: "w2", gloss: "father", form: "pata" },
      ],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "r1", notation: "a > e", note: "", enabled: true, parentId: null, exceptions: ["water"] },
        { id: "r2", notation: "p > f", note: "", enabled: true, parentId: null, exceptions: ["father"] },
      ],
      allophony: [
        { id: "a1", notation: "e > i", note: "", enabled: true, exceptions: ["water"] },
      ],
      vocabulary: [],
    },
  ],
});

equal(
  "a lexical exception skips only its rule",
  deriveForm("pata", exceptionProject, "child", { directOnly: true, gloss: "water" }).text,
  "fata"
);
equal(
  "a second rule's exception is independent",
  deriveForm("pata", exceptionProject, "child", { directOnly: true, gloss: "father" }).text,
  "pete"
);
equal(
  "words without an exception take every rule",
  deriveForm("pata", exceptionProject, "child", { directOnly: true, gloss: "brother" }).text,
  "fete"
);
equal(
  "exception matching ignores case and surrounding whitespace",
  deriveForm("pata", exceptionProject, "child", { directOnly: true, gloss: " Water " }).text,
  "fata"
);

const exceptionDerivation = deriveForm("pata", exceptionProject, "child", {
  directOnly: true,
  gloss: "water",
});
const exceptionParallel = exceptionDerivation.steps.find((step) => step.kind === "parallel");
const exceptionEntries = Object.fromEntries(exceptionParallel.entries.map((entry) => [entry.label, entry]));
equal(
  "an excepted top-level rule is marked in the derivation",
  [Boolean(exceptionEntries["1"].excepted), Boolean(exceptionEntries["2"].excepted)],
  [true, false]
);
equal("an excepted top-level rule reports no matches", exceptionEntries["1"].matches, 0);
equal(
  "exception steps summarize to the skipped rules",
  exceptionRulesFromSteps(exceptionDerivation.steps).map((rule) => [rule.label, rule.notation]),
  [["1", "a > e"]]
);

const sequentialExceptionProject = ensureProject({
  title: "Sequential exception",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      ...language,
      soundChanges: [
        { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null },
        { id: "c1", notation: "a > e", note: "", enabled: true, parentId: "r1", exceptions: ["water"] },
      ],
      vocabulary: [],
    },
  ],
});
const sequentialException = deriveForm("pata", sequentialExceptionProject, "only", {
  directOnly: true,
  gloss: "water",
});
equal("a sequential exception leaves its parent's output alone", sequentialException.text, "fata");
const sequentialExceptionStep = sequentialException.steps.find((step) => step.excepted);
equal(
  "a sequential exception is marked in the derivation",
  [sequentialExceptionStep?.label, sequentialExceptionStep?.changed],
  ["1.1", false]
);

const chainExceptionProject = ensureProject({
  title: "Chain exception",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null, exceptions: ["water"] },
      ],
      vocabulary: [],
    },
    {
      id: "grandchild",
      name: "Grandchild",
      parentId: "child",
      ...language,
      soundChanges: [{ id: "r2", notation: "a > e", note: "", enabled: true, parentId: null }],
      vocabulary: [],
    },
  ],
});
equal(
  "an exception applies at its own stage of a lineage",
  deriveForm("pata", chainExceptionProject, "grandchild", { gloss: "water" }).text,
  "pete"
);
equal(
  "other glosses pass through every stage",
  deriveForm("pata", chainExceptionProject, "grandchild", { gloss: "father" }).text,
  "fete"
);

const exceptionSurface = surfaceForForm("pete", exceptionProject, "child", { gloss: "water" });
equal("an allophony exception skips the surface rule", exceptionSurface.text, "pete");
equal(
  "an excepted allophony rule is marked in the surface steps",
  exceptionSurface.steps.map((step) => [step.label, Boolean(step.excepted), step.changed]),
  [["1", true, false]]
);
equal(
  "allophony exception steps summarize to the skipped rule",
  exceptionRulesFromSteps(exceptionSurface.steps).map((rule) => rule.label),
  ["1"]
);
equal(
  "the same allophony rule still applies to other glosses",
  surfaceForForm("pete", exceptionProject, "child", { gloss: "father" }).text,
  "piti"
);
equal(
  "without a gloss an allophony exception cannot match",
  surfaceForForm("pete", exceptionProject, "child").text,
  "piti"
);

const iterativeExceptionProject = ensureProject(
  harmonyLanguage([
    {
      id: "h1",
      notation: "a > u / u _",
      note: "",
      enabled: true,
      iterative: true,
      repeatLimit: 12,
      domain: "adjacent",
      exceptions: ["water"],
    },
  ])
);
const exceptedRepeat = surfaceForForm("uaa", iterativeExceptionProject, "only", { gloss: "water" });
equal("an iterative allophony exception skips every pass", exceptedRepeat.text, "uaa");
equal(
  "a skipped iterative step records zero passes",
  [exceptedRepeat.steps[0].passes, Boolean(exceptedRepeat.steps[0].excepted)],
  [0, true]
);

const reconstructionExceptionProject = ensureProject({
  title: "Reconstruct exception",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      ...language,
      soundChanges: [],
      vocabulary: [{ id: "w1", gloss: "water", form: "pata" }],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "r1", notation: "p > f", note: "", enabled: true, parentId: null, exceptions: ["water"] },
      ],
      vocabulary: [],
    },
  ],
});
const exceptedReconstruction = reconstructForm("fata", reconstructionExceptionProject, "child", {
  gloss: "water",
});
equal(
  "reconstruction does not invert an excepted rule",
  exceptedReconstruction.candidates.map((candidate) => candidate.text),
  ["fata"]
);
truthy(
  "without a gloss the same rule still reconstructs",
  reconstructForm("fata", reconstructionExceptionProject, "child").candidates.some(
    (candidate) => candidate.text === "pata"
  )
);

const migratedExceptions = ensureProject({
  title: "Exception migration",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      soundChanges: [
        { id: "r1", notation: "a > e", note: "", enabled: true, exceptions: [" Water ", "water", "", 7] },
      ],
      allophony: [
        { id: "a1", notation: "a > ə", note: "", enabled: true, exceptions: [" father ", "Father", null] },
      ],
      vocabulary: [],
    },
  ],
});
equal(
  "sound-change exceptions are trimmed and deduplicated on load",
  migratedExceptions.languages[0].soundChanges[0].exceptions,
  ["Water"]
);
equal(
  "allophony exceptions are trimmed and deduplicated on load",
  migratedExceptions.languages[0].allophony[0].exceptions,
  ["father"]
);
const legacyExceptions = ensureProject({
  title: "Exception defaults",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      soundChanges: [{ id: "r1", notation: "a > e", note: "", enabled: true }],
      allophony: [{ id: "a1", notation: "a > ə", note: "", enabled: true }],
      vocabulary: [],
    },
  ],
});
equal(
  "rules without stored exceptions default to an empty list",
  [
    legacyExceptions.languages[0].soundChanges[0].exceptions,
    legacyExceptions.languages[0].allophony[0].exceptions,
  ],
  [[], []]
);
equal(
  "normalization keeps the first spelling of a duplicated gloss",
  normalizeRuleExceptions(["Water", " water ", "WATER"]),
  ["Water"]
);
equal(
  "an exception matches a gloss case-insensitively",
  [
    ruleExceptsGloss({ exceptions: ["Water"] }, " water "),
    ruleExceptsGloss({ exceptions: ["water"] }, ""),
    ruleExceptsGloss({}, "water"),
    ruleExceptsGloss({ exceptions: "water" }, "water"),
  ],
  [true, false, false, false]
);

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
truthy(
  "a category with nothing to echo is rejected in the output",
  !categoryOutput.ok && /echoes/.test(categoryOutput.error)
);
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
const vowelBundle = resolver.bundleFor("a");
equal("vowels do not derive place-class features", derivedFeatures(vowelBundle), []);
truthy(
  "a vowel does not match a negative place feature",
  !matchFeatureTerms(vowelBundle, [{ kind: "bool", feature: "dorsal", value: false }]),
);
truthy(
  "a vowel does not match a positive place feature",
  !matchFeatureTerms(vowelBundle, [{ kind: "bool", feature: "dorsal", value: true }]),
);
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
const crossPlaceAffricate = resolver.bundleFor("t͡ʃʰ");
equal(
  "a cross-place affricate takes the release place",
  [crossPlaceAffricate?.place, crossPlaceAffricate?.place === resolver.bundleFor("t͡ʃ").place],
  ["postalveolar", true]
);
equal(
  "a cross-place affricate keeps release aspiration",
  featureDistance(crossPlaceAffricate, {
    ...resolver.bundleFor("t͡ʃ"),
    spread_glottis: true,
  }),
  0
);
const labializedPostalveolar = resolver.bundleFor("d͡ʒʷ");
equal(
  "a labialized cross-place affricate keeps its modifier",
  [
    featureDistance(labializedPostalveolar, {
      ...resolver.bundleFor("d͡ʒ"),
      labialized: true,
    }),
    labializedPostalveolar?.labialized,
    labializedPostalveolar?.voice,
  ],
  [0, true, true]
);
equal(
  "a labialized labiodental affricate derives its release place",
  [resolver.bundleFor("p͡fʷ")?.place, resolver.bundleFor("p͡fʷ")?.labialized],
  ["labiodental", true]
);
equal(
  "a labialized velar affricate keeps its modifier",
  resolver.bundleFor("k͡xʷ")?.labialized,
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

const htmlNoteProject = {
  ...noteProject,
  languages: [
    {
      ...noteProject.languages[0],
      notes: '<img src=x onerror="alert(1)">',
    },
  ],
};
const htmlNoteMarkdown = buildMarkdown(htmlNoteProject);
truthy(
  "markdown notes escape raw HTML tags",
  htmlNoteMarkdown.includes('> \\<img src=x onerror="alert(1)"\\>')
);

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

stressProject.languages[0].vocabulary.push({ id: "w1", gloss: "hand", form: "kasa", note: "" });
const stressMarkdown = buildMarkdown(stressProject);
truthy(
  "report records the stress system",
  stressMarkdown.includes("Stress") && stressMarkdown.includes("Initial")
);
truthy("report surface forms include stress and syllable dots", stressMarkdown.includes("ˈka.sa"));

const overrideMarkdown = buildMarkdown(featureProject);truthy(
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
const exoticChart = makeChart(
  ["Plosive", "Click"],
  ["Bilabial", "Alveolar"],
  [
    ["Plosive", "Bilabial", ["p", "b", "ɓ"]],
    ["Plosive", "Alveolar", ["t", "d"]],
    ["Click", "Bilabial", ["ʘ"]],
  ]
);
const exoticLanguage = {
  ...analyticsLanguage,
  id: "exotic",
  name: "Exotic",
  inventory: { consonants: exoticChart, vowels },
  vocabulary: [],
};
const exoticAnalysis = analyzeLexicon(
  { title: "Exotic", languages: [exoticLanguage] },
  exoticLanguage
);
equal(
  "implosives and clicks do not pool with pulmonic stops as voicing gaps",
  [exoticAnalysis.voicedWithoutVoiceless, exoticAnalysis.voicelessWithoutVoiced],
  [[], []]
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

/* ---- bulk import duplicate handling -------------------------------------- */

const duplicateLanguage = {
  vocabulary: [
    { id: "dup1", gloss: "house", form: "kasa", note: "" },
    { id: "dup2", gloss: " House ", form: "toma", note: "" },
  ],
};
const duplicateRow = { gloss: "house", form: "pere", note: "" };
equal(
  "update mode previews a duplicate gloss as an update",
  rowStatus(duplicateRow, duplicateLanguage, "update").status,
  "update"
);
const duplicateSummary = applyWordList(duplicateLanguage, [duplicateRow], "update");
equal(
  "update mode overwrites the same last duplicate the preview targets",
  [duplicateSummary.updated, duplicateLanguage.vocabulary.map((word) => word.form)],
  [1, ["kasa", "pere"]]
);

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

/* ---- correspondence tables ---------------------------------------------- */

equal(
  "alignment keeps a deleted source segment as ∅",
  alignCognate(["p", "a", "t", "a"], ["f", "a", "s"]).positions.map((position) => position.reflex),
  ["f", "a", "s", "∅"]
);
equal(
  "alignment marks a deleted source position",
  alignCognate(["p", "a", "t", "a"], ["f", "a", "s"]).positions[3].deleted,
  true
);
equal(
  "inserted segments are separated from source positions",
  alignCognate(["a", "p", "a"], ["a", "ʔ", "p", "a"]).insertions,
  [{ boundary: 1, after: "a", before: "p", reflex: "ʔ" }]
);

const corrConsonants = makeChart(
  ["Plosive", "Fricative", "Nasal"],
  ["Bilabial", "Alveolar", "Velar"],
  [
    ["Plosive", "Bilabial", ["p", "b"]],
    ["Plosive", "Alveolar", ["t", "d"]],
    ["Plosive", "Velar", ["k"]],
    ["Fricative", "Bilabial", ["f", "v"]],
    ["Fricative", "Alveolar", ["s"]],
    ["Nasal", "Bilabial", ["m"]],
    ["Nasal", "Alveolar", ["n"]],
  ]
);
const corrVowels = makeChart(["Open"], ["Front"], [["Open", "Front", ["a"]]]);
const corrBase = {
  inventory: { consonants: corrConsonants, vowels: corrVowels },
  phonotactics: { template: "(C)V(C)", onsets: "", codas: "", forbidden: "", notes: "", classes: [] },
  allophony: [],
  featureOverrides: {},
};
const correspondenceProject = {
  title: "Correspondence fixture",
  languages: [
    {
      id: "corr_root",
      name: "Proto",
      parentId: null,
      ...corrBase,
      soundChanges: [],
      vocabulary: [
        { id: "cw1", gloss: "two", form: "pata", note: "" },
        { id: "cw2", gloss: "father", form: "papa", note: "" },
        { id: "cw3", gloss: "five", form: "paka", note: "" },
        { id: "cw4", gloss: "four", form: "pasa", note: "" },
        { id: "cw5", gloss: "night", form: "sata", note: "" },
      ],
    },
    {
      id: "corr_a",
      name: "Daughter A",
      parentId: "corr_root",
      ...corrBase,
      soundChanges: [
        { id: "ca1", notation: "p > f", note: "", enabled: true },
        { id: "ca2", notation: "t > s", note: "", enabled: true },
        { id: "ca3", notation: "V > ∅ / _ #", note: "", enabled: true },
      ],
      vocabulary: [
        { id: "caw1", gloss: "two", form: "fas", note: "" },
        { id: "caw2", gloss: "father", form: "faf", note: "" },
        { id: "caw3", gloss: "five", form: "fak", note: "" },
        { id: "caw4", gloss: "four", form: "vas", note: "" },
        { id: "caw5", gloss: "night", form: "sas", note: "" },
      ],
    },
    {
      id: "corr_b",
      name: "Daughter B",
      parentId: "corr_root",
      ...corrBase,
      soundChanges: [
        { id: "cb1", notation: "p > b", note: "", enabled: true },
        { id: "cb2", notation: "t > d", note: "", enabled: true },
      ],
      vocabulary: [
        { id: "cbw1", gloss: "two", form: "bada", note: "" },
        { id: "cbw2", gloss: "father", form: "baba", note: "" },
        { id: "cbw3", gloss: "five", form: "baka", note: "" },
        { id: "cbw5", gloss: "night", form: "sada", note: "" },
      ],
    },
    {
      id: "corr_out",
      name: "Outsider",
      parentId: null,
      ...corrBase,
      soundChanges: [],
      vocabulary: [{ id: "cow1", gloss: "two", form: "pata", note: "" }],
    },
  ],
};

const recordedTable = buildCorrespondences(correspondenceProject, "corr_root");
equal(
  "only descendants of the chosen source enter the table",
  recordedTable.languages.map((language) => language.name),
  ["Daughter A", "Daughter B"]
);
equal(
  "correspondence rows group initial before medial before final",
  recordedTable.rows.map((row) => `${row.segment}/${row.position}`),
  [
    "p/initial",
    "s/initial",
    "a/medial",
    "t/medial",
    "p/medial",
    "k/medial",
    "s/medial",
    "a/final",
  ]
);

const nestedCorrespondenceProject = {
  title: "Nested correspondence order",
  languages: [
    { id: "nr_root", name: "Root", parentId: null, ...corrBase, soundChanges: [], vocabulary: [] },
    { id: "nr_a", name: "A", parentId: "nr_root", ...corrBase, soundChanges: [], vocabulary: [] },
    { id: "nr_b", name: "B", parentId: "nr_root", ...corrBase, soundChanges: [], vocabulary: [] },
    { id: "nr_a1", name: "A1", parentId: "nr_a", ...corrBase, soundChanges: [], vocabulary: [] },
    { id: "nr_b1", name: "B1", parentId: "nr_b", ...corrBase, soundChanges: [], vocabulary: [] },
  ],
};
equal(
  "correspondence columns follow the family tree, not depth",
  buildCorrespondences(nestedCorrespondenceProject, "nr_root").languages.map((language) => language.name),
  ["A", "A1", "B", "B1"]
);

const pInitial = recordedTable.rows.find((row) => row.segment === "p" && row.position === "initial");
const pInitialA = pInitial.cells.find((cell) => cell.languageId === "corr_a");
const pInitialB = pInitial.cells.find((cell) => cell.languageId === "corr_b");
equal("a source position counts each occurrence once", pInitial.occurrences, 4);
equal(
  "the dominant reflex carries its count",
  [pInitialA.dominant.reflex, pInitialA.dominant.count],
  ["f", 3]
);
equal(
  "a singleton reflex is marked as irregular",
  pInitialA.irregular.map((item) => [item.reflex, item.expected, item.glosses]),
  [["v", "f", ["four"]]]
);
equal("missing recorded forms leave a coverage gap", [pInitialB.total, pInitialB.missing], [3, 1]);
equal(
  "coverage is reported per descendant",
  recordedTable.coverage.languages.map((language) => [language.name, language.glosses]),
  [
    ["Daughter A", 5],
    ["Daughter B", 4],
  ]
);
equal(
  "irregular correspondences name the source segment and exceptional gloss",
  recordedTable.irregularities.map((item) => [
    item.segment,
    item.position,
    item.languageName,
    item.reflex,
    item.expected,
    item.glosses[0],
  ]),
  [["p", "initial", "Daughter A", "v", "f", "four"]]
);

const finalA = recordedTable.rows.find((row) => row.segment === "a" && row.position === "final");
equal(
  "a deleted final vowel is a regular ∅ reflex",
  [finalA.cells[0].dominant.reflex, finalA.cells[0].dominant.count],
  ["∅", 5]
);
equal(
  "the other daughter retains the final vowel",
  [finalA.cells[1].dominant.reflex, finalA.cells[1].dominant.count],
  ["a", 4]
);

const derivedTable = buildCorrespondences(correspondenceProject, "corr_root", { mode: "derived" });
const derivedPInitial = derivedTable.rows.find((row) => row.segment === "p" && row.position === "initial");
equal(
  "derived mode replays each descendant's rule chain",
  derivedPInitial.cells.find((cell) => cell.languageId === "corr_a").counts.map((item) => [item.reflex, item.count]),
  [["f", 4]]
);
equal(
  "derived mode fills glosses that were never recorded",
  [
    derivedPInitial.cells.find((cell) => cell.languageId === "corr_b").total,
    derivedPInitial.cells.find((cell) => cell.languageId === "corr_b").missing,
  ],
  [4, 0]
);
equal("derived correspondence tables have no recorded singletons", derivedTable.irregularities, []);
equal(
  "derived mode reports no rule errors for a clean fixture",
  derivedTable.coverage.languages.flatMap((language) => language.errors),
  []
);

const corrInsertionProject = {
  title: "Insertion fixture",
  languages: [
    {
      id: "ins_root",
      name: "Root",
      parentId: null,
      ...corrBase,
      soundChanges: [],
      vocabulary: [{ id: "iw1", gloss: "road", form: "paa", note: "" }],
    },
    {
      id: "ins_child",
      name: "Child",
      parentId: "ins_root",
      ...corrBase,
      soundChanges: [{ id: "ir1", notation: "∅ > ʔ / V _ V", note: "", enabled: true }],
      vocabulary: [{ id: "iw2", gloss: "road", form: "paʔa", note: "" }],
    },
  ],
};
const insertionTable = buildCorrespondences(corrInsertionProject, "ins_root");
equal(
  "inserted segments are listed with their boundary",
  insertionTable.insertions.map((item) => [item.languageName, item.reflex, item.after, item.before, item.gloss]),
  [["Child", "ʔ", "a", "a", "road"]]
);

const missingSource = buildCorrespondences(correspondenceProject, "no_such_language");
equal("an unknown source returns an empty table", [missingSource.source, missingSource.rows.length], [null, 0]);

/* ---- optional sound changes and allophony ------------------------------- */

const optionalDefaults = ensureProject({
  title: "Optional defaults",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      soundChanges: [{ id: "r1", notation: "p > f", note: "", enabled: true }],
      allophony: [{ id: "a1", notation: "/p/ > [f]", note: "", enabled: true }],
      vocabulary: [],
    },
  ],
});
equal(
  "rules without optional fields default to mandatory at the default rate",
  [
    optionalDefaults.languages[0].soundChanges[0].optional,
    optionalDefaults.languages[0].soundChanges[0].rate,
    optionalDefaults.languages[0].allophony[0].optional,
    optionalDefaults.languages[0].allophony[0].rate,
  ],
  [false, DEFAULT_RULE_RATE, false, DEFAULT_RULE_RATE]
);
equal(
  "optional rates are clamped to whole percentages",
  [normalizeRuleRate("150"), normalizeRuleRate(-4), normalizeRuleRate(37.6), normalizeRuleRate("nope")],
  [100, 0, 38, DEFAULT_RULE_RATE]
);
const normalizedOptional = ensureProject({
  title: "Optional normalization",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      soundChanges: [{ id: "r1", notation: "p > f", optional: "yes", rate: 12.4 }],
      allophony: [],
      vocabulary: [],
    },
  ],
});
equal(
  "stored optional flags are strict booleans and rates are normalized",
  [normalizedOptional.languages[0].soundChanges[0].optional, normalizedOptional.languages[0].soundChanges[0].rate],
  [false, 12]
);

const optionalProject = ensureProject({
  title: "Optional changes",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "o1", notation: "p > f", note: "", enabled: true, optional: true, rate: 40 },
        { id: "o2", notation: "t > s", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});
const optionalPrimary = deriveForm("pata", optionalProject, "child", { directOnly: true });
equal("the primary derivation skips optional sound changes", optionalPrimary.text, "pasa");
equal(
  "forcing an optional sound change derives a variant",
  deriveForm("pata", optionalProject, "child", { directOnly: true, optionalRuleIds: ["o1"] }).text,
  "fasa"
);
equal(
  "skipped optional sound changes are reported from the derivation steps",
  optionalSkippedRulesFromSteps(optionalPrimary.steps).map((rule) => [rule.id, rule.rate]),
  [["o1", 40]]
);

const optionalGroupProject = ensureProject({
  title: "Optional group",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "g1", notation: "p > f", note: "", enabled: true, optional: true, rate: 30 },
        { id: "g1a", notation: "a > e / f _", note: "", enabled: true, parentId: "g1" },
      ],
      vocabulary: [],
    },
  ],
});
equal(
  "skipping an optional top-level rule skips its sequential children",
  deriveForm("pata", optionalGroupProject, "child", { directOnly: true }).text,
  "pata"
);
equal(
  "forcing an optional top-level rule runs its sequential children",
  deriveForm("pata", optionalGroupProject, "child", { directOnly: true, optionalRuleIds: ["g1"] }).text,
  "feta"
);
equal(
  "forcing a child cannot override its skipped optional parent",
  deriveForm("pata", optionalGroupProject, "child", { directOnly: true, optionalRuleIds: ["g1a"] }).text,
  "pata"
);

const optionalChildProject = ensureProject({
  title: "Optional child",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "h1", notation: "p > f", note: "", enabled: true },
        { id: "h1a", notation: "a > e / f _", note: "", enabled: true, optional: true, rate: 60, parentId: "h1" },
      ],
      vocabulary: [],
    },
  ],
});
equal(
  "an optional child is skipped while its mandatory parent still runs",
  deriveForm("pata", optionalChildProject, "child", { directOnly: true }).text,
  "fata"
);
equal(
  "an optional child can be forced independently",
  deriveForm("pata", optionalChildProject, "child", { directOnly: true, optionalRuleIds: ["h1a"] }).text,
  "feta"
);

const groupStageContext = contextForLanguage(optionalGroupProject, "child");
const groupStages = [
  {
    language: optionalGroupProject.languages[1],
    groups: compileRuleStages(optionalGroupProject.languages[1].soundChanges, groupStageContext),
  },
];
equal(
  "optional stages list top-level optional groups",
  optionalRulesInStages(groupStages).map((rule) => [rule.id, rule.kind, rule.parentOptional]),
  [["g1", "top", false]]
);
const childStageContext = contextForLanguage(optionalChildProject, "child");
const childStages = [
  {
    language: optionalChildProject.languages[1],
    groups: compileRuleStages(optionalChildProject.languages[1].soundChanges, childStageContext),
  },
];
equal(
  "optional stages list optional children with their parent",
  optionalRulesInStages(childStages).map((rule) => [rule.id, rule.kind, rule.parentId]),
  [["h1a", "child", "h1"]]
);

const optionalAllophonyProject = ensureProject({
  title: "Optional allophony",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      allophony: [
        { id: "a1", notation: "/p/ > [f]", note: "", enabled: true, optional: true, rate: 25 },
        { id: "a2", notation: "/t/ > [s]", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});
equal(
  "the primary surface skips optional allophony",
  surfaceForForm("pata", optionalAllophonyProject, "only").text,
  "pasa"
);
equal(
  "forcing an optional allophony rule derives a variant",
  surfaceForForm("pata", optionalAllophonyProject, "only", { optionalRuleIds: ["a1"] }).text,
  "fasa"
);
equal(
  "the primary allophone table leaves optional rules out",
  allophoneTable(optionalAllophonyProject, "only").rows.map((row) => row.phoneme),
  ["t"]
);
equal(
  "the allophone table can include a forced optional rule",
  allophoneTable(optionalAllophonyProject, "only", { optionalRuleIds: ["a1"] }).rows.map((row) => row.phoneme),
  ["p", "t"]
);

const optionalReconstructionProject = ensureProject({
  title: "Optional reconstruction",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [{ id: "r1", notation: "p > f", note: "", enabled: true, optional: true, rate: 50 }],
      vocabulary: [],
    },
  ],
});
const optionalChanged = reconstructForm("f", optionalReconstructionProject, "child");
equal(
  "reconstruction keeps the changed and unchanged analyses of an optional rule",
  optionalChanged.candidates.map((candidate) => candidate.text),
  ["f", "p"]
);
equal("reconstruction reports the optional rule it considered", optionalChanged.optional, ["r1"]);
equal(
  "an unchanged form stays reconstructable when the optional change did not apply",
  reconstructForm("p", optionalReconstructionProject, "child").candidates.map((candidate) => candidate.text),
  ["p"]
);

const optionalChildReconstructionProject = ensureProject({
  title: "Optional child reconstruction",
  languages: [
    { id: "root", name: "Root", parentId: null, ...language, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...language,
      soundChanges: [
        { id: "k1", notation: "p > f", note: "", enabled: true },
        { id: "k1a", notation: "a > e / f _", note: "", enabled: true, optional: true, rate: 60, parentId: "k1" },
      ],
      vocabulary: [],
    },
  ],
});
equal(
  "reconstruction explores an optional child both skipped and applied",
  reconstructForm("fata", optionalChildReconstructionProject, "child").candidates.map((candidate) => candidate.text),
  ["fata", "pata"]
);
equal(
  "reconstruction inverts an applied optional child",
  reconstructForm("feta", optionalChildReconstructionProject, "child").candidates.some(
    (candidate) => candidate.text === "pata"
  ),
  true
);

/* ---- echo outputs: metathesis, exchange, and lengthening ----------------- */

// Echo outputs copy matched input segments into new positions: the k-th echo
// of a class, category, or chart class pairs with the k-th input atom of that
// kind. This gives multi-segment rewrites like metathesis (C V > V C), vowel
// exchange (a i > i a), and lengthening (V > Vː / _ #) without spelling every
// alternative out.
const echoProject = ensureProject({
  title: "Echo outputs",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      inventory,
      phonotactics: { classes: [{ name: "N", sounds: "m n" }] },
      soundChanges: [],
      allophony: [],
      vocabulary: [],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      inventory,
      phonotactics: { classes: [{ name: "N", sounds: "m n" }] },
      soundChanges: [
        { id: "s1", notation: "C V > V C", note: "", enabled: true },
        { id: "s2", notation: "V > Vː / _ #", note: "", enabled: true, parentId: "s1" },
      ],
      allophony: [
        { id: "a1", notation: "p V > V p", note: "", enabled: true },
        { id: "a2", notation: "V > Vː / _ #", note: "", enabled: true },
      ],
      vocabulary: [],
    },
  ],
});
const echoCtx = contextForLanguage(echoProject, "child");
const echoApply = (notation, form) => {
  const compiled = compileRule(notation, echoCtx);
  if (!compiled.ok) return { error: compiled.error };
  const result = applyRule(echoCtx.tokenize(form), compiled.rule, echoCtx);
  return { out: result.tokens.join(""), changed: result.changed };
};

equal("a literal exchange swaps the matched segments", apply("a i > i a", "tai"), { out: "tia" });
equal("class metathesis echoes a vowel-consonant pair in reverse", apply("V C > C V", "aki"), {
  out: "kai",
});
equal(
  "metathesis runs in one left-to-right pass instead of rescanning its output",
  apply("V C > C V", "akta"),
  { out: "kata" }
);
equal("an echo with a shorter output deletes the unmatched segment", apply("C V > C / _ #", "ta"), {
  out: "t",
});
equal("a chart-class name is a valid echo on both sides", apply("plosive.velar V > V plosive.velar", "ka"), {
  out: "ak",
});
equal("a glide tail glues onto the echoed vowel", apply("V > Vʷ / _ u", "katau"), {
  out: "kataʷu",
});

equal("echoing a class more often than it matches is rejected", !compileRule("C > C C", ctx).ok, true);
truthy(
  "the over-count error explains the pairing rule",
  /more often than the input matches it/u.test(compileRule("C > C C", ctx).error)
);
truthy(
  "an echo in an insertion is rejected",
  /cannot echo/u.test(compileRule("∅ > V / # _", ctx).error)
);
equal("an every-place echo rule is rejected as a no-op", !compileRule("C V > C V", ctx).ok, true);
truthy(
  "the identity-echo error points at writing the rule out",
  /in its own place/u.test(compileRule("C V > C V", ctx).error)
);
truthy(
  "letters glued to an echo are rejected as confusion",
  /diacritics/u.test(compileRule("V > Vd", ctx).error)
);
truthy(
  "echoing a chart class the input never matches is rejected",
  /the input never matches one/u.test(compileRule("a > fricative", ctx).error)
);

equal("lengthening echoes the matched vowel", echoApply("V > Vː / _ #", "kasa"), {
  out: "kasaː",
  changed: true,
});
const lengthenedRule = compileRule("V > Vː / _ #", echoCtx);
const lengthened = lengthenedRule.ok
  ? applyRule(echoCtx.tokenize("kasa"), lengthenedRule.rule, echoCtx)
  : null;
equal("a glued diacritic stays part of one token", lengthened && lengthened.tokens, [
  "k",
  "a",
  "s",
  "aː",
]);
equal("echo deletion reports a change", echoApply("C V > C / _ #", "ta"), {
  out: "t",
  changed: true,
});
equal("a category name is a valid echo on both sides", echoApply("N V > V N", "ma"), {
  out: "am",
  changed: true,
});

equal("sound-change metathesis derives swapped pairs", deriveForm("pata", echoProject, "child").text, "apat");

const echoMetathesis = stagedProject([
  { id: "s1", notation: "C V > V C", note: "", enabled: true, parentId: null },
]);
equal("top-level metathesis derives every pair", deriveForm("pata", echoMetathesis, "child").text, "apat");
equal("a juncture rides along inside the echoed pair", deriveForm("k+ata", echoMetathesis, "child").text, "akat");

const echoSequential = stagedProject([
  { id: "s1", notation: "C V > V C", note: "", enabled: true, parentId: null },
  { id: "s2", notation: "a > ɑ / p _", note: "", enabled: true, parentId: "s1" },
]);
equal("a child rule rewrites the metathesized form", deriveForm("pata", echoSequential, "child").text, "apɑt");

equal("allophony metathesis and lengthening derive the surface", surfaceForForm("pata", echoProject, "child").text, "aptaː");
equal("allophony lengthening is visible on the surface", surfaceForForm("taka", echoProject, "child").text, "takaː");
equal(
  "the allophone table previews lengthening echoes",
  allophoneTable(echoProject, "child").rows.map((row) => [row.phoneme, row.allophone]),
  [
    ["i", "iː"],
    ["u", "uː"],
    ["a", "aː"],
    ["ɑ", "ɑː"],
  ]
);

const echoMetathesisAllophony = ensureProject({
  title: "Metathesis allophony",
  languages: [
    {
      id: "only",
      name: "Only",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [{ id: "m1", notation: "p V > V p", note: "", enabled: true }],
      vocabulary: [],
    },
  ],
});
equal("a two-segment echo is left out of the phoneme table", allophoneTable(echoMetathesisAllophony, "only").rows, []);

const echoReconstruction = stagedProject([
  { id: "s1", notation: "p V > V p", note: "", enabled: true, parentId: null },
]);
equal(
  "reconstruction inverts a metathesis echo into both source orders",
  reconstructForm("ap", echoReconstruction, "child").candidates.map((candidate) => candidate.text),
  ["ap", "pa"]
);
equal(
  "reconstruction inverts a literal exchange",
  reconstructForm(
    "tia",
    stagedProject([{ id: "s1", notation: "a i > i a", note: "", enabled: true, parentId: null }]),
    "child"
  ).candidates.map((candidate) => candidate.text),
  ["tia", "tai"]
);
const echoLexiconProject = ensureProject({
  title: "Echo lexicon",
  languages: [
    {
      id: "root",
      name: "Root",
      parentId: null,
      inventory,
      soundChanges: [],
      allophony: [],
      vocabulary: [{ id: "w1", gloss: "man", form: "pa" }],
    },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      inventory,
      soundChanges: [{ id: "s1", notation: "p V > V p", note: "", enabled: true, parentId: null }],
      allophony: [],
      vocabulary: [{ id: "w1", gloss: "man", form: "ap" }],
    },
  ],
});
const echoEvidence = reconstructForm("ap", echoLexiconProject, "child");
equal("parent-lexicon evidence ranks the metathesis source first", echoEvidence.candidates[0].text, "pa");
equal("the ranked echo candidate cites its evidence", echoEvidence.candidates[0].parentMatch, "gloss");

// The long vowel must be charted ahead of its base for the surface form to
// re-tokenize as one segment, mirroring literal outputs of uncharted lengths.
const longVowels = {
  inventory: {
    consonants: makeChart(
      ["Plosive"],
      ["Bilabial", "Alveolar"],
      [
        ["Plosive", "Bilabial", ["p"]],
        ["Plosive", "Alveolar", ["t"]],
      ]
    ),
    vowels: makeChart(["Open"], ["Front"], [["Open", "Front", ["aː", "a"]]]),
  },
  phonotactics: { template: "(C)V(C)", onsets: "", codas: "", forbidden: "", notes: "", classes: [] },
};
const lengtheningReconstructionProject = {
  title: "Lengthening reconstruction",
  languages: [
    { id: "root", name: "Root", parentId: null, ...longVowels, soundChanges: [], vocabulary: [] },
    {
      id: "child",
      name: "Child",
      parentId: "root",
      ...longVowels,
      soundChanges: [{ id: "s1", notation: "V > Vː / _ #", note: "", enabled: true, parentId: null }],
      vocabulary: [],
    },
  ],
};
equal(
  "reconstruction inverts final lengthening to the short vowel",
  reconstructForm("takaː", lengtheningReconstructionProject, "child").candidates.map((candidate) => candidate.text),
  ["taka"]
);
equal(
  "lengthening only inverts where the original was already long",
  reconstructForm("taka", lengtheningReconstructionProject, "child").candidates.map((candidate) => candidate.text),
  []
);


/* ---- attested sound-change library -------------------------------------- */

// One flat chart holds every sound curated into the library so each rule
// compiles without uncharted-character warnings: anything missing from the
// chart would make a shipped rule look broken in the editor instead of
// staying merely illustrative.
const libraryInventory = {
  consonants: makeChart(
    ["Any"],
    ["Any"],
    [
      [
        "Any",
        "Any",
        ["p", "t", "k", "b", "d", "g", "bʰ", "dʰ", "gʰ", "p͡f", "t͡s", "k͡x", "t͡ʃ", "f", "v", "θ", "ð", "x", "ɣ", "s", "z", "ʃ", "ʒ", "r"],
      ],
    ]
  ),
  vowels: makeChart(["Any"], ["Any"], [["Any", "Any", ["a", "e", "i", "o", "u"]]]),
};
const libraryCtx = contextForInventory(libraryInventory);

const libraryErrors = [];
for (const group of soundChangeLibrary) {
  for (const item of group.rules) {
    const compiled = compileRule(item.notation, libraryCtx);
    equal(`library rule ${item.notation} compiles cleanly`, [compiled.ok, compiled.warnings?.length ?? 0], [true, 0]);
    if (!compiled.ok) libraryErrors.push(`${group.name} ${item.notation}: ${compiled.error}`);
  }
}
equal("the library raises no compile errors", libraryErrors, []);

const libraryIds = soundChangeLibrary.map((group) => group.id);
equal("library group ids are unique", libraryIds.length, new Set(libraryIds).size);
for (const group of soundChangeLibrary) {
  truthy(
    `${group.name} ships with a description and complete rules`,
    typeof group.description === "string" &&
      group.description.length > 0 &&
      group.rules.every((rule) => rule.notation && rule.note)
  );
  const drafts = newLibraryRules(group);
  equal(`${group.name} inserts one draft per rule`, drafts.length, group.rules.length);
  const draftIds = drafts.map((draft) => draft.id);
  truthy(`${group.name} draft ids are unique`, new Set(draftIds).size === draftIds.length);
  // Imported groups must behave like anything the tab assembles by hand but
  // stay inert: disabled drafts that never apply before they are reviewed.
  truthy(
    `${group.name} drafts import disabled with illustrative notes`,
    drafts.every(
      (draft, i) =>
        draft.enabled === false &&
        draft.optional === false &&
        draft.rate === DEFAULT_RULE_RATE &&
        draft.parentId === null &&
        draft.notation === group.rules[i].notation &&
        draft.note.includes(group.name) &&
        draft.note.includes("(illustrative)")
    )
  );
}

// A partially inserted group must offer only the rules that are not present
// yet; the panel's tooltip already promises that behavior.
const grimm = soundChangeLibrary.find((group) => group.id === "grimms-law");
const grimmDrafts = newLibraryRules(grimm);
const partlyPresent = new Set(grimmDrafts.slice(0, -1).map((draft) => draft.notation));
const missingDrafts = newLibraryRules(grimm, partlyPresent);
equal(
  "a partially present library group inserts only the missing rules",
  missingDrafts.map((draft) => draft.notation),
  [grimm.rules[grimm.rules.length - 1].notation]
);
equal("a partially present library group reports the missing count", missingDrafts.length, 1);
const fullyPresent = new Set(grimmDrafts.map((draft) => draft.notation));
equal("a fully present library group inserts nothing", newLibraryRules(grimm, fullyPresent), []);
equal("library presence ignores notation whitespace", normalizeLibraryNotation("  p   >  f "), "p > f");
equal(
  "a whitespace variant still counts as present",
  newLibraryRules(grimm, new Set([" p  >  f "])).map((draft) => draft.notation).includes("p > f"),
  false
);

// Spot checks use the curated notations exactly as shipped. A left-hand V
// demands a preceding vowel, so word-initial stops stay put; the rhotacism
// rule is intervocalic, so a word-final s also stays.
const kLenition = compileRule("k > x / V _", libraryCtx).rule;
const tLenition = compileRule("t > θ / V _", libraryCtx).rule;
const palatalization = compileRule("k > t͡ʃ / _ [i e]", libraryCtx).rule;
const affrication = compileRule("p > p͡f / # _", libraryCtx).rule;
const latinRhotacism = soundChangeLibrary.find((group) => group.id === "latin-rhotacism");
const rhotacism = compileRule(latinRhotacism.rules[0].notation, libraryCtx).rule;
const applyLibrary = (rule, form) => applyRule(libraryCtx.tokenize(form), rule, libraryCtx).tokens.join("");

equal("insular celtic lenition leaves a word-initial stop alone", applyLibrary(kLenition, "kata"), "kata");
equal(
  "insular celtic lenition moves each stop a vowel precedes",
  applyLibrary(tLenition, applyLibrary(kLenition, "akata")),
  "axaθa"
);
equal("slavic palatalization fronts before a front vowel", applyLibrary(palatalization, "kine"), "t͡ʃine");
equal("slavic palatalization ignores a back vowel", applyLibrary(palatalization, "kane"), "kane");
equal("high german shift affricates a word-initial voiceless stop", applyLibrary(affrication, "pak"), "p͡fak");
equal("high german shift leaves a medial stop unaffricated", applyLibrary(affrication, "apa"), "apa");
equal("latin rhotacism turns an intervocalic s into r", applyLibrary(rhotacism, "rosa"), "rora");
equal("latin rhotacism leaves a word-final s alone", applyLibrary(rhotacism, "kas"), "kas");

/* ---- x-sampa conversion ---------------------------------------------------- */

// The curated IPA table is the completeness gate: every symbol the project
// knows must survive the ASCII detour. Documented foldings (script-g joins
// plain g; deprecated glyph variants end on their modern spelling; the four
// sinological segments have no documented X-SAMPA and pass through) follow
// the module header in web/js/xsampa.js.
const xsampaCanonical = (symbol) =>
  symbol
    .replace(/\u0261/g, "g")
    .replace(/\u0269/g, "\u026A")
    .replace(/\u0277/g, "\u028A")
    .replace(/\u1D00/g, "\u0251")
    .replace(/\u1D07/g, "\u025B");
const xsampaPassthrough = new Set(["\u027F", "\u0285", "\u02AE", "\u02AF"]);

let xsampaStrict = 0;
let xsampaFolded = 0;
const xsampaBroken = [];
const xsampaWide = [];
for (const symbol of Object.keys(IPA_FEATURES)) {
  const ascii = ipaToXSampa(symbol);
  if (xSampaToIPA(ascii) === symbol) {
    xsampaStrict += 1;
  } else if (xSampaToIPA(ascii) === xsampaCanonical(symbol)) {
    xsampaFolded += 1;
  } else {
    xsampaBroken.push(`${symbol} -> ${JSON.stringify(ascii)} -> ${JSON.stringify(xSampaToIPA(ascii))}`);
  }
  if ([...ascii].some((character) => character.codePointAt(0) > 0x7e)) {
    // Only the four sinological segments may leave the ASCII range.
    if (!xsampaPassthrough.has(symbol)) xsampaWide.push(symbol);
  }
}
equal("every curated IPA symbol reads back from its X-SAMPA form", [xsampaBroken.length, xsampaWide.length], [0, 0]);
if (xsampaBroken.length) console.log(xsampaBroken.join("\n"));
truthy(
  "the curated table survives the detour strictly or via the documented foldings",
  xsampaStrict + xsampaFolded === Object.keys(IPA_FEATURES).length
);
equal("script-g canonicalizes to the plain velar stop", [xSampaToIPA("g"), ipaToXSampa("\u0261"), xSampaToIPA(ipaToXSampa("g"))], ["g", "g", "g"]);
equal("a stray trailing underscore stays literal instead of looping", xSampaToIPA("a_"), "a_");
equal("deprecated glyph variants fold onto their modern symbols", [xSampaToIPA(ipaToXSampa("\u0269")), xSampaToIPA(ipaToXSampa("\u1D00"))], ["\u026A", "\u0251"]);
truthy("segments with no documented X-SAMPA pass through non-ASCII", [...ipaToXSampa("\u027F")].every((character) => character.codePointAt(0) > 0x7e));

// The standard affricate digraphs decode as tie-barred clusters, matching the
// convention external tools write; this project's own encodings prefer the
// explicit underscore tie whenever no digraph is documented.
equal(
  "standard affricate digraphs decode as tie-barred clusters",
  [xSampaToIPA("tS"), xSampaToIPA("ts"), xSampaToIPA("dZ"), xSampaToIPA("tK"), xSampaToIPA("kp"), xSampaToIPA("gb"), xSampaToIPA("Nm")],
  ["t\u0361\u0283", "t\u0361s", "d\u0361\u0292", "t\u0361\u026C", "k\u0361p", "\u0261\u0361b", "\u014B\u0361m"]
);
equal(
  "the underscore prefers a documented tie pair over the same letter's diacritic",
  [xSampaToIPA("n_d"), xSampaToIPA("p_f"), xSampaToIPA("t_T"), xSampaToIPA("g_G"), xSampaToIPA("N_m")],
  // The tie reconstruction uses the cluster table's canonical spellings, so
  // the velar-affricate tie comes back with script-g like its stored form.
  ["n\u0361d", "p\u0361f", "t\u0361\u03B8", "\u0261\u0361\u0263", "\u014B\u0361m"]
);
equal(
  "the underscore attaches diacritics when no tie pair applies",
  [xSampaToIPA("t_h"), xSampaToIPA("p_>"), xSampaToIPA("k_w"), xSampaToIPA("a_0"), xSampaToIPA("bO~"), xSampaToIPA("tS_h")],
  ["t\u02B0", "p\u02BC", "k\u02B7", "a\u0325", "b\u0254\u0303", "t\u0361\u0283\u02B0"]
);
equal("retroflex affricates tie through the backslash-free join", xSampaToIPA("t`_s`"), "\u0288\u0361\u0282");

// Whole-form checks mirror what a saved lexicon entry meets: glued
// prenasalized/ejective affricates, length, and stress all stay ASCII and
// round-trip exactly.
equal("word forms survive the ASCII detour", [ipaToXSampa("akata"), xSampaToIPA(ipaToXSampa("akata"))], ["akata", "akata"]);
equal("untied sequences use the digraph spelling", ipaToXSampa("t\u0283"), "tS");
const gluedEjective = "k\u0361x\u02BC\u02D0";
equal("glued ejective affricates keep tie, release, and length", ipaToXSampa(gluedEjective), "k_x_>:");
equal("the glued ejective affricate round-trips", xSampaToIPA(ipaToXSampa(gluedEjective)), gluedEjective);
equal("unknown characters pass through unchanged", [ipaToXSampa("a;b"), xSampaToIPA("$")], ["a;b", "$"]);
equal("empty and null input stay empty", [ipaToXSampa(""), xSampaToIPA(""), ipaToXSampa(null), xSampaToIPA(null)], ["", "", "", ""]);
equal(
  "NFC accented letters encode through their combining mark",
  [ipaToXSampa("\u00E3"), [...ipaToXSampa("\u00E3")].every((character) => character.codePointAt(0) <= 0x7e)],
  ["a~", true],
);
equal(
  "NFC and NFD accented input share one X-SAMPA encoding",
  [ipaToXSampa("\u00E3"), ipaToXSampa("a\u0303")],
  ["a~", "a~"],
);
equal("precomposed cedilla still uses its documented letter", ipaToXSampa("\u00E7"), "C");

// X-SAMPA reuses underscore and backtick spellings for tie pairs and retroflex
// letters. When a modifier would produce one of those ambiguous spellings, the
// encoder must keep the IPA chunk rather than emit ASCII that decodes to a
// different phoneme.
for (const sound of ["n\u032A", "\u014B\u0330", "g\u02E0", "t\u02DE", "s\u02DE"]) {
  const encoded = ipaToXSampa(sound);
  equal(
    `ambiguous modifier spelling for ${sound} keeps its phoneme`,
    xSampaToIPA(encoded),
    sound.normalize("NFD")
  );
}
equal("documented encode aliases still fold under modifiers", ipaToXSampa("\u0261\u02B7"), "g_w");

/* ---- dated sound-change stages ---------------------------------------------- */

// Stage numbers are documentation: the normalizer keeps exact integers (zero
// and negatives included, since "stage 0" is a usable position) and quietly
// drops everything else into the undated bucket instead of failing a save.
equal(
  "stage normalization keeps exact integers and undates everything else",
  [
    normalizeRuleDate(3),
    normalizeRuleDate(-2),
    normalizeRuleDate(0),
    normalizeRuleDate("7"),
    normalizeRuleDate(2.5),
    normalizeRuleDate("nope"),
    normalizeRuleDate(null),
    normalizeRuleDate(undefined),
    normalizeRuleDate(""),
  ],
  [3, -2, 0, 7, null, null, null, null, null]
);

// Migration mirrors the rate field's treatment: every stored rule gains the
// field with a null default, saved integers survive, and sloppy values
// collapse to undated rather than breaking a load.
const stageProject = ensureProject({
  title: "Stages",
  languages: [
    {
      id: "old",
      name: "Old",
      parentId: null,
      soundChanges: [
        { id: "r1", notation: "p > f" },
        { id: "r2", notation: "t > θ", date: 4 },
        { id: "r3", notation: "k > x", date: "2" },
        { id: "r4", notation: "s > r", date: 1.5 },
      ],
      allophony: [],
      vocabulary: [],
    },
  ],
});
equal("stored rules gain a stage field on load", stageProject.languages[0].soundChanges.map((rule) => rule.date), [null, 4, 2, null]);

// Grouping is family-wide: stages ascend, rules inside a stage keep stored
// order, and the undated bucket takes both an absent field (library drafts
// carry no date field at all) and an explicit null.
const timelineFixture = {
  languages: [
    {
      id: "north",
      name: "North",
      soundChanges: [
        { id: "n1", notation: "p > f", date: 2, enabled: true },
        { id: "n2", notation: "t > θ", date: 1 },
        { id: "n3", notation: "k > x" },
      ],
    },
    {
      id: "south",
      name: "South",
      soundChanges: [
        { id: "s1", notation: "d > ð", date: null },
        { id: "s2", notation: "g > k", date: 1 },
        { id: "s3", notation: "b > v", date: 2 },
      ],
    },
  ],
};
const timelineReport = timelineStages(timelineFixture);
equal("family stages ascend", timelineReport.stages.map((stage) => stage.date), [1, 2]);
equal("stage one collects rules from every language in order", timelineReport.stages[0].rules.map((entry) => entry.rule.id), ["n2", "s2"]);
equal("stage two keeps stored order too", timelineReport.stages[1].rules.map((entry) => entry.rule.id), ["n1", "s3"]);
equal("undated rules keep stored order across languages", timelineReport.undated.map((entry) => entry.rule.id), ["n3", "s1"]);
truthy("timeline entries carry their language for linking", timelineReport.stages[0].rules.every((entry) => entry.language.name === "North" || entry.language.name === "South"));
equal(
  "a family with no rules reports no stages and no undated rules",
  [timelineStages({ languages: [] }).stages.length, timelineStages({ languages: [] }).undated.length, timelineStages({ languages: [{ id: "bare", name: "Bare" }, { id: "empty", name: "Empty", soundChanges: [] }] }).stages.length],
  [0, 0, 0]
);

/* ---- project store ------------------------------------------------------- */

// store.js is a UI module, but the switch guard is worth testing directly:
// stub the two globals it registers listeners on, then drive its API object.
globalThis.window = {
  location: { hash: "" },
  addEventListener() {},
  setTimeout() {
    return 0;
  },
  clearTimeout() {},
};
globalThis.document = {
  body: { classList: { contains: () => false } },
  addEventListener() {},
};
const { store } = await import("../web/js/store.js");
const { api } = await import("../web/js/api.js");
const storeProjectA = JSON.parse(
  JSON.stringify(ensureProject({ title: "Store A", languages: [] }))
);
const storeProjectB = JSON.parse(
  JSON.stringify(ensureProject({ title: "Store B", languages: [] }))
);
api.saveProject = async () => ({ savedAt: new Date().toISOString() });
api.listProjects = async () => ({
  active: "a.json",
  projects: [{ file: "a.json" }, { file: "b.json" }],
});
store.projectFile = "a.json";
await store.load(storeProjectA);
let selectionChanged = false;
api.selectProject = async () => {
  selectionChanged = true;
  return { ok: true };
};
api.loadProject = async () => {
  // An edit typed while the remote document is in flight.
  store.touch({ label: "Edit during switch" });
  return storeProjectB;
};
let switched = false;
try {
  switched = await store.switchProject("b.json");
} catch {
  // The switch is expected to abort and keep the edited project open.
}
equal(
  "a project switch aborts when an edit arrives while loading",
  [switched, store.project.title, store.projectFile, selectionChanged, store.dirty],
  [false, "Store A", "a.json", false, true]
);

/* ---- summary ------------------------------------------------------------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
