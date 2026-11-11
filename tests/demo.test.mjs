// Real-demo smoke test for Language Tree — plain Node, no framework and no DOM.
//
//   node tests/demo.test.mjs
//
// The engine suite uses small fixtures, so it cannot catch a regression that
// only shows up in the tracked 23-language demo: a migration that rewrites the
// document on load, a rule that stops compiling against a real inventory, a
// report that drops a language, or an analysis that fails on a real lexicon.
// This suite loads data/example_project.json exactly as the app does and runs
// every major engine path over it. Counts are pinned deliberately: updating the
// demo should update this file in the same change.
//
// Every assertion prints a line; the process exits non-zero on any failure.

import { readFileSync } from "node:fs";
import {
  ensureProject,
  languagesInTreeOrder,
  projectStats,
} from "../web/js/model.js";
import { compileChainFrom, deriveForm, surfaceForForm } from "../web/js/phonology.js";
import { reconstructForm } from "../web/js/reconstruction.js";
import { buildHtml, buildMarkdown } from "../web/js/report.js";
import { subgroupingEvidence } from "../web/js/subgrouping.js";
import { analyzeLexicon } from "../web/js/analytics.js";
import { timelineStages } from "../web/js/timeline.js";
import { buildCorrespondences } from "../web/js/correspondences.js";

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

/* ---- load and migrate --------------------------------------------------- */

const demoUrl = new URL("../data/example_project.json", import.meta.url);
const raw = JSON.parse(readFileSync(demoUrl, "utf8"));
const project = ensureProject(structuredClone(raw));
const root = project.languages.find((language) => !language.parentId);
const daughters = project.languages.filter((language) => language.parentId);
const rootWords = root.vocabulary.filter((word) => word.form.trim() && word.gloss.trim());
// Every twentieth headword spans the list without turning a smoke test into a
// second full engine run. The derived correspondence pass below still touches
// every root word.
const sample = rootWords.filter((_, index) => index % 20 === 0);

equal("the demo title is intact", project.title, "Classical Nahuatl — a demo language family");
equal("the demo document version is current", project.version, 1);
equal(
  "the demo totals are unchanged",
  projectStats(project),
  { languages: 23, consonants: 326, vowels: 178, changes: 81, allophony: 2, words: 5083 }
);
equal("the demo has one root", project.languages.filter((language) => !language.parentId).length, 1);
equal("the demo root is Classical Nahuatl", root.id, "lang_cn");
equal("the demo has 23 unique language ids", new Set(project.languages.map((language) => language.id)).size, 23);
truthy(
  "every demo language has the documented shape",
  project.languages.every(
    (language) =>
      typeof language.id === "string" &&
      typeof language.name === "string" &&
      language.inventory?.consonants &&
      language.inventory?.vowels &&
      language.phonotactics &&
      Array.isArray(language.soundChanges) &&
      Array.isArray(language.allophony) &&
      Array.isArray(language.vocabulary) &&
      language.featureOverrides &&
      typeof language.featureOverrides === "object"
  )
);
truthy(
  "every demo language has 221 fully recorded words",
  project.languages.every(
    (language) =>
      language.vocabulary.length === 221 &&
      language.vocabulary.every((word) => word.form.trim() && word.gloss.trim())
  )
);
truthy(
  "demo vocabulary ids and glosses are unique within each language",
  project.languages.every((language) => {
    const ids = new Set(language.vocabulary.map((word) => word.id));
    const glosses = new Set(language.vocabulary.map((word) => word.gloss));
    return ids.size === language.vocabulary.length && glosses.size === language.vocabulary.length;
  })
);
truthy(
  "demo sound-change ids are unique within each language",
  project.languages.every(
    (language) =>
      new Set(language.soundChanges.map((rule) => rule.id)).size === language.soundChanges.length
  )
);

// Opening a fresh clone must not rewrite the tracked file. If a new persisted
// field needs a default, update data/example_project.json in the same change.
equal("ensureProject leaves the tracked demo unchanged", project, raw);
const migratedAgain = structuredClone(project);
ensureProject(migratedAgain);
equal("ensureProject is idempotent on the demo", migratedAgain, project);

const languageIds = new Set(project.languages.map((language) => language.id));
truthy(
  "every demo parent link resolves",
  project.languages.every((language) => !language.parentId || languageIds.has(language.parentId))
);
const treeOrder = languagesInTreeOrder(project);
equal("tree order visits every demo language once", treeOrder.length, project.languages.length);
equal(
  "tree order visits every demo language once by id",
  new Set(treeOrder.map((language) => language.id)).size,
  project.languages.length
);
const treePositions = new Map(treeOrder.map((language, index) => [language.id, index]));
truthy(
  "every demo daughter follows its parent in tree order",
  treeOrder.every(
    (language) =>
      !language.parentId || treePositions.get(language.parentId) < treePositions.get(language.id)
  )
);

/* ---- derivation and surface --------------------------------------------- */

const derivationIssues = [];
const surfaceIssues = [];
let changedSampleForms = 0;

for (const language of project.languages) {
  const chain = compileChainFrom(project, root.id, language.id);
  truthy(`the chain compiles from the demo root to ${language.name}`, chain.ok);
  equal(
    `the chain has one stage per generation to ${language.name}`,
    chain.stages.length,
    chain.lineage.length - 1
  );

  for (const word of sample) {
    const derived = deriveForm(word.form, project, language.id, { gloss: word.gloss });
    if (word === sample[0]) {
      equal(
        `derivation includes the full lineage to ${language.name}`,
        derived.stages.length,
        chain.lineage.length
      );
    }
    if (derived.errors.length || derived.fatal || !derived.text) {
      if (derivationIssues.length < 5) {
        derivationIssues.push({
          language: language.id,
          gloss: word.gloss,
          form: word.form,
          errors: derived.errors,
          fatal: derived.fatal,
          text: derived.text,
        });
      }
    }
    if (derived.text !== word.form) changedSampleForms += 1;

    const surface = surfaceForForm(derived.text, project, language.id, { gloss: word.gloss });
    if (surface.errors.length || !surface.display) {
      if (surfaceIssues.length < 5) {
        surfaceIssues.push({
          language: language.id,
          gloss: word.gloss,
          form: derived.text,
          errors: surface.errors,
          display: surface.display,
        });
      }
    }
  }
}

equal("every sampled demo derivation compiles and applies", derivationIssues, []);
equal("every sampled demo surface applies with stress", surfaceIssues, []);
truthy("the demo sound changes alter sampled forms", changedSampleForms > 0);

/* ---- reconstruction ------------------------------------------------------ */

const reconstructionIssues = [];
for (const language of daughters) {
  const wordByGloss = new Map(language.vocabulary.map((word) => [word.gloss, word]));
  for (const word of sample) {
    const daughterWord = wordByGloss.get(word.gloss);
    if (!daughterWord) {
      if (reconstructionIssues.length < 5) {
        reconstructionIssues.push({ language: language.id, gloss: word.gloss, missing: true });
      }
      continue;
    }
    const result = reconstructForm(daughterWord.form, project, language.id, {
      gloss: daughterWord.gloss,
    });
    if (!result.ok || !result.candidates.length || result.warnings.length) {
      if (reconstructionIssues.length < 5) {
        reconstructionIssues.push({
          language: language.id,
          gloss: daughterWord.gloss,
          form: daughterWord.form,
          ok: result.ok,
          reason: result.reason,
          candidates: result.candidates.length,
          warnings: result.warnings,
        });
      }
    }
  }
}
equal("every sampled demo form reconstructs", reconstructionIssues, []);

const rootReconstruction = reconstructForm(rootWords[0].form, project, root.id, {
  gloss: rootWords[0].gloss,
});
equal("the demo root reports that it has no ancestor", rootReconstruction.reason, "root");

let roundTrip = null;
for (const word of rootWords) {
  const derived = deriveForm(word.form, project, "lang_pbs", { gloss: word.gloss });
  if (derived.errors.length || derived.text === word.form) continue;
  const result = reconstructForm(derived.text, project, "lang_pbs", { gloss: word.gloss });
  roundTrip = { word, derived, result };
  break;
}
truthy("a changed demo form exists for the reconstruction round trip", Boolean(roundTrip));
if (roundTrip) {
  truthy(
    "reconstructing a derived demo form offers its recorded parent form",
    roundTrip.result.ok &&
      roundTrip.result.candidates.some((candidate) => candidate.text === roundTrip.word.form)
  );
}

/* ---- reports ------------------------------------------------------------- */

const markdown = buildMarkdown(project);
const html = buildHtml(project);
const statsLine = "23 languages · 5083 words · 81 sound-change rules · 2 allophony rules";

truthy("the Markdown report starts with the demo title", markdown.startsWith(`# ${project.title}`));
truthy("the Markdown report carries the demo totals", markdown.includes(statsLine));
truthy("the HTML report carries the demo totals", html.includes(statsLine));
truthy(
  "the Markdown report names every demo language",
  project.languages.every((language) => markdown.includes(language.name))
);
truthy(
  "the HTML report names every demo language",
  project.languages.every((language) => html.includes(language.name))
);
truthy(
  "the HTML report is a complete document",
  html.startsWith("<!doctype html>") && html.trimEnd().endsWith("</html>")
);
truthy(
  "the reports contain no unresolved values",
  !markdown.includes("undefined") &&
    !html.includes("undefined") &&
    !markdown.includes("NaN") &&
    !html.includes("NaN")
);

/* ---- subgrouping, analytics, timeline ----------------------------------- */

const evidence = subgroupingEvidence(project);
equal("subgrouping tests every branching demo node", evidence.tested, 8);
equal(
  "subgrouping classifies the demo branches",
  [evidence.supported, evidence.weak, evidence.unsupported],
  [6, 2, 0]
);
truthy(
  "every subgrouping panel has at least two daughters",
  evidence.nodes.every((node) => node.children.length >= 2)
);

const analyticsIssues = [];
let rootAnalytics = null;
for (const language of project.languages) {
  const analytics = analyzeLexicon(project, language);
  if (language.id === root.id) rootAnalytics = analytics;
  if (
    analytics.words !== 221 ||
    analytics.recorded !== 221 ||
    analytics.drafts !== 0 ||
    analytics.parseableWords !== 221 ||
    analytics.uncharted.length ||
    analytics.leaks.length
  ) {
    analyticsIssues.push({
      language: language.id,
      words: analytics.words,
      recorded: analytics.recorded,
      parseable: analytics.parseableWords,
      uncharted: analytics.uncharted.length,
      leaks: analytics.leaks.length,
    });
  }
}
equal("analytics parses every recorded demo word in every language", analyticsIssues, []);
equal("the root lexicon has 1,230 tokens", rootAnalytics.tokenTotal, 1230);
truthy("the root lexicon has syllables", rootAnalytics.syllablesTotal > 0);

const timeline = timelineStages(project);
equal("the timeline groups the demo rules into 12 stages", timeline.stages.length, 12);
equal(
  "every demo sound change is dated",
  timeline.stages.reduce((total, stage) => total + stage.rules.length, 0),
  projectStats(project).changes
);
equal("the demo has no undated sound changes", timeline.undated.length, 0);
truthy(
  "timeline stages ascend",
  timeline.stages.every(
    (stage, index) => index === 0 || timeline.stages[index - 1].date < stage.date
  )
);

/* ---- correspondences ----------------------------------------------------- */

const recorded = buildCorrespondences(project, root.id);
const derived = buildCorrespondences(project, root.id, { mode: "derived" });

equal("correspondences cover every daughter of the demo root", recorded.languages.length, 22);
equal("correspondences cover every root gloss", recorded.glosses.length, 221);
equal(
  "recorded correspondence coverage has no errors",
  recorded.coverage.languages.filter((language) => language.errors.length).map((language) => language.id),
  []
);
equal(
  "derived correspondence coverage has no errors",
  derived.coverage.languages.filter((language) => language.errors.length).map((language) => language.id),
  []
);
equal("recorded and derived correspondences agree", derived.totals, recorded.totals);
equal(
  "correspondence occurrences match the root token count",
  recorded.totals.occurrences,
  rootAnalytics.tokenTotal
);
truthy(
  "correspondence rows are present",
  recorded.totals.rows > 0 && recorded.totals.occurrences > 0
);

/* ---- summary ------------------------------------------------------------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
