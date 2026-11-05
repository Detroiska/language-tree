import { uid } from "./model.js";
import { formatPhonemic, stripLevelMarks } from "./notation.js";
import { toast } from "./ui.js";

// Bulk word import/export: the paste-and-go side door for spreadsheets and
// word lists. Text is parsed as JSON when it looks like JSON, otherwise as a
// delimited table (tab, semicolon, comma, or aligned whitespace — detected by
// whichever separator the lines actually contain). Gaps in data are fine:
// a gloss alone imports as a draft word whose form can be filled in later.

const HEADER_WORDS = new Set(["gloss", "glosses", "meaning", "meanings"]);

function normalizeGloss(value) {
  return String(value || "").trim().toLowerCase();
}

// Aligned whitespace (2+ spaces between columns) is a table layout, not a
// single-space token list — keep the two apart or "big house   kasa" would
// split the gloss apart.
const ALIGNED_DELIMITER = "aligned";

function splitDelimited(line, delimiter) {
  if (delimiter === ALIGNED_DELIMITER) return line.trim().split(/\s{2,}/);
  if (delimiter === " ") return line.trim().split(/\s+/);
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (inQuotes) {
      if (character === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      out.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  out.push(current);
  return out.map((cell) => String(cell).trim());
}

function detectDelimiter(text) {
  if (text.includes("\t")) return "\t";
  if (text.includes(";")) return ";";
  if (text.includes(",")) return ",";
  if (/\S\s{2,}\S/.test(text)) return ALIGNED_DELIMITER;
  return " ";
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
  let lines = raw.split("\n");
  let headerSkipped = false;
  let warnings = [];

  if (raw.startsWith("[") || raw.startsWith("{")) {
    let entries = null;
    try {
      entries = JSON.parse(raw);
    } catch (error) {
      warnings.push(`The text starts with JSON but could not be parsed (${error.message}); check brackets and quotes.`);
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
    // Neither an array nor an object (or the text did not parse): an honest
    // empty result beats a garbage table.
    return { delimiter: "JSON", headerSkipped: false, rows: [], warnings, parseError: "" };
  }

  // One delimiter for the whole table, chosen from the first line so the
  // header and the rows are always cut the same way: a tab hiding inside a
  // later note must not change how the header is read, and vice versa.
  let delimiter = detectDelimiter(lines[0]);
  if (HEADER_WORDS.has(splitDelimited(lines[0], delimiter)[0].toLowerCase())) {
    headerSkipped = true;
    lines = lines.slice(1);
  }

  const rows = [];
  lines.forEach((line, lineIndex) => {
    if (!line.trim()) return;
    const cells = splitDelimited(line, delimiter);
    const gloss = cells[0] || "";
    const form = stripLevelMarks(cells[1] || "");
    const note = cells.slice(2).join(" ");
    if (!gloss && !form) return; // stray separators
    rows.push({
      gloss,
      form,
      note,
      index: lineIndex + (headerSkipped ? 2 : 1), // 1-based file line number
      warning: "",
    });
  });

  if (!rows.length && (headerSkipped || lines.length)) {
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
  const existing = language.vocabulary.find((word) => normalizeGloss(word.gloss) === normalizeGloss(row.gloss));
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
