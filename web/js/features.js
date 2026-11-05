// Distinctive features.
//
// Features are looked up by IPA symbol, never by chart label: chart labels are
// free-form, so deriving [±nasal] from a row called "Nasal" would make the
// semantics depend on presentation. A curated table covers common IPA; chart
// sounds outside it can be described per language in the Features panel.
//
// Bundles are tri-state. A boolean feature is true, false, or null ("not
// applicable"). `place` is categorical (or null for vowels). The tri-state is
// what lets [αplace] bind only on consonants and [αround] only on vowels:
// `V > [αround] / [αround] _` cannot accidentally match after a consonant.
//
// Place is deliberately non-redundant: `place` is the stored primary place,
// `anterior` is a dependent coronal feature, and labial/coronal/dorsal/radical
// are derived queries. Changing place therefore produces a coherent bundle
// (n with place=velar resolves to ŋ), instead of leaving stale alveolar
// features behind.

export const FEATURE_DEFINITIONS = {
  // Major class and manner.
  syllabic: { type: "boolean", label: "syllabic" },
  consonantal: { type: "boolean", label: "consonantal" },
  sonorant: { type: "boolean", label: "sonorant" },
  continuant: { type: "boolean", label: "continuant" },
  nasal: { type: "boolean", label: "nasal" },
  lateral: { type: "boolean", label: "lateral" },
  trill: { type: "boolean", label: "trill" },
  tap: { type: "boolean", label: "tap" },
  delayed_release: { type: "boolean", label: "delayed release" },
  prenasalized: { type: "boolean", label: "prenasalized" },
  click: { type: "boolean", label: "click" },
  implosive: { type: "boolean", label: "implosive" },

  // Laryngeal.
  voice: { type: "boolean", label: "voice" },
  spread_glottis: { type: "boolean", label: "spread glottis" },
  constricted_glottis: { type: "boolean", label: "constricted glottis" },

  // Place. `place` is categorical; the class features below are derived from
  // it and are query-only.
  place: {
    type: "categorical",
    label: "place",
    values: [
      "bilabial",
      "labiodental",
      "dental",
      "alveolar",
      "postalveolar",
      "retroflex",
      "palatal",
      "velar",
      "uvular",
      "pharyngeal",
      "glottal",
      "labiovelar",
    ],
  },
  anterior: { type: "boolean", label: "anterior" },
  labial: { type: "derived", from: "place", values: ["bilabial", "labiodental", "labiovelar"] },
  coronal: { type: "derived", from: "place", values: ["dental", "alveolar", "postalveolar", "retroflex"] },
  dorsal: { type: "derived", from: "place", values: ["palatal", "velar", "uvular", "labiovelar"] },
  radical: { type: "derived", from: "place", values: ["pharyngeal"] },
  laryngeal: { type: "derived", from: "place", values: ["glottal"] },

  // Vowel features. These are null on consonants.
  high: { type: "boolean", label: "high" },
  low: { type: "boolean", label: "low" },
  back: { type: "boolean", label: "back" },
  central: { type: "boolean", label: "central" },
  round: { type: "boolean", label: "round" },
  atr: { type: "boolean", label: "ATR" },
  long: { type: "boolean", label: "long" },

  // Secondary articulation and other segment notes.
  rhotic: { type: "boolean", label: "rhotic" },
  labialized: { type: "boolean", label: "labialized" },
  palatalized: { type: "boolean", label: "palatalized" },
  velarized: { type: "boolean", label: "velarized" },
  pharyngealized: { type: "boolean", label: "pharyngealized" },
};

export const FEATURE_NAMES = Object.keys(FEATURE_DEFINITIONS);

export const FEATURE_ALIASES = {
  ant: "anterior",
  cons: "consonantal",
  cont: "continuant",
  delrel: "delayed_release",
  nas: "nasal",
  son: "sonorant",
  syl: "syllabic",
  lat: "lateral",
  sg: "spread_glottis",
  cg: "constricted_glottis",
  hi: "high",
  lo: "low",
  bk: "back",
  cen: "central",
  rd: "round",
  rho: "rhotic",
  lab: "labial",
  cor: "coronal",
  dor: "dorsal",
  rad: "radical",
  lng: "long",
};

const BOOLEAN_FEATURES = FEATURE_NAMES.filter(
  (name) => FEATURE_DEFINITIONS[name].type === "boolean"
);

const DEFAULT_BOOLEAN_FEATURES = new Set([
  "syllabic", "consonantal", "sonorant", "continuant", "nasal", "lateral",
  "trill", "tap", "delayed_release", "prenasalized", "click", "implosive",
  "voice", "spread_glottis", "constricted_glottis", "long", "rhotic",
  "labialized", "palatalized", "velarized", "pharyngealized",
]);

const VOWEL_FEATURES = ["high", "low", "back", "central", "round", "atr"];

const CORONAL_PLACES = new Set(["dental", "alveolar", "postalveolar", "retroflex"]);
const ANTERIOR_PLACES = new Set(["dental", "alveolar"]);

const TIE_PRIMARY = "\u0361";
const TIE_SECONDARY = "\u035C";

export function normalizeSound(value) {
  return String(value ?? "").normalize("NFC").trim();
}

// Tie bars have two typographic forms. They describe the same segment for
// feature lookup, so normalize one to the other.
export function soundKey(value) {
  return normalizeSound(value).replaceAll(TIE_SECONDARY, TIE_PRIMARY);
}

export function normalizeFeatureName(value) {
  const key = String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "");
  return FEATURE_ALIASES[key] || key;
}

function normalizeCategoryValue(value) {
  return String(value ?? "").normalize("NFC").trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

export function featureDefinition(name) {
  return FEATURE_DEFINITIONS[normalizeFeatureName(name)] || null;
}

export function featureLabel(name) {
  const key = normalizeFeatureName(name);
  return FEATURE_DEFINITIONS[key]?.label || key;
}

export function defaultBundle() {
  const bundle = {};
  for (const name of FEATURE_NAMES) {
    if (FEATURE_DEFINITIONS[name].type === "boolean") {
      bundle[name] = DEFAULT_BOOLEAN_FEATURES.has(name) ? false : null;
    } else if (FEATURE_DEFINITIONS[name].type === "categorical") {
      bundle[name] = null;
    }
  }
  bundle.anterior = null;
  return bundle;
}

function cloneBundle(bundle) {
  return { ...(bundle || {}) };
}

export function derivedFeatureValue(bundle, name) {
  const def = FEATURE_DEFINITIONS[name];
  if (!def || def.type !== "derived") return null;
  const place = bundle?.place || null;
  if (!place) return false;
  return def.values.includes(place);
}

export function featureValue(bundle, name) {
  const key = normalizeFeatureName(name);
  const def = FEATURE_DEFINITIONS[key];
  if (!def) return undefined;
  if (def.type === "derived") return derivedFeatureValue(bundle, key);
  return bundle ? bundle[key] : undefined;
}

// Fill a partial record into a complete bundle. Missing applicable booleans
// default to false; vowel features and place default to null. This is the
// normalizer used for per-language overrides and the feature editor.
export function normalizeBundle(raw) {
  const bundle = defaultBundle();
  if (!raw || typeof raw !== "object") return canonicalizeBundle(bundle);
  for (const name of FEATURE_NAMES) {
    const def = FEATURE_DEFINITIONS[name];
    if (def.type === "derived") continue;
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const value = raw[name];
    if (def.type === "boolean") {
      if (value === true || value === false || value === null) bundle[name] = value;
      continue;
    }
    if (def.type === "categorical") {
      if (value === null || value === undefined || value === "" || value === "none") {
        bundle[name] = null;
        continue;
      }
      const normalized = normalizeCategoryValue(value);
      if (def.values.includes(normalized)) bundle.place = normalized;
    }
  }
  return canonicalizeBundle(bundle, raw);
}

// Keep the bundle internally coherent. `explicit` is the record being applied:
// an explicit anterior value is preserved, otherwise it follows place.
export function canonicalizeBundle(input, explicit = null) {
  const bundle = cloneBundle(input);
  for (const name of FEATURE_NAMES) {
    if (FEATURE_DEFINITIONS[name].type === "derived") continue;
    if (!(name in bundle)) {
      bundle[name] = FEATURE_DEFINITIONS[name].type === "boolean"
        ? (DEFAULT_BOOLEAN_FEATURES.has(name) ? false : null)
        : null;
    }
  }
  if (bundle.place === "none" || bundle.place === undefined) bundle.place = null;
  if (bundle.place !== null && !FEATURE_DEFINITIONS.place.values.includes(bundle.place)) {
    bundle.place = null;
  }

  if (bundle.place === null) {
    bundle.anterior = null;
  } else if (CORONAL_PLACES.has(bundle.place)) {
    const hasExplicitAnterior =
      explicit && Object.prototype.hasOwnProperty.call(explicit, "anterior") &&
      (explicit.anterior === true || explicit.anterior === false);
    bundle.anterior = hasExplicitAnterior
      ? explicit.anterior
      : ANTERIOR_PLACES.has(bundle.place);
  } else {
    bundle.anterior = null;
  }

  if (bundle.central === true) bundle.back = false;
  if (bundle.back === true && bundle.central === true) bundle.central = false;

  return bundle;
}

/* ---- curated IPA table -------------------------------------------------- */

const STOP_BASE = {
  syllabic: false,
  consonantal: true,
  sonorant: false,
  continuant: false,
  nasal: false,
  lateral: false,
  trill: false,
  tap: false,
  delayed_release: false,
  prenasalized: false,
  click: false,
  implosive: false,
  voice: false,
  spread_glottis: false,
  constricted_glottis: false,
  long: false,
  rhotic: false,
  labialized: false,
  palatalized: false,
  velarized: false,
  pharyngealized: false,
};

function consonant(place, patch = {}) {
  return canonicalizeBundle({
    ...defaultBundle(),
    ...STOP_BASE,
    place,
    ...patch,
  }, patch);
}

function stop(place, voice = false, patch = {}) {
  return consonant(place, { voice, ...patch });
}

function nasal(place, patch = {}) {
  return consonant(place, {
    voice: true,
    sonorant: true,
    nasal: true,
    ...patch,
  });
}

function fricative(place, voice = false, patch = {}) {
  return consonant(place, {
    voice,
    continuant: true,
    ...patch,
  });
}

function approximant(place, patch = {}) {
  return consonant(place, {
    voice: true,
    sonorant: true,
    continuant: true,
    ...patch,
  });
}

function trill(place, patch = {}) {
  return approximant(place, { trill: true, ...patch });
}

function tap(place, patch = {}) {
  return approximant(place, { tap: true, ...patch });
}

function lateral(place, patch = {}) {
  return approximant(place, { lateral: true, ...patch });
}

function affricate(place, voice = false, patch = {}) {
  return stop(place, voice, { delayed_release: true, ...patch });
}

function affricateFrom(place, voice = false, patch = {}) {
  return affricate(place, voice, { ...patch });
}

function prenasalized(place, voice = false, patch = {}) {
  return stop(place, voice, { nasal: true, prenasalized: true, ...patch });
}

function click(place, patch = {}) {
  return consonant(place, {
    click: true,
    continuant: false,
    ...patch,
  });
}

function implosive(place, patch = {}) {
  return stop(place, true, { implosive: true, ...patch });
}

function ejective(place, patch = {}) {
  return stop(place, false, { constricted_glottis: true, ...patch });
}

function vowel(patch = {}) {
  return canonicalizeBundle({
    ...defaultBundle(),
    syllabic: true,
    consonantal: false,
    sonorant: true,
    continuant: true,
    nasal: false,
    voice: true,
    place: null,
    anterior: null,
    high: false,
    low: false,
    back: false,
    central: false,
    round: false,
    atr: true,
    long: false,
    rhotic: false,
    ...patch,
  }, patch);
}

// A compact vowel shorthand: height is "high" | "near-high" | "mid" | "low".
function v(height, backness, rounded, patch = {}) {
  const { lax = false, ...rest } = patch;
  const base = {
    high: height === "high" || height === "near-high",
    low: height === "low",
    back: backness === "back",
    central: backness === "central",
    round: rounded,
    atr: height !== "near-high" && !lax,
  };
  return vowel({ ...base, ...rest });
}

export const IPA_FEATURES = {
  // Stops.
  p: stop("bilabial"),
  b: stop("bilabial", true),
  t: stop("alveolar"),
  d: stop("alveolar", true),
  ʈ: stop("retroflex"),
  ɖ: stop("retroflex", true),
  c: stop("palatal"),
  ɟ: stop("palatal", true),
  k: stop("velar"),
  g: stop("velar", true),
  ɡ: stop("velar", true),
  q: stop("uvular"),
  ɢ: stop("uvular", true),
  ʔ: stop("glottal"),
  ʡ: stop("pharyngeal"),

  // Nasals.
  m: nasal("bilabial"),
  ɱ: nasal("labiodental"),
  n: nasal("alveolar"),
  ɳ: nasal("retroflex"),
  ɲ: nasal("palatal"),
  ŋ: nasal("velar"),
  ɴ: nasal("uvular"),

  // Trills, taps, flaps.
  ʙ: trill("bilabial"),
  r: trill("alveolar"),
  ʀ: trill("uvular"),
  ɾ: tap("alveolar"),
  ɽ: tap("retroflex"),
  ɺ: tap("alveolar", { lateral: true }),

  // Fricatives.
  ɸ: fricative("bilabial"),
  β: fricative("bilabial", true),
  f: fricative("labiodental"),
  v: fricative("labiodental", true),
  θ: fricative("dental"),
  ð: fricative("dental", true),
  s: fricative("alveolar"),
  z: fricative("alveolar", true),
  ʃ: fricative("postalveolar"),
  ʒ: fricative("postalveolar", true),
  ɕ: fricative("postalveolar"),
  ʑ: fricative("postalveolar", true),
  ʂ: fricative("retroflex"),
  ʐ: fricative("retroflex", true),
  ç: fricative("palatal"),
  ʝ: fricative("palatal", true),
  x: fricative("velar"),
  ɣ: fricative("velar", true),
  χ: fricative("uvular"),
  ʁ: fricative("uvular", true),
  ħ: fricative("pharyngeal"),
  ʕ: fricative("pharyngeal", true),
  ʜ: fricative("pharyngeal"),
  ʢ: fricative("pharyngeal", true),
  h: fricative("glottal"),
  ɦ: fricative("glottal", true),
  ɧ: fricative("postalveolar", { labialized: true }),

  // Lateral fricatives.
  ɬ: fricative("alveolar", false, { lateral: true }),
  ɮ: fricative("alveolar", true, { lateral: true }),

  // Approximants.
  ʋ: approximant("labiodental"),
  ɹ: approximant("alveolar"),
  ɻ: approximant("retroflex"),
  j: approximant("palatal"),
  ɰ: approximant("velar"),
  w: approximant("labiovelar", { labialized: true }),
  ʍ: approximant("labiovelar", { voice: false, labialized: true }),
  ɥ: approximant("palatal", { labialized: true }),
  l: lateral("alveolar"),
  ɫ: lateral("alveolar", { velarized: true }),
  ɭ: lateral("retroflex"),
  ʎ: lateral("palatal"),
  ʟ: lateral("velar"),

  // Affricates.
  "t͡s": affricate("alveolar"),
  "d͡z": affricate("alveolar", true),
  "t͡ʃ": affricate("postalveolar"),
  "d͡ʒ": affricate("postalveolar", true),
  "t͡ɕ": affricate("postalveolar"),
  "d͡ʑ": affricate("postalveolar", true),
  "ʈ͡ʂ": affricate("retroflex"),
  "ɖ͡ʐ": affricate("retroflex", true),
  "t͡θ": affricate("dental"),
  "d͡ð": affricate("dental", true),
  "p͡f": affricate("labiodental"),
  "b͡v": affricate("labiodental", true),
  "t͡ɬ": affricate("alveolar", false, { lateral: true }),
  "d͡ɮ": affricate("alveolar", true, { lateral: true }),
  "k͡x": affricate("velar"),
  "ɡ͡ɣ": affricate("velar", true),
  "q͡χ": affricate("uvular"),
  "ɢ͡ʁ": affricate("uvular", true),
  "t͡ʂ": affricate("retroflex"),
  "d͡ʐ": affricate("retroflex", true),
  "c͡ç": affricate("palatal"),
  "ɟ͡ʝ": affricate("palatal", true),

  // Prenasalized stops.
  "m͡p": prenasalized("bilabial"),
  "m͡b": prenasalized("bilabial", true),
  "n͡t": prenasalized("alveolar"),
  "n͡d": prenasalized("alveolar", true),
  "ɳ͡ʈ": prenasalized("retroflex"),
  "ɳ͡ɖ": prenasalized("retroflex", true),
  "ɲ͡c": prenasalized("palatal"),
  "ɲ͡ɟ": prenasalized("palatal", true),
  "ŋ͡k": prenasalized("velar"),
  "ŋ͡g": prenasalized("velar", true),
  "ŋ͡ɡ": prenasalized("velar", true),
  "ɴ͡q": prenasalized("uvular"),
  "ɴ͡ɢ": prenasalized("uvular", true),

  // Double articulations.
  "k͡p": stop("labiovelar"),
  "ɡ͡b": stop("labiovelar", true),
  "ŋ͡m": nasal("labiovelar"),

  // Clicks.
  ʘ: click("bilabial"),
  ǀ: click("dental"),
  ǃ: click("alveolar"),
  ǂ: click("palatal"),
  ǁ: click("alveolar", { lateral: true }),

  // Implosives.
  ɓ: implosive("bilabial"),
  ɗ: implosive("alveolar"),
  ʄ: implosive("palatal"),
  ɠ: implosive("velar"),
  ʛ: implosive("uvular"),

  // Ejectives.
  "pʼ": ejective("bilabial"),
  "tʼ": ejective("alveolar"),
  "ʈʼ": ejective("retroflex"),
  "cʼ": ejective("palatal"),
  "kʼ": ejective("velar"),
  "qʼ": ejective("uvular"),
  "fʼ": ejective("labiodental"),
  "sʼ": ejective("alveolar"),
  "ʃʼ": ejective("postalveolar"),
  "xʼ": ejective("velar"),
  "ɸʼ": ejective("bilabial"),
  "θʼ": ejective("dental"),
  "ɬʼ": ejective("alveolar", { lateral: true }),
  "çʼ": ejective("palatal"),
  "ʂʼ": ejective("retroflex"),
  "ɕʼ": ejective("postalveolar"),
  "t͡sʼ": ejective("alveolar", { delayed_release: true }),
  "t͡ʃʼ": ejective("postalveolar", { delayed_release: true }),
  "t͡θʼ": ejective("dental", { delayed_release: true }),
  "t͡ɬʼ": ejective("alveolar", { delayed_release: true, lateral: true }),
  "t͡ɕʼ": ejective("postalveolar", { delayed_release: true }),
  "t͡ʂʼ": ejective("retroflex", { delayed_release: true }),
  "k͡xʼ": ejective("velar", { delayed_release: true }),
  "q͡χʼ": ejective("uvular", { delayed_release: true }),

  // Vowels.
  i: v("high", "front", false),
  y: v("high", "front", true),
  ɨ: v("high", "central", false),
  ʉ: v("high", "central", true),
  ɯ: v("high", "back", false),
  u: v("high", "back", true),
  ɪ: v("near-high", "front", false, { lax: true }),
  ʏ: v("near-high", "front", true, { lax: true }),
  ʊ: v("near-high", "back", true, { lax: true }),
  e: v("mid", "front", false),
  ø: v("mid", "front", true),
  ɘ: v("mid", "central", false),
  ɵ: v("mid", "central", true),
  ɤ: v("mid", "back", false),
  o: v("mid", "back", true),
  ə: v("mid", "central", false, { atr: false }),
  ɛ: v("mid", "front", false, { lax: true }),
  œ: v("mid", "front", true, { lax: true }),
  ɜ: v("mid", "central", false),
  ɞ: v("mid", "central", true),
  ʌ: v("mid", "back", false),
  ɔ: v("mid", "back", true),
  æ: v("low", "front", false),
  ɐ: v("low", "central", false),
  a: v("low", "front", false),
  ɶ: v("low", "front", true),
  ɑ: v("low", "back", false),
  ɒ: v("low", "back", true),
  ɚ: v("mid", "central", false, { atr: false, rhotic: true }),
  ɝ: v("mid", "central", false, { rhotic: true }),
  ᵻ: v("near-high", "central", false, { atr: false }),
  ᵿ: v("near-high", "central", true, { atr: false }),
  ɩ: v("near-high", "front", false, { atr: false }),
  ɷ: v("near-high", "back", true, { atr: false }),
  ᴀ: v("low", "central", false),
  ᴇ: v("mid", "central", false),
  ɿ: v("high", "central", false, { atr: false }),
  ʅ: v("high", "central", false, { atr: false }),
  ʮ: v("high", "central", true, { atr: false }),
  ʯ: v("high", "central", true, { atr: false }),
};

const MODIFIER_DELTAS = {
  // Spacing modifier letters.
  "ʰ": { spread_glottis: true },
  "ʷ": { labialized: true },
  "ʲ": { palatalized: true },
  "ˠ": { velarized: true },
  "ˤ": { pharyngealized: true },
  "ː": { long: true },
  "ˑ": { long: true },
  "ʼ": { constricted_glottis: true },
  "ˀ": { constricted_glottis: true },
  "ʱ": { voice: true, spread_glottis: true },
  "ⁿ": { prenasalized: true },
  "˞": { rhotic: true },
  // Combining marks below.
  "\u0303": { nasal: true },
  "\u0325": { voice: false },
  "\u032C": { voice: true },
  "\u0329": { syllabic: true, consonantal: false },
  "\u032F": { syllabic: false },
  "\u031A": {},
  "\u0330": { constricted_glottis: true },
  "\u0304": {},
  "\u0301": {},
  "\u0300": {},
  "\u030C": {},
  "\u0302": {},
  "\u0308": {},
  "\u032A": { place: "dental" },
};

const IGNORED_MARKS = new Set([
  "\u0300", "\u0301", "\u0302", "\u0304", "\u0306", "\u0307", "\u0308",
  "\u030B", "\u030C", "\u030F", "\u0311", "\u0313", "\u0314", "\u0342",
]);

const MODIFIER_CHARS = new Set(Object.keys(MODIFIER_DELTAS));

function applyModifier(bundle, char) {
  const delta = MODIFIER_DELTAS[char];
  if (!delta) return false;
  Object.assign(bundle, delta);
  return true;
}

function splitSound(sound) {
  const nfd = sound.normalize("NFD");
  const chars = Array.from(nfd);
  let base = "";
  const modifiers = [];
  for (const char of chars) {
    if (!base) {
      if (/\p{M}/u.test(char)) continue;
      if (MODIFIER_CHARS.has(char)) {
        modifiers.push(char);
        continue;
      }
      base = char;
      continue;
    }
    modifiers.push(char);
  }
  return { base, modifiers };
}

function deriveFromParts(base, modifiers) {
  if (!base) return null;
  const source = IPA_FEATURES[soundKey(base)];
  if (!source) return null;
  const bundle = cloneBundle(source);
  for (const char of modifiers) {
    if (applyModifier(bundle, char)) continue;
    if (IGNORED_MARKS.has(char)) continue;
    if (/\p{M}/u.test(char)) return null;
    return null;
  }
  return canonicalizeBundle(bundle);
}

function deriveContour(sound) {
  const key = soundKey(sound);
  if (!key.includes(TIE_PRIMARY)) return null;
  const parts = key.split(TIE_PRIMARY);
  if (parts.length !== 2) return null;
  const first = deriveIpaFeatures(parts[0]);
  const second = deriveIpaFeatures(parts[1]);
  if (!first || !second) return null;

  // Prenasalized stop: a nasal followed by a homorganic stop.
  if (
    first.nasal === true &&
    second.consonantal === true &&
    second.continuant === false &&
    first.place &&
    first.place === second.place
  ) {
    return canonicalizeBundle({
      ...second,
      nasal: true,
      prenasalized: true,
      sonorant: false,
    });
  }

  // Affricate: a stop followed by a homorganic fricative.
  if (
    first.consonantal === true &&
    first.continuant === false &&
    second.consonantal === true &&
    second.continuant === true &&
    first.place &&
    first.place === second.place
  ) {
    return canonicalizeBundle({
      ...first,
      delayed_release: true,
      continuant: false,
      voice: second.voice,
      anterior: second.anterior,
      // The release carries the laryngeal setting: an affricate written with
      // an aspirated fricative should stay aspirated after derivation.
      spread_glottis: second.spread_glottis,
      constricted_glottis: second.constricted_glottis,
    });
  }

  // Common labial + dorsal double articulation.
  if (
    first.place &&
    second.place &&
    ((first.place === "labial" || ["bilabial", "labiodental"].includes(first.place)) &&
      ["palatal", "velar", "uvular"].includes(second.place))
  ) {
    return canonicalizeBundle({
      ...first,
      place: "labiovelar",
      voice: second.voice,
    });
  }

  return null;
}

export function deriveIpaFeatures(sound) {
  const normalized = normalizeSound(sound);
  if (!normalized) return null;
  const key = soundKey(normalized);
  if (IPA_FEATURES[key]) return canonicalizeBundle(IPA_FEATURES[key]);
  const contour = deriveContour(normalized);
  if (contour) return contour;
  const { base, modifiers } = splitSound(normalized);
  return deriveFromParts(base, modifiers);
}

export function createFeatureResolver(overrides = {}) {
  const overrideMap = new Map();
  for (const [sound, bundle] of Object.entries(overrides || {})) {
    if (!sound || !bundle || typeof bundle !== "object") continue;
    overrideMap.set(soundKey(sound), normalizeBundle(bundle));
  }
  const cache = new Map();

  return {
    overrides: overrideMap,
    bundleFor(sound) {
      const key = soundKey(sound);
      if (!key) return null;
      if (overrideMap.has(key)) return cloneBundle(overrideMap.get(key));
      if (cache.has(key)) return cache.get(key);
      const bundle = deriveIpaFeatures(sound);
      cache.set(key, bundle);
      return bundle;
    },
    hasOverride(sound) {
      return overrideMap.has(soundKey(sound));
    },
    overrideFor(sound) {
      return overrideMap.get(soundKey(sound)) || null;
    },
  };
}

/* ---- feature notation --------------------------------------------------- */

const SIGNED = /^([+\-\u2212])\s*([A-Za-z][A-Za-z0-9_-]*)$/u;
const VARIABLE = /^(\p{Script=Greek})([A-Za-z][A-Za-z0-9_-]*)$/u;
const EQUALS = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*([^\s,;]+)$/u;

function booleanTerm(feature, value) {
  return { kind: "bool", feature, value };
}

function categoricalTerm(feature, value) {
  return { kind: "cat", feature, value };
}

function variableTerm(variable, feature) {
  return { kind: "var", variable, feature };
}

// Parse one word as a feature term. Returns null when the word is not
// feature-shaped at all, which lets callers fall back to literal sounds.
export function parseFeatureWord(word, { allowBare = true, allowVariables = true } = {}) {
  const source = String(word ?? "").normalize("NFC").trim();
  if (!source) return null;

  const equals = source.match(EQUALS);
  if (equals) {
    const feature = normalizeFeatureName(equals[1]);
    const def = FEATURE_DEFINITIONS[feature];
    if (!def) return { ok: false, error: `No feature is named “${equals[1]}”.` };
    if (def.type !== "categorical") {
      return {
        ok: false,
        error: `“${feature}” takes + or −, not a value. Write [${source.startsWith("-") ? "-" : "+"}${feature}].`,
      };
    }
    const value = normalizeCategoryValue(equals[2]);
    if (!def.values.includes(value)) {
      return {
        ok: false,
        error: `“${equals[2]}” is not a value of ${feature}. Use one of: ${def.values.join(", ")}.`,
      };
    }
    return { ok: true, term: categoricalTerm(feature, value) };
  }

  const signed = source.match(SIGNED);
  if (signed) {
    const feature = normalizeFeatureName(signed[2]);
    const def = FEATURE_DEFINITIONS[feature];
    if (!def) return { ok: false, error: `No feature is named “${signed[2]}”.` };
    if (def.type === "categorical") {
      return {
        ok: false,
        error: `“${feature}” is categorical; write ${feature}=${def.values[0]} instead of a sign.`,
      };
    }
    return { ok: true, term: booleanTerm(feature, signed[1] !== "-" && signed[1] !== "\u2212") };
  }

  const variable = source.match(VARIABLE);
  if (variable) {
    if (!allowVariables) {
      return { ok: false, error: "α-variables are only available in sound-change and allophony rules." };
    }
    const feature = normalizeFeatureName(variable[2]);
    const def = FEATURE_DEFINITIONS[feature];
    if (!def) return { ok: false, error: `No feature is named “${variable[2]}”.` };
    if (def.type === "derived") {
      return {
        ok: false,
        error: `“${feature}” is derived from place, so it cannot be used with a variable. Use [αplace] instead.`,
      };
    }
    return { ok: true, term: variableTerm(variable[1], feature) };
  }

  if (!allowBare) return null;
  const feature = normalizeFeatureName(source);
  const def = FEATURE_DEFINITIONS[feature];
  if (!def) return null;
  if (def.type === "categorical") {
    return {
      ok: false,
      error: `“${feature}” is categorical; write [${feature}=${def.values[0]}] or [α${feature}].`,
    };
  }
  if (def.type === "derived") {
    return { ok: true, term: booleanTerm(feature, true) };
  }
  return { ok: true, term: booleanTerm(feature, true) };
}

function stripBrackets(text) {
  const source = String(text ?? "").trim();
  if (source.startsWith("[") && source.endsWith("]")) return source.slice(1, -1);
  return source;
}

// A word is explicitly feature syntax when there is no chance it is a chart
// class or literal sound: a sign, an α-variable, or a categorical assignment.
export function isExplicitFeatureSyntax(word) {
  const source = String(word ?? "").trim();
  if (!source) return false;
  if (/^[+\-\u2212]/u.test(source)) return true;
  if (VARIABLE.test(source)) return true;
  return EQUALS.test(source);
}

// Decide whether a bracket's words are a feature bundle. Callers pass
// `isReserved` so the documented precedence still applies: a bare word that is
// a category or chart class keeps that meaning, and a bracket may not mix
// sounds with features. Returns {kind:"none"} when this is an ordinary set.
export function classifyFeatureWords(
  words,
  { allowBare = true, allowVariables = true, isReserved = () => false } = {}
) {
  const list = (Array.isArray(words) ? words : []).map((word) => String(word ?? "").trim()).filter(Boolean);
  if (!list.length) return { kind: "none" };
  const parsed = list.map((word) => parseFeatureWord(word, { allowBare, allowVariables }));
  const explicit = list.some(isExplicitFeatureSyntax);
  const candidates = parsed.map((entry, index) => Boolean(entry && entry.ok && !isReserved(list[index])));
  if (!explicit && !candidates.some(Boolean)) return { kind: "none" };

  const terms = [];
  for (let index = 0; index < list.length; index += 1) {
    const word = list[index];
    const entry = parsed[index];
    if (!entry) {
      return {
        kind: "error",
        error: explicit
          ? `Feature bundles cannot mix sounds and features: “${word}” is a sound. Write the bundle entirely with features, like [+nasal -voice].`
          : `“${word}” is a sound, not a feature; a feature bundle cannot mix sounds and features.`,
      };
    }
    if (!entry.ok) return { kind: "error", error: entry.error };
    if (!explicit && isReserved(word)) {
      return {
        kind: "error",
        error: `Feature bundles cannot mix a chart class or category (“${word}”) with features. Write the class on its own or use only features.`,
      };
    }
    terms.push(entry.term);
  }
  return { kind: "feature", terms, source: `[${list.join(" ")}]` };
}

export function parseFeatureBundleText(text, options = {}) {
  const { allowBare = true, allowVariables = true } = options;
  const inner = stripBrackets(text);
  if (!inner.trim()) return { ok: false, error: "A feature bundle cannot be empty." };
  const words = inner.split(/[\s,;]+/u).filter(Boolean);
  const classified = classifyFeatureWords(words, { allowBare, allowVariables });
  if (classified.kind === "none") return null;
  if (classified.kind === "error") return { ok: false, error: classified.error };
  return { ok: true, terms: classified.terms, source: classified.source };
}

export function normalizeFeatureOverrides(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [sound, bundle] of Object.entries(raw)) {
    const key = soundKey(sound);
    if (!key || !bundle || typeof bundle !== "object" || Array.isArray(bundle)) continue;
    result[key] = normalizeBundle(bundle);
  }
  return result;
}

export function isFeatureBundleText(text, options = {}) {
  const parsed = parseFeatureBundleText(text, options);
  return Boolean(parsed && parsed.ok);
}

export function describeTerm(term) {
  if (term.kind === "bool") return `${term.value ? "+" : "-"}${term.feature}`;
  if (term.kind === "cat") return `${term.feature}=${term.value}`;
  if (term.kind === "var") return `${term.variable}${term.feature}`;
  return "";
}

export function describeTerms(terms) {
  return (terms || []).map(describeTerm).filter(Boolean).join(" ");
}

export function describeBundle(bundle, { full = false } = {}) {
  if (!bundle) return [];
  const pieces = [];
  for (const name of FEATURE_NAMES) {
    const def = FEATURE_DEFINITIONS[name];
    if (def.type === "derived") continue;
    if (name === "anterior" && bundle.anterior === null) continue;
    const value = bundle[name];
    if (value === null || value === undefined) {
      if (full) pieces.push(`∅${name}`);
      continue;
    }
    if (def.type === "categorical") pieces.push(`${name}=${value}`);
    else if (def.type === "boolean") {
      if (value === false && !full) continue;
      pieces.push(`${value ? "+" : "-"}${name}`);
    }
  }
  return pieces;
}

export function derivedFeatures(bundle) {
  return ["labial", "coronal", "dorsal", "radical", "laryngeal"].filter((name) =>
    derivedFeatureValue(bundle, name)
  );
}

/* ---- matching and mutation --------------------------------------------- */

export function matchFeatureTerms(bundle, terms, bindings = {}) {
  if (!bundle) return false;
  for (const term of terms || []) {
    const value = featureValue(bundle, term.feature);
    if (term.kind === "bool") {
      if (value === null || value === undefined || value !== term.value) return false;
      continue;
    }
    if (term.kind === "cat") {
      if (value !== term.value) return false;
      continue;
    }
    if (term.kind === "var") {
      if (value === null || value === undefined) return false;
      if (!Object.prototype.hasOwnProperty.call(bindings, term.variable)) {
        bindings[term.variable] = value;
        continue;
      }
      if (bindings[term.variable] !== value) return false;
      continue;
    }
    return false;
  }
  return true;
}

export function applyFeatureTerms(bundle, terms, bindings = {}) {
  if (!bundle) return { ok: false, error: "This segment has no feature bundle." };
  const next = cloneBundle(bundle);
  const explicit = {};
  for (const term of terms || []) {
    const def = FEATURE_DEFINITIONS[term.feature];
    if (!def) return { ok: false, error: `No feature is named “${term.feature}”.` };
    if (def.type === "derived") {
      return {
        ok: false,
        error: `“${term.feature}” is derived from place; change [place=…] instead.`,
      };
    }
    if (term.kind === "var") {
      if (!Object.prototype.hasOwnProperty.call(bindings, term.variable)) {
        return { ok: false, error: `The variable ${term.variable} is not bound.` };
      }
      const value = bindings[term.variable];
      if (value === null || value === undefined) {
        return { ok: false, error: `The variable ${term.variable} has no value to copy.` };
      }
      next[term.feature] = value;
      explicit[term.feature] = value;
      continue;
    }
    next[term.feature] = term.value;
    explicit[term.feature] = term.value;
  }
  return { ok: true, bundle: canonicalizeBundle(next, explicit) };
}

export function featureDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (const name of FEATURE_NAMES) {
    const def = FEATURE_DEFINITIONS[name];
    if (def.type === "derived") continue;
    const left = a[name] ?? null;
    const right = b[name] ?? null;
    if (left !== right) distance += 1;
  }
  return distance;
}

export function featureDifferences(a, b) {
  if (!a || !b) return [];
  const differences = [];
  for (const name of FEATURE_NAMES) {
    const def = FEATURE_DEFINITIONS[name];
    if (def.type === "derived") continue;
    const left = a[name] ?? null;
    const right = b[name] ?? null;
    if (left !== right) differences.push(name);
  }
  return differences;
}

export function nearestBundles(target, candidates, limit = 3) {
  return (candidates || [])
    .map((candidate) => ({
      ...candidate,
      distance: featureDistance(target, candidate.bundle),
      differences: featureDifferences(target, candidate.bundle),
    }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((a, b) => a.distance - b.distance || a.sound.localeCompare(b.sound))
    .slice(0, limit);
}

export function featureDifferenceLabel(names) {
  return (names || []).map((name) => featureLabel(name)).join(", ");
}

// Resolve a complete bundle back to exactly one charted symbol. The chart is
// the current generation's inventory: a sound that exists only in an ancestor
// is not a valid output of a change in this language.
export function resolveFeatureBundle(bundle, phonemes, resolver) {
  if (!bundle) return { ok: false, error: "This segment has no feature bundle." };
  const candidates = [];
  for (const sound of phonemes || []) {
    const candidate = resolver?.bundleFor(sound);
    if (candidate) candidates.push({ sound, bundle: candidate });
  }
  const exact = candidates.filter((candidate) => featureDistance(bundle, candidate.bundle) === 0);
  const shown = describeBundle(bundle);
  const description = shown.length ? `[${shown.join(" ")}]` : "that feature bundle";
  if (exact.length === 1) return { ok: true, sound: exact[0].sound, bundle };
  if (exact.length > 1) {
    return {
      ok: false,
      ambiguity: true,
      candidates: exact.map((candidate) => candidate.sound),
      error: `The feature bundle ${description} matches more than one charted sound (${exact
        .map((candidate) => `“${candidate.sound}”`)
        .join(", ")}). Remove the duplicate or give one of them a feature override.`,
    };
  }
  const suggestions = nearestBundles(bundle, candidates, 3);
  const suggestionText = suggestions.length
    ? ` Nearest charted ${suggestions.length === 1 ? "sound" : "sounds"}: ${suggestions
        .map((candidate) => {
          const differences = candidate.differences.length
            ? `differs in ${featureDifferenceLabel(candidate.differences)}`
            : "same features";
          return `“${candidate.sound}” (${differences})`;
        })
        .join(", ")}.`
    : " The chart is empty.";
  return {
    ok: false,
    suggestions,
    error: `No charted sound has the feature bundle ${description}.${suggestionText} Add the sound to the chart or change the rule.`,
  };
}

export function featureMembers(phonemes, resolver, terms) {
  const members = [];
  for (const sound of phonemes || []) {
    const bundle = resolver?.bundleFor(sound);
    if (!bundle) continue;
    if (matchFeatureTerms(bundle, terms, {})) members.push(sound);
  }
  return members;
}

export function featureQueryErrorName(terms) {
  return describeTerms(terms) || "the feature bundle";
}
