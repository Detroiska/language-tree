import { uid } from "./model.js";
import { stripLevelMarks } from "./notation.js";
import { toast } from "./ui.js";

// Bulk word import/export: the paste-and-go side door for spreadsheets and
// word lists. Text is parsed as JSON when it looks like JSON, otherwise as a
// delimited table (tab, semicolon, comma, or aligned whitespace — detected by
// whichever separator the lines actually contain). Gaps in data are fine:
// a gloss alone imports as a draft word whose form can be filled in later.

const HEADER_WORDS = new Set(["gloss", "glosses", "meaning", "meanings"]);
const FORM_HEADER_WORDS = new Set(["form", "forms", "ipa", "word", "words", "surface"]);

function normalizeGloss(value) {
  return String(value || "").trim().toLowerCase();
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

function detectDelimiter(text) {
  if (text.includes("\t")) return "\t";
  if (text.includes(";")) return ";";
  if (text.includes(",")) return ",";
  if (/\S\s{2,}\S/.test(text)) return ALIGNED_DELIMITER;
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

function rowFromJsonEntry(entry, index) {
  const gloss = String(entry.gloss ?? entry.meaning ?? "").trim();
  const form = stripLevelMarks(entry.form ?? entry.ipa ?? "");
  const note = String(entry.note ?? "").trim();
  return { gloss, form, note, index, warning: "" };
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
      return { delimiter: "JSON", headerSkipped: false, rows, warnings, parseError: "" };
    }
    if (entries && typeof entries === "object") {
      // A single {gloss, form, note} object imports as one row.
      const row = rowFromJsonEntry(entries, 0);
      return {
        delimiter: "JSON",
        headerSkipped: false,
        rows: row.gloss || row.form ? [row] : [],
        warnings,
        parseError: "",
      };
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
  if (tableRows.length) {
    const first = tableRows[0].cells.map((cell) => cell.trim().toLowerCase());
    if (HEADER_WORDS.has(first[0])) {
      headerSkipped = true;
      tableRows.shift();
    } else if (first[0] && FORM_HEADER_WORDS.has(first[0]) && first[1] && HEADER_WORDS.has(first[1])) {
      headerSkipped = true;
      formFirst = true;
      tableRows.shift();
    }
  }

  const rows = [];
  for (const row of tableRows) {
    const [firstCell = "", secondCell = "", ...rest] = row.cells;
    let gloss = formFirst ? secondCell : firstCell;
    let form = stripLevelMarks(formFirst ? firstCell : secondCell);
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
      form = stripLevelMarks(firstCell);
    }
    const note = rest.join(" ");
    if (!gloss && !form) continue; // stray separators
    rows.push({ gloss, form, note, index: row.line, warning: "" });
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

// Applies the parsed rows and returns a summary. One touch() after this
// renders the whole import as a single undo step.
export function applyWordList(language, rows, mode) {
  // Assignment keeps the last duplicate gloss, the same word rowStatus
  // previews and reports as the update target.
  const byGloss = new Map(language.vocabulary.map((word) => [normalizeGloss(word.gloss), word]));
  const summary = { added: 0, updated: 0, skipped: 0, drafts: 0 };
  for (const row of rows) {
    const verdict = rowStatus(row, language, mode);
    if (verdict.status === "invalid" || verdict.status === "skip") {
      if (verdict.status === "skip") summary.skipped += 1;
      continue;
    }
    const existing = byGloss.get(normalizeGloss(row.gloss));
    if (existing) {
      if (row.form) existing.form = row.form;
      if (row.note) existing.note = row.note;
      existing.gloss = row.gloss;
      summary.updated += 1;
      continue;
    }
    const word = { id: uid("word"), gloss: row.gloss, form: row.form, note: row.note };
    language.vocabulary.push(word);
    byGloss.set(normalizeGloss(row.gloss), word);
    summary.added += 1;
    if (!row.form) summary.drafts += 1;
  }
  return summary;
}

function sanitizeField(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// TSV with a header row. Tabs and line breaks inside fields are collapsed to
// spaces so the sheet stays readable; JSON keeps the exact strings.
export function toTsv(words) {
  const lines = ["gloss\tform\tnote"];
  for (const word of words) {
    lines.push([sanitizeField(word.gloss), sanitizeField(word.form), sanitizeField(word.note)].join("\t"));
  }
  return lines.join("\n");
}

export function toJson(words) {
  return JSON.stringify(
    words.map((word) => ({ gloss: word.gloss, form: word.form, note: word.note })),
    null,
    2
  );
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      const done = document.execCommand("copy");
      helper.remove();
      return done;
    } catch {
      return false;
    }
  }
}

export async function copyWords(words, format = "tsv") {
  const content = format === "json" ? toJson(words) : toTsv(words);
  const done = await copyToClipboard(content);
  if (done) toast(`Copied ${words.length} word${words.length === 1 ? "" : "s"} as ${format.toUpperCase()}.`, { type: "success" });
  else toast("Copy failed — select the text and copy manually.", { type: "info" });
  return done;
}

export function downloadWords(words, languageName, format) {
  const extension = format === "json" ? "json" : "tsv";
  const content = format === "json" ? toJson(words) : toTsv(words);
  const name = `${String(languageName || "vocabulary").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "")}-vocabulary.${extension}`;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Downloading ${words.length} word${words.length === 1 ? "" : "s"} as ${name}.`, { type: "success", duration: 3000 });
}
