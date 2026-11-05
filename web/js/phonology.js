import {
  allophonyEntries,
  allophonyRules,
  chartPhonemeList,
  getLineage,
  ruleGroups,
  ruleNumberMap,
} from "./model.js";
import { compileClasses } from "./categories.js";
import { buildClassIndex, classForText } from "./naturalclasses.js";
import { stripLevelMarks } from "./notation.js";

const VOWEL_FALLBACK = new Set([
  "a", "e", "i", "o", "u", "y", "æ", "ɑ", "ɒ", "ɐ", "ə", "ɘ", "ɛ", "ɜ", "ɞ", "ɤ", "ɔ", "ø", "œ", "ɵ",
  "ɨ", "ɪ", "ʉ", "ʏ", "ʊ", "ɯ", "ʌ", "ɚ", "ɝ", "ɶ", "ɞ", "ɤ", "ɐ", "ᵻ", "ᵿ",
]);

const COMBINING = /\p{M}/u;
const TIE_BARS = new Set(["\u0361", "\u035c"]);

function stripMarks(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

function firstBase(text) {
  const stripped = stripMarks(text);
  return Array.from(stripped)[0] || "";
}

function normalizeForm(text) {
  return String(text || "").normalize("NFC");
}

export class SegmentContext {
  constructor({
    known = [],
    vowels = [],
    consonants = [],
    classIndex = [],
    categories = new Map(),
    categoryErrors = new Map(),
  } = {}) {
    this.vowels = new Set(vowels);
    this.consonants = new Set(consonants);
    // Chart-derived natural classes ( labeled hierarchies from the phonology
    // tables): a reference like plosive.plain or V.back expands against
    // these. Kept per-language or per-lineage by the context builders.
    this.classIndex = classIndex;
    // Custom categories from the current language's Phonotactics tab. They
    // use the same syntax as templates (N, G, OBS, …) and expand to a fixed
    // member list here; categoryErrors keeps broken definitions loud.
    this.categories = categories;
    this.categoryErrors = categoryErrors;
    this.known = [...new Set(known.filter(Boolean))].sort((a, b) => b.length - a.length);
  }

  isVowel(token) {
    if (this.vowels.has(token)) return true;
    return VOWEL_FALLBACK.has(firstBase(token)) && !this.consonants.has(token);
  }

  isConsonant(token) {
    if (this.consonants.has(token)) return true;
    return !this.isVowel(token);
  }

  tokenize(text) {
    const source = normalizeForm(text);
    const tokens = [];
    let index = 0;
    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char) || char === "." || char === "-" || char === "·") {
        index += 1;
        continue;
      }
      let match = null;
      for (const candidate of this.known) {
        if (candidate && source.startsWith(candidate, index)) {
          match = candidate;
          break;
        }
      }
      if (match) {
        tokens.push(match);
        index += match.length;
        continue;
      }

      let end = index + char.length;
      let hasTie = TIE_BARS.has(char);
      while (end < source.length) {
        const next = source.codePointAt(end);
        if (next === undefined) break;
        const nextChar = String.fromCodePoint(next);
        if (COMBINING.test(nextChar)) {
          if (TIE_BARS.has(nextChar)) hasTie = true;
          end += nextChar.length;
          continue;
        }
        if (hasTie) {
          end += nextChar.length;
          hasTie = false;
          continue;
        }
        break;
      }
      tokens.push(source.slice(index, end));
      index = end;
    }
    return tokens;
  }
}

export function contextForInventory(inventory) {
  const known = new Set();
  const vowels = new Set();
  const consonants = new Set();
  for (const phoneme of chartPhonemeList(inventory.vowels)) {
    vowels.add(phoneme);
    known.add(phoneme);
    const base = firstBase(phoneme);
    if (base) known.add(base);
  }
  for (const phoneme of chartPhonemeList(inventory.consonants)) {
    consonants.add(phoneme);
    known.add(phoneme);
    const base = firstBase(phoneme);
    if (base) known.add(base);
  }
  const classIndex = buildClassIndex([
    { chart: inventory.consonants, kind: "consonant" },
    { chart: inventory.vowels, kind: "vowel" },
  ]);
  return new SegmentContext({ known: [...known], vowels: [...vowels], consonants: [...consonants], classIndex });
}

// Rule application reads the whole lineage because an ancestral sound may
// still be a valid environment in a later language. Phonotactic checks are
// about the language's own synchronic inventory, so they use this narrower
// context instead.
function buildLanguageContext(project, languageId, extraKnown = []) {
  const lineage = getLineage(project, languageId);
  const known = new Set(extraKnown);
  const vowels = new Set();
  const consonants = new Set();
  for (const language of lineage) {
    for (const phoneme of chartPhonemeList(language.inventory.vowels)) {
      vowels.add(phoneme);
      known.add(phoneme);
      const base = firstBase(phoneme);
      if (base) known.add(base);
    }
    for (const phoneme of chartPhonemeList(language.inventory.consonants)) {
      consonants.add(phoneme);
      known.add(phoneme);
      const base = firstBase(phoneme);
      if (base) known.add(base);
    }
  }
  // Classes read the whole lineage: a class keeps meaning the same sounds
  // while a chart changes, because each generation contributes its own
  // labelled cells.
  const classIndex = buildClassIndex(
    lineage.flatMap((language) => [
      { chart: language.inventory.consonants, kind: "consonant" },
      { chart: language.inventory.vowels, kind: "vowel" },
    ])
  );
  const base = new SegmentContext({ known: [...known], vowels: [...vowels], consonants: [...consonants], classIndex });
  // Categories are authored on the current language's Phonotactics tab. They
  // are resolved against the lineage context so a rule can still name an
  // ancestral sound that the current chart no longer lists.
  const language = lineage.at(-1);
  const compiled = compileClasses(language?.phonotactics?.classes, base);
  const categories = new Map();
  for (const [name, entry] of compiled.map) categories.set(name, entry.values);
  const categoryErrors = new Map();
  for (const entry of compiled.entries) {
    if (!entry.name || compiled.map.has(entry.name)) continue;
    if (entry.errors.length && !categoryErrors.has(entry.name)) {
      categoryErrors.set(entry.name, entry.errors[0]);
    }
  }
  return new SegmentContext({
    known: [...known],
    vowels: [...vowels],
    consonants: [...consonants],
    classIndex,
    categories,
    categoryErrors,
  });
}

export function contextForLanguage(project, languageId) {
  return buildLanguageContext(project, languageId);
}

// ---------------------------------------------------------------------------
// Allophony
//
// Sound changes are diachronic: they run from a parent's phonemic form to a
// daughter's phonemic form and feed the cognate chain. Allophony is
// synchronic: it takes the current language's phonemic form and produces the
// surface form. The two use the same matching primitives but are stored and
// applied separately, so a daughter never inherits its parent's allophony as
// if it were a historical law.

function stripOuterMark(text, open, close) {
  const source = String(text ?? "").trim();
  return source.startsWith(open) && source.endsWith(close) && source.length >= 2
    ? source.slice(1, -1).trim()
    : source;
}

// Accept the linguist's standard form as well as the compact form:
//   /p/ → [pʰ] / # _ V
//   p > pʰ / # _ V
// The allophony section tells the parser that the output is a surface form,
// so outer square brackets are stripped rather than read as a sound set.
export function normalizeAllophonyNotation(notation) {
  const source = String(notation || "").trim();
  if (!source) return source;
  const arrow = source.match(/→|->|>/);
  if (!arrow) return source;
  const index = arrow.index;
  let target = stripOuterMark(source.slice(0, index), "/", "/");
  let rightSide = source.slice(index + arrow[0].length).trim();
  const slashIndex = rightSide.indexOf("/");
  if (slashIndex === -1) {
    rightSide = stripOuterMark(rightSide, "[", "]");
    return `${target} ${arrow[0]} ${rightSide}`;
  }
  const output = stripOuterMark(rightSide.slice(0, slashIndex), "[", "]");
  const environment = rightSide.slice(slashIndex + 1).trim();
  return `${target} ${arrow[0]} ${output} / ${environment}`;
}

// The tokenizer needs to know non-charted allophone symbols so [pʰ] is one
// segment, not p + ʰ. Collect output chunks from the rules lexically; this
// must work before the rules have been compiled.
export function allophoneCandidates(rules) {
  const candidates = [];
  for (const rule of rules || []) {
    const source = String(rule?.notation || "").trim();
    const arrow = source.match(/→|->|>/);
    if (!arrow) continue;
    let output = source.slice(arrow.index + arrow[0].length).trim();
    const slashIndex = output.indexOf("/");
    if (slashIndex !== -1) output = output.slice(0, slashIndex).trim();
    output = stripOuterMark(output, "[", "]");
    for (const chunk of output.split(/[\s,;]+/u)) {
      if (chunk && chunk !== "∅" && chunk !== "0") candidates.push(chunk);
    }
  }
  return [...new Set(candidates)];
}

export function contextForAllophony(project, languageId) {
  const language = getLineage(project, languageId).at(-1);
  const surface = allophoneCandidates(allophonyRules(language?.allophony || []));
  // Surface symbols join the tokenizer before categories are compiled, so a
  // category that names an uncharted allophone still reads it as one segment.
  return buildLanguageContext(project, languageId, surface);
}

export function compileAllophonyRule(notation, context) {
  const source = String(notation || "").trim();
  if (!source) return compileRule("", context);
  const normalized = normalizeAllophonyNotation(source);
  const result = compileRule(normalized, context);
  if (!result.ok) return result;
  return {
    ...result,
    rule: {
      ...result.rule,
      source,
      allophony: true,
    },
  };
}

export function compileAllophonyRules(rules, context) {
  return allophonyEntries(rules || []).map((entry) => {
    const rule = entry.rule;
    const result = compileAllophonyRule(rule.notation, context);
    const meta = {
      number: entry.number,
      group: entry.group,
      groupDisabled: entry.group?.enabled === false,
    };
    // Keep the stored rule (id, note, enabled) alongside the compiled target
    // and replacement. compileRule's successful result has its own `rule`
    // object, so merging in the stored fields is what preserves `enabled`.
    if (!result.ok) return { ...result, ...meta, rule };
    return { ...result, ...meta, rule: { ...result.rule, ...rule, source: rule.notation } };
  });
}

export function applyAllophony(tokens, compiledRules, context) {
  let current = [...tokens];
  const steps = [];
  const errors = [];
  (compiledRules || []).forEach((compiled, index) => {
    if (compiled.rule?.enabled === false || compiled.groupDisabled) return;
    const label = compiled.number || String(index + 1);
    if (!compiled.ok) {
      if (!compiled.empty) errors.push(compiled.error);
      steps.push({
        kind: "allophony-error",
        label,
        rule: compiled.rule || { notation: "" },
        compiled,
        error: compiled.error,
        before: [...current],
        after: [...current],
        changed: false,
      });
      return;
    }
    const result = applyRule(current, compiled.rule, context);
    steps.push({
      kind: "allophony",
      label,
      rule: compiled.rule,
      compiled,
      before: [...current],
      after: [...result.tokens],
      changed: result.changed,
    });
    current = result.tokens;
  });
  return { tokens: current, steps, errors, text: current.join("") };
}

// Surface form of a phonemic form in the current language. The input is the
// lexical/phonemic level; only this language's allophony (not its ancestors')
// applies.
export function surfaceForForm(form, project, languageId) {
  const context = contextForAllophony(project, languageId);
  const language = getLineage(project, languageId).at(-1);
  const compiled = compileAllophonyRules(language?.allophony || [], context);
  const input = context.tokenize(stripLevelMarks(form));
  const result = applyAllophony(input, compiled, context);
  return {
    ...result,
    input,
    context,
    compiled,
    language,
  };
}

// A flat table of phoneme → allophone rows derived from the rules. Rules are
// the source of truth; the table is a view, so it cannot drift from them.
export function allophoneTable(project, languageId) {
  const context = contextForAllophony(project, languageId);
  const language = getLineage(project, languageId).at(-1);
  const compiled = compileAllophonyRules(language?.allophony || [], context);
  const rows = [];
  const seen = new Set();
  compiled.forEach((entry, index) => {
    if (!entry.ok || entry.rule?.enabled === false || entry.groupDisabled) return;
    const phonemes = new Set();
    for (const atom of entry.rule.target || []) {
      if (atom.type === "literal") phonemes.add(atom.value);
      else if (atom.type === "class") {
        const values = atom.value === "V" ? context.vowels : context.consonants;
        for (const value of values) phonemes.add(value);
      } else if (atom.type === "set") {
        for (const value of atom.values) phonemes.add(value);
      }
    }
    const allophone = (entry.rule.replacement || []).join("") || "∅";
    for (const phoneme of phonemes) {
      const key = `${phoneme}\u0000${allophone}\u0000${entry.rule.environment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        phoneme,
        allophone,
        environment: entry.rule.environment || "",
        notation: entry.rule.source || entry.rule.notation || "",
        label: entry.number || String(index + 1),
      });
    }
  });
  return { rows, compiled, context, language };
}

function chunksOf(text) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "[") {
      const end = text.indexOf("]", index + 1);
      if (end === -1) {
        chunks.push(text.slice(index));
        break;
      }
      chunks.push(text.slice(index, end + 1));
      index = end + 1;
      continue;
    }
    if (char === "#") {
      chunks.push("#");
      index += 1;
      continue;
    }
    let end = index;
    while (end < text.length && !/\s/.test(text[end]) && text[end] !== "[" && text[end] !== "#") end += 1;
    if (end === index) end += 1;
    chunks.push(text.slice(index, end));
    index = end;
  }
  return chunks;
}

function tokenMatcher(pattern, token, context) {
  if (pattern.type === "literal") return token === pattern.value;
  if (pattern.type === "class") return pattern.value === "V" ? context.isVowel(token) : context.isConsonant(token);
  if (pattern.type === "set") {
    const included = pattern.values.includes(token);
    return pattern.negated ? !included : included;
  }
  return false;
}

// A custom category from the current language's Phonotactics tab. Valid
// categories expand to their members like a set; an invalid definition keeps
// its error so a rule that mentions it fails loudly instead of matching the
// literal letters.
function categoryForText(text, context) {
  const name = String(text || "");
  if (context.categories?.has(name)) {
    return { ok: true, source: name, members: context.categories.get(name) };
  }
  if (context.categoryErrors?.has(name)) {
    return { ok: false, source: name, error: context.categoryErrors.get(name) };
  }
  return null;
}

function parsePattern(text, context, options = {}) {
  const { allowBoundary = false, allowClass = true, allowSet = true, role = "pattern" } = options;
  const chunks = chunksOf(text);
  if (!chunks.length) return { ok: false, error: `The ${role} is empty.` };
  const pattern = [];

  // Set content reads as separated words: literal sounds, chart classes, or
  // sound sequences. `[u, o]`, `[^back]` and `[plosive.plain t]` all work.
  const setValues = (inner, negated) => {
    if (!inner.trim()) return { ok: false, error: "A bracketed set cannot be empty." };
    const values = [];
    const hadWords = [];
    for (const word of inner.split(/[\s,;]+/u)) {
      if (!word) continue;
      hadWords.push(word);
      const category = categoryForText(word, context);
      if (category && !category.ok) return category;
      if (category) {
        values.push(...category.members);
        continue;
      }
      const ref = classForText(word, context.classIndex);
      if (ref && !ref.ok) return ref;
      if (ref) {
        values.push(...ref.members);
        continue;
      }
      values.push(...context.tokenize(word));
    }
    if (!values.length) {
      return {
        ok: false,
        error: negated
          ? `The negated set matches no sounds (its chart labels select nothing here): ${hadWords.map((word) => `“${word}”`).join(", ")}.`
          : `The bracketed set matches no sounds: ${hadWords.map((word) => `“${word}”`).join(", ")}.`,
      };
    }
    return { ok: true, values };
  };

  for (const chunk of chunks) {
    if (chunk === "#") {
      if (!allowBoundary) return { ok: false, error: "A word boundary (#) is only valid in the environment." };
      pattern.push({ type: "boundary", value: "#" });
      continue;
    }
    if (chunk === "V" || chunk === "C") {
      if (!allowClass) return { ok: false, error: `The class “${chunk}” can only appear in the input or environment.` };
      pattern.push({ type: "class", value: chunk });
      continue;
    }
    if (chunk.startsWith("[") && chunk.endsWith("]")) {
      if (!allowSet) return { ok: false, error: "Bracketed sets cannot appear in the output. Use a concrete sound." };
      let inner = chunk.slice(1, -1);
      let negated = false;
      if (inner.startsWith("^")) {
        negated = true;
        inner = inner.slice(1);
      }
      const values = setValues(inner, negated);
      if (!values.ok) return { ok: false, error: values.error };
      pattern.push({ type: "set", values: values.values, negated });
      continue;
    }
    if (chunk.startsWith("\\") && chunk.length > 1) {
      // An escape keeps the rest of the chunk literal, so a name that
      // happens to match a chart label can still be written as sounds.
      const segments = context.tokenize(chunk.slice(1));
      for (const segment of segments) pattern.push({ type: "literal", value: segment });
      continue;
    }
    if (chunk.includes("[") || chunk.includes("]")) {
      return { ok: false, error: "Unclosed or misplaced bracket in the rule." };
    }
    const category = categoryForText(chunk, context);
    if (category) {
      if (!category.ok) return { ok: false, error: category.error };
      if (!allowSet) {
        return {
          ok: false,
          error: `The output needs concrete sounds: “${category.source}” is a category, and categories work only in the input and the environment.`,
        };
      }
      pattern.push({ type: "set", values: category.members, negated: false, fromCategory: category.source });
      continue;
    }
    const classRef = classForText(chunk, context.classIndex);
    if (classRef) {
      if (!classRef.ok) return { ok: false, error: classRef.error };
      if (!allowSet) {
        return {
          ok: false,
          error: `The output needs concrete sounds: “${classRef.source}” is a chart class, and class references work only in the input and the environment.`,
        };
      }
      pattern.push({ type: "set", values: classRef.members, negated: false, fromRef: classRef.source });
      continue;
    }
    const segments = context.tokenize(chunk);
    if (!segments.length) return { ok: false, error: `Could not read “${chunk}”.` };
    for (const segment of segments) pattern.push({ type: "literal", value: segment });
  }
  return { ok: true, pattern };
}

function matchTarget(tokens, start, pattern, context) {
  if (!pattern.length || start + pattern.length > tokens.length) return 0;
  for (let offset = 0; offset < pattern.length; offset += 1) {
    if (pattern[offset].type === "boundary") return 0;
    if (!tokenMatcher(pattern[offset], tokens[start + offset], context)) return 0;
  }
  return pattern.length;
}

function matchesLeft(tokens, index, pattern, context) {
  let cursor = index;
  for (let offset = pattern.length - 1; offset >= 0; offset -= 1) {
    const item = pattern[offset];
    if (item.type === "boundary") {
      if (cursor !== 0) return false;
      continue;
    }
    if (cursor <= 0) return false;
    if (!tokenMatcher(item, tokens[cursor - 1], context)) return false;
    cursor -= 1;
  }
  return true;
}

function matchesRight(tokens, index, pattern, context) {
  let cursor = index;
  for (const item of pattern) {
    if (item.type === "boundary") {
      if (cursor !== tokens.length) return false;
      continue;
    }
    if (cursor >= tokens.length) return false;
    if (!tokenMatcher(item, tokens[cursor], context)) return false;
    cursor += 1;
  }
  return true;
}

export function compileRule(notation, context) {
  const source = String(notation || "").trim();
  if (!source) return { ok: false, empty: true, error: "Empty rule." };
  const arrow = source.match(/→|->|>/);
  if (!arrow) return { ok: false, error: "Use “>” between the input and the output (for example p > f)." };
  const arrowIndex = arrow.index;
  const targetText = source.slice(0, arrowIndex).trim();
  const rightSide = source.slice(arrowIndex + arrow[0].length).trim();
  if (!targetText) return { ok: false, error: "The input side of the rule is empty." };

  let outputText = rightSide;
  let environment = null;
  const slashIndex = rightSide.indexOf("/");
  if (slashIndex !== -1) {
    outputText = rightSide.slice(0, slashIndex).trim();
    environment = rightSide.slice(slashIndex + 1).trim();
    if (!environment) return { ok: false, error: "The environment after “/” is empty." };
    if (!environment.includes("_")) {
      return { ok: false, error: "The environment needs an underscore, for example / V _ V." };
    }
    if ((environment.match(/_/g) || []).length > 1) {
      return { ok: false, error: "Use exactly one underscore to mark the focus of the change." };
    }
  }

  // ∅ (or 0) on the input side is an insertion: the rule adds the output at
  // a zero-width point in the environment instead of rewriting a segment.
  const isInsertion = targetText === "∅" || targetText === "0";
  const target = isInsertion ? { ok: true, pattern: [] } : parsePattern(targetText, context, { role: "input" });
  if (!target.ok) return target;

  let replacement = [];
  if (outputText && outputText !== "∅" && outputText !== "0") {
    const parsedOutput = parsePattern(outputText, context, { allowBoundary: false, allowClass: false, allowSet: false, role: "output" });
    if (!parsedOutput.ok) return parsedOutput;
    replacement = parsedOutput.pattern.map((item) => item.value);
  }

  let left = [];
  let right = [];
  if (environment) {
    const [leftText, rightText] = environment.split("_");
    if (leftText.trim()) {
      const parsedLeft = parsePattern(leftText, context, { allowBoundary: true, allowClass: true, role: "left environment" });
      if (!parsedLeft.ok) return parsedLeft;
      left = parsedLeft.pattern;
    }
    if (rightText.trim()) {
      const parsedRight = parsePattern(rightText, context, { allowBoundary: true, allowClass: true, role: "right environment" });
      if (!parsedRight.ok) return parsedRight;
      right = parsedRight.pattern;
    }
  }

  // A literal sound that no chart in the context lists can never match a
  // charted form, so the rule would sit valid-but-inert. Compact template
  // writing makes this easy to hit: "CV > x" reads here as the literal
  // sounds C and V, while phonotactics templates treat the same letters as
  // classes. Chart classes already fail loudly; literal inputs get a warning.
  const unchartedOf = (pattern) => {
    const found = new Set();
    for (const atom of pattern) {
      if (atom.type !== "literal") continue;
      if (!context.vowels.has(atom.value) && !context.consonants.has(atom.value)) found.add(atom.value);
    }
    return found;
  };
  const warnings = [];
  const unchartedInput = unchartedOf(target.pattern);
  const unchartedEnv = new Set([...unchartedOf(left), ...unchartedOf(right)]);
  if (unchartedInput.size) {
    const list = [...unchartedInput].map((sound) => `“${sound}”`).join(", ");
    let message = `The input ${unchartedInput.size === 1 ? "sound" : "sounds"} ${list} ${
      unchartedInput.size === 1 ? "is" : "are"
    } not in the charted ancestry, so the rule cannot match a charted form. Add ${
      unchartedInput.size === 1 ? "it" : "them"
    } to a Phonology chart, or check the spelling.`;
    if (unchartedInput.has("C") || unchartedInput.has("V")) {
      message += " Classes need spaces in rules (“C V > x”); compact class writing works only in phonotactics templates.";
    }
    warnings.push(message);
  } else if (unchartedEnv.size) {
    const list = [...unchartedEnv].map((sound) => `“${sound}”`).join(", ");
    warnings.push(
      `The environment ${unchartedEnv.size === 1 ? "sound" : "sounds"} ${list} ${
        unchartedEnv.size === 1 ? "is" : "are"
      } not in the charted ancestry, so the rule cannot apply to a charted form.`
    );
  }

  return {
    ok: true,
    warnings,
    rule: {
      source,
      target: target.pattern,
      replacement,
      left,
      right,
      environment: environment ? environment.trim() : "",
    },
  };
}

export function findRuleMatches(tokens, compiled, context) {
  const matches = [];
  // An empty target is an insertion. The match sits between two segments, so
  // the environment is checked at every boundary, including before the first
  // and after the last segment.
  if (!compiled.target.length) {
    for (let index = 0; index <= tokens.length; index += 1) {
      if (matchesLeft(tokens, index, compiled.left, context) && matchesRight(tokens, index, compiled.right, context)) {
        matches.push({ start: index, end: index, replacement: compiled.replacement });
      }
    }
    return matches;
  }
  let index = 0;
  while (index < tokens.length) {
    const length = matchTarget(tokens, index, compiled.target, context);
    if (
      length > 0 &&
      matchesLeft(tokens, index, compiled.left, context) &&
      matchesRight(tokens, index + length, compiled.right, context)
    ) {
      matches.push({ start: index, end: index + length, replacement: compiled.replacement });
      index += length;
    } else {
      index += 1;
    }
  }
  return matches;
}

export function applyRule(tokens, compiled, context) {
  const matches = findRuleMatches(tokens, compiled, context);
  if (!matches.length) return { tokens: [...tokens], changed: false };
  const output = [];
  let cursor = 0;
  for (const match of matches) {
    output.push(...tokens.slice(cursor, match.start), ...match.replacement);
    cursor = match.end;
  }
  output.push(...tokens.slice(cursor));
  return { tokens: output, changed: true };
}

export function compileRules(rules, context) {
  return rules.map((rule) => {
    const result = compileRule(rule.notation, context);
    return { rule, ...result };
  });
}

// Compile a language's rules into top-level groups and their sequential
// children. Labels are the display numbers (1, 1.1, 1.2, 2, ...).
export function compileRuleStages(rules, context) {
  const numbers = ruleNumberMap(rules);
  return ruleGroups(rules).map((group) => ({
    rule: group.rule,
    label: numbers.get(group.rule.id),
    compiled: compileRule(group.rule.notation, context),
    children: group.children.map((child) => ({
      rule: child,
      label: numbers.get(child.id),
      compiled: compileRule(child.notation, context),
    })),
  }));
}

export function compileRuleChain(project, languageId) {
  const context = contextForLanguage(project, languageId);
  const lineage = getLineage(project, languageId);
  const stages = lineage.map((language) => ({
    language,
    groups: compileRuleStages(language.soundChanges, context),
  }));
  return { context, stages, lineage };
}

// The cognate explorer derives one ancestor word in every language it reaches.
// The chain is the ordered set of rules on the path strictly below the source:
// the source's own rules are already baked into its recorded forms, and each
// later language applies its own rules to what it receives — the same
// convention the inherited check uses for a single step, extended down the
// tree. Languages outside the source's line of descent have no chain.
export function compileChainFrom(project, sourceId, targetId) {
  const lineage = getLineage(project, targetId);
  const sourceIndex = lineage.findIndex((language) => language.id === sourceId);
  if (sourceIndex === -1) {
    return { ok: false, reason: "not-descended", lineage, stages: [], context: null };
  }
  const context = contextForLanguage(project, targetId);
  const stages = lineage.slice(sourceIndex + 1).map((language) => ({
    language,
    groups: compileRuleStages(language.soundChanges, context),
  }));
  return { ok: true, reason: "", lineage, sourceIndex, stages, context };
}

// Top-level rules all match the frozen ancestral form. Their edits are
// combined in one pass, so the order of the list never changes which rules
// apply. Two top-level rules that touch the same part of the form are a
// conflict: the derivation stops with an error instead of guessing an order.
function applyParallel(tokens, groups, context) {
  const entries = groups.map((group) => ({
    group,
    matches: findRuleMatches(tokens, group.compiled.rule, context),
  }));
  const changes = [];
  for (const entry of entries) {
    for (const match of entry.matches) changes.push({ ...match, entry });
  }
  changes.sort((a, b) => a.start - b.start || a.end - b.end);

  let furthest = null;
  for (const change of changes) {
    if (furthest && change.start < furthest.end) {
      const a = furthest.entry.group;
      const b = change.entry.group;
      return {
        ok: false,
        error: `Rules ${a.label} (“${a.rule.notation}”) and ${b.label} (“${b.rule.notation}”) both change overlapping parts of the ancestral form “${tokens.join("")}”. Make one of them sequential or make the rules mutually exclusive.`,
      };
    }
    if (!furthest || change.end > furthest.end) furthest = change;
  }

  if (!changes.length) return { ok: true, tokens: [...tokens], changed: false, entries };
  const output = [];
  let cursor = 0;
  for (const change of changes) {
    output.push(...tokens.slice(cursor, change.start), ...change.replacement);
    cursor = change.end;
  }
  output.push(...tokens.slice(cursor));
  return { ok: true, tokens: output, changed: true, entries };
}

export function deriveStages(inputTokens, stages, context) {
  let current = [...inputTokens];
  const steps = [];
  const errors = [];
  let fatal = false;

  for (const stage of stages) {
    const languageName = stage.language?.name || "";
    const groups = (stage.groups || []).filter((group) => group.rule.enabled !== false);
    if (!groups.length) continue;

    // Broken rules are reported but do not prevent other rules from running.
    // Empty rules are unfinished, so they produce a step but no hard error.
    const usable = [];
    for (const group of groups) {
      if (group.compiled.ok) {
        usable.push(group);
        continue;
      }
      steps.push({
        kind: "error",
        label: group.label,
        rule: group.rule,
        compiled: group.compiled,
        error: group.compiled.error,
        before: [...current],
        after: [...current],
        changed: false,
        languageName,
      });
      if (!group.compiled.empty) errors.push(group.compiled.error);
    }

    const before = [...current];
    const parallel = applyParallel(current, usable, context);
    if (!parallel.ok) {
      steps.push({
        kind: "error",
        label: "anc",
        error: parallel.error,
        before,
        after: [...before],
        changed: false,
        languageName,
      });
      errors.push(parallel.error);
      fatal = true;
      break;
    }

    if (usable.length) {
      const matches = parallel.entries.reduce((total, entry) => total + entry.matches.length, 0);
      steps.push({
        kind: "parallel",
        label: "anc",
        before,
        after: [...parallel.tokens],
        changed: matches > 0,
        entries: parallel.entries.map((entry) => ({
          label: entry.group.label,
          notation: entry.group.rule.notation,
          matches: entry.matches.length,
        })),
        languageName,
      });
      current = parallel.tokens;
    }

    // Sequential children run after the whole ancestral pass, in display
    // order. They see the combined output of every top-level rule. A broken
    // parent is reported separately; it does not take its children down with
    // it, just as a broken flat rule never stopped the next rule.
    for (const group of groups) {
      for (const child of group.children) {
        if (child.rule.enabled === false) continue;
        if (!child.compiled.ok) {
          steps.push({
            kind: "error",
            label: child.label,
            rule: child.rule,
            compiled: child.compiled,
            error: child.compiled.error,
            before: [...current],
            after: [...current],
            changed: false,
            languageName,
          });
          if (!child.compiled.empty) errors.push(child.compiled.error);
          continue;
        }
        const result = applyRule(current, child.compiled.rule, context);
        steps.push({
          kind: "sequential",
          label: child.label,
          rule: child.rule,
          compiled: child.compiled,
          before: [...current],
          after: [...result.tokens],
          changed: result.changed,
          languageName,
        });
        current = result.tokens;
      }
    }
  }

  return { tokens: current, steps, errors, fatal };
}

export function deriveForm(form, project, languageId, options = {}) {
  const { directOnly = false } = options;
  const context = contextForLanguage(project, languageId);
  const lineage = getLineage(project, languageId);
  const languages = directOnly ? lineage.slice(-1) : lineage;
  const stages = languages.map((language) => ({
    language,
    groups: compileRuleStages(language.soundChanges, context),
  }));
  const tokens = context.tokenize(form);
  const derived = deriveStages(tokens, stages, context);
  return {
    input: tokens,
    output: derived.tokens,
    steps: derived.steps,
    errors: derived.errors,
    error: derived.errors[0] || "",
    fatal: derived.fatal,
    stages,
    context,
    text: derived.tokens.join(""),
  };
}

export function ruleCompileErrors(stages) {
  const errors = [];
  for (const stage of stages || []) {
    for (const group of stage.groups || []) {
      if (group.rule.enabled === false) continue;
      if (!group.compiled.ok && !group.compiled.empty) errors.push(group.compiled.error);
      for (const child of group.children || []) {
        if (child.rule.enabled === false) continue;
        if (!child.compiled.ok && !child.compiled.empty) errors.push(child.compiled.error);
      }
    }
  }
  return errors;
}

export function firstRuleError(compiledRules) {
  const broken = compiledRules.find((item) => !item.ok && !item.empty);
  return broken ? broken.error : "";
}

export { normalizeForm };
