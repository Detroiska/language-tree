// X-SAMPA <-> IPA conversion for stored forms.
//
// Scope: this is a storage/development-side ASCII serialization of IPA word
// forms — paste into notes, diffs, and external tools. It is NOT for rule
// notation: in this project's rules `V`, `C`, `_` and `#` are legal symbols
// that mean something else (X-SAMPA `V` = ʌ, `_` starts a diacritic), so rule
// strings could never round-trip. Keep rules in the project notation.
//
// Table source: the X-SAMPA mapping documented at
// https://en.wikipedia.org/wiki/X-SAMPA (Wells' extended SAMPA), plus the
// curated IPA_FEATURES symbol set in features.js as the verification target.
//
// Binding rules (documented because X-SAMPA is inherently ambiguous here):
// - An underscore binds the next token: affine diacritic first (`t_h`),
//   unless the pair (previous segment, next token) is one of the documented
//   tie pairs below, which read as an IPA tie bar (`n_d` = n͡d, not breathy
//   t after n), otherwise a generic coarticulation tie (`k_p` = k͡p).
// - The X-SAMPA affricate digraphs (ts, tS, kp, ...) decode as tie-barred
//   affricates — the standard reading; encode instead uses the underscore
//   tie for every pair except when a documented digraph exists.
// - Canonicalizations, both ways: script-g (U+0261) and plain g encode to
//   `g` and decode back to plain g (the way this project's charts spell the
//   velar stop); deprecated glyph variants iota/closed-upsilon/small-cap
//   A and E canonicalize to I/U/A/E. Four sinological segments (ɿ ʅ ʮ ʯ)
//   have no documented X-SAMPA encoding and pass through unchanged.
// - Characters outside the tables pass through unchanged in both
//   directions, so unknown input never corrupts stored data.
//
// Deliberately DOM-free and dependency-free so Node tests can import it.

// Diagnostic/name -> IPA attach character (superscripts, combining marks).
const DIACRITICS = {
  h: "\u02B0", // ʰ aspirated
  w: "\u02B7", // ʷ labialized
  j: "\u02B2", // ʲ palatalized
  G: "\u02E0", // ˠ velarized
  "?\\": "\u02E4", // ˤ pharyngealized
  ">": "\u02BC", // ʼ ejective
  0: "\u0325", // combining voiceless
  v: "\u032C", // combining voiced
  t: "\u0324", // combining breathy
  k: "\u0330", // combining creaky
  d: "\u032A", // combining dental
  n: "\u207F", // ⁿ nasal release
  l: "\u02E1", // ˡ lateral release
  m: "\u033B", // combining laminal
  N: "\u033C", // combining linguolabial
  O: "\u0339", // combining more rounded
  o: "\u031E", // combining lowered
  c: "\u031C", // combining less rounded
  x: "\u033D", // combining mid-centralized
  X: "\u0306", // combining extra-short
  '"': "\u0308", // combining centralized
  "+": "\u031F", // combining advanced
  "-": "\u0321", // combining retracted
  "/": "\u030C", // combining rising tone
  "\\": "\u0302", // combining falling tone
  "^": "\u032F", // combining non-syllabic
  "}": "\u031A", // combining no audible release
  A: "\u0318", // combining advanced tongue root
  a: "\u033A", // combining apical
  e: "\u0334", // combining velarized/pharyngealized
  q: "\u0319", // combining retracted tongue root
  r: "\u031D", // combining raised
  H: "\u0301", // combining high tone
  L: "\u0300", // combining low tone
  M: "\u0304", // combining mid tone
  B: "\u030F", // combining extra low tone
  T: "\u030B", // combining extra high tone
  H_T: "\u1DC4", // combining high rising tone
  B_L: "\u1DC5", // combining low rising tone
  R_F: "\u1DC8", // combining rising falling tone
  // The standard also allows most of these without the underscore, and bare
  // forms are the normalization other tools emit.
  "~": "\u0303", // combining nasalization (also `_~`)
  "=": "\u0329", // combining syllabic (also `_=`)
  "`": "\u02DE", // ˞ rhotacization (also before it: retroflex digraphs)
};

// Tie pairs whose second element is also a diacritic name. Without this list
// the underscore reading would attach the diacritic instead of tying (for
// example `n_d` would read as breathy t rather than prenasalized n͡d).
const TIE_PAIRS = new Set([
  "p_f", "b_v", "t_T", "k_x", "g_G", "q_X", "n_t", "n_d", "J_c", "N_k",
  "N_m", "N\\_q",
]);

// Segments as [X-SAMPA, IPA] pairs. Plain ASCII letters decode to
// themselves, so only the rest is tabled.
const SEGMENTS = [
  // Upper-case
  { x: "A", ipa: "ɑ" }, { x: "B", ipa: "β" }, { x: "B\\", ipa: "ʙ" },
  { x: "C", ipa: "ç" }, { x: "D", ipa: "ð" }, { x: "E", ipa: "ɛ" },
  { x: "F", ipa: "ɱ" }, { x: "G", ipa: "ɣ" }, { x: "G\\", ipa: "ɢ" },
  { x: "H", ipa: "ɥ" }, { x: "H\\", ipa: "ʜ" }, { x: "I", ipa: "ɪ" },
  { x: "I\\", ipa: "ᵻ" }, { x: "J", ipa: "ɲ" }, { x: "J\\", ipa: "ɟ" },
  { x: "K", ipa: "ɬ" }, { x: "K\\", ipa: "ɮ" }, { x: "L", ipa: "ʎ" },
  { x: "L\\", ipa: "ʟ" }, { x: "M", ipa: "ɯ" }, { x: "M\\", ipa: "ɰ" },
  { x: "N", ipa: "ŋ" }, { x: "N\\", ipa: "ɴ" }, { x: "O", ipa: "ɔ" },
  { x: "P", ipa: "ʋ" }, { x: "Q", ipa: "ɒ" }, { x: "R", ipa: "ʁ" },
  { x: "R\\", ipa: "ʀ" }, { x: "S", ipa: "ʃ" }, { x: "T", ipa: "θ" },
  { x: "U", ipa: "ʊ" }, { x: "U\\", ipa: "ᵿ" }, { x: "V", ipa: "ʌ" },
  { x: "W", ipa: "ʍ" }, { x: "X", ipa: "χ" }, { x: "X\\", ipa: "ħ" },
  { x: "Y", ipa: "ʏ" }, { x: "Z", ipa: "ʒ" },
  // Digit-based vowels and miscellany
  { x: "1", ipa: "ɨ" }, { x: "2", ipa: "ø" }, { x: "3", ipa: "ɜ" },
  { x: "3\\", ipa: "ɞ" }, { x: "4", ipa: "ɾ" }, { x: "5", ipa: "ɫ" },
  { x: "6", ipa: "ɐ" }, { x: "7", ipa: "ɤ" }, { x: "8", ipa: "ɵ" },
  { x: "9", ipa: "œ" }, { x: "@", ipa: "ə" }, { x: "@\\", ipa: "ɘ" },
  { x: "@`", ipa: "ɚ" }, { x: "3`", ipa: "ɝ" }, { x: "{", ipa: "æ" },
  { x: "}", ipa: "ʉ" }, { x: "&", ipa: "ɶ" }, { x: "?", ipa: "ʔ" },
  { x: "?\\", ipa: "ʕ" }, { x: ":", ipa: "ː" }, { x: ":\\", ipa: "ˑ" },
  { x: "\"", ipa: "ˈ" }, { x: "%", ipa: "ˌ" }, { x: "'", ipa: "ʲ" },
  // Backslash and retroflex symbols
  { x: "h\\", ipa: "ɦ" }, { x: "j\\", ipa: "ʝ" }, { x: "l\\", ipa: "ɺ" },
  { x: "p\\", ipa: "ɸ" }, { x: "r\\", ipa: "ɹ" }, { x: "r\\`", ipa: "ɻ" },
  { x: "s\\", ipa: "ɕ" }, { x: "v\\", ipa: "ʋ" }, { x: "x\\", ipa: "ɧ" },
  { x: "z\\", ipa: "ʑ" }, { x: "t`", ipa: "ʈ" }, { x: "d`", ipa: "ɖ" },
  { x: "n`", ipa: "ɳ" }, { x: "r`", ipa: "ɽ" }, { x: "s`", ipa: "ʂ" },
  { x: "l`", ipa: "ɭ" }, { x: "z`", ipa: "ʐ" },
  // Clicks, implosives (documented separate symbols)
  { x: "O\\", ipa: "ʘ" }, { x: "|\\", ipa: "ǀ" }, { x: "!\\", ipa: "ǃ" },
  { x: "=\\", ipa: "ǂ" }, { x: "|\\|\\", ipa: "ǁ" },
  { x: "b_<", ipa: "ɓ" }, { x: "d_<", ipa: "ɗ" }, { x: "g_<", ipa: "ɠ" },
  { x: "J\\_<", ipa: "ʄ" }, { x: "G\\_<", ipa: "ʛ" },
  // Non-pulmonic and extra-marks curated in features.js
  { x: "<\\", ipa: "ʢ" }, { x: ">\\", ipa: "ʡ" },
];

// Encode-only aliases: glyphs with no X-SAMPA of their own that canonically
// fold onto a documented symbol. Decode never emits them, so plain g, A, E
// stay plain and the round trip ends on the modern spelling.
const ENCODE_ALIASES = [
  { x: "g", ipa: "ɡ" }, { x: "I", ipa: "ɩ" }, { x: "U", ipa: "ɷ" },
  { x: "A", ipa: "ᴀ" }, { x: "E", ipa: "ᴇ" },
];

// Affricates and double articulations. Encode uses the documented digraph
// when one exists, the underscore tie otherwise; both decode to the
// tie-barred form (keys sorted by length where it matters).
const TIE_CLUSTERS = [
  // Documented digraphs
  { x: "ts", ipa: "t͡s" }, { x: "dz", ipa: "d͡z" },
  { x: "tS", ipa: "t͡ʃ" }, { x: "dZ", ipa: "d͡ʒ" },
  { x: "ts\\", ipa: "t͡ɕ" }, { x: "dz\\", ipa: "d͡ʑ" },
  { x: "tK", ipa: "t͡ɬ" }, { x: "dK\\", ipa: "d͡ɮ" },
  { x: "kp", ipa: "k͡p" }, { x: "gb", ipa: "ɡ͡b" }, { x: "Nm", ipa: "ŋ͡m" },
  // Underscore ties
  { x: "t_s", ipa: "t͡s" }, { x: "d_z", ipa: "d͡z" },
  { x: "t_S", ipa: "t͡ʃ" }, { x: "d_Z", ipa: "d͡ʒ" },
  { x: "p_f", ipa: "p͡f" }, { x: "b_v", ipa: "b͡v" },
  { x: "t_T", ipa: "t͡θ" }, { x: "d_D", ipa: "d͡ð" },
  { x: "t_K", ipa: "t͡ɬ" }, { x: "d_K\\", ipa: "d͡ɮ" },
  { x: "k_x", ipa: "k͡x" }, { x: "g_G", ipa: "ɡ͡ɣ" },
  { x: "q_X", ipa: "q͡χ" }, { x: "g_b", ipa: "ɡ͡b" },
  { x: "m_p", ipa: "m͡p" }, { x: "m_b", ipa: "m͡b" },
  { x: "n_t", ipa: "n͡t" }, { x: "n_d", ipa: "n͡d" },
  { x: "n`_t`", ipa: "ɳ͡ʈ" }, { x: "n`_d`", ipa: "ɳ͡ɖ" },
  { x: "J_c", ipa: "ɲ͡c" }, { x: "J_J\\", ipa: "ɲ͡ɟ" },
  { x: "N_k", ipa: "ŋ͡k" }, { x: "N_g", ipa: "ŋ͡g" },
  { x: "N_g", ipa: "ŋ͡ɡ" }, // script-g twin of the line above; plain wins decode
  { x: "N_m", ipa: "ŋ͡m" }, { x: "N\\_q", ipa: "ɴ͡q" },
  { x: "N\\_G\\", ipa: "ɴ͡ɢ" }, { x: "G\\_R", ipa: "ɢ͡ʁ" },
  { x: "c_C", ipa: "c͡ç" }, { x: "J\\_j\\", ipa: "ɟ͡ʝ" },
  { x: "t_s`", ipa: "t͡ʂ" }, { x: "d_z`", ipa: "d͡ʐ" },
  { x: "t`_s`", ipa: "ʈ͡ʂ" }, { x: "d`_z`", ipa: "ɖ͡ʐ" },
];

// X-SAMPA -> IPA lookup, longest tokens first so `J\` wins over `J`,
// `ts\` over `s\`, `|\|\` over `|\`. Plain ASCII letters decode to their own
// IPA value, so binds like `t_h` can see the previous segment.
// ASCII letters are their own X-SAMPA form in both directions.
const identityLower = "abcdefghijklmnopqrstuvwxyz".split("");

// X-SAMPA -> IPA lookup, longest tokens first so `J\` wins over `J`,
// `ts\` over `s\`, `|\|\` over `|\`. Plain ASCII letters decode to their own
// IPA value, so binds like `t_h` can see the previous segment.
const xToIpaTokens = [
  ...identityLower.map((letter) => ({ x: letter, ipa: letter })),
  ...SEGMENTS,
  ...TIE_CLUSTERS,
].sort((a, b) => b.x.length - a.x.length);

// Stored forms are NFC, but the encoder walks NFD so a precomposed accented
// letter is read as its base plus combining mark. Add decomposed twins for
// entries such as ç whose combining mark is part of the segment itself.
function withDecomposedVariants(entries) {
  const result = [];
  for (const entry of entries) {
    result.push(entry);
    const decomposed = entry.ipa.normalize("NFD");
    if (decomposed !== entry.ipa) result.push({ ...entry, ipa: decomposed });
  }
  return result;
}

// IPA -> X-SAMPA lookup, multi-codepoint clusters first (the generic
// longest-match walks it front to back).
const ipaToXEntries = [
  ...identityLower.map((letter) => ({ ipa: letter, x: letter })),
  ...withDecomposedVariants(SEGMENTS),
  ...ENCODE_ALIASES,
  ...withDecomposedVariants(TIE_CLUSTERS),
].sort((a, b) => b.ipa.length - a.ipa.length);

// Superscripts and combining marks bind to the previous segment. Bare tilde,
// equals and backtick are documented as usable without the underscore.
const MODIFIERS = {
  "ʰ": "_h", "ʷ": "_w", "ʲ": "_j", "ˠ": "_G", "ˤ": "_?\\", "ʼ": "_>",
  "\u0325": "_0", "\u032C": "_v", "\u0324": "_t", "\u0330": "_k",
  "\u032A": "_d", "ⁿ": "_n", "ˡ": "_l", "\u033B": "_m", "\u033C": "_N",
  "\u0339": "_O", "\u031E": "_o", "\u031C": "_c", "\u033D": "_x",
  "\u0306": "_X", "\u0308": "_\"", "\u031F": "_+", "\u0321": "_-",
  "\u030C": "_/", "\u0302": "_\\", "\u032F": "_^", "\u031A": "_}",
  "\u0318": "_A", "\u033A": "_a", "\u0334": "_e", "\u0319": "_q",
  "\u031D": "_r", "\u0301": "_H", "\u0300": "_L", "\u0304": "_M",
  "\u030F": "_B", "\u030B": "_T", "\u1DC4": "_H_T", "\u1DC5": "_B_L",
  "\u1DC8": "_R_F", "\u0303": "~", "\u0329": "=", "\u02DE": "`",
};

function longestMatch(entries, keySelector, text, position) {
  for (const entry of entries) {
    const key = keySelector(entry);
    if (text.startsWith(key, position)) return entry;
  }
  return null;
}

// Decode helper: attach the underscore-bound next token to the segment just
// emitted. Precedence: documented tie pair, diacritic name, otherwise a
// generic coarticulation tie.
function bindUnderscore(out, text, index, lastX) {
  const position = index + 1; // past the underscore
  const next = longestMatch(xToIpaTokens, (entry) => entry.x, text, position);
  const nextX = next ? next.x : null;
  // A documented pair beats the same letter's diacritic reading.
  if (nextX && TIE_PAIRS.has(`${lastX}_${nextX}`)) {
    out.push("\u0361", next.ipa);
    return { index: position + nextX.length, lastX: nextX };
  }
  // Diacritic names, longest first (3-char contours before 2-char `?\`).
  const names = Object.keys(DIACRITICS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (text.startsWith(name, position)) {
      out.push(DIACRITICS[name]);
      return { index: position + name.length, lastX };
    }
  }
  // Anything else starts a segment: tie it to the previous one (k_p rule).
  if (next) {
    out.push("\u0361", next.ipa);
    return { index: position + nextX.length, lastX: nextX };
  }
  // Stray underscore with nothing bindable after it: keep it literally and
  // consume it, so the caller does not retry the same underscore forever.
  out.push("_");
  return { index: position, lastX };
}

// Encode aliases fold onto a different glyph (script-g becomes plain g, for
// example), so a modifier chunk's round trip compares those documented
// canonical folds rather than the literal input.
const DECODE_ALIASES = { "\u0261": "g", "\u0269": "\u026A", "\u0277": "\u028A", "\u1D00": "\u0251", "\u1D07": "\u025B" };

function foldDecodeAliases(text) {
  let result = text.normalize("NFC");
  for (const [from, to] of Object.entries(DECODE_ALIASES)) result = result.replaceAll(from, to);
  return result;
}

export function ipaToXSampa(text) {
  if (text === null || text === undefined) return "";
  // Decompose first so NFC input and NFD input take the same path.
  const source = String(text).normalize("NFD");
  const chars = [...source];
  const out = [];
  let position = 0;
  while (position < chars.length) {
    const rest = chars.slice(position).join("");
    const entry = longestMatch(ipaToXEntries, (item) => item.ipa, rest, 0);
    if (entry) {
      const chunkStart = position;
      const encodedStart = out.length;
      out.push(entry.x);
      position += [...entry.ipa].length;
      let modified = false;
      // Modifier loop: superscripts and combining marks bind to the segment.
      while (position < chars.length && MODIFIERS[chars[position]]) {
        out.push(MODIFIERS[chars[position]]);
        modified = true;
        position += 1;
      }
      // Some modifier spellings are ambiguous in X-SAMPA: `n_d` is the
      // documented tie pair n͡d, `t`` is retroflex ʈ, and `g_G` is the
      // affricate ɡ͡ɣ. When the decoder would not read our spelling back as
      // this chunk, keep the IPA chunk unchanged instead of corrupting it.
      if (modified) {
        const chunk = chars.slice(chunkStart, position).join("");
        const decoded = xSampaToIPA(out.slice(encodedStart).join(""));
        if (foldDecodeAliases(decoded) !== foldDecodeAliases(chunk)) {
          out.length = encodedStart;
          out.push(chunk);
        }
      }
      continue;
    }
    // Unknown characters pass through unchanged so nothing is silently lost.
    out.push(chars[position]);
    position += 1;
  }
  return out.join("");
}

export function xSampaToIPA(text) {
  if (text === null || text === undefined) return "";
  const source = String(text);
  const out = [];
  let index = 0;
  let lastX = null;
  while (index < source.length) {
    const entry = longestMatch(xToIpaTokens, (item) => item.x, source, index);
    if (entry) {
      out.push(entry.ipa);
      index += entry.x.length;
      lastX = entry.x;
      // Attach chained diacritics / ties to the emitted segment.
      let attaching = true;
      while (attaching && index < source.length) {
        const char = source[index];
        if (char === "_") {
          const bound = bindUnderscore(out, source, index, lastX);
          index = bound.index;
          lastX = bound.lastX;
        } else if (char === "~" || char === "=" || char === "`") {
          out.push(DIACRITICS[char]);
          index += 1;
        } else {
          attaching = false;
        }
      }
      continue;
    }
    out.push(source[index]);
    index += 1;
  }
  return out.join("");
}
