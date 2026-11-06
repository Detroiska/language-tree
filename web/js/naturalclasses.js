// Chart-derived natural classes.
//
// A class reference names the phonology table itself instead of listing
// sounds: `plosive.plain`, `V.back`, or a bare axis label like `back`.
//
//   ref          = chart? label ("." label)*
//   chart        = "v" | "c" | "vowel" | "consonant"   (case-insensitive)
//   label        = one chart row/column (sub)label, with spaces, dashes,
//                  slashes and similar punctuation all read as one break,
//                  so "Dental/Alveolar" can be written `dental-alveolar`
//
// Matching rule: a sound is a member when every listed label applies to it
// on whichever axis (rows or columns) that label occurs in the chart. A
// label present on both axes constrains both, which is how
// `plosive.plain` ends up meaning exactly the plain oral stops: a sound
// must be plosive by manner row, "Plain" on the manner's own subdivision,
// and "Plain" on the place column (so aspirated ones drop out). Labels
// missing from the reference's chart make the class invalid, so typos fail
// loudly instead of silently matching nothing.
//
// `V.` / `C.` pins the reference to the vowel or consonant chart; a bare
// label applies to whichever charts mention it. The index is rebuilt from
// the charts on every context, so classes always reflect the table.

const PIN_TOKENS = new Map([
  ["v", "vowel"],
  ["c", "consonant"],
  ["vowel", "vowel"],
  ["consonant", "consonant"],
]);

export function normalizeLabelKey(text) {
  return String(text || "")
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function buildClassIndex(charts) {
  const list = Array.isArray(charts) ? charts : [];
  const built = [];
  const labelKinds = new Map();

  for (const { chart, kind } of list) {
    if (!chart) continue;
    const entry = { kind, chart, axisKeys: { row: new Set(), col: new Set() }, phonemes: [] };
    const leafPaths = (nodes, path = [], out = []) => {
      for (const node of nodes || []) {
        const nextPath = [...path, node];
        if (node.children && node.children.length) leafPaths(node.children, nextPath, out);
        else out.push({ node, path: nextPath });
      }
      return out;
    };
    const collectLabels = (nodes, into) => {
      for (const node of nodes || []) {
        into.add(normalizeLabelKey(node.label));
        collectLabels(node.children || [], into);
      }
      return into;
    };
    const rowLeaves = leafPaths(chart.rows || []);
    const colLeaves = leafPaths(chart.columns || []);
    collectLabels(chart.rows || [], entry.axisKeys.row);
    collectLabels(chart.columns || [], entry.axisKeys.col);
    const rowByLeaf = new Map(rowLeaves.map((leaf) => [leaf.node.id, leaf]));
    const colByLeaf = new Map(colLeaves.map((leaf) => [leaf.node.id, leaf]));
    for (const [key, sounds] of Object.entries(chart.cells || {})) {
      if (!Array.isArray(sounds)) continue;
      const [rowId, columnId] = key.split("|");
      const rowLeaf = rowByLeaf.get(rowId);
      const colLeaf = colByLeaf.get(columnId);
      if (!rowLeaf || !colLeaf) continue;
      for (const phoneme of sounds) {
        if (typeof phoneme !== "string" || !phoneme.trim()) continue;
        entry.phonemes.push({
          phoneme,
          row: rowLeaf.path.map((node) => normalizeLabelKey(node.label)).filter(Boolean),
          col: colLeaf.path.map((node) => normalizeLabelKey(node.label)).filter(Boolean),
        });
      }
    }
    for (const axis of ["row", "col"]) {
      for (const key of entry.axisKeys[axis]) {
        if (!key) continue;
        if (!labelKinds.has(key)) labelKinds.set(key, new Set());
        labelKinds.get(key).add(kind);
      }
    }
    built.push(entry);
  }

  const kindsOf = (key) => labelKinds.get(key) || new Set();
  // Template scanning matches labels inside compact chunks, so it wants the
  // keys sorted by length with single-character labels excluded: those stay
  // phonemes. parseClassRef still accepts every key through labelKeys.
  const sortedLabels = [...labelKinds.keys()]
    .filter((key) => Array.from(key).length >= 2)
    .sort((a, b) => Array.from(b).length - Array.from(a).length || a.localeCompare(b));
  return { charts: built, labelKeys: labelKinds, kindsOf, sortedLabels };
}

function failed(source, message) {
  return { ok: false, source, error: message };
}

// Parse a chunk into a class reference. Returns
//   { ok: true, chart, labels, source }   a class reference
//   { ok: false, source, error }          a broken class reference
//   null                                  not a class at all
// A bare word counts as a class only when it matches some chart label, so
// ordinary sound sequences keep their literal reading.
export function parseClassRef(text, index) {
  const source = String(text || "").normalize("NFC").trim();
  if (!source || /\s/u.test(source)) return null;
  const index_ = index && index.labelKeys instanceof Map ? index : { labelKeys: new Map() };
  const parts = source.split(".");
  if (parts.length === 1) {
    const key = normalizeLabelKey(parts[0]);
    // Single letters stay phonemes; two or more letters that name a chart
    // label become classes, which is what makes bare `back` useful.
    if (Array.from(key).length < 2) return null;
    // "vowel" / "consonant" name the whole chart, equivalent to V and C.
    const barePin = PIN_TOKENS.get(key);
    if (key.length >= 5 && barePin) return { ok: true, chart: barePin, labels: [], source };
    if (!index_.labelKeys.has(key)) return null;
    return { ok: true, chart: null, labels: [key], source };
  }

  let chart = null;
  let rest = parts;
  const pinKey = normalizeLabelKey(parts[0]).replace(/-/gu, "");
  if (parts.length >= 2 && PIN_TOKENS.has(pinKey)) {
    chart = PIN_TOKENS.get(pinKey);
    rest = parts.slice(1);
  }
  const labels = rest.map((part) => normalizeLabelKey(part));
  if (rest.some((part) => !part.trim())) {
    return failed(source, `The class reference “${source}” has an empty part between dots.`);
  }
  if (!labels.length) return { ok: true, chart, labels: [], source };
  for (const key of labels) {
    const kinds = index_.kindsOf(key);
    if (!kinds.size) {
      return failed(source, `No chart row or column is labelled “${key}” (from “${source}”).`);
    }
    if (chart && !kinds.has(chart)) {
      return failed(source, `The ${chart} chart has no axis label “${key}” (from “${source}”).`);
    }
  }
  return { ok: true, chart, labels, source };
}

// Which charts the reference applies to and what each requires. A chart is
// eligible when it is pinned, or (unpinned) when it mentions at least one of
// the labels. A chart's requirement per label: constrain an axis only when
// that axis actually has such a label.
function planForChart(entry, ref) {
  const plan = { row: [], col: [] };
  let mentions = false;
  for (const key of ref.labels) {
    if (entry.axisKeys.row.has(key)) {
      plan.row.push(key);
      mentions = true;
    }
    if (entry.axisKeys.col.has(key)) {
      plan.col.push(key);
      mentions = true;
    }
  }
  if (!ref.chart && !mentions) return null;
  return plan;
}

function resolveClassRef(index, ref) {
  const members = [];
  if (!ref || !ref.ok) return { members, empty: true };
  for (const entry of index?.charts || []) {
    if (ref.chart && entry.kind !== ref.chart) continue;
    if (!ref.labels.length) {
      for (const item of entry.phonemes) members.push(item.phoneme);
      continue;
    }
    const plan = planForChart(entry, ref);
    if (!plan) continue;
    for (const item of entry.phonemes) {
      let ok = true;
      for (const key of plan.row) {
        if (!item.row.includes(key)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (const key of plan.col) {
          if (!item.col.includes(key)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) members.push(item.phoneme);
    }
  }
  const unique = [...new Set(members)];
  return { members: unique, empty: unique.length === 0 };
}

// Convenience for engines and views: parse plus resolve in one step.
export function classForText(text, index) {
  const ref = parseClassRef(text, index);
  if (!ref) return null;
  if (!ref.ok) return { ok: false, source: ref.source, error: ref.error, ref };
  const resolved = resolveClassRef(index, ref);
  return { ok: true, source: ref.source, ref, members: resolved.members, empty: resolved.empty };
}

// Refs worth offering in the UI: every chart label, plus parent.child
// pairs where a node is subdivided. Single-label refs always appear;
// chain and chart-pinned variants are dropped when they would resolve to
// the same members as an entry already listed. Each entry carries its
// resolved members.
export function suggestClassRefs(index) {
  const suggestions = new Map();
  const signatures = new Set();

  const add = (source, display = source, { chain } = {}) => {
    if (!source || suggestions.has(source)) return;
    const result = classForText(source, index);
    if (!result || !result.ok) return;
    const signature = result.members.join("\u0001");
    if (chain && signatures.has(signature)) return;
    signatures.add(signature);
    suggestions.set(source, {
      ref: source,
      label: display || source,
      members: result.members,
      empty: result.empty,
      chart: result.ref.chart || "",
    });
  };

  for (const entry of index?.charts || []) {
    const walk = (nodes, parentKey = "") => {
      for (const node of nodes || []) {
        const key = normalizeLabelKey(node.label);
        const shown = typeof node.label === "string" ? node.label.trim() : "";
        if (key) add(key, shown);
        if (parentKey) {
          add(`${parentKey}.${key}`, `${parentKey}.${key}`, { chain: true });
          if (entry.kind === "vowel") add(`v.${parentKey}.${key}`, `v.${parentKey}.${key}`, { chain: true });
          if (entry.kind === "consonant") add(`c.${parentKey}.${key}`, `c.${parentKey}.${key}`, { chain: true });
        }
        walk(node.children || [], key || parentKey);
      }
    };
    walk(entry.chart?.rows || []);
    walk(entry.chart?.columns || []);
  }
  return [...suggestions.values()].filter((item) => !item.empty);
}

// ---- typed-query policy ---------------------------------------------------
//
// Pure helpers for the rule-field class autocomplete, kept here so the
// trigger and matching policy is DOM-free and covered by the engine tests;
// the DOM wiring in autocomplete.js stays thin.

// A rule-field token is worth suggesting against when it could plausibly be
// a class reference: at least two characters (a single letter is an ordinary
// phoneme in rule text, so typing a rule must never open the list by itself),
// containing only letters, digits and the dots and dashes labels use.
// Notation pieces — `>`, `[`, `#`, spaces — never suggest; the return value
// is "" when the token should not trigger.
export function suggestQuery(tokenText) {
  const query = String(tokenText ?? "").normalize("NFC").trim().toLowerCase();
  if (!query || query.length < 2) return "";
  if (/[^a-z\p{L}\p{N}.\-]/u.test(query)) return "";
  return query;
}

// A reference matches when it starts with the query, or when the query
// matches a later dotted segment — typing `.pl` still finds `plosive.plain`.
export function matchesQuery(ref, query) {
  const lower = String(ref ?? "").toLowerCase();
  if (lower.startsWith(query)) return true;
  return lower.split(".").some((part) => part.startsWith(query));
}

// Lower is more relevant: exact, then prefix, then a later dotted segment.
function matchRank(ref, query) {
  const lower = String(ref ?? "").toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  const index = lower.split(".").findIndex((part) => part.startsWith(query));
  return index === -1 ? Infinity : 2 + index;
}

// The displayed list: matched references, ranked by match quality (exact
// before prefix before later segment, shorter labels breaking ties) and then
// capped. Kept here with the rest of the policy so the cap and the ordering
// live in one place.
export function filterSuggestions(suggestions, query, limit = 8) {
  return suggestions
    .map((item, order) => ({ item, order, rank: matchRank(item.ref, query) }))
    .filter((entry) => entry.rank !== Infinity)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.item.ref.length - right.item.ref.length ||
        left.order - right.order
    )
    .slice(0, limit)
    .map((entry) => entry.item);
}
