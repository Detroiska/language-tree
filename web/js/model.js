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

export function createLanguage(name, parentId = null, template = null) {
  return {
    id: uid("lang"),
    name: name.trim() || "Untitled language",
    parentId,
    notes: "",
    inventory: template ? deepClone(template) : defaultInventory(),
    soundChanges: [],
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
  if (!node || typeof node !== "object") return null;
  if (!node.id || seen.has(node.id)) node.id = uid(kind === "row" ? "row" : "col");
  seen.add(node.id);
  if (typeof node.label !== "string" || !node.label.trim()) node.label = "Unnamed";
  if (!Array.isArray(node.children)) node.children = [];
  node.children = node.children.map((child) => ensureAxisNode(child, kind, seen)).filter(Boolean);
  return node;
}

function ensureChart(chart, fallbackFactory, kind) {
  const base = chart && typeof chart === "object" ? chart : fallbackFactory();
  if (!Array.isArray(base.rows)) base.rows = fallbackFactory().rows;
  if (!Array.isArray(base.columns)) base.columns = fallbackFactory().columns;
  if (!base.cells || typeof base.cells !== "object" || Array.isArray(base.cells)) base.cells = {};
  if (typeof base.notes !== "string") base.notes = "";
  const seen = new Set();
  base.rows = base.rows.map((node) => ensureAxisNode(node, "row", seen)).filter(Boolean);
  const colSeen = new Set();
  base.columns = base.columns.map((node) => ensureAxisNode(node, "col", colSeen)).filter(Boolean);
  // Drop malformed cell values but keep valid phoneme arrays.
  for (const [key, value] of Object.entries(base.cells)) {
    if (!Array.isArray(value)) {
      delete base.cells[key];
      continue;
    }
    base.cells[key] = [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
    if (!base.cells[key].length) delete base.cells[key];
  }
  return base;
}

export function ensureProject(raw) {
  const project = raw && typeof raw === "object" ? raw : createProject();
  if (typeof project.title !== "string" || !project.title.trim()) project.title = "Untitled language family";
  if (!Array.isArray(project.languages)) project.languages = [];
  if (!project.createdAt) project.createdAt = new Date().toISOString();
  if (!project.updatedAt) project.updatedAt = project.createdAt;
  project.version = 1;

  const ids = new Set();
  project.languages = project.languages.filter((language) => {
    if (!language || typeof language !== "object" || !language.name) return false;
    if (!language.id || ids.has(language.id)) language.id = uid("lang");
    ids.add(language.id);
    return true;
  });

  for (const language of project.languages) {
    language.name = String(language.name).trim() || "Untitled language";
    language.notes = typeof language.notes === "string" ? language.notes : "";
    language.parentId = typeof language.parentId === "string" ? language.parentId : null;
    if (language.parentId && !ids.has(language.parentId)) language.parentId = null;
    language.inventory = language.inventory && typeof language.inventory === "object" ? language.inventory : {};
    language.inventory.consonants = ensureChart(language.inventory.consonants, defaultConsonantChart, "row");
    language.inventory.vowels = ensureChart(language.inventory.vowels, defaultVowelChart, "col");
    language.soundChanges = Array.isArray(language.soundChanges)
      ? language.soundChanges
          .filter((rule) => rule && typeof rule === "object")
          .map((rule) => ({
            id: rule.id || uid("rule"),
            notation: typeof rule.notation === "string" ? rule.notation : "",
            note: typeof rule.note === "string" ? rule.note : "",
            enabled: rule.enabled !== false,
          }))
      : [];
    language.vocabulary = Array.isArray(language.vocabulary)
      ? language.vocabulary
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => ({
            id: entry.id || uid("word"),
            gloss: typeof entry.gloss === "string" ? entry.gloss : "",
            form: typeof entry.form === "string" ? entry.form : "",
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
      stats.words += item.words;
      return stats;
    },
    { languages: project.languages.length, consonants: 0, vowels: 0, changes: 0, words: 0 }
  );
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
