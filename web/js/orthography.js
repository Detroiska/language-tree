// Orthography: an ordered table of phoneme <-> grapheme pairs, kept separate
// from phonology so derivation and phonotactics never depend on spelling.
// This module is DOM-free so the model, report builder, views and search can
// share the same normalization and conversion rules.

let pairCounter = 0;

function newPairId() {
  pairCounter += 1;
  return `graph_${Date.now().toString(36)}_${pairCounter.toString(36)}`;
}

// Normalize only fields that are present: an older document must not gain a
// new key on every language when it is loaded (the demo is pinned byte-for-byte).
export function normalizeOrthography(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = { ...value };
  if (Object.prototype.hasOwnProperty.call(normalized, "pairs")) {
    const seen = new Set();
    const pairs = [];
    for (const entry of Array.isArray(normalized.pairs) ? normalized.pairs : []) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const phonemes = String(entry.phonemes ?? "").trim();
      const graph = String(entry.graph ?? "").trim();
      if (!phonemes || !graph) continue;
      const key = `${phonemes}\u0000${graph}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pair = { ...entry, phonemes, graph };
      if (Object.prototype.hasOwnProperty.call(pair, "note")) pair.note = String(pair.note ?? "").trim();
      if (typeof pair.id !== "string" || !pair.id) pair.id = newPairId();
      pairs.push(pair);
    }
    normalized.pairs = pairs;
  }
  return normalized;
}

function orderedPairs(orthography, from, to) {
  const entries = Array.isArray(orthography?.pairs) ? orthography.pairs : [];
  return entries
    .filter((entry) => entry && typeof entry[from] === "string" && entry[from] && typeof entry[to] === "string")
    .map((entry) => ({ [from]: entry[from], [to]: entry[to] }))
    .sort((left, right) => Array.from(right[from]).length - Array.from(left[from]).length);
}

// Longest-match, left-to-right replacement. Anything a pair does not match —
// including cuts, stress marks and unpaired IPA — passes through unchanged, so
// a partially specified orthography still converts what it knows.
function convert(text, pairs, from, to) {
  const input = Array.from(String(text ?? ""));
  const result = [];
  let position = 0;
  while (position < input.length) {
    let matched = null;
    for (const pair of pairs) {
      const source = Array.from(pair[from]);
      if (source.length > input.length - position) continue;
      let fits = true;
      for (let offset = 0; offset < source.length; offset += 1) {
        if (source[offset] !== input[position + offset]) {
          fits = false;
          break;
        }
      }
      if (fits) {
        matched = pair;
        break;
      }
    }
    if (matched) {
      result.push(matched[to]);
      position += Array.from(matched[from]).length;
    } else {
      result.push(input[position]);
      position += 1;
    }
  }
  return result.join("");
}

export function toOrthography(form, orthography) {
  return convert(form, orderedPairs(orthography, "phonemes", "graph"), "phonemes", "graph");
}

export function fromOrthography(text, orthography) {
  return convert(text, orderedPairs(orthography, "graph", "phonemes"), "graph", "phonemes");
}

export function hasOrthography(orthography) {
  return Array.isArray(orthography?.pairs) && orthography.pairs.length > 0;
}
