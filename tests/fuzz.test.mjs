// Seeded parser fuzz tests for Language Tree — plain Node, no framework and no DOM.
//
//   node tests/fuzz.test.mjs
//   node tests/fuzz.test.mjs --seed=123 --cases=5000
//
// The engine and bulk suites pin known cases. This suite complements them with
// deterministic random coverage of the four parser surfaces: rule notation,
// RFC 4180 tables, JSON word lists, and X-SAMPA. It uses a fixed default seed
// so CI is reproducible; the flags exist only to explore more cases locally.
// A failure prints the seed, case index, and generated input, so rerunning the
// same command reproduces it exactly.
//
// The summary prints at the end and failures print details; the process exits
// non-zero on any failure.

import { defaultInventory } from "../web/js/model.js";
import { applyRule, compileRule, contextForInventory } from "../web/js/phonology.js";
import { parseWordList, toJson, toTsv } from "../web/js/bulk.js";
import { ipaToXSampa, xSampaToIPA } from "../web/js/xsampa.js";
import { IPA_FEATURES } from "../web/js/features.js";
import { stripLevelMarks } from "../web/js/notation.js";
import { classForText } from "../web/js/naturalclasses.js";

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

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function numericArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!arg) return fallback;
  const parsed = Number(arg.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : fallback;
}

const SEED = numericArg("seed", 0x5eed2026) >>> 0;
const CASES = Math.max(1, Math.floor(numericArg("cases", 1000)));

// mulberry32: tiny, deterministic, and good enough for input generation.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function chance(random, probability) {
  return random() < probability;
}

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min));
}

function randomString(random, alphabet, minLength, maxLength) {
  const length = randomInt(random, minLength, maxLength + 1);
  let text = "";
  for (let index = 0; index < length; index += 1) text += pick(random, alphabet);
  return text;
}

function formatInput(input) {
  const text = JSON.stringify(input);
  if (text === undefined) return String(input);
  return text.length > 900 ? `${text.slice(0, 900)}…` : text;
}

// One assertion per property: stop at the first counterexample so the log
// names one reproducible case instead of thousands.
function runFuzz(name, seed, cases, generate, verify) {
  const random = mulberry32(seed);
  for (let index = 0; index < cases; index += 1) {
    let input;
    try {
      input = generate(random);
      verify(input);
    } catch (error) {
      failures.push(
        `${name} (case ${index}, seed ${seed})\n    input: ${formatInput(input)}\n    ${error.message || String(error)}`
      );
      return;
    }
  }
  passed += 1;
}

/* ---- rule-notation fixture ---------------------------------------------- */

function makeChart(base, rows, columns, cells) {
  base.rows = rows.map((label) => ({ id: `r_${label}`, label, children: [] }));
  base.columns = columns.map((label) => ({ id: `c_${label}`, label, children: [] }));
  base.cells = {};
  for (const [row, column, sounds] of cells) {
    base.cells[`r_${row}|c_${column}`] = sounds;
  }
  return base;
}

const inventory = defaultInventory();
const consonants = makeChart(
  inventory.consonants,
  ["Plosive", "Implosive", "Ejective", "Affricate", "Fricative", "Nasal", "Trill", "Liquid", "Glide", "Click"],
  ["Labial", "Alveolar", "Postalveolar", "Retroflex", "Palatal", "Velar", "Uvular", "Pharyngeal", "Glottal"],
  [
    ["Plosive", "Labial", ["p", "b"]],
    ["Plosive", "Alveolar", ["t", "d"]],
    ["Plosive", "Retroflex", ["ʈ", "ɖ"]],
    ["Plosive", "Palatal", ["c", "ɟ"]],
    ["Plosive", "Velar", ["k", "g"]],
    ["Plosive", "Uvular", ["q", "ɢ"]],
    ["Plosive", "Glottal", ["ʔ"]],
    ["Implosive", "Labial", ["ɓ"]],
    ["Implosive", "Alveolar", ["ɗ"]],
    ["Implosive", "Palatal", ["ʄ"]],
    ["Implosive", "Velar", ["ɠ"]],
    ["Implosive", "Uvular", ["ʛ"]],
    ["Ejective", "Labial", ["pʼ"]],
    ["Ejective", "Alveolar", ["tʼ", "t͡sʼ"]],
    ["Ejective", "Postalveolar", ["t͡ʃʼ"]],
    ["Ejective", "Retroflex", ["ʈʼ"]],
    ["Ejective", "Palatal", ["cʼ"]],
    ["Ejective", "Velar", ["kʼ", "k͡xʼ"]],
    ["Ejective", "Uvular", ["qʼ"]],
    ["Affricate", "Alveolar", ["t͡s", "d͡z", "t͡ɬ", "d͡ɮ"]],
    ["Affricate", "Postalveolar", ["t͡ʃ", "d͡ʒ"]],
    ["Affricate", "Retroflex", ["t͡ʂ", "d͡ʐ"]],
    ["Affricate", "Palatal", ["t͡ɕ", "d͡ʑ"]],
    ["Affricate", "Velar", ["k͡x", "g͡ɣ"]],
    ["Fricative", "Labial", ["ɸ", "β", "f", "v"]],
    ["Fricative", "Alveolar", ["θ", "ð", "s", "z", "ɬ", "ɮ"]],
    ["Fricative", "Postalveolar", ["ʃ", "ʒ"]],
    ["Fricative", "Retroflex", ["ʂ", "ʐ"]],
    ["Fricative", "Palatal", ["ç", "ʝ"]],
    ["Fricative", "Velar", ["x", "ɣ"]],
    ["Fricative", "Uvular", ["χ", "ʁ"]],
    ["Fricative", "Pharyngeal", ["ħ", "ʕ"]],
    ["Fricative", "Glottal", ["h", "ɦ"]],
    ["Nasal", "Labial", ["m", "ɱ"]],
    ["Nasal", "Alveolar", ["n"]],
    ["Nasal", "Retroflex", ["ɳ"]],
    ["Nasal", "Palatal", ["ɲ"]],
    ["Nasal", "Velar", ["ŋ"]],
    ["Nasal", "Uvular", ["ɴ"]],
    ["Trill", "Labial", ["ʙ"]],
    ["Trill", "Alveolar", ["r"]],
    ["Trill", "Uvular", ["ʀ"]],
    ["Liquid", "Alveolar", ["l", "ɾ", "ɺ"]],
    ["Liquid", "Retroflex", ["ɭ", "ɻ"]],
    ["Liquid", "Palatal", ["ʎ"]],
    ["Glide", "Labial", ["w", "ʍ", "ɥ"]],
    ["Glide", "Palatal", ["j"]],
    ["Glide", "Velar", ["ɰ"]],
    ["Click", "Labial", ["ʘ"]],
    ["Click", "Alveolar", ["ǀ", "ǃ"]],
    ["Click", "Palatal", ["ǂ"]],
    ["Click", "Velar", ["ǁ"]],
  ]
);
const vowels = makeChart(
  inventory.vowels,
  ["Close", "Near-close", "Close-mid", "Mid", "Open-mid", "Near-open", "Open", "Diphthong"],
  ["Front", "Central", "Back"],
  [
    ["Close", "Front", ["i", "y", "iː", "ĩ", "ẽ"]],
    ["Close", "Central", ["ɨ", "ʉ"]],
    ["Close", "Back", ["ɯ", "u", "uː", "õ", "ũ"]],
    ["Near-close", "Front", ["ɪ", "ʏ"]],
    ["Near-close", "Back", ["ʊ"]],
    ["Close-mid", "Front", ["e", "ø", "eː"]],
    ["Close-mid", "Central", ["ɘ", "ɵ"]],
    ["Close-mid", "Back", ["ɤ", "o", "oː"]],
    ["Mid", "Central", ["ə", "ə̃"]],
    ["Open-mid", "Front", ["ɛ", "œ", "ɛː", "ɛ̃"]],
    ["Open-mid", "Central", ["ɜ", "ɞ"]],
    ["Open-mid", "Back", ["ʌ", "ɔ", "ɔː", "ɔ̃"]],
    ["Near-open", "Front", ["æ"]],
    ["Near-open", "Central", ["ɐ"]],
    ["Open", "Front", ["a", "ã", "aː"]],
    ["Open", "Back", ["ɑ", "ɒ", "ɑː", "ɑ̃"]],
    ["Diphthong", "Front", ["aɪ", "eɪ", "ɔɪ"]],
    ["Diphthong", "Central", ["iə", "uə"]],
    ["Diphthong", "Back", ["aʊ", "oʊ"]],
  ]
);
const context = contextForInventory({ consonants, vowels });
const chart = context.chart;

// Chart references, bare and dotted. Dotted refs are the interesting ones:
// `ejective.alveolar` picks up t͡sʼ, `ejective.velar` picks up k͡xʼ, and
// `vowel.diphthong` pins the vowel chart before matching the row label.
const CLASS_LABELS = [
  "plosive", "implosive", "ejective", "affricate", "fricative", "nasal",
  "trill", "liquid", "glide", "click", "vowel", "diphthong",
  "plosive.alveolar", "plosive.velar", "ejective.alveolar", "ejective.velar",
  "ejective.uvular", "affricate.alveolar", "affricate.postalveolar",
  "affricate.retroflex", "affricate.velar", "fricative.uvular",
  "fricative.pharyngeal", "fricative.glottal", "nasal.palatal", "nasal.uvular",
  "liquid.retroflex", "glide.labial", "click.alveolar", "click.velar",
  "vowel.front", "vowel.back", "vowel.central", "vowel.diphthong",
  "diphthong.front", "diphthong.back", "close.front", "open.front",
  "mid.central", "open-mid.back",
];
const invalidClasses = CLASS_LABELS.filter((label) => {
  const ref = classForText(label, context.classIndex);
  return !ref || !ref.ok || !ref.members.length;
});
equal("every curated chart class resolves in the fuzz fixture", invalidClasses, []);
const classLabels = CLASS_LABELS;
truthy("the fuzz chart exposes chart classes", classLabels.length >= 20);

function literal(random) {
  return pick(random, chart);
}

// Separate generated literals with spaces. Without the space a Greek-letter
// sound followed by a letter (θx, βj, χa) reads as an α-variable naming a
// feature, which is rule notation, not a sound sequence.
function sequence(random, minLength = 1, maxLength = 2, separator = " ") {
  const length = randomInt(random, minLength, maxLength + 1);
  const parts = [];
  for (let index = 0; index < length; index += 1) parts.push(literal(random));
  return parts.join(separator);
}

function environmentSide(random) {
  const roll = random();
  if (roll < 0.18) return "#";
  if (roll < 0.36) return pick(random, ["V", "C"]);
  if (roll < 0.46) return ".";
  if (roll < 0.56) return "+";
  if (roll < 0.7) return pick(random, classLabels);
  return literal(random);
}

function validRule(random) {
  let target;
  const targetRoll = random();
  if (targetRoll < 0.08) target = "∅";
  else if (targetRoll < 0.22) target = pick(random, ["V", "C"]);
  else if (targetRoll < 0.36) target = `[${literal(random)} ${literal(random)}]`;
  else if (targetRoll < 0.52) target = pick(random, classLabels);
  else target = sequence(random, 1, 2);

  let output;
  do {
    output = chance(random, 0.12) ? "∅" : sequence(random, 1, 2);
  } while (target === "∅" && output === "∅");

  const arrow = pick(random, [">", "->", "→"]);
  const environment = chance(random, 0.45)
    ? ` / ${environmentSide(random)} _ ${environmentSide(random)}`
    : "";
  return `${target} ${arrow} ${output}${environment}`;
}

function randomForm(random) {
  // Forms are surface strings, not rule patterns, so they keep no spaces.
  return sequence(random, 1, 4, "");
}

const RULE_TOKENS = [
  ..."abcdefghijklmnopqrstuvwxyz",
  "æ", "ø", "ŋ", "ʃ", "ʒ", "θ", "ð", "ɬ", "ɮ", "ʂ", "ʐ", "ç", "ʝ",
  "χ", "ʁ", "ħ", "ʕ", "ɦ", "ɸ", "β", "ɱ", "ɳ", "ɲ", "ɴ", "ɭ", "ɻ",
  "ʎ", "ɥ", "ɰ", "ʍ", "ʔ", "ɢ", "q", "ʈ", "ɖ", "ɓ", "ɗ", "ʄ", "ɠ", "ʛ",
  "i", "y", "ɨ", "ʉ", "ɯ", "u", "ɪ", "ʏ", "ʊ", "e", "ɘ", "ɵ", "ɤ", "o",
  "ə", "ɛ", "œ", "ɜ", "ɞ", "ʌ", "ɔ", "æ", "ɐ", "a", "ɑ", "ɒ",
  "pʼ", "tʼ", "kʼ", "qʼ", "t͡s", "d͡z", "t͡ʃ", "d͡ʒ", "t͡ɬ", "d͡ɮ", "k͡x",
  "t͡sʼ", "k͡xʼ", "ã", "ẽ", "ĩ", "õ", "ũ", "ə̃", "aɪ", "aʊ", "ɔɪ",
  "iː", "aː", "uː", ">", "->", "→", "/", "_", "#", "[", "]", "(", ")",
  "∅", "0", "α", "β", "+", ".", "ˈ", "ˌ", "ː", "̃", "͡", "ʼ", "ʰ",
  "ʷ", "ʲ", "ˠ", "ˤ", "̥", "̤", " ", "\t", "\n",
];

function randomRuleText(random) {
  return randomString(random, RULE_TOKENS, 0, 60);
}

function mutatedRule(random) {
  const characters = [...validRule(random)];
  const edits = randomInt(random, 1, 5);
  for (let index = 0; index < edits; index += 1) {
    const kind = random();
    const position = randomInt(random, 0, characters.length + 1);
    if (kind < 0.34 && characters.length) {
      characters.splice(Math.min(position, characters.length - 1), 1);
    } else if (kind < 0.68) {
      characters.splice(position, 0, pick(random, RULE_TOKENS));
    } else if (characters.length) {
      characters[Math.min(position, characters.length - 1)] = pick(random, RULE_TOKENS);
    }
  }
  return characters.join("");
}

/* ---- rule-notation fuzz -------------------------------------------------- */

runFuzz(
  "valid generated rules compile and apply",
  SEED,
  CASES,
  (random) => ({ rule: validRule(random), form: randomForm(random) }),
  ({ rule, form }) => {
    const compiled = compileRule(rule, context);
    check(compiled.ok, `compile failed: ${compiled.error}`);
    const tokens = context.tokenize(form);
    check(tokens.length > 0, "generated form did not tokenize");
    const result = applyRule(tokens, compiled.rule, context);
    check(Array.isArray(result.tokens), "applyRule returned no token array");
    check(
      result.tokens.every((token) => typeof token === "string"),
      "applyRule returned a non-string token"
    );
    check(!result.error, `applyRule error: ${result.error}`);
  }
);

runFuzz(
  "random and mutated rule notation never crashes",
  SEED,
  CASES,
  (random) => ({
    rule: chance(random, 0.5) ? randomRuleText(random) : mutatedRule(random),
    form: randomForm(random),
  }),
  ({ rule, form }) => {
    const compiled = compileRule(rule, context);
    if (!compiled.ok) {
      check(
        typeof compiled.error === "string" && compiled.error.length > 0,
        "failed compilation without an error message"
      );
      return;
    }
    const result = applyRule(context.tokenize(form), compiled.rule, context);
    check(Array.isArray(result.tokens), "applyRule returned no token array");
    check(
      result.tokens.every((token) => typeof token === "string"),
      "applyRule returned a non-string token"
    );
  }
);

truthy(
  "empty and non-string rule input fails cleanly",
  [null, undefined, "", 0, {}, []].every((value) => {
    const result = compileRule(value, context);
    return result.ok === false && typeof result.error === "string" && result.error.length > 0;
  })
);

/* ---- bulk table and writer fuzz ----------------------------------------- */

const GLOSSES = [
  "house", "water", "friend", "tree", "sun", "moon", "big house", 'say "hi"',
  "line\nbreak", "semi;colon", "comma,separated", "tab\there", "  padded  ",
  "café", "naïve", "日本語", "a b", "x",
];
const FORMS = [
  "kasa", "neːwaːl", "t͡saka", "pʼa", "ãka", "aɪ", "ɬaχ", "k͡xʼi",
  "/kasa/", "[paka]", "  pa ka  ", "ka+ta", "", "a;b", "a,b", "a\tb", "a\nb", "ʔa",
];
const NOTES = [
  "", "plain", "a note", 'quote "x"', "line\nbreak", "  padded  ",
  "semi;colon", "comma,separated", "tab\there", "日本語",
];

function randomWord(random) {
  return {
    gloss: pick(random, GLOSSES),
    form: pick(random, FORMS),
    note: pick(random, NOTES),
  };
}

function csvField(value) {
  const text = String(value);
  if (/[",;\t\n\r]/u.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function makeTable(random, rows, delimiter, headerMode) {
  const header =
    headerMode === "gloss"
      ? ["gloss", "form", "note"]
      : headerMode === "form"
        ? ["form", "gloss", "note"]
        : null;
  const lines = [];
  if (header) lines.push(header.map((cell) => csvField(cell)).join(delimiter));
  for (const row of rows) {
    const cells = headerMode === "form" ? [row.form, row.gloss, row.note] : [row.gloss, row.form, row.note];
    lines.push(cells.map((cell) => csvField(cell)).join(delimiter));
  }
  const newline = chance(random, 0.2) ? "\r\n" : "\n";
  return lines.join(newline) + (chance(random, 0.5) ? newline : "");
}

function parsedRows(parsed) {
  return parsed.rows.map(({ gloss, form, note }) => ({ gloss, form, note }));
}

function expectedTableRows(rows) {
  return rows.map((row) => ({
    gloss: row.gloss.trim(),
    form: stripLevelMarks(row.form),
    note: row.note.trim(),
  }));
}

runFuzz(
  "generated CSV/TSV tables round-trip",
  SEED,
  CASES,
  (random) => {
    const delimiter = pick(random, [",", "\t", ";", ",", "\t"]);
    const headerMode = pick(random, ["none", "gloss", "form", "gloss"]);
    const rows = Array.from({ length: randomInt(random, 1, 7) }, () => randomWord(random));
    // parseWordList trims the paste, so a headerless first row made only of
    // trailing delimiters (gloss + empty form + empty note) loses the
    // delimiter before detection. Give that row a visible second field.
    if (headerMode === "none" && !rows[0].form && !rows[0].note) {
      rows[0] = { ...rows[0], note: "plain" };
    }
    return { text: makeTable(random, rows, delimiter, headerMode), rows, delimiter, headerMode };
  },
  ({ text, rows, delimiter, headerMode }) => {
    const parsed = parseWordList(text);
    check(parsed.parseError === "", `parseError: ${parsed.parseError}`);
    check(
      parsed.delimiter === delimiter,
      `delimiter ${JSON.stringify(parsed.delimiter)} !== ${JSON.stringify(delimiter)}`
    );
    check(parsed.headerSkipped === (headerMode !== "none"), "headerSkipped mismatch");
    const expected = expectedTableRows(rows);
    const actual = parsedRows(parsed);
    check(
      JSON.stringify(actual) === JSON.stringify(expected),
      `rows mismatch\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`
    );
  }
);

function sanitizeField(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

runFuzz(
  "JSON writer round-trips generated words",
  SEED,
  CASES,
  (random) => {
    const words = Array.from({ length: randomInt(random, 1, 7) }, () => randomWord(random));
    return { words, text: toJson(words) };
  },
  ({ words, text }) => {
    const parsed = parseWordList(text);
    check(parsed.delimiter === "JSON", `delimiter ${JSON.stringify(parsed.delimiter)} !== "JSON"`);
    const expected = words.map((word) => ({
      gloss: word.gloss.trim(),
      form: stripLevelMarks(word.form),
      note: word.note.trim(),
    }));
    const actual = parsedRows(parsed);
    check(
      JSON.stringify(actual) === JSON.stringify(expected),
      `rows mismatch\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`
    );
  }
);

runFuzz(
  "TSV writer round-trips sanitized fields",
  SEED,
  CASES,
  (random) => {
    const words = Array.from({ length: randomInt(random, 1, 7) }, () => randomWord(random));
    return { words, text: toTsv(words) };
  },
  ({ words, text }) => {
    const parsed = parseWordList(text);
    check(parsed.delimiter === "\t", `delimiter ${JSON.stringify(parsed.delimiter)} !== "\\t"`);
    check(parsed.headerSkipped, "TSV header was not skipped");
    const expected = words.map((word) => ({
      gloss: sanitizeField(word.gloss),
      form: stripLevelMarks(sanitizeField(word.form)),
      note: sanitizeField(word.note),
    }));
    const actual = parsedRows(parsed);
    check(
      JSON.stringify(actual) === JSON.stringify(expected),
      `rows mismatch\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`
    );
  }
);

const TABLE_TEXT_ALPHABET = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ,\t;\n\"'[]{}:/|.-_+=()!?@#$%^&*",
  "\\",
  "é", "ã", "t͡s", "pʼ", "ə", "ɬ", "ʂ", "χ", "ʁ", "ʔ", "→", "∅",
];

runFuzz(
  "arbitrary table text parses without throwing",
  SEED,
  CASES,
  (random) => randomString(random, TABLE_TEXT_ALPHABET, 0, 120),
  (text) => {
    const parsed = parseWordList(text);
    check(parsed && typeof parsed === "object", "parseWordList returned no object");
    check(Array.isArray(parsed.rows), "rows is not an array");
    check(Array.isArray(parsed.warnings), "warnings is not an array");
    check(typeof parsed.parseError === "string", "parseError is not a string");
    check(typeof parsed.delimiter === "string", "delimiter is not a string");
    for (const row of parsed.rows) {
      check(typeof row.gloss === "string", "row gloss is not a string");
      check(typeof row.form === "string", "row form is not a string");
      check(typeof row.note === "string", "row note is not a string");
      check(typeof row.warning === "string", "row warning is not a string");
      check(Number.isInteger(row.index), "row index is not an integer");
    }
  }
);

equal("empty table text parses to no rows", parseWordList("").rows, []);

/* ---- JSON fuzz ----------------------------------------------------------- */

function randomJsonEntry(random) {
  const word = randomWord(random);
  const entry = {};
  if (chance(random, 0.85)) entry.gloss = word.gloss;
  if (chance(random, 0.4)) entry.meaning = word.gloss;
  if (chance(random, 0.85)) entry.form = word.form;
  if (chance(random, 0.3)) entry.ipa = word.form;
  if (chance(random, 0.6)) entry.note = word.note;
  return entry;
}

function expectedJsonRow(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  return {
    gloss: String(source.gloss ?? source.meaning ?? "").trim(),
    form: stripLevelMarks(source.form ?? source.ipa ?? ""),
    note: String(source.note ?? "").trim(),
  };
}

function randomJsonEntries(random) {
  const entries = [];
  const count = randomInt(random, 0, 7);
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    if (roll < 0.75) entries.push(randomJsonEntry(random));
    else if (roll < 0.85) entries.push(null);
    else if (roll < 0.92) entries.push(pick(random, [0, 1, true, false, "text", "a\nb"]));
    else entries.push([randomWord(random)]);
  }
  return entries;
}

runFuzz(
  "JSON word-list arrays import exactly",
  SEED,
  CASES,
  (random) => {
    const entries = randomJsonEntries(random);
    return { entries, text: JSON.stringify(entries) };
  },
  ({ entries, text }) => {
    const parsed = parseWordList(text);
    check(parsed.delimiter === "JSON", `delimiter ${JSON.stringify(parsed.delimiter)} !== "JSON"`);
    const expected = entries.map(expectedJsonRow).filter((row) => row.gloss || row.form);
    const actual = parsedRows(parsed);
    check(
      JSON.stringify(actual) === JSON.stringify(expected),
      `rows mismatch\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`
    );
    if (!expected.length) {
      check(
        parsed.warnings.some((warning) => /not a word list/i.test(warning)),
        "an empty word-list JSON did not warn"
      );
    }
  }
);

runFuzz(
  "single JSON word objects import exactly",
  SEED,
  CASES,
  (random) => {
    const entry = randomJsonEntry(random);
    return { entry, text: JSON.stringify(entry) };
  },
  ({ entry, text }) => {
    const parsed = parseWordList(text);
    check(parsed.delimiter === "JSON", `delimiter ${JSON.stringify(parsed.delimiter)} !== "JSON"`);
    const expected = expectedJsonRow(entry);
    const actual = parsedRows(parsed);
    if (expected.gloss || expected.form) {
      check(
        JSON.stringify(actual) === JSON.stringify([expected]),
        `rows mismatch\n    expected: ${JSON.stringify([expected])}\n    actual:   ${JSON.stringify(actual)}`
      );
    } else {
      check(actual.length === 0, "a non-word object produced rows");
      check(
        parsed.warnings.some((warning) => /not a word list/i.test(warning)),
        "a non-word object did not warn"
      );
    }
  }
);

function randomJsonValue(random, depth = 0) {
  const roll = random();
  if (depth >= 3 || roll < 0.4) {
    return pick(random, [null, true, false, 0, 1, -2, 3.5, "text", "a\nb", ""]);
  }
  if (roll < 0.7) {
    return Array.from({ length: randomInt(random, 0, 5) }, () => randomJsonValue(random, depth + 1));
  }
  const object = {};
  const keys = ["gloss", "meaning", "form", "ipa", "note", "other", ""];
  const count = randomInt(random, 0, 5);
  for (let index = 0; index < count; index += 1) {
    object[pick(random, keys)] = randomJsonValue(random, depth + 1);
  }
  return object;
}

runFuzz(
  "arbitrary JSON values parse without throwing",
  SEED,
  CASES,
  (random) => {
    const value = randomJsonValue(random);
    return { value, text: JSON.stringify(value) };
  },
  ({ text }) => {
    const parsed = parseWordList(text);
    check(Array.isArray(parsed.rows), "rows is not an array");
    check(Array.isArray(parsed.warnings), "warnings is not an array");
    check(typeof parsed.parseError === "string", "parseError is not a string");
    for (const row of parsed.rows) {
      check(typeof row.gloss === "string", "row gloss is not a string");
      check(typeof row.form === "string", "row form is not a string");
      check(typeof row.note === "string", "row note is not a string");
    }
  }
);

for (const text of ['[{"gloss":}]', '[{"gloss":"house"', '{gloss: "house"}', "[", "{"]) {
  const parsed = parseWordList(text);
  truthy(
    `malformed JSON ${JSON.stringify(text)} falls back with a warning`,
    parsed.warnings.some((warning) => /JSON/i.test(warning))
  );
  truthy(
    `malformed JSON ${JSON.stringify(text)} still returns a parse result`,
    Array.isArray(parsed.rows) && typeof parsed.parseError === "string"
  );
}

/* ---- X-SAMPA fuzz -------------------------------------------------------- */

const IPA_SYMBOLS = Object.keys(IPA_FEATURES);
const DECODE_FOLDS = [
  ["ɡ", "g"],
  ["ɩ", "ɪ"],
  ["ɷ", "ʊ"],
  ["ᴀ", "ɑ"],
  ["ᴇ", "ɛ"],
];

function canonicalIpa(text) {
  let result = text.normalize("NFC");
  for (const [from, to] of DECODE_FOLDS) result = result.replaceAll(from, to);
  return result;
}

runFuzz(
  "curated IPA symbols keep their X-SAMPA round trip",
  SEED,
  CASES,
  (random) => pick(random, IPA_SYMBOLS),
  (symbol) => {
    const ascii = ipaToXSampa(symbol);
    const back = xSampaToIPA(ascii);
    check(
      back === symbol || back === canonicalIpa(symbol),
      `${JSON.stringify(symbol)} -> ${JSON.stringify(ascii)} -> ${JSON.stringify(back)}`
    );
  }
);

// Concatenating valid X-SAMPA tokens keeps the stability property meaningful.
// Arbitrary ASCII can contain a stray underscore: the decoder preserves it
// literally, but the next encode of a following modifier can spell a binding
// (`_'`), so malformed input belongs to the no-throw property, not this one.
const XSAMPA_TOKENS = [
  ..."abcdefghijklmnopqrstuvwxyz",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "@", "{", "}", "&", "?",
  ":", "\"", "%", "'", "<\\", ">\\",
  "B\\", "G\\", "H\\", "I\\", "J\\", "K\\", "L\\", "M\\", "N\\", "O\\",
  "R\\", "U\\", "X\\", "3\\", "@\\", "@`", "3`", "?\\", ":\\",
  "h\\", "j\\", "l\\", "p\\", "r\\", "r\\`", "s\\", "v\\", "x\\", "z\\",
  "t`", "d`", "n`", "r`", "s`", "l`", "z`",
  "O\\", "|\\", "!\\", "=\\", "|\\|\\", "b_<", "d_<", "g_<", "J\\_<", "G\\_<",
  "ts", "dz", "tS", "dZ", "ts\\", "dz\\", "tK", "dK\\", "kp", "gb", "Nm",
  "t_s", "d_z", "t_S", "d_Z", "p_f", "b_v", "t_T", "d_D", "t_K", "d_K\\",
  "k_x", "g_G", "q_X", "g_b", "m_p", "m_b", "n_t", "n_d", "n`_t`", "n`_d`",
  "J_c", "J_J\\", "N_k", "N_g", "N_m", "N\\_q", "N\\_G\\", "G\\_R",
  "c_C", "J\\_j\\", "t_s`", "d_z`", "t`_s`", "d`_z`",
  "_h", "_w", "_j", "_G", "_?\\", "_>", "_0", "_v", "_t", "_k", "_d", "_n",
  "_l", "_m", "_N", "_O", "_o", "_c", "_x", "_X", "_\"", "_+", "_-", "_/",
  "_\\", "_^", "_}", "_A", "_a", "_e", "_q", "_r", "_H", "_L", "_M", "_B",
  "_T", "_H_T", "_B_L", "_R_F", "~", "=", "`",
];

runFuzz(
  "X-SAMPA decode/encode is stable after NFC",
  SEED,
  CASES,
  (random) => randomString(random, XSAMPA_TOKENS, 0, 12),
  (text) => {
    const first = xSampaToIPA(text).normalize("NFC");
    const second = xSampaToIPA(ipaToXSampa(first)).normalize("NFC");
    check(
      second === first,
      `${JSON.stringify(text)} -> ${JSON.stringify(first)} -> ${JSON.stringify(second)}`
    );
  }
);

runFuzz(
  "random curated IPA sequences encode and decode",
  SEED,
  CASES,
  (random) => {
    const length = randomInt(random, 0, 9);
    return Array.from({ length }, () => pick(random, IPA_SYMBOLS)).join("");
  },
  (form) => {
    const ascii = ipaToXSampa(form);
    const back = xSampaToIPA(ascii);
    check(typeof ascii === "string", "ipaToXSampa did not return a string");
    check(typeof back === "string", "xSampaToIPA did not return a string");
    check(ipaToXSampa(form) === ascii, "ipaToXSampa is not deterministic");
    check(xSampaToIPA(ascii) === back, "xSampaToIPA is not deterministic");
  }
);

const UNICODE_ALPHABET = [
  ..."abcdefghijklmnopqrstuvwxyz0123456789 _~=`'!@#$%^&*()-+={}[]:;,.?/|\\",
  "é", "ã", "ĩ", "õ", "ũ", "ə̃", "t͡s", "t͡ʃ", "pʼ", "kʼ", "ɬ", "ɮ",
  "ʂ", "ʐ", "ç", "ʝ", "χ", "ʁ", "ħ", "ʕ", "ɦ", "ɸ", "β", "ɱ", "ɳ",
  "ɲ", "ɴ", "ɭ", "ɻ", "ʎ", "ɥ", "ɰ", "ʍ", "ʔ", "ɢ", "q", "͡", "̃",
  "ː", "̥", "̤", "ʼ", "ʰ", "ʷ", "ʲ", "ˠ", "ˤ", "→", "∅",
];

runFuzz(
  "arbitrary Unicode text converts without throwing",
  SEED,
  CASES,
  (random) => randomString(random, UNICODE_ALPHABET, 0, 30),
  (text) => {
    check(typeof ipaToXSampa(text) === "string", "ipaToXSampa did not return a string");
    check(typeof xSampaToIPA(text) === "string", "xSampaToIPA did not return a string");
  }
);

equal(
  "X-SAMPA edge inputs stay empty or literal",
  [ipaToXSampa(null), xSampaToIPA(null), ipaToXSampa(""), xSampaToIPA(""), xSampaToIPA("a_")],
  ["", "", "", "", "a_"]
);
truthy(
  "unknown X-SAMPA characters pass through",
  ipaToXSampa("a;b") === "a;b" && xSampaToIPA("$") === "$"
);

/* ---- summary ------------------------------------------------------------- */

console.log(`Fuzz seed ${SEED} (0x${SEED.toString(16)}), ${CASES} cases per property`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  console.log(`\nReproduce with: node tests/fuzz.test.mjs --seed=${SEED} --cases=${CASES}`);
  process.exit(1);
}
