import { normalizeGloss } from "./gloss.js";
import { normalizeWordMeta } from "./lexicon.js";
import { uid } from "./model.js";
import { stripLevelMarks, stripStressMarks } from "./notation.js";
import {
  createPhonotacticsChecker,
  pruneWordStressForForm,
  stressMarkedForm,
} from "./phonotacticsCheck.js";
import { normalizeWordStress, stressMarksFromForm } from "./prosody.js";

// Bulk word import/export: the paste-and-go side door for spreadsheets and
// word lists. Text is parsed as JSON when it looks like JSON, otherwise as a
// delimited table (tab, semicolon, comma, or aligned whitespace — detected by
// whichever separator the lines actually contain). Gaps in data are fine:
// a gloss alone imports as a draft word whose form can be filled in later.

const HEADER_WORDS = new Set(["gloss", "glosses", "meaning", "meanings"]);
const FORM_HEADER_WORDS = new Set(["form", "forms", "ipa", "word", "words", "surface"]);
const NOTE_HEADER_WORDS = new Set(["note", "notes"]);
// Scalar metadata travels in TSV; list fields (senses, tags) round-trip only
// in JSON, where their structure survives exactly.
const SCALAR_META_FIELDS = ["pos", "status", "source", "etymology"];
const META_FIELDS = [...SCALAR_META_FIELDS, "senses", "tags"];
const META_HEADER_WORDS = {
  pos: new Set(["pos", "part of speech"]),
  status: new Set(["status"]),
  source: new Set(["source"]),
  etymology: new Set(["etymology", "etym"]),
};

function metaFrom(entry) {
  const normalized = normalizeWordMeta(entry);
  const meta = {};
  for (const field of META_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) meta[field] = normalized[field];
  }
  return meta;
}

// Duplicate glosses can exist in an older project. applyWordList builds its
// map by assignment, so the last matching word is the one an update changes;
// previews must look at that same word instead of the first match.
function lastWordWithGloss(vocabulary, gloss) {
  const target = normalizeGloss(gloss);
  let found = null;
  for (const word of vocabulary) {
    if (normalizeGloss(word.gloss) === target) found = word;
  }
  return found;
}

// Aligned whitespace (2+ spaces between columns) is a table layout, not a
// single-space token list — keep the two apart or "big house   kasa" would
// split the gloss apart.
const ALIGNED_DELIMITER = "aligned";

// Delimiter detection must ignore separators inside quoted fields: a gloss
// like `"hello; world"` must not turn an otherwise comma-separated paste into
// a semicolon table. Doubled quotes are escapes, same as splitQuotedRows.
function unquotedText(line) {
  let text = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes) text += character;
  }
  return text;
}

function detectDelimiter(text) {
  const unquoted = unquotedText(text);
  if (unquoted.includes("\t")) return "\t";
  if (unquoted.includes(";")) return ";";
  if (unquoted.includes(",")) return ",";
  if (/\S\s{2,}\S/.test(unquoted)) return ALIGNED_DELIMITER;
  return " ";
}

// The delimiter is chosen from the first logical row, not the first physical
// line: a quoted field may contain a line break, and treating that break as a
// row boundary would pick the wrong delimiter for the whole paste.
function firstLogicalLine(text) {
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (character === "\n" && !inQuotes) {
      return text.slice(0, index);
    }
  }
  return text;
}

// RFC 4180 quoting over the whole text, not one line: a quoted field may
// contain the delimiter, doubled quotes, and line breaks. Quote state carries
// across newlines, so a spreadsheet cell like "first line\nsecond line" stays
// one field instead of being cut into a truncated row plus a phantom data
// row. Cells are trimmed like the old single-line parser did; internal line
// breaks and spacing are preserved. Each row remembers the physical line it
// starts on for the preview's line numbers.
function splitQuotedRows(text, delimiter) {
  const rows = [];
  let cells = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  const pushRow = () => {
    cells.push(cell);
    rows.push({ cells: cells.map((value) => String(value).trim()), line: rowStartLine });
    cells = [];
    cell = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (character === "\n") line += 1;
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === delimiter) {
      cells.push(cell);
      cell = "";
      continue;
    }
    if (character === "\n") {
      pushRow();
      line += 1;
      rowStartLine = line;
      continue;
    }
    cell += character;
  }
  // The text is trimmed, so it never ends with a newline; the last row is
  // still pending. Push it when it holds anything at all.
  if (cells.length || cell) pushRow();
  return { rows, unterminated: inQuotes };
}

function formAndStress(value) {
  const raw = String(value ?? "");
  return {
    form: stripStressMarks(stripLevelMarks(raw)),
    // Inline marks in an exported or hand-typed form import as the same
    // per-word stress field the vocabulary picker writes.
    stress: stressMarksFromForm(raw),
  };
}

function rowFromJsonEntry(entry, index) {
  const gloss = String(entry.gloss ?? entry.meaning ?? "").trim();
  const parsed = formAndStress(entry.form ?? entry.ipa ?? "");
  const note = String(entry.note ?? "").trim();
  return {
    ...metaFrom(entry),
    gloss,
    form: parsed.form,
    stress: normalizeWordStress(entry.stress) || parsed.stress,
    note,
    index,
    warning: "",
  };
}

// Returns { delimiter, headerSkipped, rows, warnings, parseError }.
export function parseWordList(text) {
  const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!raw) {
    return { delimiter: "\t", headerSkipped: false, rows: [], warnings: [], parseError: "" };
  }
  const warnings = [];

  if (raw.startsWith("[") || raw.startsWith("{")) {
    let entries = null;
    try {
      entries = JSON.parse(raw);
    } catch (error) {
      // Not valid JSON after all (a bracketed transcription list, say): keep
      // the warning, but fall through to table parsing instead of dropping
      // the whole paste on the floor.
      warnings.push(`The text starts with JSON but could not be parsed (${error.message}); it was read as a table instead.`);
    }
    if (Array.isArray(entries)) {
      const rows = entries
        .map((entry, index) => rowFromJsonEntry(entry && typeof entry === "object" ? entry : {}, index))
        .filter((row) => row.gloss || row.form);
      if (!rows.length) {
        warnings.push(
          "The pasted JSON is valid but is not a word list: no row has a gloss or form. Nothing was imported.",
        );
      }
      return { delimiter: "JSON", headerSkipped: false, rows, warnings, parseError: "" };
    }
    if (entries && typeof entries === "object") {
      // A single {gloss, form, note} object imports as one row.
      const row = rowFromJsonEntry(entries, 0);
      if (row.gloss || row.form) {
        return { delimiter: "JSON", headerSkipped: false, rows: [row], warnings, parseError: "" };
      }
      warnings.push(
        "The pasted JSON is valid but is not a word list: it has no gloss or form. Nothing was imported.",
      );
      return { delimiter: "JSON", headerSkipped: false, rows: [], warnings, parseError: "" };
    }
    // A valid JSON scalar is not a word list; the table parser below still
    // shows the text in the preview.
  }

  // One delimiter for the whole table, chosen from the first logical row so
  // the header and the rows are always cut the same way: a tab hiding inside
  // a later note must not change how the header is read, and vice versa.
  const delimiter = detectDelimiter(firstLogicalLine(raw));

  // Rows as { cells, line } with 1-based physical line numbers.
  const tableRows = [];
  if (delimiter === ALIGNED_DELIMITER || delimiter === " ") {
    // Whitespace layouts have no quoting; keep the plain per-line split.
    raw.split("\n").forEach((line, lineIndex) => {
      if (!line.trim()) return;
      const cells = delimiter === ALIGNED_DELIMITER ? line.trim().split(/\s{2,}/) : line.trim().split(/\s+/);
      tableRows.push({ cells: cells.map((cell) => String(cell).trim()), line: lineIndex + 1 });
    });
  } else {
    const split = splitQuotedRows(raw, delimiter);
    if (split.unterminated) {
      warnings.push("A quoted field was opened but never closed; the table was imported as-is. Check the quotes in the pasted text.");
    }
    tableRows.push(...split.rows);
  }

  // The header may be gloss-first ("gloss,form,note") or form-first
  // ("form,gloss"), detected from the first two cells together so a data
  // row whose gloss happens to be "form" is not eaten as a header.
  let headerSkipped = false;
  let formFirst = false;
  let headerColumns = null;
  if (tableRows.length) {
    const first = tableRows[0].cells.map((cell) => cell.trim().toLowerCase());
    if (HEADER_WORDS.has(first[0])) {
      headerSkipped = true;
      headerColumns = first;
      tableRows.shift();
    } else if (first[0] && FORM_HEADER_WORDS.has(first[0]) && first[1] && HEADER_WORDS.has(first[1])) {
      headerSkipped = true;
      formFirst = true;
      headerColumns = first;
      tableRows.shift();
    }
  }

  // With a named header, columns can be matched by name so the extended export
  // (gloss, form, note, pos, status, source, etymology) imports correctly while
  // a legacy three-column table keeps its old positional reading.
  let columnMap = null;
  if (headerColumns) {
    const named = (words) => headerColumns.findIndex((column) => words.includes(column));
    columnMap = {
      gloss: named([...HEADER_WORDS]),
      form: named([...FORM_HEADER_WORDS]),
      note: named([...NOTE_HEADER_WORDS]),
      pos: named([...META_HEADER_WORDS.pos]),
      status: named([...META_HEADER_WORDS.status]),
      source: named([...META_HEADER_WORDS.source]),
      etymology: named([...META_HEADER_WORDS.etymology]),
    };
  }
  const hasMetaHeader = columnMap
    ? ["pos", "status", "source", "etymology"].some((field) => columnMap[field] >= 0)
    : false;

  const rows = [];
  for (const row of tableRows) {
    const [firstCell = "", secondCell = "", ...rest] = row.cells;
    let gloss = formFirst ? secondCell : firstCell;
    let parsed = formAndStress(formFirst ? firstCell : secondCell);
    let note = rest.join(" ");
    let meta = {};
    if (columnMap) {
      const cellAt = (index) => (index >= 0 ? row.cells[index] ?? "" : "");
      gloss = cellAt(columnMap.gloss);
      parsed = formAndStress(cellAt(columnMap.form));
      note = hasMetaHeader
        ? cellAt(columnMap.note)
        : row.cells.slice(Math.max(columnMap.gloss, columnMap.form) + 1).join(" ");
      meta = {
        pos: cellAt(columnMap.pos),
        status: cellAt(columnMap.status),
        source: cellAt(columnMap.source),
        etymology: cellAt(columnMap.etymology),
      };
    }
    // A paste of bracketed transcriptions ("[apa] father") is a form-first
    // two-column list without a header. Keep both fields and put the phonetic
    // form in the form column instead of importing the brackets as a gloss.
    if (
      !headerSkipped &&
      !formFirst &&
      row.cells.length === 2 &&
      firstCell.startsWith("[") &&
      firstCell.endsWith("]") &&
      secondCell
    ) {
      gloss = secondCell;
      parsed = formAndStress(firstCell);
    }
    if (!gloss && !parsed.form) continue; // stray separators
    rows.push({
      ...meta,
      gloss,
      form: parsed.form,
      stress: parsed.stress,
      note,
      index: row.line,
      warning: "",
    });
  }

  if (!rows.length && (headerSkipped || tableRows.length)) {
    warnings.push(headerSkipped ? "Only a header row was found." : "No data rows were found.");
  }
  return { delimiter, headerSkipped, rows, warnings, parseError: "" };
}

// Status per row against the current lexicon and the chosen duplicate mode.
// mark: "add" (new word), "update" (existing gloss, will be overwritten),
// "skip" (existing gloss, kept as-is), or "invalid" (empty gloss and form).
export function rowStatus(row, language, mode) {
  if (!row.gloss && !row.form) return { status: "invalid", reason: "Row is empty." };
  if (!row.gloss) return { status: "invalid", reason: "Missing gloss — a gloss is required." };
  const existing = lastWordWithGloss(language.vocabulary, row.gloss);
  if (!existing) return { status: "add", reason: "" };
  if (mode === "update") {
    return {
      status: "update",
      reason: `${row.form ? "Form becomes " + row.form : "Form unchanged"}${row.note ? " · note becomes “" + row.note + "”" : ""}`,
    };
  }
  return { status: "skip", reason: "A word with this gloss already exists — it is kept as-is." };
}

// Metadata present in a row updates the word; metadata a row omits (or leaves
// blank in a TSV cell) is left untouched, so importing a form list never
// wipes senses or etymology already recorded in the lexicon.
function applyMeta(target, row) {
  for (const field of META_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    const value = row[field];
    if (Array.isArray(value)) target[field] = [...value];
    else if (String(value ?? "").trim()) target[field] = String(value).trim();
  }
}

// Applies the parsed rows and returns a summary. One touch() after this
// renders the whole import as a single undo step.
export function applyWordList(language, rows, mode) {
  // Assignment keeps the last duplicate gloss, the same word rowStatus
  // previews and reports as the update target.
  const byGloss = new Map(language.vocabulary.map((word) => [normalizeGloss(word.gloss), word]));
  const summary = { added: 0, updated: 0, skipped: 0, drafts: 0 };
  let checker = null;
  let usesStress = false;
  for (const row of rows) {
    const verdict = rowStatus(row, language, mode);
    if (verdict.status === "invalid" || verdict.status === "skip") {
      if (verdict.status === "skip") summary.skipped += 1;
      continue;
    }
    const existing = byGloss.get(normalizeGloss(row.gloss));
    const rawStress = normalizeWordStress(row.stress);
    // Reject marks that the form cannot display, so an import never creates a
    // stress field the picker and phonemic view silently ignore. A stress-only
    // update has no form of its own, so prune against the stored form instead.
    // Languages without stress rows never need to compile a checker.
    const effectiveForm = row.form || existing?.form || "";
    if ((rawStress || (row.form && existing?.stress)) && !checker) {
      checker = createPhonotacticsChecker(language);
    }
    const stress = rawStress ? pruneWordStressForForm(effectiveForm, checker, rawStress) : null;
    if (stress) usesStress = true;
    if (existing) {
      if (rawStress) {
        if (stress) existing.stress = stress;
        else delete existing.stress;
      } else if (row.form && existing.stress) {
        // Prune a previously hidden mark against the old form first, then
        // against the new one, so a form change cannot revive a stale mark
        // once the default primary moves away from it.
        const before = pruneWordStressForForm(existing.form, checker, existing.stress);
        const after = before ? pruneWordStressForForm(row.form, checker, before) : null;
        if (after) existing.stress = after;
        else delete existing.stress;
      }
      if (row.form) existing.form = row.form;
      if (row.note) existing.note = row.note;
      applyMeta(existing, row);
      existing.gloss = row.gloss;
      summary.updated += 1;
      continue;
    }
    const word = { id: uid("word"), gloss: row.gloss, form: row.form, note: row.note };
    applyMeta(word, row);
    if (stress) word.stress = stress;
    language.vocabulary.push(word);
    byGloss.set(normalizeGloss(row.gloss), word);
    summary.added += 1;
    if (!row.form) summary.drafts += 1;
  }
  // A list that carries word stress is making a phonemic claim; switch the
  // language so the imported stress is visible and usable in rules.
  if (usesStress && language.phonotactics) language.phonotactics.stressScope = "phonemic";
  return summary;
}

function sanitizeField(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// TSV fields follow the parser's RFC 4180 quoting for the one character that
// still matters after whitespace is collapsed: a double quote is doubled and
// the whole field is wrapped, so toTsv output re-imports verbatim.
function tsvField(value) {
  const text = sanitizeField(value);
  return text.includes('"') ? `"${text.replaceAll('"', '""')}"` : text;
}

// TSV with a header row. Tabs and line breaks inside fields are collapsed to
// spaces so the sheet stays readable; JSON keeps the exact strings. A word's
// stored stress is written back as inline marks, the same notation the parser
// reads, so a TSV round-trip keeps stress without adding a fourth column.
export function toTsv(words, language = null) {
  const checker = language ? createPhonotacticsChecker(language) : null;
  // The extra columns appear only when the lexicon uses them, so a plain
  // project's export stays byte-identical to the old three-column format.
  const hasMeta = words.some((word) =>
    SCALAR_META_FIELDS.some((field) => String(word?.[field] ?? "").trim())
  );
  const lines = [["gloss", "form", "note", ...(hasMeta ? SCALAR_META_FIELDS : [])].join("\t")];
  for (const word of words) {
    const form = checker && word.stress ? stressMarkedForm(word.form, checker, word.stress) || word.form : word.form;
    const cells = [tsvField(word.gloss), tsvField(form), tsvField(word.note)];
    if (hasMeta) {
      for (const field of SCALAR_META_FIELDS) cells.push(tsvField(word[field]));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

export function toJson(words, language = null) {
  const checker = language ? createPhonotacticsChecker(language) : null;
  return JSON.stringify(
    words.map((word) => {
      const entry = { gloss: word.gloss, form: word.form, note: word.note };
      for (const field of META_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(word, field)) continue;
        const value = word[field];
        if (Array.isArray(value)) entry[field] = value;
        else if (String(value ?? "").trim()) entry[field] = String(value).trim();
      }
      const stress = checker
        ? pruneWordStressForForm(word.form, checker, word.stress)
        : normalizeWordStress(word.stress);
      if (stress) entry.stress = stress;
      return entry;
    }),
    null,
    2
  );
}


