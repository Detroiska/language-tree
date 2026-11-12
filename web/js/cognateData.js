import { indexWordsByGloss, normalizeGloss } from "./gloss.js";
import { getLineage, languagesInTreeOrder } from "./model.js";
import { formatPhonemic, joinSegments, sameForm } from "./notation.js";
import {
  createChainCompiler,
  deriveStages,
  exceptionRulesFromSteps,
  hasSurfaceDisplay,
  optionalRulesInStages,
  optionalSkippedRulesFromSteps,
  ruleCompileErrors,
  surfaceForForm,
} from "./phonology.js";

// The cognate explorer's data preparation, kept DOM-free so Node tests can
// run it. The view owns markup and events; everything here is plain objects.
//
// The matrix is deliberately data-only: it never needs surface forms, and
// `surfaceForForm` rebuilds the allophony context for every call. Only the
// single-gloss trace asks for surfaces, where there is one row per language.

export function wordsWithForms(language) {
  return (language?.vocabulary || []).filter((word) => word.gloss.trim() && word.form.trim());
}

function optionalRulesFromRows(targetRows) {
  return [
    ...new Map(
      targetRows.flatMap((row) => row.optionalRules || []).map((rule) => [rule.id, rule])
    ).values(),
  ];
}

/*
 * One descriptor per language: whether it descends from the source, the
 * languages between them ("via Old Coastal"), and the compiled rule chain.
 * The source itself stays a row of its own with no chain — its recorded form
 * already contains its own rules. The gloss index assigned to each row is
 * reused for every cell, so the matrix does not rescan the lexicon.
 */
export function buildCognateRows(project, source) {
  const chains = createChainCompiler(project);
  const rows = [];
  for (const language of languagesInTreeOrder(project)) {
    const lineage = getLineage(project, language.id);
    const depth = lineage.length - 1;
    const recordedByGloss = indexWordsByGloss(language.vocabulary);
    if (language.id === source.id) {
      rows.push({
        language,
        depth,
        isSource: true,
        descended: true,
        path: [],
        chain: null,
        errors: [],
        optionalRules: [],
        recordedByGloss,
      });
      continue;
    }
    const sourceIndex = lineage.findIndex((item) => item.id === source.id);
    if (sourceIndex === -1) {
      rows.push({
        language,
        depth,
        isSource: false,
        descended: false,
        path: [],
        chain: null,
        errors: [],
        optionalRules: [],
        recordedByGloss,
      });
      continue;
    }
    const chain = chains.compileChainFrom(source.id, language.id);
    const errors = chain.ok ? ruleCompileErrors(chain.stages) : [];
    rows.push({
      language,
      depth,
      isSource: false,
      descended: true,
      path: lineage.slice(sourceIndex + 1, lineage.length - 1),
      chain,
      errors,
      optionalRules: chain.ok ? optionalRulesInStages(chain.stages) : [],
      recordedByGloss,
    });
  }
  const targetRows = rows.filter((row) => row.descended && !row.isSource);
  return {
    rows,
    targetRows,
    allOptionalRules: optionalRulesFromRows(targetRows),
  };
}

function recordedFor(row, sourceWord) {
  const key = normalizeGloss(sourceWord.gloss);
  if (!key) return null;
  return row.recordedByGloss?.get(key) || null;
}

function surfaceOf(form, project, languageId, gloss) {
  const surface = surfaceForForm(form, project, languageId, { gloss });
  return surface?.errors.length ? "" : surface?.display || "";
}

export function deriveCognateCell(
  row,
  sourceWord,
  project,
  { optionalRuleIds = [], surface = true, diagnostics = true } = {}
) {
  const recorded = recordedFor(row, sourceWord);
  if (!row.descended || row.isSource || !row.chain?.ok) {
    const sourceForm = row.isSource ? sourceWord.form : recorded?.form || "";
    return {
      derived: row.isSource ? sourceWord.form : "",
      surface: surface && sourceForm ? surfaceOf(sourceForm, project, row.language.id, sourceWord.gloss) : "",
      steps: [],
      exceptions: [],
      skippedOptional: [],
      error: "",
      recorded,
    };
  }
  const parsed = row.chain.context.tokenizeWithStress(sourceWord.form);
  const result = deriveStages(parsed.tokens, row.chain.stages, row.chain.context, {
    gloss: sourceWord.gloss,
    junctures: parsed.junctures,
    optionalRuleIds,
    diagnostics,
  });
  const derived = joinSegments(result.tokens, result.junctures);
  return {
    derived,
    surface:
      surface && !result.errors.length
        ? surfaceOf(derived, project, row.language.id, sourceWord.gloss)
        : "",
    steps: result.steps,
    exceptions: exceptionRulesFromSteps(result.steps),
    skippedOptional: optionalSkippedRulesFromSteps(result.steps),
    error: row.errors[0] || result.errors[0] || "",
    recorded,
  };
}

export function statusForCognate(sourceWord, row, cell) {
  if (!row.descended) return { kind: "outside", label: "—", icon: "info" };
  if (row.isSource) return { kind: "source", label: "Source", icon: "check" };
  if (cell.error) return { kind: "error", label: "Rule error", icon: "warning", detail: cell.error };
  const exceptionSuffix = cell.exceptions?.length
    ? ` · ${cell.exceptions.length} ${cell.exceptions.length === 1 ? "rule" : "rules"} skipped as lexical ${
        cell.exceptions.length === 1 ? "exception" : "exceptions"
      }`
    : "";
  const optionalSuffix = cell.skippedOptional?.length
    ? ` · optional ${cell.skippedOptional.length === 1 ? "change" : "changes"} skipped (${cell.skippedOptional
        .map((rule) => rule.label || rule.notation)
        .filter(Boolean)
        .join(", ")})`
    : "";
  const suffix = `${exceptionSuffix}${optionalSuffix}`;
  if (!cell.recorded || !cell.recorded.form.trim()) {
    return {
      kind: "missing",
      label: "Missing",
      icon: "info",
      detail: `No word with the gloss “${sourceWord.gloss}” recorded in ${row.language.name}.`,
    };
  }
  if (sameForm(cell.recorded.form, cell.derived)) {
    return {
      kind: "match",
      label: "Matches",
      icon: "check",
      detail: `Rules predict ${formatPhonemic(cell.derived) || "∅"}${suffix}.`,
    };
  }
  return {
    kind: "differs",
    label: "Differs",
    icon: "warning",
    detail: `Rules predict ${formatPhonemic(cell.derived) || "∅"} · recorded ${formatPhonemic(cell.recorded.form) || "∅"}${suffix}.`,
  };
}

function matrixFlags(cells) {
  return {
    differs: cells.some((item) => item.status.kind === "differs"),
    error: cells.some((item) => item.status.kind === "error"),
    missing: cells.some((item) => item.status.kind === "missing"),
  };
}

export function buildCognateMatrix(project, source, { optionalRuleIds = [], rows = null } = {}) {
  const targetRows = rows
    ? rows.filter((row) => row.descended && !row.isSource)
    : buildCognateRows(project, source).targetRows;
  const words = wordsWithForms(source);
  const cellsByLanguage = new Map();
  const cellsByWord = new Map(words.map((word) => [word.id, []]));
  const matrixCells = [];

  for (const row of targetRows) {
    const cells = words.map((word) => ({
      word,
      ...deriveCognateCell(row, word, project, {
        optionalRuleIds,
        surface: false,
        diagnostics: false,
      }),
    }));
    cellsByLanguage.set(row.language.id, cells);
    for (const cell of cells) {
      const item = { word: cell.word, cell, row, status: statusForCognate(cell.word, row, cell) };
      matrixCells.push(item);
      cellsByWord.get(cell.word.id).push(item);
    }
  }

  const flagsByWord = new Map(
    words.map((word) => [word.id, matrixFlags(cellsByWord.get(word.id) || [])])
  );
  const counts = {
    // Per-word counts feed the matrix filter options.
    all: words.length,
    attention: 0,
    differs: 0,
    error: 0,
    missing: 0,
    clean: 0,
    // Per-cell counts feed the intro summary; a gloss can contribute more
    // than one differing cell.
    cellDiffers: 0,
    cellErrors: 0,
    cellMissing: 0,
    excepted: 0,
    optional: 0,
  };
  for (const flags of flagsByWord.values()) {
    if (flags.differs) counts.differs += 1;
    if (flags.error) counts.error += 1;
    if (flags.missing) counts.missing += 1;
    if (flags.differs || flags.error || flags.missing) counts.attention += 1;
    else counts.clean += 1;
  }
  for (const item of matrixCells) {
    if (item.status.kind === "differs") counts.cellDiffers += 1;
    else if (item.status.kind === "error") counts.cellErrors += 1;
    else if (item.status.kind === "missing") counts.cellMissing += 1;
    if (item.cell.exceptions?.length) counts.excepted += 1;
    if (item.cell.skippedOptional?.length) counts.optional += 1;
  }

  return {
    words,
    targetRows,
    cellsByLanguage,
    matrixCells,
    cellsByWord,
    flagsByWord,
    counts,
  };
}

export function buildCognateTrace(project, source, word, rows, { optionalRuleIds = [] } = {}) {
  const usable = rows.filter((row) => row.descended);
  const cellsByLanguage = new Map(
    usable.map((row) => [
      row.language.id,
      { word, ...deriveCognateCell(row, word, project, { optionalRuleIds }) },
    ])
  );
  return {
    word,
    rows: usable,
    cellsByLanguage,
    showSurface: usable.some((row) => hasSurfaceDisplay(row.language)),
    sourceDepth: getLineage(project, source.id).length - 1,
    outside: rows.length - usable.length,
  };
}
