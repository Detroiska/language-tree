import {
  allophonyRules,
  chartPhonemeList,
} from "./model.js";
import {
  allophoneCandidates,
  allophoneTable,
} from "./phonology.js";
import { createPhonotacticsChecker } from "./phonotacticsCheck.js";
import {
  createFeatureResolver,
  featureDistance,
  normalizeFeatureOverrides,
} from "./features.js";

// Lexicon and inventory analytics.
//
// The data has been in the project all along — charts, vocabulary, the
// syllabifier, allophony rules — this module only turns it into answers:
// how often each phoneme occurs, which charted sounds never appear, which
// recorded sounds are off-chart, what onsets and codas the syllabifier finds,
// how balanced the inventory is, and whether a *phonemic* form silently
// contains a surface-only allophone.

function sortedByCount(entries) {
  return [...entries].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function normalizedLabel(value) {
  return String(value || "").trim();
}

// Voice symmetry: a voiceless obstruent with no voiced twin — and the
// mirror case — inside a manner series that already contrasts voice. `t`
// missing `d` matters once `p`/`b` exists; `s` alone, or a sonorant without
// a voiceless twin (sonorants are voiced by definition, so /m/ lacking /m̥/
// is typology), is not a gap. Counterpart bundles flip exactly the voice
// feature; an exact bundle match on the chart closes the gap, so `p` answers
// `b` only when they otherwise agree (place, manner, …).
function voicingFindings(language) {
  const consonants = [...new Set(chartPhonemeList(language.inventory.consonants))];
  const resolver = createFeatureResolver(normalizeFeatureOverrides(language.featureOverrides));
  const obstruents = [];
  for (const sound of consonants) {
    const bundle = resolver.bundleFor(sound);
    if (!bundle || typeof bundle.voice !== "boolean" || bundle.sonorant === true) continue;
    obstruents.push({ sound, bundle });
  }
  // Only obstruent manners reaching voice contrast (plosive, affricate,
  // fricative) are examined, one series at a time. Airstream distinctions are
  // part of the manner: an implosive or click is not the voiced/voiceless twin
  // of a pulmonic stop that happens to share continuancy and release.
  const mannerKey = (bundle) =>
    [
      bundle.continuant,
      bundle.delayed_release,
      bundle.trill,
      bundle.tap,
      bundle.click,
      bundle.implosive,
    ].join(",");
  const byManner = new Map();
  for (const entry of obstruents) {
    const key = mannerKey(entry.bundle);
    if (!byManner.has(key)) byManner.set(key, []);
    byManner.get(key).push(entry);
  }
  const findCounterpart = (entry) => {
    const flipped = { ...entry.bundle, voice: !entry.bundle.voice };
    return obstruents.find((candidate) => featureDistance(candidate.bundle, flipped) === 0) || null;
  };
  const voicedWithoutVoiceless = [];
  const voicelessWithoutVoiced = [];
  for (const pool of byManner.values()) {
    // A manner that never pairs sounds by voice has not demonstrated a voice
    // series, so flagging each member would claim a gap in every stop-only
    // or fricative-only inventory. The demand for a counterpart comes from
    // the series itself.
    if (!pool.some((candidate) => findCounterpart(candidate))) continue;
    for (const entry of pool) {
      if (findCounterpart(entry)) continue;
      if (entry.bundle.voice) voicedWithoutVoiceless.push(entry.sound);
      else voicelessWithoutVoiced.push(entry.sound);
    }
  }
  return { voicedWithoutVoiceless, voicelessWithoutVoiced };
}

// Chart symmetry in its most attested form: for each pair of manner rows,
// a place that one row fills and another leaves empty. Nasal rows missing a
// plosive place (Hanebu-style "lacks a velar nasal") fall out of this; it
// reads the chart the way the linguist drew it, not a feature analysis.
function chartGapFindings(consonantChart) {
  const rows = Array.isArray(consonantChart?.rows) ? consonantChart.rows : [];
  const columns = Array.isArray(consonantChart?.columns) ? consonantChart.columns : [];
  if (!rows.length || !columns.length) return [];
  const leafPaths = (nodes, path = [], out = []) => {
    for (const node of nodes) {
      const next = [...path, node];
      if (node.children?.length) leafPaths(node.children, next, out);
      else out.push({ id: node.id, top: normalizedLabel(path[0]?.label) || normalizedLabel(node.label) });
    }
    return out;
  };
  const rowTop = new Map(leafPaths(rows).map((leaf) => [leaf.id, leaf.top]));
  const colTop = new Map(leafPaths(columns).map((leaf) => [leaf.id, leaf.top]));
  const occupied = new Set();
  for (const [key, sounds] of Object.entries(consonantChart?.cells || {})) {
    if (!Array.isArray(sounds) || !sounds.length) continue;
    const [rowId, columnId] = key.split("|");
    const row = rowTop.get(rowId);
    const column = colTop.get(columnId);
    if (row && column) occupied.add(`${row}\u0001${column}`);
  }
  if (!occupied.size) return [];
  const mannerPlaces = new Map();
  for (const key of occupied) {
    const [manner, place] = key.split("\u0001");
    if (!mannerPlaces.has(manner)) mannerPlaces.set(manner, new Set());
    mannerPlaces.get(manner).add(place);
  }
  const allPlaces = [...new Set([...mannerPlaces.values()].flatMap((places) => [...places]))];
  const findings = [];
  for (const [manner, places] of mannerPlaces) {
    const missing = allPlaces.filter((place) => !places.has(place));
    if (missing.length && allPlaces.length > missing.length) findings.push({ manner, missing });
  }
  return findings;
}

export function analyzeLexicon(project, language) {
  const checker = createPhonotacticsChecker(language);
  const context = checker.context;
  const consonantList = [...new Set(chartPhonemeList(language.inventory.consonants))];
  const vowelList = [...new Set(chartPhonemeList(language.inventory.vowels))];
  const charted = new Set([...consonantList, ...vowelList]);

  const words = language.vocabulary;
  const recorded = words.filter((word) => word.form.trim() && word.gloss.trim());

  const counts = new Map([...charted].map((sound) => [sound, 0]));
  const uncharted = new Map();
  let consonantTokens = 0;
  let vowelTokens = 0;
  let tokenTotal = 0;

  // No ∅ seed: a real empty onset increments the key itself, and only when
  // something actually syllabifies — an unconditional seed would keep a
  // meaningless "∅ ×0" row alive and suppress the panel's empty state.
  const onsets = new Map();
  const codas = new Map();
  let syllablesTotal = 0;
  let parseableWords = 0;

  // Surface symbols the allophony rules can produce. A *stored phonemic form*
  // that contains one of them (and only them — the chart never lists it) is a
  // typo for the allophone-leakage detector: someone recorded a surface form.
  const ruleOutputs = new Set();
  const hasAllophony = allophonyRules(language.allophony).length > 0;
  if (hasAllophony) {
    // Known blind spot: candidates are lexical chunks, so a multi-segment
    // output such as "ks" can never match the k + s a stored form tokenizes
    // into. Single-symbol outputs — the realistic leak — are caught.
    for (const chunk of allophoneCandidates(allophonyRules(language.allophony))) {
      if (chunk && chunk !== "∅") ruleOutputs.add(chunk);
    }
    try {
      const table = allophoneTable(project, language.id);
      for (const row of table.rows) {
        if (row.allophone && row.allophone !== "∅" && row.allophone !== "") ruleOutputs.add(row.allophone);
      }
    } catch {
      // A broken allophony rule must not take the whole overview down; the
      // rule output list is then just narrower.
    }
  }

  const leaks = [];
  for (const word of recorded) {
    const tokens = context.tokenize(word.form);
    for (const token of tokens) {
      tokenTotal += 1;
      if (counts.has(token)) {
        counts.set(token, counts.get(token) + 1);
        if (context.consonants.has(token)) consonantTokens += 1;
        else vowelTokens += 1;
      } else {
        uncharted.set(token, (uncharted.get(token) || 0) + 1);
        // Charted tokens use the chart's own kind; uncharted tokens fall back
        // to a feature lookup, and a symbol with no bundle reads as a
        // consonant.
        if (context.isVowel(token)) vowelTokens += 1;
        else consonantTokens += 1;
      }
    }

    const result = checker.validate(word.form);
    if (result.checked && result.ok && result.syllables?.length) {
      parseableWords += 1;
      for (const syllable of result.syllables) {
        syllablesTotal += 1;
        const onset = syllable.onset.join("") || "∅";
        const coda = syllable.coda.join("") || "∅";
        onsets.set(onset, (onsets.get(onset) || 0) + 1);
        codas.set(coda, (codas.get(coda) || 0) + 1);
      }
    }

    if (hasAllophony) {
      const symbols = [...new Set(tokens.filter((token) => !charted.has(token) && ruleOutputs.has(token)))];
      if (symbols.length) {
        leaks.push({
          id: word.id,
          gloss: word.gloss,
          form: word.form,
          symbols,
        });
      }
    }
  }

  const frequency = sortedByCount(
    [...counts.entries()].map(([value, count]) => ({ value, count, charted: true }))
  );
  for (const entry of sortedByCount([...uncharted.entries()].map(([value, count]) => ({ value, count })))) {
    frequency.push({ value: entry.value, count: entry.count, charted: false });
  }

  const neverUsed = frequency.filter((row) => row.charted && row.count === 0).map((row) => row.value);
  const ratio = vowelTokens > 0 && consonantTokens > 0 ? consonantTokens / vowelTokens : null;
  const voicing = voicingFindings(language);

  return {
    languageId: language.id,
    words: words.length,
    recorded: recorded.length,
    drafts: words.length - recorded.length,
    tokenTotal,
    consonantTokens,
    vowelTokens,
    ratio,
    chartedCount: charted.size,
    consonantCount: consonantList.length,
    vowelCount: vowelList.length,
    frequency,
    uncharted: sortedByCount([...uncharted.entries()].map(([value, count]) => ({ value, count }))),
    neverUsed,
    onsets: sortedByCount([...onsets.entries()].map(([value, count]) => ({ value, count }))).slice(0, 10),
    codas: sortedByCount([...codas.entries()].map(([value, count]) => ({ value, count }))).slice(0, 10),
    syllablesTotal,
    parseableWords,
    voicedWithoutVoiceless: voicing.voicedWithoutVoiceless,
    voicelessWithoutVoiced: voicing.voicelessWithoutVoiced,
    gaps: chartGapFindings(language.inventory.consonants),
    leaks,
    rulesOutputCount: ruleOutputs.size,
    hasAllophony,
  };
}
