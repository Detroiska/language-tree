import { alignSegments } from "./diff.js";
import { normalizeGloss } from "./gloss.js";
import { getLineage } from "./model.js";
import { compileChainFrom, contextForLanguage, deriveStages } from "./phonology.js";

// Comparative-method correspondence tables.
//
// The cognate explorer already derives a source word in every descendant.
// This module turns those pairs into a table: for each aligned source segment
// (and its position in the word), count the reflexes each daughter shows. A
// reflex that occurs once while a sister reflex dominates is called out as an
// irregular correspondence — the alignment aid a comparative linguist wants.
//
// Everything here is DOM-free. Counts, dominant reflexes, singleton
// irregularities, and insertion sites are plain data so they can be tested
// under Node.

const DELETED = "∅";

const POSITION_RANK = {
  initial: 0,
  medial: 1,
  final: 2,
  only: 3,
};

function formOf(word) {
  return String(word?.form || "").trim();
}

// One word per gloss, first form wins — the same convention as the cognate
// explorer's recordedFor() and the vocabulary inherited check.
function wordsForCorrespondence(language) {
  const seen = new Set();
  const words = [];
  for (const word of language.vocabulary || []) {
    const gloss = normalizeGloss(word.gloss);
    if (!gloss || !formOf(word) || seen.has(gloss)) continue;
    seen.add(gloss);
    words.push(word);
  }
  return words;
}

function wordForGloss(language, gloss) {
  const key = normalizeGloss(gloss);
  if (!key) return null;
  return (
    (language.vocabulary || []).find((word) => normalizeGloss(word.gloss) === key && formOf(word)) || null
  );
}

// A source segment's position is relative to its source word. Words of one
// segment get their own label so a one-vowel word is not called both initial
// and final.
function positionOf(index, length) {
  if (length <= 1) return "only";
  if (index === 0) return "initial";
  if (index === length - 1) return "final";
  return "medial";
}

// Align one daughter's reflex to the source form. Each source position gets a
// reflex (or ∅ for a deletion); segments the daughter inserted have no source
// position and are returned separately so the table does not invent a row for
// them.
export function alignCognate(sourceTokens = [], reflexTokens = []) {
  const operations = alignSegments(sourceTokens, reflexTokens, { edgeBias: true });
  const positions = [];
  const insertions = [];
  let sourceIndex = 0;

  for (const operation of operations) {
    if (operation.left != null) {
      positions.push({
        sourceIndex,
        segment: operation.left,
        reflex: operation.right == null ? DELETED : operation.right,
        deleted: operation.right == null,
      });
      sourceIndex += 1;
      continue;
    }

    if (operation.right != null) {
      insertions.push({
        boundary: sourceIndex,
        after: sourceIndex > 0 ? sourceTokens[sourceIndex - 1] : "#",
        before: sourceIndex < sourceTokens.length ? sourceTokens[sourceIndex] : "#",
        reflex: operation.right,
      });
    }
  }

  return { positions, insertions };
}

function emptyResult(source, mode) {
  return {
    source: source ? { id: source.id, name: source.name } : null,
    mode,
    languages: [],
    glosses: [],
    rows: [],
    insertions: [],
    irregularities: [],
    coverage: {
      glosses: 0,
      alignedGlosses: 0,
      languages: [],
    },
    totals: {
      rows: 0,
      occurrences: 0,
      irregularities: 0,
      insertions: 0,
    },
  };
}

// Build the table in one of two modes:
//   "recorded" (default) — align the forms entered in the lexicon.
//   "derived"            — replay each descendant's rule chain from the source.
// Derived mode fills gaps where a gloss was never recorded and is useful for
// checking whether the rules predict the regular correspondences.
export function buildCorrespondences(project, sourceId, { mode = "recorded" } = {}) {
  const selectedMode = mode === "derived" ? "derived" : "recorded";
  const allLanguages = Array.isArray(project?.languages) ? project.languages : [];
  const source = allLanguages.find((language) => language.id === sourceId) || null;
  if (!source) return emptyResult(null, selectedMode);

  const sourceWords = wordsForCorrespondence(source);
  const sourceContext = contextForLanguage(project, source.id);
  const projectOrder = new Map(allLanguages.map((language, index) => [language.id, index]));

  const daughters = [];
  for (const language of allLanguages) {
    if (language.id === source.id) continue;
    const lineage = getLineage(project, language.id);
    if (!lineage.some((item) => item.id === source.id)) continue;
    const daughter = {
      id: language.id,
      name: language.name,
      depth: lineage.length - 1,
      language,
      // Recorded mode tokenizes the daughter's lexicon; derived mode reuses
      // the context the chain already built, so only one of the two is needed.
      context: selectedMode === "recorded" ? contextForLanguage(project, language.id) : null,
      chain: null,
    };
    if (selectedMode === "derived") {
      daughter.chain = compileChainFrom(project, source.id, language.id);
    }
    daughters.push(daughter);
  }
  daughters.sort((a, b) => a.depth - b.depth || projectOrder.get(a.id) - projectOrder.get(b.id));

  const result = emptyResult(source, selectedMode);
  result.languages = daughters.map(({ id, name, depth }) => ({ id, name, depth }));

  const coverage = new Map(
    daughters.map((daughter) => [
      daughter.id,
      {
        id: daughter.id,
        name: daughter.name,
        depth: daughter.depth,
        glosses: new Set(),
        alignedPositions: 0,
        errors: new Set(),
      },
    ])
  );

  const rows = new Map();
  let alignedGlosses = 0;

  for (const word of sourceWords) {
    const sourceTokens = sourceContext.tokenize(word.form);
    if (!sourceTokens.length) continue;
    result.glosses.push({ id: word.id, gloss: word.gloss, form: word.form, tokens: sourceTokens });
    let aligned = false;

    for (const daughter of daughters) {
      let tokens = null;

      if (selectedMode === "derived") {
        if (!daughter.chain?.ok) {
          const reason = daughter.chain?.reason || "not descended from the source";
          coverage.get(daughter.id).errors.add(reason);
          continue;
        }
        const parsed = daughter.chain.context.tokenizeWithStress(word.form);
        const derived = deriveStages(parsed.tokens, daughter.chain.stages, daughter.chain.context, {
          gloss: word.gloss,
          junctures: parsed.junctures,
        });
        if (derived.errors.length) {
          coverage.get(daughter.id).errors.add(derived.errors[0]);
          continue;
        }
        tokens = derived.tokens;
      } else {
        const recorded = wordForGloss(daughter.language, word.gloss);
        if (!recorded) continue;
        tokens = daughter.context.tokenize(recorded.form);
      }

      if (!tokens.length) continue;
      aligned = true;
      const daughterCoverage = coverage.get(daughter.id);
      daughterCoverage.glosses.add(normalizeGloss(word.gloss));

      const { positions, insertions } = alignCognate(sourceTokens, tokens);
      for (const insertion of insertions) {
        result.insertions.push({
          gloss: word.gloss,
          wordId: word.id,
          languageId: daughter.id,
          languageName: daughter.name,
          boundary: insertion.boundary,
          after: insertion.after,
          before: insertion.before,
          reflex: insertion.reflex,
        });
      }

      for (const position of positions) {
        const label = positionOf(position.sourceIndex, sourceTokens.length);
        const key = `${position.segment}\u0000${label}`;
        let row = rows.get(key);
        if (!row) {
          row = {
            key,
            segment: position.segment,
            position: label,
            order: rows.size,
            occurrenceKeys: new Set(),
            glossKeys: new Set(),
            occurrences: 0,
            cells: new Map(
              daughters.map((item) => [
                item.id,
                {
                  languageId: item.id,
                  languageName: item.name,
                  counts: new Map(),
                  total: 0,
                },
              ])
            ),
          };
          rows.set(key, row);
        }

        const occurrenceKey = `${word.id}\u0000${position.sourceIndex}`;
        if (!row.occurrenceKeys.has(occurrenceKey)) {
          row.occurrenceKeys.add(occurrenceKey);
          row.occurrences += 1;
        }
        row.glossKeys.add(normalizeGloss(word.gloss));

        const cell = row.cells.get(daughter.id);
        cell.total += 1;
        let count = cell.counts.get(position.reflex);
        if (!count) {
          count = { reflex: position.reflex, count: 0, glosses: new Set() };
          cell.counts.set(position.reflex, count);
        }
        count.count += 1;
        count.glosses.add(word.gloss);
        daughterCoverage.alignedPositions += 1;
      }
    }

    if (aligned) alignedGlosses += 1;
  }

  // Initial, then medial, then final groups keep the table readable; within a
  // position, rows appear in the order the corpus first presents them.
  const finalizedRows = [...rows.values()]
    .sort(
      (a, b) =>
        POSITION_RANK[a.position] - POSITION_RANK[b.position] || a.order - b.order
    )
    .map((row) => {
      const cells = daughters.map((daughter) => {
        const cell = row.cells.get(daughter.id);
        const counts = [...cell.counts.values()]
          .map((count) => ({
            reflex: count.reflex,
            count: count.count,
            glosses: [...count.glosses],
          }))
          // Map insertion order is stable, so ties keep the order the corpus
          // presented instead of flipping between renders.
          .sort((a, b) => b.count - a.count);
        const dominant = counts[0] || null;
        const topCount = dominant?.count || 0;
        const tied = counts.length > 1 && counts[1].count === topCount;
        const irregular =
          !tied && topCount >= 2
            ? counts.slice(1).filter((count) => count.count === 1)
            : [];
        return {
          languageId: daughter.id,
          languageName: daughter.name,
          total: cell.total,
          missing: Math.max(0, row.occurrences - cell.total),
          counts,
          dominant,
          variants: counts.slice(1),
          irregular: irregular.map((count) => ({
            reflex: count.reflex,
            count: count.count,
            glosses: count.glosses,
            expected: dominant.reflex,
          })),
          tied,
        };
      });
      return {
        key: row.key,
        segment: row.segment,
        position: row.position,
        occurrences: row.occurrences,
        glossCount: row.glossKeys.size,
        cells,
      };
    });

  for (const row of finalizedRows) {
    for (const cell of row.cells) {
      for (const item of cell.irregular) {
        result.irregularities.push({
          rowKey: row.key,
          segment: row.segment,
          position: row.position,
          languageId: cell.languageId,
          languageName: cell.languageName,
          reflex: item.reflex,
          expected: item.expected,
          count: item.count,
          dominantCount: cell.dominant.count,
          glosses: item.glosses,
        });
      }
    }
  }

  result.rows = finalizedRows;
  result.coverage = {
    glosses: result.glosses.length,
    alignedGlosses,
    languages: daughters.map((daughter) => {
      const entry = coverage.get(daughter.id);
      return {
        id: daughter.id,
        name: daughter.name,
        depth: daughter.depth,
        glosses: entry.glosses.size,
        alignedPositions: entry.alignedPositions,
        errors: [...entry.errors],
      };
    }),
  };
  result.totals = {
    rows: finalizedRows.length,
    occurrences: finalizedRows.reduce((sum, row) => sum + row.occurrences, 0),
    irregularities: result.irregularities.length,
    insertions: result.insertions.length,
  };

  return result;
}
