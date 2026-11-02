import { chartPhonemeList, getLineage } from "./model.js";

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
  constructor({ known = [], vowels = [], consonants = [] } = {}) {
    this.vowels = new Set(vowels);
    this.consonants = new Set(consonants);
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
  return new SegmentContext({ known: [...known], vowels: [...vowels], consonants: [...consonants] });
}

// Rule application reads the whole lineage because an ancestral sound may
// still be a valid environment in a later language. Phonotactic checks are
// about the language's own synchronic inventory, so they use this narrower
// context instead.
export function contextForLanguage(project, languageId) {
  const lineage = getLineage(project, languageId);
  const known = new Set();
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
  return new SegmentContext({ known: [...known], vowels: [...vowels], consonants: [...consonants] });
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

function parsePattern(text, context, options = {}) {
  const { allowBoundary = false, allowClass = true, allowSet = true, role = "pattern" } = options;
  const chunks = chunksOf(text);
  if (!chunks.length) return { ok: false, error: `The ${role} is empty.` };
  const pattern = [];
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
      const values = context.tokenize(inner);
      if (!values.length) return { ok: false, error: "A bracketed set cannot be empty." };
      pattern.push({ type: "set", values, negated });
      continue;
    }
    if (chunk.includes("[") || chunk.includes("]")) {
      return { ok: false, error: "Unclosed or misplaced bracket in the rule." };
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

  const target = parsePattern(targetText, context, { role: "input" });
  if (!target.ok) return target;
  if (targetText === "∅" || targetText === "0") {
    return { ok: false, error: "The input cannot be ∅. Put the sound being changed before “>”." };
  }

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

  return {
    ok: true,
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

export function applyRule(tokens, compiled, context) {
  const output = [];
  let index = 0;
  let changed = false;
  while (index < tokens.length) {
    const length = matchTarget(tokens, index, compiled.target, context);
    if (
      length > 0 &&
      matchesLeft(tokens, index, compiled.left, context) &&
      matchesRight(tokens, index + length, compiled.right, context)
    ) {
      output.push(...compiled.replacement);
      index += length;
      changed = true;
    } else {
      output.push(tokens[index]);
      index += 1;
    }
  }
  return { tokens: output, changed };
}

export function compileRules(rules, context) {
  return rules.map((rule) => {
    const result = compileRule(rule.notation, context);
    return { rule, ...result };
  });
}

export function compileRuleChain(project, languageId) {
  const context = contextForLanguage(project, languageId);
  const lineage = getLineage(project, languageId);
  const compiled = [];
  for (const sourceLanguage of lineage) {
    for (const rule of sourceLanguage.soundChanges) {
      if (rule.enabled === false) continue;
      const result = compileRule(rule.notation, context);
      compiled.push({ ...result, sourceRule: rule, sourceLanguage });
    }
  }
  return { context, compiled, lineage };
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
    return { ok: false, reason: "not-descended", lineage, compiled: [], context: null };
  }
  const context = contextForLanguage(project, targetId);
  const compiled = [];
  for (const sourceLanguage of lineage.slice(sourceIndex + 1)) {
    for (const rule of sourceLanguage.soundChanges) {
      if (rule.enabled === false) continue;
      const result = compileRule(rule.notation, context);
      compiled.push({ ...result, sourceRule: rule, sourceLanguage });
    }
  }
  return { ok: true, reason: "", lineage, sourceIndex, compiled, context };
}

export function deriveTokens(inputTokens, compiledRules, context) {
  let current = [...inputTokens];
  const steps = [];
  for (const compiled of compiledRules) {
    if (!compiled.ok) {
      steps.push({ compiled, before: current, after: current, changed: false, error: compiled.error });
      continue;
    }
    const result = applyRule(current, compiled.rule, context);
    steps.push({ compiled, before: current, after: result.tokens, changed: result.changed });
    current = result.tokens;
  }
  return { tokens: current, steps };
}

export function deriveForm(form, project, languageId, options = {}) {
  const { directOnly = false } = options;
  const context = contextForLanguage(project, languageId);
  const lineage = getLineage(project, languageId);
  const languages = directOnly ? lineage.slice(-1) : lineage;
  const compiled = [];
  for (const sourceLanguage of languages) {
    for (const rule of sourceLanguage.soundChanges) {
      if (rule.enabled === false) continue;
      const result = compileRule(rule.notation, context);
      compiled.push({ ...result, sourceRule: rule, sourceLanguage });
    }
  }
  const tokens = context.tokenize(form);
  const derived = deriveTokens(tokens, compiled, context);
  return {
    input: tokens,
    output: derived.tokens,
    steps: derived.steps,
    compiled,
    context,
    text: derived.tokens.join(""),
  };
}

export function firstRuleError(compiledRules) {
  const broken = compiledRules.find((item) => !item.ok && !item.empty);
  return broken ? broken.error : "";
}

export { normalizeForm };
