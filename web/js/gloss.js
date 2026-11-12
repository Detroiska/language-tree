// Glosses are compared case-insensitively across the lexicon, reports,
// correspondences, and reconstruction. Normalizing Unicode and collapsing
// whitespace keeps a stray double space or a decomposed character from hiding
// the same lexical item.

export function normalizeGloss(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

// Index a lexicon by normalized gloss. The first entry with a non-empty form
// wins, matching the cognate explorer's "one recorded word per gloss" rule.
export function indexWordsByGloss(words) {
  const index = new Map();
  for (const word of Array.isArray(words) ? words : []) {
    const key = normalizeGloss(word?.gloss);
    if (!key || !String(word?.form ?? "").trim() || index.has(key)) continue;
    index.set(key, word);
  }
  return index;
}
