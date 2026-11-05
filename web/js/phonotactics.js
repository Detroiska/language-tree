import { contextForInventory, normalizeForm } from "./phonology.js";
import { compileClasses } from "./categories.js";
import { classForText, parseClassRef, normalizeLabelKey } from "./naturalclasses.js";

// Categories are shared with the sound-change and allophony engines; the
// compiler lives in categories.js so both sides can import it without a cycle.
export { compileClasses, splitClassSounds } from "./categories.js";

// A syllable template is a small regular expression over sounds:
//   C, V        any charted consonant or vowel
//   N, G, L, …  a category defined for this language (nasals, glides, …)
//   p, t͡ʃ, ...  a literal sound
//   [ptk]       a set of literal sounds (categories work inside too: [Nt])
//   (...)       an optional group (the conventional syllable-template syntax)
//   a|b         alternatives inside a group
//   ?           optional, as in C?V
// Parentheses are optional by default so "(C)V(C)" reads naturally. The
// expansion is finite, which keeps matching deterministic and cheap.
const MAX_SHAPES = 256;
const MAX_SYLLABLE_LENGTH = 16;

const TEMPLATE_SYNTAX = new Set(["(", ")", "|", "?", "[", "]", "#", "*", "+"]);
const REPEAT_QUANTIFIERS = new Set(["*", "+"]);

class TemplateError extends Error {}

// A category used inside a pattern becomes a set atom so every matcher can
// treat categories, brackets, and sets uniformly.
function classAtom(name, classes) {
  const info = classes.map.get(name);
  if (!info) return { type: "literal", value: name };
  return { type: "set", values: info.values, fromClass: name };
}

// A chart-derived class reference turns into the same kind of atom.
function classAtomFromRef(ref) {
  return { type: "set", values: ref.members, fromRef: ref.source };
}

// Bracket content reads as a set of words: literal sounds, C or V, category
// letters, or chart classes, each contributing their members.
function expandSetValues(inner, context, classes) {
  const values = [];
  for (const word of String(inner).split(/[\s,;]+/u)) {
    if (!word) continue;
    if (word === "C") {
      values.push(...context.consonants);
      continue;
    }
    if (word === "V") {
      values.push(...context.vowels);
      continue;
    }
    const info = classes.map.get(word);
    if (info) {
      values.push(...info.values);
      continue;
    }
    const ref = classForText(word, context.classIndex);
    if (ref && !ref.ok) throw new TemplateError(ref.error);
    if (ref) {
      values.push(...ref.members);
      continue;
    }
    if (word.startsWith("\\") && word.length > 1) {
      values.push(...context.tokenize(word.slice(1)));
      continue;
    }
    values.push(...context.tokenize(word));
  }
  return [...new Set(values)];
}

// Separators between user-written pieces. Dots, dashes and middle dots are
// NOT separators: the tokenizer drops them inside words, and chart class
// references need them intact (`plosive.plain`, `dental-alveolar`).
function isSpace(char) {
  return /\s/.test(char) || char === "," || char === ";";
}

function atomSignature(atom) {
  if (atom.type === "class") return atom.value;
  if (atom.type === "literal") return `L:${atom.value}`;
  if (atom.type === "set") return `S:${atom.negated ? "^" : ""}${atom.values.join("\u0001")}`;
  return atom.type;
}

function displayAtom(atom) {
  if (atom.type === "class") return atom.value;
  if (atom.type === "literal") return atom.value;
  if (atom.type === "set") {
    if (atom.fromClass) return atom.negated ? `[^${atom.fromClass}]` : atom.fromClass;
    if (atom.fromRef) return atom.negated ? `[^${atom.fromRef}]` : `[${atom.fromRef}]`;
    return atom.negated ? `[^${atom.values.join("")}]` : `[${atom.values.join("")}]`;
  }
  return "";
}

function displayShape(atoms) {
  return atoms.map(displayAtom).join("");
}

function isNucleusAtom(atom, context) {
  if (atom.type === "class") return atom.value === "V";
  if (atom.type === "literal") return context.isVowel(atom.value);
  if (atom.type === "set") {
    // A negated set matches "everything else" — including vowels — so it
    // can never guarantee a nucleus.
    if (atom.negated) return false;
    return atom.values.length > 0 && atom.values.every((value) => context.isVowel(value));
  }
  return false;
}

function tokenMatchesAtom(atom, token, context) {
  if (atom.type === "class") return atom.value === "V" ? context.isVowel(token) : context.isConsonant(token);
  if (atom.type === "literal") return token === atom.value;
  if (atom.type === "set") {
    const included = atom.values.includes(token);
    return atom.negated ? !included : included;
  }
  return false;
}

// Split a run of literal text into class atoms (C/V, categories, chart
// classes) and literal phonemes. Splitting CVC without spaces is convenient
// for compact templates. Category letters win over literal interpretation
// (longest match first); `\X` writes a literal sound even when X is a
// category or a chart label.
//
// Chart classes join the same system: whole chunks ("back", "V.back") and
// prefixes inside compact writing ("velarV", "CV.back") both match. A
// dotted reference is strict — every label must exist in some chart — so a
// typo fails with a message instead of silently matching nothing.
function literalAtomsStrict(chunk, context, classes) {
  const names = classes?.names || [];
  const index = context.classIndex || null;
  const atoms = [];

  if (index) {
    const whole = classForText(chunk, index);
    if (whole && whole.ok) return { atoms: [classAtomFromRef(whole)] };
  }

  let literal = "";
  let error = null;
  const flush = () => {
    if (!literal) return;
    for (const token of context.tokenize(literal)) atoms.push({ type: "literal", value: token });
    literal = "";
  };
  const chars = Array.from(chunk);
  let position = 0;

  if (index && chunk.includes(".") && !chunk.includes("\\")) {
    // Dotted chunks read as one chart reference when the first part names a
    // chart label or a chart pin; then every label is checked strictly. When
    // the first part is something else — a category letter or compact C/V
    // writing — later parts may still open a reference, so the char loop
    // decides; other unknown first parts are typos and fail loud.
    const first = chunk.split(".")[0].trim();
    const firstKey = normalizeLabelKey(first);
    const isPin = ["v", "c", "vowel", "consonant"].includes(firstKey.replace(/-/gu, ""));
    const isLabel = !isPin && index.labelKeys.has(firstKey);
    if (isPin || isLabel) {
      const whole = classForText(chunk, index);
      if (whole && whole.ok) return { atoms: [classAtomFromRef(whole)] };
      return { error: whole ? whole.error : `The class reference “${chunk}” could not be read.` };
    }
    const isCompact = /^(?:[CV]|\p{N})+$/u.test(first) || (classes?.names || []).includes(first);
    if (!isCompact) {
      return { error: `Neither a chart label nor a category is named “${firstKey}” (from “${chunk}”).` };
    }
    // A compact head is followed by a chart reference: after the first dot,
    // `CV.back.short` or `T.velar` read the tail as one checked reference.
    const tail = chunk.slice(chunk.indexOf(".") + 1);
    const tailRef = parseClassRef(tail, index);
    if (tailRef && !tailRef.ok) return { error: tailRef.error };
    if (!tailRef) {
      // Tail text that is not a reference at all (no label, multi letters).
      const stray = tail.split(".").find((part) => {
        const key = normalizeLabelKey(part);
        return Array.from(key).length > 1 && !index.labelKeys.has(key);
      });
      if (stray) {
        return { error: `Neither a chart label nor a category is named “${normalizeLabelKey(stray)}” (from “${chunk}”).` };
      }
    }
  }

  while (position < chars.length && !error) {
    const char = chars[position];
    if (char === "\\" && chars[position + 1]) {
      flush();
      atoms.push({ type: "literal", value: chars[position + 1] });
      position += 2;
      continue;
    }
    if (char === "C" || char === "V") {
      // "V." / "C." opens a chart-pinned reference like V.back.
      if (chars[position + 1] === "." && index) {
        const rest = chars.slice(position).join("");
        const result = classForText(rest, index);
        if (result && result.ok) {
          flush();
          atoms.push(classAtomFromRef(result));
          position = chars.length;
          continue;
        }
        if (result && !result.ok) {
          error = result.error;
          break;
        }
      }
      flush();
      atoms.push({ type: "class", value: char });
      position += 1;
      continue;
    }
    if (char === "." && index) {
      // Everything from the first dot of the chunk onwards is one chart
      // reference, validated before the loop started.
      const rest = chars.slice(position + 1).join("");
      const ref = classForText(rest, index);
      if (ref && ref.ok) {
        flush();
        atoms.push(classAtomFromRef(ref));
        position = chars.length;
        continue;
      }
      if (ref && !ref.ok) {
        error = ref.error;
        break;
      }
    }
    const asClass = names.find((name) => {
      const span = Array.from(name).length;
      return span <= chars.length - position && chars.slice(position, position + span).join("") === name;
    });
    if (asClass) {
      flush();
      atoms.push(classAtom(asClass, classes));
      position += Array.from(asClass).length;
      continue;
    }
    const label = index?.sortedLabels.find((key) => {
      const span = Array.from(key).length;
      return span <= chars.length - position && chars.slice(position, position + span).join("") === key;
    });
    if (label) {
      const result = index ? classForText(label, index) : null;
      if (result && result.ok) {
        flush();
        atoms.push(classAtomFromRef(result));
        position += Array.from(label).length;
        continue;
      }
    }
    literal += char;
    position += 1;
  }

  if (error) return { error };
  flush();
  return { atoms };
}

class TemplateParser {
  constructor(source, context, classes) {
    this.source = String(source || "").normalize("NFC");
    this.context = context;
    this.classes = classes || { map: new Map(), names: [] };
    this.index = 0;
  }

  fail(message) {
    throw new TemplateError(message);
  }

  atEnd() {
    return this.index >= this.source.length;
  }

  peek() {
    return this.source[this.index] || "";
  }

  skip() {
    while (!this.atEnd() && isSpace(this.source[this.index])) this.index += 1;
  }

  parse() {
    const node = this.parseAlternation(false);
    this.skip();
    if (!this.atEnd()) this.fail(`Unexpected “${this.peek()}” in the template.`);
    return node;
  }

  parseAlternation(insideGroup) {
    const options = [this.parseSequence(insideGroup)];
    this.skip();
    while (this.peek() === "|") {
      this.index += 1;
      options.push(this.parseSequence(insideGroup));
      this.skip();
    }
    return options.length === 1 ? options[0] : { type: "alt", options };
  }

  parseSequence(insideGroup) {
    const items = [];
    while (true) {
      this.skip();
      if (this.atEnd()) break;
      const char = this.peek();
      if (char === ")") {
        if (insideGroup) break;
        this.fail("Unexpected “)” in the template.");
      }
      if (char === "|") break;
      items.push(this.parseItem());
    }
    if (!items.length) this.fail(insideGroup ? "A group cannot be empty." : "The template is empty.");
    return items.length === 1 ? items[0] : { type: "seq", items };
  }

  // A chart reference span starts at a C/V pin followed by a dot and runs
  // while the characters could belong to it: letters, digits, dashes, dots
  // and middle dots (any other punctuation in a written label is a break —
  // normalizeLabelKey reads it as one anyway).
  referenceEnd(start) {
    const REFERENCE_CHAR = /[\p{L}\p{N}.\-·]/u;
    let end = start;
    while (end < this.source.length && REFERENCE_CHAR.test(this.source[end])) end += 1;
    return end;
  }

  parseItem() {
    this.skip();
    const char = this.peek();
    let node;
    if (char === "(") {
      this.index += 1;
      const inner = this.parseAlternation(true);
      this.skip();
      if (this.peek() !== ")") this.fail("A “(” in the template is not closed.");
      this.index += 1;
      node = { type: "optional", item: inner };
    } else if (char === "[") {
      const close = this.source.indexOf("]", this.index + 1);
      if (close === -1) this.fail("A “[” in the template is not closed.");
      let inner = this.source.slice(this.index + 1, close).trim();
      if (!inner) this.fail("A bracketed set cannot be empty.");
      let negated = false;
      if (inner.startsWith("^")) {
        negated = true;
        inner = inner.slice(1).trim();
        if (!inner) this.fail("A negated set cannot be empty.");
      }
      const values = expandSetValues(inner, this.context, this.classes);
      if (!values.length) this.fail(`Could not read the set “[${inner}]”.`);
      node = { type: "set", values, negated };
      this.index = close + 1;
    } else if (char === "C" || char === "V") {
      // A dot straight after opens a pinned chart reference (V.back, …).
      const next = this.source[this.index + 1];
      if (next === "." && this.context.classIndex) {
        const end = this.referenceEnd(this.index);
        const refText = this.source.slice(this.index, end);
        const result = classForText(refText, this.context.classIndex);
        if (result && result.ok) {
          this.index = end;
          node = classAtomFromRef(result);
        } else {
          this.fail(result ? result.error : `Could not read “${refText}” in the template.`);
        }
      } else {
        node = { type: "class", value: char };
        this.index += 1;
      }
    } else if (char === "#") {
      this.fail("Word boundaries (#) belong in forbidden sequences, not in a syllable template.");
    } else if (REPEAT_QUANTIFIERS.has(char)) {
      this.fail("Repeat quantifiers (* and +) are not supported in syllable templates. Write the element out.");
    } else if (char === ")" || char === "]" || char === "|" || char === "?") {
      this.fail(`Unexpected “${char}” in the template.`);
    } else {
      const start = this.index;
      while (!this.atEnd() && !isSpace(this.source[this.index]) && !TEMPLATE_SYNTAX.has(this.source[this.index])) {
        this.index += 1;
      }
      const chunk = this.source.slice(start, this.index);
      const parsed = literalAtomsStrict(chunk, this.context, this.classes);
      if (parsed.error) this.fail(parsed.error);
      if (!parsed.atoms.length) this.fail(`Could not read “${chunk}” in the template.`);
      node = parsed.atoms.length === 1 ? parsed.atoms[0] : { type: "seq", items: parsed.atoms };
    }

    this.skip();
    if (this.peek() === "?") {
      this.index += 1;
      node = { type: "optional", item: node };
    }
    return node;
  }
}

function capShapes(shapes) {
  if (shapes.length > MAX_SHAPES) {
    throw new TemplateError(`This template expands to more than ${MAX_SHAPES} syllable shapes. Simplify its optional parts.`);
  }
  return shapes;
}

function expandNode(node) {
  if (node.type === "class" || node.type === "literal" || node.type === "set") return [[node]];
  if (node.type === "optional") return capShapes([[], ...expandNode(node.item)]);
  if (node.type === "alt") return capShapes(node.options.flatMap((option) => expandNode(option)));
  if (node.type !== "seq") return [];

  let results = [[]];
  for (const item of node.items) {
    const child = expandNode(item);
    const next = [];
    for (const left of results) {
      for (const right of child) {
        next.push([...left, ...right]);
        if (next.length > MAX_SHAPES) {
          throw new TemplateError(`This template expands to more than ${MAX_SHAPES} syllable shapes. Simplify its optional parts.`);
        }
      }
    }
    results = next;
  }
  return results;
}

function compileTemplate(source, context, classes) {
  const parser = new TemplateParser(source, context, classes);
  const ast = parser.parse();
  const rawShapes = expandNode(ast);
  const seen = new Set();
  const shapes = [];
  const unknownSounds = new Set();
  const emptyClasses = new Set();
  let withoutNucleus = [];
  const dropped = [];

  for (const atoms of rawShapes) {
    if (!atoms.length) continue;
    if (atoms.length > MAX_SYLLABLE_LENGTH) {
      return { ok: false, error: `A syllable can contain at most ${MAX_SYLLABLE_LENGTH} sounds.` };
    }
    const signature = atoms.map(atomSignature).join(" ");
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const atom of atoms) {
      if (atom.type === "literal" && !context.vowels.has(atom.value) && !context.consonants.has(atom.value)) {
        unknownSounds.add(atom.value);
      }
      if (atom.type === "set") {
        if (!atom.values.length) {
          emptyClasses.add(atom.fromRef || atom.fromClass || "a bracketed set");
          continue;
        }
        const info = atom.fromClass ? classes.map.get(atom.fromClass) : null;
        for (const value of atom.values) {
          if (info && info.values.includes(value)) continue; // members warned by the category itself
          if (!context.vowels.has(value) && !context.consonants.has(value)) unknownSounds.add(value);
        }
      }
    }
    if (!atoms.some((atom) => isNucleusAtom(atom, context))) {
      withoutNucleus.push({ atoms, signature });
      dropped.push(displayShape(atoms));
      continue;
    }
    shapes.push({ atoms, signature, display: displayShape(atoms) });
  }

  if (!shapes.length) {
    return {
      ok: false,
      error: withoutNucleus
        ? "Every syllable shape needs a vowel. Use V, a vowel sound, or a category whose members are all vowels."
        : "The template does not define a syllable.",
    };
  }

  shapes.sort((a, b) => a.atoms.length - b.atoms.length || a.display.localeCompare(b.display));
  const warnings = [];
  if (withoutNucleus.length) {
    const list = dropped.map((display) => `“${display}”`).join(", ");
    warnings.push(
      `${withoutNucleus.length} ${withoutNucleus.length === 1 ? "shape has" : "shapes have"} no vowel and ${withoutNucleus.length === 1 ? "was" : "were"} ignored: ${list}. Mixed sets (like a glide+vowel category) cannot fill a nucleus slot.`
    );
  }
  if (unknownSounds.size) {
    warnings.push(`The template uses ${[...unknownSounds].map((sound) => `“${sound}”`).join(", ")}, which ${unknownSounds.size === 1 ? "is" : "are"} not in the chart.`);
    const stray = [...unknownSounds].filter((sound) => /^[A-Z]$/.test(sound) && !classes.names.includes(sound));
    if (stray.length) {
      warnings.push(
        `Capital letters count as literal sounds until you define them as categories — ${stray
          .map((letter) => `“${letter}”`)
          .join(", ")} is read literally.`
      );
    }
  }
  if (emptyClasses.size) {
    warnings.push(
      `${[...emptyClasses].map((name) => `“${name}”`).join(", ")} ${emptyClasses.size === 1 ? "matches" : "match"} no sounds right now — check that the chart labels still exist.`
    );
  }
  return { ok: true, shapes, warnings };
}

function splitList(value) {
  return String(value || "")
    .split(/[\n,;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseClusterList(value, context) {
  const allowed = new Map();
  for (const item of String(value || "").split(/[\s,;]+/u)) {
    const trimmed = item.trim();
    if (!trimmed || trimmed === "∅" || trimmed === "-") continue;
    const tokens = context.tokenize(trimmed);
    if (!tokens.length) continue;
    const key = tokens.join("");
    if (!allowed.has(key)) allowed.set(key, trimmed);
  }
  return allowed;
}

function parseConstraintPattern(source, context, classes) {
  const text = String(source || "").normalize("NFC");
  const atoms = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (isSpace(char)) {
      index += 1;
      continue;
    }
    if (char === "#") {
      atoms.push({ type: "boundary" });
      index += 1;
      continue;
    }
    if (char === "[") {
      const close = text.indexOf("]", index + 1);
      if (close === -1) return { ok: false, error: "A “[” is not closed." };
      let inner = text.slice(index + 1, close).trim();
      if (!inner) return { ok: false, error: "A bracketed set cannot be empty." };
      let negated = false;
      if (inner.startsWith("^")) {
        negated = true;
        inner = inner.slice(1).trim();
        if (!inner) return { ok: false, error: "A negated set cannot be empty." };
      }
      // A broken chart class inside a set throws TemplateError. The template
      // compiler catches it, but the forbidden-sequence loop in
      // compilePhonotactics runs before its try/catch — an escape would take
      // the whole view down, so a typo must land in constraintErrors instead.
      let values;
      try {
        values = expandSetValues(inner, context, classes);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof TemplateError ? error.message : `Could not read the set “[${inner}]”.`,
        };
      }
      if (!values.length) return { ok: false, error: `Could not read the set “[${inner}]”.` };
      atoms.push({ type: "set", values, negated });
      index = close + 1;
      continue;
    }
    if (TEMPLATE_SYNTAX.has(char)) {
      if (char === "#") continue;
      return {
        ok: false,
        error:
          REPEAT_QUANTIFIERS.has(char) || char === "?" || char === "(" || char === ")"
            ? "Use a fixed sequence in a forbidden pattern; optional groups and quantifiers are not supported."
            : `Unexpected “${char}” in a forbidden pattern.`,
      };
    }

    let end = index;
    while (end < text.length && !isSpace(text[end]) && !TEMPLATE_SYNTAX.has(text[end]) && text[end] !== "[") end += 1;
    const chunk = text.slice(index, end);
    const parsed = literalAtomsStrict(chunk, context, classes);
    if (parsed.error) return { ok: false, error: parsed.error };
    if (!parsed.atoms.length) return { ok: false, error: `Could not read “${chunk}”.` };
    atoms.push(...parsed.atoms);
    index = end;
  }

  let leading = false;
  let trailing = false;
  if (atoms[0]?.type === "boundary") {
    leading = true;
    atoms.shift();
  }
  if (atoms[atoms.length - 1]?.type === "boundary") {
    trailing = true;
    atoms.pop();
  }
  if (atoms.some((atom) => atom.type === "boundary")) {
    return { ok: false, error: "A boundary (#) can only appear at the start or end of a forbidden pattern." };
  }
  if (!atoms.length) return { ok: false, error: "A forbidden pattern needs at least one sound." };
  return { ok: true, source: text.trim(), body: atoms, leading, trailing };
}

function matchSyllableAt(tokens, start, shapes, context) {
  const matches = [];
  for (const shape of shapes) {
    const end = start + shape.atoms.length;
    if (end > tokens.length) continue;
    let ok = true;
    for (let offset = 0; offset < shape.atoms.length; offset += 1) {
      if (!tokenMatchesAtom(shape.atoms[offset], tokens[start + offset], context)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const atoms = shape.atoms.map((atom, offset) => ({
      atom,
      token: tokens[start + offset],
      nucleus: isNucleusAtom(atom, context),
    }));
    const nuclei = atoms.map((item, offset) => (item.nucleus ? offset : -1)).filter((offset) => offset >= 0);
    if (!nuclei.length) continue;
    const firstNucleus = nuclei[0];
    const lastNucleus = nuclei[nuclei.length - 1];
    matches.push({
      start,
      end,
      shape,
      tokens: tokens.slice(start, end),
      onset: atoms.slice(0, firstNucleus).map((item) => item.token),
      nucleus: atoms.slice(firstNucleus, lastNucleus + 1).map((item) => item.token),
      coda: atoms.slice(lastNucleus + 1).map((item) => item.token),
      onsetLength: firstNucleus,
      codaLength: atoms.length - lastNucleus - 1,
    });
  }
  return matches;
}

function preferMatch(a, b) {
  // Maximal onset: a consonant between vowels belongs to the following
  // syllable, so prefer the analysis with the shortest coda.
  if (a.codaLength !== b.codaLength) return a.codaLength - b.codaLength;
  return a.end - b.end;
}

function syllabify(tokens, shapes, context) {
  const length = tokens.length;
  const matchesAt = new Array(length);
  const canFinish = new Array(length + 1).fill(false);
  canFinish[length] = true;

  for (let index = length - 1; index >= 0; index -= 1) {
    matchesAt[index] = matchSyllableAt(tokens, index, shapes, context);
    canFinish[index] = matchesAt[index].some((match) => canFinish[match.end]);
  }

  if (!canFinish[0]) {
    const reachable = new Set([0]);
    const queue = [0];
    let furthest = 0;
    while (queue.length) {
      const position = queue.shift();
      furthest = Math.max(furthest, position);
      for (const match of matchesAt[position] || []) {
        if (!reachable.has(match.end)) {
          reachable.add(match.end);
          queue.push(match.end);
        }
      }
    }

    const partial = [];
    let position = 0;
    while (position < furthest) {
      const options = (matchesAt[position] || [])
        .filter((match) => reachable.has(match.end))
        .sort((a, b) => b.end - a.end || preferMatch(a, b));
      if (!options.length) break;
      partial.push(options[0]);
      position = options[0].end;
    }
    const partialText = partial.map((syllable) => syllable.tokens.join("")).join(".");
    const rest = tokens.slice(furthest).join("");
    const error =
      furthest === 0
        ? "The form does not begin with a valid syllable."
        : rest
          ? `Syllabification stops before “${rest}”. ${partialText ? `It parses as far as ${partialText}.` : ""}`.trim()
          : "The form cannot be divided into valid syllables.";
    return { ok: false, error, partial, partialText, furthest };
  }

  const syllables = [];
  let position = 0;
  while (position < length) {
    const options = matchesAt[position].filter((match) => canFinish[match.end]).sort(preferMatch);
    const chosen = options[0];
    syllables.push(chosen);
    position = chosen.end;
  }
  return {
    ok: true,
    syllables,
    text: syllables.map((syllable) => syllable.tokens.join("")).join("."),
  };
}

function findForbidden(pattern, tokens, context) {
  const starts = pattern.leading ? [0] : Array.from({ length: tokens.length + 1 }, (_, index) => index);
  for (const start of starts) {
    let position = start;
    let ok = true;
    for (const atom of pattern.body) {
      if (position >= tokens.length || !tokenMatchesAtom(atom, tokens[position], context)) {
        ok = false;
        break;
      }
      position += 1;
    }
    if (!ok) continue;
    if (pattern.trailing && position !== tokens.length) continue;
    return { start, end: position, text: tokens.slice(start, position).join("") };
  }
  return null;
}

export function compilePhonotactics(phonotactics, context) {
  const source = typeof phonotactics?.template === "string" ? phonotactics.template.trim() : "";
  const classes = compileClasses(phonotactics?.classes, context);
  const result = {
    ok: false,
    empty: false,
    error: "",
    warnings: [],
    shapes: [],
    classes,
    onsetsMode: phonotactics?.onsetsMode === "forbidden" ? "forbidden" : "allowed",
    codasMode: phonotactics?.codasMode === "forbidden" ? "forbidden" : "allowed",
    onsets: parseClusterList(phonotactics?.onsets, context),
    codas: parseClusterList(phonotactics?.codas, context),
    forbiddenOnsets: parseClusterList(phonotactics?.forbiddenOnsets, context),
    forbiddenCodas: parseClusterList(phonotactics?.forbiddenCodas, context),
    forbidden: [],
    constraintErrors: [],
  };

  for (const raw of splitList(phonotactics?.forbidden)) {
    const pattern = parseConstraintPattern(raw, context, classes);
    if (pattern.ok) result.forbidden.push(pattern);
    else result.constraintErrors.push(`“${raw}”: ${pattern.error}`);
  }

  if (!source) {
    result.empty = true;
    return result;
  }

  try {
    const compiled = compileTemplate(source, context, classes);
    if (!compiled.ok) {
      result.error = compiled.error;
      return result;
    }
    result.ok = true;
    result.shapes = compiled.shapes;
    result.warnings = compiled.warnings;
  } catch (error) {
    result.error = error instanceof TemplateError ? error.message : "Could not read the syllable template.";
  }
  return result;
}

export function validateWord(form, compiled, context) {
  const normalized = normalizeForm(form);
  const text = normalized.trim();
  const result = {
    form: normalized,
    text,
    tokens: [],
    unknown: [],
    issues: [],
    syllables: [],
    syllableText: "",
    checked: false,
    ok: false,
    empty: !text,
    templateEmpty: Boolean(compiled?.empty),
    templateError: compiled?.error || "",
    partialText: "",
  };
  if (!text) {
    result.ok = true;
    return result;
  }

  const tokens = context.tokenize(text);
  result.tokens = tokens;

  const unknown = new Set();
  for (const token of tokens) {
    if (!context.vowels.has(token) && !context.consonants.has(token)) unknown.add(token);
  }
  result.unknown = [...unknown];
  for (const token of unknown) {
    result.issues.push({ type: "unknown", message: `Unknown sound “${token}” is not in the charted inventory.` });
  }

  if (!compiled || !compiled.ok) {
    result.checked = false;
    result.ok = false;
    return result;
  }

  result.checked = true;
  const parse = syllabify(tokens, compiled.shapes, context);
  result.parse = parse;
  if (parse.ok) {
    result.syllables = parse.syllables;
    result.syllableText = parse.text;
  } else {
    result.partialText = parse.partialText || "";
    result.issues.push({ type: "syllable", message: parse.error });
  }

  if (parse.ok) {
    for (const syllable of parse.syllables) {
      if (syllable.onset.length) {
        const onset = syllable.onset.join("");
        if (compiled.onsetsMode === "forbidden") {
          if (compiled.forbiddenOnsets.has(onset)) {
            result.issues.push({ type: "onset", message: `Onset “${onset}” is forbidden.` });
          }
        } else if (compiled.onsets.size && !compiled.onsets.has(onset)) {
          result.issues.push({ type: "onset", message: `Onset “${onset}” is not in the allowed onsets.` });
        }
      }
      if (syllable.coda.length) {
        const coda = syllable.coda.join("");
        if (compiled.codasMode === "forbidden") {
          if (compiled.forbiddenCodas.has(coda)) {
            result.issues.push({ type: "coda", message: `Coda “${coda}” is forbidden.` });
          }
        } else if (compiled.codas.size && !compiled.codas.has(coda)) {
          result.issues.push({ type: "coda", message: `Coda “${coda}” is not in the allowed codas.` });
        }
      }
    }
    for (const pattern of compiled.forbidden) {
      const match = findForbidden(pattern, tokens, context);
      if (match) {
        result.issues.push({
          type: "forbidden",
          message: `Forbidden sequence ${pattern.source} appears as “${match.text || "∅"}”.`,
        });
      }
    }
  }

  result.ok = result.issues.length === 0;
  return result;
}

// One compiled checker can validate many forms: the inventory and
// phonotactics are fixed until the next render.
export function createPhonotacticsChecker(language) {
  const context = contextForInventory(language.inventory);
  const compiled = compilePhonotactics(language.phonotactics || {}, context);
  return {
    context,
    compiled,
    validate(form) {
      return validateWord(form, compiled, context);
    },
  };
}
