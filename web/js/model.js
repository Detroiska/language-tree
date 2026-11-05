import { stripLevelMarks } from "./notation.js";
import { normalizeFeatureOverrides } from "./features.js";

let fallbackCounter = 0;

export function uid(prefix = "id") {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  fallbackCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${fallbackCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function axisNode(label, kind, children = []) {
  return {
    id: uid(kind === "row" ? "row" : "col"),
    label,
    children,
  };
}

const CONSONANT_MANNERS = [
  "Plosive",
  "Affricate",
  "Nasal",
  "Trill",
  "Tap / flap",
  "Fricative",
  "Lateral fricative",
  "Approximant",
  "Lateral approximant",
];

const CONSONANT_PLACES = [
  "Bilabial",
  "Labiodental",
  "Dental",
  "Alveolar",
  "Postalveolar",
  "Retroflex",
  "Palatal",
  "Velar",
  "Uvular",
  "Pharyngeal",
  "Glottal",
];

const VOWEL_HEIGHTS = ["Close", "Near-close", "Close-mid", "Mid", "Open-mid", "Near-open", "Open"];
const VOWEL_BACKNESS = ["Front", "Central", "Back"];

export function defaultConsonantChart() {
  return {
    rows: CONSONANT_MANNERS.map((label) => axisNode(label, "row")),
    columns: CONSONANT_PLACES.map((label) => axisNode(label, "col")),
    cells: {},
    notes: "",
  };
}

export function defaultVowelChart() {
  return {
    rows: VOWEL_HEIGHTS.map((label) => axisNode(label, "row")),
    columns: VOWEL_BACKNESS.map((label) =>
      axisNode(label, "col", [axisNode("Unrounded", "col"), axisNode("Rounded", "col")])
    ),
    cells: {},
    notes: "",
  };
}

export function defaultInventory() {
  return {
    consonants: defaultConsonantChart(),
    vowels: defaultVowelChart(),
  };
}

// The phonotactics template is deliberately data, not code: every language
// carries its own copy so a daughter can inherit and then diverge. Empty
// constraint lists mean "no extra restriction beyond the template".
// Categories are the language's named sound classes (N, G, L, …) usable in
// the template and forbidden sequences. Onsets and codas keep separate
// allowed and forbidden lists so switching modes never rewrites the text.
export function defaultPhonotactics() {
  return {
    template: "(C)V(C)",
    onsets: "",
    codas: "",
    onsetsMode: "allowed",
    codasMode: "allowed",
    forbiddenOnsets: "",
    forbiddenCodas: "",
    forbidden: "",
    notes: "",
    classes: [],
  };
}

export function createLanguage(
  name,
  parentId = null,
  template = null,
  phonotactics = null,
  allophony = null,
  featureOverrides = null
) {
  return {
    id: uid("lang"),
    name: name.trim() || "Untitled language",
    parentId,
    notes: "",
    inventory: template ? deepClone(template) : defaultInventory(),
    phonotactics: phonotactics ? ensurePhonotactics(deepClone(phonotactics)) : defaultPhonotactics(),
    soundChanges: [],
    // Allophony is synchronic grammar, not a historical change: it is copied
    // to daughters like phonotactics, but it never enters the cognate chain.
    allophony: allophony ? deepClone(allophony) : [],
    // Curated IPA features cover common symbols; overrides describe custom
    // symbols. They are inherited with the chart so a daughter keeps the same
    // feature semantics until someone edits its panel.
    featureOverrides: normalizeFeatureOverrides(featureOverrides),
    vocabulary: [],
    createdAt: new Date().toISOString(),
  };
}

export function createProject(title = "Untitled language family") {
  const now = new Date().toISOString();
  return {
    version: 1,
    title,
    createdAt: now,
    updatedAt: now,
    languages: [],
  };
}

function ensureAxisNode(node, kind, seen) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  if (typeof node.id === "number") node.id = String(node.id);
  if (typeof node.id !== "string" || !node.id || seen.has(node.id)) {
    node.id = uid(kind === "row" ? "row" : "col");
  }
  seen.add(node.id);
  if (typeof node.label !== "string" || !node.label.trim()) node.label = "Unnamed";
  if (!Array.isArray(node.children)) node.children = [];
  node.children = node.children.map((child) => ensureAxisNode(child, kind, seen)).filter(Boolean);
  return node;
}

function ensureChart(chart, fallbackFactory, kind) {
  const base = chart && typeof chart === "object" && !Array.isArray(chart) ? chart : fallbackFactory();
  if (!Array.isArray(base.rows)) base.rows = fallbackFactory().rows;
  if (!Array.isArray(base.columns)) base.columns = fallbackFactory().columns;
  if (!base.cells || typeof base.cells !== "object" || Array.isArray(base.cells)) base.cells = {};
  if (typeof base.notes !== "string") base.notes = "";
  const seen = new Set();
  base.rows = base.rows.map((node) => ensureAxisNode(node, "row", seen)).filter(Boolean);
  const colSeen = new Set();
  base.columns = base.columns.map((node) => ensureAxisNode(node, "col", colSeen)).filter(Boolean);
  // Cells belong to leaf intersections. Entries that point at a missing
  // row/column are dropped; entries that point at an interior group are
  // migrated to that group's leftmost leaf so hand-edited or legacy files do
  // not silently lose sounds.
  const anchorMap = (nodes) => {
    const map = new Map();
    const walk = (node) => {
      if (!node) return;
      map.set(node.id, nodeLeafIds(node)[0]);
      node.children?.forEach(walk);
    };
    nodes.forEach(walk);
    return map;
  };
  const rowAnchors = anchorMap(base.rows);
  const columnAnchors = anchorMap(base.columns);
  // Drop malformed cell values but keep valid phoneme arrays.
  for (const [key, value] of Object.entries(base.cells)) {
    const { rowId, columnId } = splitCellKey(key);
    const rowTarget = rowAnchors.get(rowId);
    const columnTarget = columnAnchors.get(columnId);
    if (!rowTarget || !columnTarget || !Array.isArray(value)) {
      delete base.cells[key];
      continue;
    }
    const values = [
      ...new Set(
        value
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => stripLevelMarks(item))
          .filter(Boolean)
      ),
    ];
    if (!values.length) {
      delete base.cells[key];
      continue;
    }
    const targetKey = cellKey(rowTarget, columnTarget);
    if (targetKey === key) {
      base.cells[key] = values;
      continue;
    }
    // Migrate: merge into the leaf cell, deduping sounds already there.
    const merged = [...new Set([...(base.cells[targetKey] || []), ...values])];
    delete base.cells[key];
    if (merged.length) base.cells[targetKey] = merged;
  }
  return base;
}

export function isAllophonyGroup(item) {
  return Boolean(item && typeof item === "object" && !Array.isArray(item) && item.type === "group");
}

function ensureAllophony(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  const seen = new Set();
  const uniqueId = (id, prefix) => {
    let next = typeof id === "string" && id && !seen.has(id) ? id : uid(prefix);
    while (seen.has(next)) next = uid(prefix);
    seen.add(next);
    return next;
  };
  const normalizeRule = (rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || isAllophonyGroup(rule)) return null;
    return {
      id: uniqueId(rule.id, "allo"),
      notation: typeof rule.notation === "string" ? rule.notation : "",
      note: typeof rule.note === "string" ? rule.note : "",
      enabled: rule.enabled !== false,
    };
  };
  // Groups are one level deep. A malformed nested group is flattened into its
  // parent rather than hiding its rules.
  const collectRules = (entries, rules) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (isAllophonyGroup(entry)) {
        collectRules(entry.rules, rules);
        continue;
      }
      const rule = normalizeRule(entry);
      if (rule) rules.push(rule);
    }
  };
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (!isAllophonyGroup(entry)) {
      const rule = normalizeRule(entry);
      if (rule) items.push(rule);
      continue;
    }
    const rules = [];
    collectRules(entry.rules, rules);
    items.push({
      id: uniqueId(entry.id, "allogroup"),
      type: "group",
      name: typeof entry.name === "string" ? entry.name : "",
      collapsed: entry.collapsed === true,
      enabled: entry.enabled !== false,
      rules,
    });
  }
  return items;
}

// Allophony is stored as an ordered list of rules and group containers. Groups
// are visual organization only: entries() flattens them back into the exact
// order the engine applies, while keeping the display number (2.1, 2.2, …).
export function allophonyEntries(items) {
  const entries = [];
  let topIndex = 0;
  for (const item of items || []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    topIndex += 1;
    if (isAllophonyGroup(item)) {
      const rules = Array.isArray(item.rules) ? item.rules : [];
      let childIndex = 0;
      for (const rule of rules) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule) || isAllophonyGroup(rule)) continue;
        childIndex += 1;
        entries.push({ rule, group: item, number: `${topIndex}.${childIndex}` });
      }
      continue;
    }
    entries.push({ rule: item, group: null, number: String(topIndex) });
  }
  return entries;
}

export function allophonyRules(items) {
  return allophonyEntries(items).map((entry) => entry.rule);
}

// Move a consecutive run of rules into a new group. Returning a status instead
// of a boolean lets the view explain why a selection cannot be grouped. A group
// is a single container, so a run that starts or ends in the middle of an
// existing group cannot be extracted without reordering the rules around it.
export function groupAllophonyRules(language, selectedIds) {
  const selected = new Set(selectedIds || []);
  const items = language?.allophony || [];
  const entries = allophonyEntries(items);
  const positions = [];
  entries.forEach((entry, index) => {
    if (selected.has(entry.rule.id)) positions.push(index);
  });
  if (!positions.length) return "empty";
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] !== positions[index - 1] + 1) return "noncontiguous";
  }
  const start = positions[0];
  const selectedRules = positions.map((index) => entries[index].rule);

  const remaining = [];
  for (const item of items) {
    if (isAllophonyGroup(item)) {
      const rules = item.rules.filter((rule) => !selected.has(rule.id));
      if (!rules.length) continue;
      remaining.push(rules.length === item.rules.length ? item : { ...item, rules });
    } else if (!selected.has(item.id)) {
      remaining.push(item);
    }
  }

  // Insert after as many remaining rules as came before the selected run. If
  // that point falls inside a group, the run was taken from that group's
  // middle: splitting the leftovers would be more surprising than refusing.
  let insertAt = remaining.length;
  let before = 0;
  for (let index = 0; index < remaining.length; index += 1) {
    if (before === start) {
      insertAt = index;
      break;
    }
    const item = remaining[index];
    const count = isAllophonyGroup(item) ? item.rules.length : 1;
    if (before + count > start) return "inside";
    before += count;
  }
  if (insertAt === remaining.length && before < start) return "inside";

  remaining.splice(insertAt, 0, {
    id: uid("allogroup"),
    type: "group",
    name: "",
    collapsed: false,
    enabled: true,
    rules: selectedRules,
  });
  language.allophony = remaining;
  return "ok";
}

function ensurePhonotactics(value) {
  const defaults = defaultPhonotactics();
  const base = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = (raw) => (raw === "forbidden" ? "forbidden" : "allowed");
  return {
    // An explicitly empty template is meaningful: it turns phonotactic
    // checking off. Only a missing field gets the default template.
    template: typeof base.template === "string" ? base.template : defaults.template,
    onsets: typeof base.onsets === "string" ? base.onsets : defaults.onsets,
    codas: typeof base.codas === "string" ? base.codas : defaults.codas,
    onsetsMode: mode(base.onsetsMode),
    codasMode: mode(base.codasMode),
    forbiddenOnsets:
      typeof base.forbiddenOnsets === "string" ? base.forbiddenOnsets : defaults.forbiddenOnsets,
    forbiddenCodas:
      typeof base.forbiddenCodas === "string" ? base.forbiddenCodas : defaults.forbiddenCodas,
    forbidden: typeof base.forbidden === "string" ? base.forbidden : defaults.forbidden,
    notes: typeof base.notes === "string" ? base.notes : defaults.notes,
    classes: Array.isArray(base.classes)
      ? base.classes
          .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
          .map((entry) => ({
            name: typeof entry.name === "string" ? entry.name : "",
            sounds: typeof entry.sounds === "string" ? entry.sounds : "",
          }))
      : [],
  };
}

export function ensureProject(raw) {
  const project = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : createProject();
  if (typeof project.title !== "string" || !project.title.trim()) project.title = "Untitled language family";
  if (!Array.isArray(project.languages)) project.languages = [];
  if (!project.createdAt) project.createdAt = new Date().toISOString();
  if (!project.updatedAt) project.updatedAt = project.createdAt;
  project.version = 1;

  const ids = new Set();
  project.languages = project.languages.filter((language) => {
    if (!language || typeof language !== "object" || Array.isArray(language) || !language.name) return false;
    if (typeof language.id === "number") language.id = String(language.id);
    if (typeof language.id !== "string" || !language.id || ids.has(language.id)) language.id = uid("lang");
    ids.add(language.id);
    return true;
  });

  for (const language of project.languages) {
    language.name = String(language.name).trim() || "Untitled language";
    language.notes = typeof language.notes === "string" ? language.notes : "";
    if (typeof language.parentId === "number") language.parentId = String(language.parentId);
    language.parentId = typeof language.parentId === "string" ? language.parentId : null;
    if (language.parentId && !ids.has(language.parentId)) language.parentId = null;
    language.inventory = language.inventory && typeof language.inventory === "object" && !Array.isArray(language.inventory) ? language.inventory : {};
    language.inventory.consonants = ensureChart(language.inventory.consonants, defaultConsonantChart, "row");
    language.inventory.vowels = ensureChart(language.inventory.vowels, defaultVowelChart, "col");
    language.phonotactics = ensurePhonotactics(language.phonotactics);
    language.soundChanges = Array.isArray(language.soundChanges)
      ? language.soundChanges
          .filter((rule) => rule && typeof rule === "object")
          .map((rule) => ({
            id: rule.id || uid("rule"),
            notation: typeof rule.notation === "string" ? rule.notation : "",
            note: typeof rule.note === "string" ? rule.note : "",
            enabled: rule.enabled !== false,
            parentId: typeof rule.parentId === "string" ? rule.parentId : null,
          }))
      : [];
    // Sequential rules are children of a top-level rule. Only one level of
    // nesting is supported: a parent must itself be a top-level rule.
    const topLevelRuleIds = new Set(
      language.soundChanges.filter((rule) => !rule.parentId).map((rule) => rule.id)
    );
    for (const rule of language.soundChanges) {
      if (rule.parentId && !topLevelRuleIds.has(rule.parentId)) rule.parentId = null;
    }
    language.soundChanges = normalizeRuleOrder(language.soundChanges);
    language.allophony = ensureAllophony(language.allophony);
    language.featureOverrides = normalizeFeatureOverrides(language.featureOverrides);
    language.vocabulary = Array.isArray(language.vocabulary)
      ? language.vocabulary
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => ({
            id: entry.id || uid("word"),
            gloss: typeof entry.gloss === "string" ? entry.gloss : "",
            // A form pasted as /kasa/ or [kʰasa] is still one lexical form.
            // Keep the stored value bare so tokenizing and comparison stay
            // level-agnostic; the UI adds the marks back for display.
            form: typeof entry.form === "string" ? stripLevelMarks(entry.form) : "",
            note: typeof entry.note === "string" ? entry.note : "",
          }))
      : [];
  }

  // A parent link must point to a real, different language, and cycles are
  // repaired by detaching the language that closes the loop.
  for (const language of project.languages) {
    if (!language.parentId) continue;
    if (language.parentId === language.id) {
      language.parentId = null;
      continue;
    }
    let cursor = project.languages.find((item) => item.id === language.parentId);
    const seen = new Set([language.id]);
    while (cursor) {
      if (seen.has(cursor.id)) {
        language.parentId = null;
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parentId ? project.languages.find((item) => item.id === cursor.parentId) : null;
    }
  }

  if (!project.languages.length) {
    project.languages.push(createLanguage("Proto-Language"));
  }

  normalizeSiblingOrder(project);
  return project;
}

export function normalizeSiblingOrder(project) {
  // Arrays are the source of truth for sibling order. This helper exists to
  // make that convention explicit and gives migrations a stable landing point.
  return project.languages;
}

export function findLanguage(project, id) {
  return project.languages.find((language) => language.id === id) || null;
}

export function childrenOf(project, parentId) {
  return project.languages.filter((language) => language.parentId === parentId);
}

export function rootLanguages(project) {
  return project.languages.filter((language) => !language.parentId || !findLanguage(project, language.parentId));
}

export function getLineage(project, id) {
  const result = [];
  const seen = new Set();
  let current = findLanguage(project, id);
  while (current && !seen.has(current.id)) {
    result.unshift(current);
    seen.add(current.id);
    current = current.parentId ? findLanguage(project, current.parentId) : null;
  }
  return result;
}

export function ancestorsOf(project, id) {
  return getLineage(project, id).slice(0, -1);
}

export function descendantIds(project, id) {
  const result = new Set();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const child of childrenOf(project, current)) {
      if (!result.has(child.id)) {
        result.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return result;
}

export function canSetParent(project, languageId, parentId) {
  if (!parentId) return true;
  if (parentId === languageId) return false;
  if (!findLanguage(project, parentId)) return false;
  return !descendantIds(project, languageId).has(parentId);
}

export function setParent(project, languageId, parentId) {
  if (!canSetParent(project, languageId, parentId)) return false;
  const language = findLanguage(project, languageId);
  if (!language) return false;
  language.parentId = parentId || null;
  return true;
}

// Insert a new language above an existing one, so a root can gain an ancestor
// and a daughter can gain an intermediate stage. The descendant's inventory is
// used as the starting point, which makes working backwards in time practical.
export function createAncestor(project, languageId, name) {
  const language = findLanguage(project, languageId);
  if (!language) return null;
  const ancestor = createLanguage(
    name,
    language.parentId,
    language.inventory,
    language.phonotactics,
    language.allophony,
    language.featureOverrides
  );
  const index = project.languages.indexOf(language);
  project.languages.splice(index, 0, ancestor);
  language.parentId = ancestor.id;
  return ancestor;
}

// Create a language at the same level as an existing one. For a root this
// produces another root, for a daughter another daughter of the same parent.
export function createSibling(project, languageId, name) {
  const language = findLanguage(project, languageId);
  if (!language) return null;
  const sibling = createLanguage(
    name,
    language.parentId,
    language.inventory,
    language.phonotactics,
    language.allophony,
    language.featureOverrides
  );
  const index = project.languages.indexOf(language);
  project.languages.splice(index + 1, 0, sibling);
  return sibling;
}

export function deleteLanguage(project, id) {
  const ids = new Set([id, ...descendantIds(project, id)]);
  project.languages = project.languages.filter((language) => !ids.has(language.id));
  return ids;
}

export function depthOf(project, id) {
  return Math.max(0, getLineage(project, id).length - 1);
}

export function descendantsCount(project, id) {
  return descendantIds(project, id).size;
}

export function cellKey(rowId, columnId) {
  return `${rowId}|${columnId}`;
}

export function splitCellKey(key) {
  const [rowId, columnId] = key.split("|");
  return { rowId, columnId };
}

export function chartLeaves(nodes, path = []) {
  const leaves = [];
  for (const node of nodes) {
    const nextPath = [...path, node];
    if (node.children && node.children.length) leaves.push(...chartLeaves(node.children, nextPath));
    else leaves.push({ node, path: nextPath, depth: nextPath.length - 1 });
  }
  return leaves;
}

export function chartMaxDepth(nodes) {
  let max = 0;
  const walk = (items, depth) => {
    for (const item of items) {
      max = Math.max(max, depth);
      if (item.children && item.children.length) walk(item.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return max;
}

export function countLeaves(node) {
  if (!node.children || !node.children.length) return 1;
  return node.children.reduce((total, child) => total + countLeaves(child), 0);
}

export function findAxisNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children && node.children.length) {
      const found = findAxisNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findAxisNodeContext(nodes, id, parent = null) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.id === id) return { node, parent, siblings: nodes, index };
    if (node.children && node.children.length) {
      const found = findAxisNodeContext(node.children, id, node);
      if (found) return found;
    }
  }
  return null;
}

export function nodeLeafIds(node) {
  if (!node.children || !node.children.length) return [node.id];
  return node.children.flatMap((child) => nodeLeafIds(child));
}

export function removeAxisNode(nodes, id) {
  const context = findAxisNodeContext(nodes, id);
  if (!context) return null;
  context.siblings.splice(context.index, 1);
  return context.node;
}

export function addAxisSibling(nodes, id, label, kind) {
  const context = findAxisNodeContext(nodes, id);
  if (!context) return null;
  const node = axisNode(label, kind);
  context.siblings.splice(context.index + 1, 0, node);
  return node;
}

export function addAxisChild(nodes, id, label, kind) {
  const node = findAxisNode(nodes, id);
  if (!node) return null;
  const child = axisNode(label, kind);
  node.children.push(child);
  return { parent: node, child };
}

export function moveAxisNode(nodes, id, direction) {
  const context = findAxisNodeContext(nodes, id);
  if (!context) return false;
  const target = context.index + direction;
  if (target < 0 || target >= context.siblings.length) return false;
  const [node] = context.siblings.splice(context.index, 1);
  context.siblings.splice(target, 0, node);
  return true;
}

export function chartPhonemeList(chart) {
  const values = [];
  for (const cell of Object.values(chart.cells || {})) {
    if (Array.isArray(cell)) values.push(...cell);
  }
  return values;
}

export function inventoryPhonemes(language) {
  return [...new Set([...chartPhonemeList(language.inventory.consonants), ...chartPhonemeList(language.inventory.vowels)])];
}

export function languageStats(language) {
  return {
    consonants: new Set(chartPhonemeList(language.inventory.consonants)).size,
    vowels: new Set(chartPhonemeList(language.inventory.vowels)).size,
    changes: language.soundChanges.length,
    allophony: allophonyRules(language.allophony).length,
    words: language.vocabulary.length,
  };
}

export function projectStats(project) {
  return project.languages.reduce(
    (stats, language) => {
      const item = languageStats(language);
      stats.consonants += item.consonants;
      stats.vowels += item.vowels;
      stats.changes += item.changes;
      stats.allophony += item.allophony;
      stats.words += item.words;
      return stats;
    },
    { languages: project.languages.length, consonants: 0, vowels: 0, changes: 0, allophony: 0, words: 0 }
  );
}

// Sound changes are stored as one flat array, but only top-level rules are
// independently ordered. A sequential rule names its parent with parentId and
// follows that parent on screen. Grouping is order-preserving, so the array
// remains the source of truth for both levels.
export function ruleGroups(rules) {
  const groups = [];
  const byId = new Map();
  for (const rule of rules) {
    if (rule.parentId) continue;
    const group = { rule, children: [] };
    groups.push(group);
    byId.set(rule.id, group);
  }
  for (const rule of rules) {
    if (!rule.parentId) continue;
    const group = byId.get(rule.parentId);
    if (group) {
      group.children.push(rule);
      continue;
    }
    // A missing parent should not make the rule disappear. Treat it as a
    // top-level rule until ensureProject repairs the link.
    const orphan = { rule, children: [] };
    groups.push(orphan);
    byId.set(rule.id, orphan);
  }
  return groups;
}

export function ruleNumberMap(rules) {
  const numbers = new Map();
  ruleGroups(rules).forEach((group, index) => {
    numbers.set(group.rule.id, String(index + 1));
    group.children.forEach((child, childIndex) => {
      numbers.set(child.id, `${index + 1}.${childIndex + 1}`);
    });
  });
  return numbers;
}

export function normalizeRuleOrder(rules) {
  const ordered = [];
  for (const group of ruleGroups(rules)) {
    ordered.push(group.rule, ...group.children);
  }
  return ordered;
}

export function ruleChain(project, languageId, { includeSelf = true } = {}) {
  const lineage = getLineage(project, languageId);
  const languages = includeSelf ? lineage : lineage.slice(0, -1);
  const rules = [];
  for (const language of languages) {
    for (const rule of language.soundChanges) {
      if (rule.enabled !== false) rules.push({ ...rule, sourceLanguage: language });
    }
  }
  return rules;
}

export function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}
