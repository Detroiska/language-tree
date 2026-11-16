// Lexicon metadata: optional per-word fields layered around `gloss`, which
// stays the canonical cross-language key for derivation, cognates and reports.
// This module is DOM-free so the model, report builder, importer and views can
// share the same defaults and normalization rules.

const STRING_FIELDS = ["pos", "status", "source", "etymology"];
const LIST_FIELDS = ["senses", "tags"];

// Report columns, in display order. A column is emitted only when at least one
// word actually carries a value, so projects that predate metadata keep an
// unchanged report.
const COLUMNS = [
  ["pos", "POS"],
  ["senses", "Senses"],
  ["tags", "Tags"],
  ["status", "Status"],
  ["source", "Source"],
  ["etymology", "Etymology"],
];

function stringValue(value) {
  return String(value ?? "").trim();
}

function listValue(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

// Normalize only fields that are present. Loading an older document must not
// add new keys to thousands of words: the tracked demo is pinned byte-identical
// through ensureProject(). Fields absent on disk simply read as empty here.
export function normalizeWordMeta(word) {
  if (!word || typeof word !== "object" || Array.isArray(word)) return {};
  const normalized = { ...word };
  for (const field of STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = stringValue(normalized[field]);
    }
  }
  for (const field of LIST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = listValue(normalized[field]);
    }
  }
  return normalized;
}

export function hasMetaValue(word, field) {
  if (!word || typeof word !== "object") return false;
  const value = word[field];
  if (LIST_FIELDS.includes(field)) {
    return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim());
  }
  return Boolean(stringValue(value));
}

// All metadata text for the quick-search and lexicon-filter haystacks.
export function wordMetaText(word) {
  if (!word || typeof word !== "object") return "";
  const parts = [];
  for (const field of STRING_FIELDS) {
    const value = stringValue(word[field]);
    if (value) parts.push(value);
  }
  for (const field of LIST_FIELDS) {
    if (Array.isArray(word[field])) {
      parts.push(...word[field].filter((item) => typeof item === "string" && item.trim()));
    }
  }
  return parts.join(" ");
}

export function lexiconColumns(words) {
  const used = new Set();
  for (const word of Array.isArray(words) ? words : []) {
    for (const [field] of COLUMNS) {
      if (hasMetaValue(word, field)) used.add(field);
    }
  }
  return COLUMNS.filter(([field]) => used.has(field)).map(([field, label]) => ({ field, label }));
}

export function formatMetaCell(word, field) {
  if (!word || typeof word !== "object") return "";
  const value = word[field];
  if (LIST_FIELDS.includes(field)) {
    return Array.isArray(value)
      ? value.filter((item) => typeof item === "string" && item.trim()).join("; ")
      : "";
  }
  return stringValue(value);
}
