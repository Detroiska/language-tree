// Bulk word import/export tests for Language Tree — plain Node, no DOM.
//
//   node tests/bulk.test.mjs
//
// bulk.js was the one engine module with no test coverage; these tests pin
// the table-parsing contract the import preview is built on: RFC 4180
// quoting (including quoted line breaks), header detection in both column
// orders, the JSON fast path and its fallback, and the duplicate-handling
// modes. Every assertion prints a line; the process exits non-zero on any
// failure.

import { applyWordList, parseWordList, rowStatus, toJson, toTsv } from "../web/js/bulk.js";

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

const rowOf = (parsed, index = 0) => {
  const row = parsed.rows[index];
  return row ? { gloss: row.gloss, form: row.form, note: row.note, index: row.index } : null;
};

/* ---- quoted fields ------------------------------------------------------- */

equal(
  "a quoted field may contain the delimiter",
  rowOf(parseWordList('house,"big, wooden place",kasa')),
  { gloss: "house", form: "big, wooden place", note: "kasa", index: 1 }
);

// The original bug: lines were split before quote handling, so a quoted
// newline cut the field in half and imported the remainder as a new word.
equal(
  "a quoted field may contain a line break",
  rowOf(parseWordList('gloss,form,note\nhouse,kasa,"first line\nsecond line"')),
  { gloss: "house", form: "kasa", note: "first line\nsecond line", index: 2 }
);
equal(
  "a quoted line break does not create a phantom row",
  parseWordList('gloss,form,note\nhouse,kasa,"first line\nsecond line"').rows.length,
  1
);

equal(
  "doubled quotes escape a quote inside a field",
  rowOf(parseWordList('"say ""hi""",form')),
  { gloss: 'say "hi"', form: "form", note: "", index: 1 }
);

truthy(
  "an unterminated quote warns instead of failing silently",
  parseWordList('house,kasa,"never closed').warnings.some((warning) => /never closed/i.test(warning))
);
equal(
  "an unterminated quote still imports the row",
  rowOf(parseWordList('house,kasa,"never closed')),
  { gloss: "house", form: "kasa", note: "never closed", index: 1 }
);

equal(
  "CRLF input is normalized before parsing",
  rowOf(parseWordList("gloss,form\r\nhouse,kasa\r\n")),
  { gloss: "house", form: "kasa", note: "", index: 2 }
);
equal(
  "cells are trimmed like the old parser",
  rowOf(parseWordList(" house , kasa , a note ")),
  { gloss: "house", form: "kasa", note: "a note", index: 1 }
);
equal(
  "a quoted line break in the first field does not break delimiter detection",
  rowOf(parseWordList('"house\nwith newline",kasa')),
  { gloss: "house\nwith newline", form: "kasa", note: "", index: 1 }
);

/* ---- headers ------------------------------------------------------------- */

equal(
  "a gloss-first header row is skipped",
  parseWordList("gloss,form,note\nhouse,kasa,plain").headerSkipped,
  true
);
equal(
  "header synonyms are recognized",
  parseWordList("meaning,form\nhouse,kasa").headerSkipped,
  true
);
equal(
  "a form-first header row is skipped",
  parseWordList("form,gloss\nkasa,house").headerSkipped,
  true
);
// The original bug: the header became a data row and every real row's
// gloss/form were swapped.
equal(
  "a form-first header does not import itself as a word",
  rowOf(parseWordList("form,gloss\nkasa,house")),
  { gloss: "house", form: "kasa", note: "", index: 2 }
);
truthy(
  "a data row whose gloss is literally a header word is not eaten",
  !parseWordList("form,house\nkasa,water").headerSkipped
);
// A header need not name every column. Unnamed columns keep the old positional
// reading, so a bare "gloss" header cannot turn a form into a note.
equal(
  "a bare gloss header still reads the form positionally",
  rowOf(parseWordList("gloss\nhouse\tkasa\tdwelling")),
  { gloss: "house", form: "kasa", note: "dwelling", index: 2 }
);
equal(
  "a gloss header with a synonym but no form column keeps the form",
  rowOf(parseWordList("gloss\tmeaning\nhouse\tkasa")),
  { gloss: "house", form: "kasa", note: "", index: 2 }
);

/* ---- delimiters ---------------------------------------------------------- */

equal(
  "a quoted separator does not choose the table delimiter",
  [
    parseWordList('"hello; world",a house\nkasa,house2').delimiter,
    rowOf(parseWordList('"hello; world",a house\nkasa,house2'), 0),
    rowOf(parseWordList('"hello; world",a house\nkasa,house2'), 1),
  ],
  [
    ",",
    { gloss: "hello; world", form: "a house", note: "", index: 1 },
    { gloss: "kasa", form: "house2", note: "", index: 2 },
  ]
);

equal(
  "tab-delimited rows parse",
  rowOf(parseWordList("house\tkasa\tplain")),
  { gloss: "house", form: "kasa", note: "plain", index: 1 }
);
equal(
  "aligned whitespace stays a table layout",
  rowOf(parseWordList("big house   kasa")),
  { gloss: "big house", form: "kasa", note: "", index: 1 }
);
equal(
  "a gloss alone imports as a draft word",
  rowOf(parseWordList("house")),
  { gloss: "house", form: "", note: "", index: 1 }
);
equal(
  "stray separator-only rows are dropped",
  parseWordList("house,kasa\n,\n,,,").rows.length,
  1
);

/* ---- JSON ---------------------------------------------------------------- */

equal(
  "a JSON array imports as rows",
  parseWordList('[{"gloss":"house","form":"kasa"}]').rows.map((row) => [row.gloss, row.form]),
  [["house", "kasa"]]
);
equal(
  "a single JSON object imports as one row",
  parseWordList('{"gloss":"house","form":"kasa"}').rows.length,
  1
);
// The original bug: a paste starting with "[" that was not valid JSON was
// dropped entirely instead of falling back to table parsing.
truthy(
  "a bracketed non-JSON paste falls back to table parsing",
  parseWordList("[apa] father\n[kasa] house").rows.length === 2
);
equal(
  "a bracketed form-first paste keeps form and gloss in the right columns",
  rowOf(parseWordList("[apa] father")),
  { gloss: "father", form: "apa", note: "", index: 1 }
);
truthy(
  "the fallback keeps its JSON warning",
  parseWordList("[apa] father").warnings.some((warning) => /JSON/.test(warning))
);
for (const [name, text] of [
  ["an array of scalars", "[1,2,3]"],
  ["an object without word fields", '{"foo":"bar"}'],
  ["an array of unrelated objects", '[{"name":"x"}]'],
]) {
  const parsed = parseWordList(text);
  truthy(`${name} imports no rows`, parsed.rows.length === 0);
  truthy(
    `${name} explains that it is not a word list`,
    parsed.warnings.some((warning) => /word list|gloss/i.test(warning)),
  );
}

/* ---- duplicates and apply ------------------------------------------------- */

const language = () => ({
  vocabulary: [
    { id: "w1", gloss: "water", form: "AAA", note: "" },
    { id: "w2", gloss: "water", form: "BBB", note: "" },
  ],
});
equal(
  "rowStatus previews the last duplicate",
  rowStatus({ gloss: "water", form: "CCC", note: "" }, language(), "update").reason,
  "Form becomes CCC"
);
// The working tree deliberately keeps last-wins duplicate behavior; the
// preview must name the same word the apply step updates.
{
  const lang = language();
  applyWordList(lang, [{ gloss: "water", form: "CCC", note: "" }], "update");
  equal(
    "update mode writes the word the preview named",
    lang.vocabulary.map((word) => [word.id, word.form]),
    [["w1", "AAA"], ["w2", "CCC"]]
  );
}
{
  const lang = language();
  const summary = applyWordList(lang, [{ gloss: "water", form: "CCC", note: "" }], "skip");
  equal("skip mode keeps duplicates as-is", [lang.vocabulary[0].form, summary.skipped], ["AAA", 1]);
}
{
  const lang = { vocabulary: [] };
  const summary = applyWordList(
    lang,
    [
      { gloss: "house", form: "kasa", note: "" },
      { gloss: "draft", form: "", note: "" },
    ],
    "skip"
  );
  equal("new rows are added and counted", [summary.added, summary.drafts, lang.vocabulary.length], [2, 1, 2]);
}
equal(
  "rowStatus rejects rows without a gloss",
  rowStatus({ gloss: "", form: "kasa", note: "" }, { vocabulary: [] }, "update").status,
  "invalid"
);

/* ---- writers -------------------------------------------------------------- */

equal(
  "toTsv writes a header and collapses whitespace in fields",
  toTsv([{ gloss: "big house", form: "kasa", note: "a\nb" }]),
  "gloss\tform\tnote\nbig house\tkasa\ta b"
);
equal(
  "toTsv escapes double quotes as a quoted field",
  toTsv([{ gloss: "sun", form: "ãka", note: 'quote "x"' }]),
  'gloss\tform\tnote\nsun\tãka\t"quote ""x"""'
);
equal(
  "a quoted TSV export re-imports with the quote intact",
  rowOf(parseWordList(toTsv([{ gloss: "sun", form: "ãka", note: 'quote "x"' }]))),
  { gloss: "sun", form: "ãka", note: 'quote "x"', index: 2 }
);
equal(
  "toJson keeps the exact field strings",
  JSON.parse(toJson([{ gloss: "a b", form: "x\ny", note: "" }])),
  [{ gloss: "a b", form: "x\ny", note: "" }]
);

/* ---- stress ------------------------------------------------------------- */

const stressLanguage = () => ({
  inventory: {
    consonants: { cells: { place: ["k", "m", "s"] } },
    vowels: { cells: { height: ["a", "u"] } },
  },
  phonotactics: { template: "(C)V(C)", stress: "initial", stressScope: "phonetic" },
  vocabulary: [],
});

const penultLanguage = () => ({
  ...stressLanguage(),
  phonotactics: { ...stressLanguage().phonotactics, stress: "penult" },
});

equal(
  "a JSON word imports its stress field",
  parseWordList('[{"gloss":"flour","form":"muka","stress":{"primary":1,"secondary":[]}}]').rows[0].stress,
  { primary: 1, secondary: [] }
);
equal(
  "a JSON word imports secondary stress too",
  parseWordList('[{"gloss":"flour","form":"muka","stress":{"primary":1,"secondary":[0]}}]').rows[0].stress,
  { primary: 1, secondary: [0] }
);
{
  const row = parseWordList("flour\tmuˈka").rows[0];
  equal("an inline primary mark imports as word stress and leaves the form bare", [row.form, row.stress], [
    "muka",
    { primary: 1, secondary: [] },
  ]);
}
{
  const row = parseWordList("flour\tˌmuˈka").rows[0];
  equal("an inline secondary mark imports alongside the primary", row.stress, {
    primary: 1,
    secondary: [0],
  });
}
{
  const row = parseWordList("flour\tmuˈ").rows[0];
  equal("a trailing inline mark imports instead of being dropped", [row.form, row.stress], [
    "mu",
    { primary: 0, secondary: [] },
  ]);
}
{
  const row = parseWordList("flour\tkaiˈa").rows[0];
  equal("an inline mark before a hiatus vowel imports its syllable index", row.stress, {
    primary: 2,
    secondary: [],
  });
}
{
  const lang = stressLanguage();
  applyWordList(
    lang,
    [{ gloss: "flour", form: "muka", stress: { primary: 1, secondary: [] }, note: "" }],
    "update"
  );
  equal(
    "importing stress stores it on the word and opts into phonemic scope",
    [lang.vocabulary[0].stress, lang.phonotactics.stressScope],
    [{ primary: 1, secondary: [] }, "phonemic"]
  );
}
{
  const lang = stressLanguage();
  applyWordList(lang, [{ gloss: "plain", form: "kasa", note: "" }], "update");
  equal(
    "an import without stress leaves the scope alone",
    lang.phonotactics.stressScope,
    "phonetic"
  );
}
{
  const lang = stressLanguage();
  applyWordList(
    lang,
    [{ gloss: "flour", form: "muka", stress: { primary: 1, secondary: [0] }, note: "" }],
    "update"
  );
  applyWordList(lang, [{ gloss: "flour", form: "muka", note: "updated" }], "update");
  equal(
    "a bulk update without stress preserves the stored stress",
    lang.vocabulary[0].stress,
    { primary: 1, secondary: [0] }
  );
}
{
  const words = [{ gloss: "flour", form: "muka", note: "", stress: { primary: null, secondary: [1] } }];
  const tsv = toTsv(words, stressLanguage());
  equal(
    "a TSV export keeps a secondary-only stress record from gaining a primary",
    tsv.split("\n")[1],
    "flour\tmuˌka\t"
  );
  equal(
    "a secondary-only TSV round-trip keeps the original stress",
    parseWordList(tsv).rows[0].stress,
    { primary: null, secondary: [1] }
  );
}
equal(
  "toJson writes stress only when the word has it",
  JSON.parse(toJson([
    { gloss: "flour", form: "muka", note: "", stress: { primary: 1, secondary: [] } },
    { gloss: "plain", form: "kasa", note: "" },
  ])),
  [
    { gloss: "flour", form: "muka", note: "", stress: { primary: 1, secondary: [] } },
    { gloss: "plain", form: "kasa", note: "" },
  ]
);
equal(
  "JSON export prunes a secondary colliding with the default primary",
  JSON.parse(toJson(
    [{ gloss: "flour", form: "muka", note: "", stress: { primary: null, secondary: [0] } }],
    stressLanguage()
  )),
  [{ gloss: "flour", form: "muka", note: "" }]
);
{
  const lang = stressLanguage();
  applyWordList(
    lang,
    [{ gloss: "flour", form: "muka", note: "", stress: { primary: null, secondary: [0] } }],
    "update"
  );
  equal("a bulk import prunes a colliding secondary", Object.hasOwn(lang.vocabulary[0], "stress"), false);
}
{
  const lang = stressLanguage();
  lang.vocabulary.push({ id: "w1", gloss: "flour", form: "muka", note: "", stress: { primary: 1, secondary: [] } });
  applyWordList(
    lang,
    [{ gloss: "flour", form: "muka", note: "", stress: { primary: null, secondary: [0] } }],
    "update"
  );
  equal(
    "an update whose stress prunes away clears the stored field",
    Object.hasOwn(lang.vocabulary[0], "stress"),
    false
  );
}
{
  const lang = stressLanguage();
  lang.vocabulary.push({ id: "w1", gloss: "flour", form: "muka", note: "", stress: { primary: 1, secondary: [] } });
  applyWordList(
    lang,
    [{ gloss: "flour", form: "", note: "", stress: { primary: null, secondary: [0] } }],
    "update"
  );
  equal(
    "a stress-only update prunes against the stored form",
    Object.hasOwn(lang.vocabulary[0], "stress"),
    false
  );
}
{
  const lang = penultLanguage();
  lang.vocabulary.push({
    id: "w1",
    gloss: "flour",
    form: "kasa",
    note: "",
    stress: { primary: null, secondary: [0] },
  });
  applyWordList(lang, [{ gloss: "flour", form: "kasaka", note: "" }], "update");
  equal(
    "a form-only update prunes a hidden mark instead of reviving it",
    Object.hasOwn(lang.vocabulary[0], "stress"),
    false
  );
}
{
  const words = [{ gloss: "flour", form: "muka", note: "", stress: { primary: 1, secondary: [0] } }];
  const lang = stressLanguage();
  const tsv = toTsv(words, lang);
  const row = parseWordList(tsv).rows[0];
  equal("a TSV export writes stress as inline marks", tsv.split("\n")[1], "flour\tˌmuˈka\t");
  equal("a TSV stress round-trip keeps the form and both marks", [row.form, row.stress], [
    "muka",
    { primary: 1, secondary: [0] },
  ]);
}

/* ---- lexicon metadata ---------------------------------------------------- */

const metaEntry = {
  gloss: "house",
  form: "kasa",
  note: "a place",
  pos: "noun",
  senses: ["dwelling", "household"],
  tags: ["nature", "dwelling"],
  status: "attested",
  source: "Wiktionary",
  etymology: "from *kas-",
};
const importedMeta = parseWordList(JSON.stringify([metaEntry])).rows[0];
equal(
  "JSON import reads every metadata field",
  [importedMeta.pos, importedMeta.senses, importedMeta.tags, importedMeta.status, importedMeta.source, importedMeta.etymology],
  ["noun", ["dwelling", "household"], ["nature", "dwelling"], "attested", "Wiktionary", "from *kas-"]
);

const metaTsv = toTsv([metaEntry]);
equal(
  "TSV adds scalar metadata columns only when fields are used",
  metaTsv.split("\n")[0],
  "gloss\tform\tnote\tpos\tstatus\tsource\tetymology"
);
const metaTsvRow = parseWordList(metaTsv).rows[0];
equal(
  "the extended TSV header imports scalar metadata",
  [metaTsvRow.pos, metaTsvRow.status, metaTsvRow.source, metaTsvRow.etymology],
  ["noun", "attested", "Wiktionary", "from *kas-"]
);
equal("list metadata stays JSON-only in TSV", Object.hasOwn(metaTsvRow, "senses"), false);

{
  const lang = { vocabulary: [] };
  applyWordList(lang, [importedMeta], "skip");
  equal(
    "an imported word carries its metadata",
    [lang.vocabulary[0].pos, lang.vocabulary[0].senses, lang.vocabulary[0].tags, lang.vocabulary[0].etymology],
    ["noun", ["dwelling", "household"], ["nature", "dwelling"], "from *kas-"]
  );
}
{
  const lang = {
    vocabulary: [
      {
        id: "w",
        gloss: "house",
        form: "kasa",
        note: "",
        pos: "noun",
        senses: ["dwelling"],
        etymology: "old note",
      },
    ],
  };
  applyWordList(lang, [{ gloss: "house", form: "kasa", note: "new note", pos: "" }], "update");
  equal(
    "blank or omitted metadata does not clobber recorded values",
    [lang.vocabulary[0].pos, lang.vocabulary[0].senses, lang.vocabulary[0].etymology],
    ["noun", ["dwelling"], "old note"]
  );
}

const exportedMeta = JSON.parse(toJson([metaEntry]))[0];
equal(
  "JSON export includes scalar and list metadata",
  [exportedMeta.pos, exportedMeta.senses, exportedMeta.tags, exportedMeta.status, exportedMeta.source, exportedMeta.etymology],
  ["noun", ["dwelling", "household"], ["nature", "dwelling"], "attested", "Wiktionary", "from *kas-"]
);

/* ---- summary ------------------------------------------------------------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
