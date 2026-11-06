// Glosses are compared case-insensitively across the lexicon, reports,
// correspondences, and reconstruction. Normalizing Unicode and collapsing
// whitespace keeps a stray double space or a decomposed character from hiding
// the same lexical item.

export function normalizeGloss(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}
