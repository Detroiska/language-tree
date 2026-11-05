import { classForText } from "./naturalclasses.js";
import { classifyFeatureWords, featureMembers } from "./features.js";

// Custom sound categories are named sound groups defined per language:
// N = nasals, G = glides, OBS = obstruents, … They are authored in the
// Phonotactics tab and shared by phonotactics templates, sound changes, and
// allophony. Keeping the compiler here (rather than in phonotactics.js) lets
// the two engines use the same definitions without a circular import.
//
// A bracket groups a feature bundle across spaces, so
// `S = [+sonorant -syllabic]` is one item, not two broken ones.
export function splitClassSounds(text) {
  const source = String(text || "");
  const items = [];
  let current = "";
  let depth = 0;
  for (const char of source) {
    if (char === "[") depth += 1;
    if (char === "]" && depth > 0) depth -= 1;
    if (depth === 0 && /[\s,;]/u.test(char)) {
      if (current.trim()) items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function featureWords(item) {
  const source = String(item || "").trim();
  const inner = source.startsWith("[") && source.endsWith("]") ? source.slice(1, -1) : source;
  return inner.split(/[\s,;]+/u).filter(Boolean);
}

export function compileClasses(rawEntries, context) {
  const entries = (Array.isArray(rawEntries) ? rawEntries : []).map((entry) => {
    const compiled = {
      name: typeof entry?.name === "string" ? entry.name.trim() : "",
      sounds: typeof entry?.sounds === "string" ? entry.sounds : "",
      values: [],
      notCharted: new Set(),
      allVowels: false,
      errors: [],
      warnings: [],
      resolved: false,
    };
    if (!compiled.name) compiled.errors.push("The category has no name yet.");
    else if (!/^[A-Z]{1,6}$/u.test(compiled.name)) {
      compiled.errors.push("Category names are 1–6 capital letters (like N, LIQ or OBS).");
    } else if (compiled.name === "C" || compiled.name === "V") {
      compiled.errors.push("C and V are built in: C is any charted consonant, V any charted vowel.");
    }
    return compiled;
  });

  const byName = new Map();
  for (const entry of entries) {
    if (entry.errors.length || !entry.name) continue;
    if (byName.has(entry.name)) {
      // A duplicate row is inert: it may not override the definition above
      // it, and references resolve to the first occurrence.
      entry.errors.push(`The name “${entry.name}” is already used by another category.`);
      continue;
    }
    byName.set(entry.name, entry);
  }

  const resolve = (entry, visiting) => {
    if (visiting.has(entry.name)) {
      entry.errors.push("A category cannot include itself, directly or indirectly.");
      entry.resolved = true;
      entry.values = [];
      return;
    }
    if (entry.resolved) return;
    entry.resolved = true;
    const next = new Set(visiting);
    next.add(entry.name);
    const values = [];
    const notCharted = new Set();
    for (const item of splitClassSounds(entry.sounds)) {
      if (item === "C") {
        values.push(...context.consonants);
        continue;
      }
      if (item === "V") {
        values.push(...context.vowels);
        continue;
      }
      const other = byName.get(item);
      if (other) {
        resolve(other, next);
        values.push(...other.values);
        continue;
      }
      const classRef = classForText(item, context.classIndex);
      if (classRef && !classRef.ok) {
        entry.errors.push(classRef.error);
        continue;
      }
      if (classRef) {
        // A chart-derived reference: its members come straight from the
        // phonology table and update with it.
        values.push(...classRef.members);
        continue;
      }
      // Feature bundles come last in the documented precedence. Bare words
      // that name a category or chart class were already handled above, so
      // `[back]` keeps its chart meaning and `[+back]` forces the feature.
      const feature = classifyFeatureWords(featureWords(item), {
        allowBare: true,
        allowVariables: false,
        isReserved: (word) =>
          word === "C" ||
          word === "V" ||
          byName.has(word) ||
          Boolean(classForText(word, context.classIndex)),
      });
      if (feature.kind === "error") {
        entry.errors.push(feature.error);
        continue;
      }
      if (feature.kind === "feature") {
        const members = featureMembers(context.featurePhonemes || [], context.features, feature.terms);
        if (!members.length) {
          entry.errors.push(`The feature bundle ${feature.source} matches no sounds in the charted ancestry.`);
          continue;
        }
        values.push(...members);
        continue;
      }
      if (/^[A-Z]{1,6}$/u.test(item)) {
        entry.warnings.push(`“${item}” is not a defined category letter here; it is read as a literal sound.`);
      }
      for (const token of context.tokenize(item)) {
        values.push(token);
        if (!context.vowels.has(token) && !context.consonants.has(token)) notCharted.add(token);
      }
    }
    entry.values = [...new Set(values)];
    entry.notCharted = notCharted;
    entry.allVowels = entry.values.length > 0 && entry.values.every((value) => context.isVowel(value));
    if (!entry.values.length && !entry.errors.length) entry.errors.push("The category has no sounds yet.");
    if (notCharted.size) {
      entry.warnings.push(`Not in the chart: ${[...notCharted].map((sound) => `“${sound}”`).join(", ")}.`);
    }
  };

  for (const entry of byName.values()) resolve(entry, new Set());

  const map = new Map();
  for (const entry of byName.values()) {
    if (!entry.errors.length) map.set(entry.name, entry);
  }
  const names = [...map.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return { entries, map, names };
}
