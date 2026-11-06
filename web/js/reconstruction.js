// Reconstruction helper.
//
// The sound-change engine is deterministic: it takes an inherited form and
// produces a daughter form. This module walks the same rule chain backwards.
// It is deliberately conservative: every candidate is checked by re-applying
// the forward rule, so a reconstruction is offered only when that exact input
// would have produced the recorded form.
//
// A rule does not prove that its output was derived by that rule. A daughter
// segment can also be inherited unchanged, so both analyses are kept:
//   p > f          f   -> f (inherited) or p (changed)
//   ŋ͡g > n͜d       n͜d  -> n͜d (inherited) or ŋ͡g (changed)
//   [p t k] > ʔ    ʔ   -> ʔ (inherited), p, t, or k
//   ∅ > ʔ / V _ V  aʔa -> aʔa (inherited) or aa
//
// Deletions are genuinely underdetermined, so the helper restores the fewest
// segments that make the rule apply and flags those alternatives as lossy.
// Candidates are ordered by fewest rule applications. Everything here is
// DOM-free so it can be tested under Node.

import { getLineage, ruleExceptsGloss } from "./model.js";
import { stripLevelMarks, stripStressMarks } from "./notation.js";
import {
  applyRule,
  compileRuleStages,
  contextForLanguage,
  deriveStages,
  replacementForMatch,
} from "./phonology.js";

const DEFAULTS = {
  maxCandidates: 64,
  maxStates: 4096,
  maxTargetCombinations: 256,
  maxLoss: 3,
};

function tokenKey(tokens) {
  return tokens.join("\u0000");
}

function sameTokens(left, right) {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function identityCandidate(tokens) {
  return { tokens: [...tokens], score: 0, loss: 0 };
}

function normalizeLexicalForm(value) {
  return stripStressMarks(stripLevelMarks(value)).normalize("NFC");
}

function normalizeGloss(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Gloss labels in a real lexicon drift in punctuation more often than in
// wording: a parent may record "you (sg.)" while the daughter records
// "You (sg)". Comparisons keep an exact key first and fall back to a loose key
// that drops punctuation, so a stray period does not hide same-gloss evidence.
function glossKey(value) {
  return normalizeGloss(value)
    .replace(/\p{P}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The parent's recorded lexicon is independent evidence for a reconstruction.
// A candidate that is already a parent word is more plausible than one the
// rules merely could have produced. A gloss match is stronger than a bare form
// match because it ties the candidate to the same lexical item.
function parentLexicon(parent) {
  const byForm = new Map();
  const byGloss = new Map();
  const byGlossLoose = new Map();
  for (const word of parent?.vocabulary || []) {
    const form = normalizeLexicalForm(word.form);
    const gloss = normalizeGloss(word.gloss);
    if (form && !byForm.has(form)) byForm.set(form, word);
    if (!gloss) continue;
    if (!byGloss.has(gloss)) byGloss.set(gloss, word);
    const loose = glossKey(gloss);
    if (!loose) continue;
    if (!byGlossLoose.has(loose)) byGlossLoose.set(loose, []);
    byGlossLoose.get(loose).push(word);
  }
  return { byForm, byGloss, byGlossLoose };
}

function inferGloss(language, form) {
  const normalized = normalizeLexicalForm(form);
  if (!normalized) return "";
  const matches = (language?.vocabulary || []).filter(
    (word) => normalizeLexicalForm(word.form) === normalized && String(word.gloss || "").trim()
  );
  return matches.length === 1 ? matches[0].gloss : "";
}

function parentMatchFor(text, lexicon, gloss) {
  const form = normalizeLexicalForm(text);
  if (!form) return { parentMatch: "", parentGloss: "" };
  const key = normalizeGloss(gloss);
  if (key) {
    const exact = lexicon.byGloss.get(key);
    if (exact && normalizeLexicalForm(exact.form) === form) {
      return { parentMatch: "gloss", parentGloss: exact.gloss };
    }
    const loose = lexicon.byGlossLoose.get(glossKey(key)) || [];
    const matched = loose.find((word) => normalizeLexicalForm(word.form) === form);
    if (matched) return { parentMatch: "gloss", parentGloss: matched.gloss };
  }
  const word = lexicon.byForm.get(form);
  if (word) return { parentMatch: "form", parentGloss: word.gloss };
  return { parentMatch: "", parentGloss: "" };
}

function optionsWithDefaults(options) {
  return { ...DEFAULTS, ...(options || {}) };
}

// All concrete input sounds a target atom can match. A negated set or feature
// bundle is expanded against every sound the ancestry knows about, then the
// forward check throws away anything that cannot have produced the output.
function atomOptions(atom, context) {
  if (!atom) return [];
  if (atom.type === "literal") return atom.value ? [atom.value] : [];
  if (atom.type === "class") {
    return [...(atom.value === "V" ? context.vowels : context.consonants)];
  }
  if (atom.type === "set") {
    const universe = [...new Set([...context.featurePhonemes, ...context.known])];
    const members = atom.negated
      ? universe.filter((sound) => !atom.values.includes(sound))
      : atom.values;
    return [...new Set(members)];
  }
  if (atom.type === "feature") {
    let members = context.featureMembers(atom.terms);
    // α-variables cannot be resolved without a binding. Keep every charted
    // sound as a candidate and let the forward verification decide.
    if (!members.length) members = [...context.featurePhonemes];
    if (atom.negated) {
      const included = new Set(members);
      members = [...context.featurePhonemes].filter((sound) => !included.has(sound));
    }
    return [...new Set(members)];
  }
  return [];
}

// Expand a rule's input pattern into concrete token sequences. This is the
// source of merger ambiguity: [p t k] becomes three one-segment candidates.
function targetCombinations(rule, context, limit) {
  let combos = [[]];
  let truncated = false;
  for (const atom of rule.target || []) {
    const options = atomOptions(atom, context);
    if (!options.length) return { combos: [], truncated: false };
    const next = [];
    for (const combo of combos) {
      for (const option of options) {
        if (next.length >= limit) {
          truncated = true;
          break;
        }
        next.push([...combo, option]);
      }
      if (next.length >= limit) break;
    }
    combos = next;
    if (truncated) break;
  }
  const seen = new Set();
  return {
    combos: combos.filter((combo) => {
      const key = tokenKey(combo);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    truncated,
  };
}

// For a feature output such as t > [+voice], only some inputs can spell the
// observed segment. Try each concrete input in isolation to prune the search;
// α-variables may depend on the environment, so they stay as candidates and
// the full-word verification has the final say.
function featureSources(rule, context, outputToken, combos) {
  const variableOutput = (rule.featureOutput?.terms || []).some((term) => term.kind === "var");
  const sources = [];
  for (const combo of combos) {
    if (combo.length !== 1) continue;
    const match = { start: 0, end: 1, replacement: [], bindings: {} };
    const resolved = replacementForMatch([combo[0]], match, rule, context);
    if (resolved.ok) {
      if (resolved.replacement.length === 1 && resolved.replacement[0] === outputToken) {
        sources.push(combo);
      } else if (variableOutput) {
        sources.push(combo);
      }
      continue;
    }
    if (variableOutput) sources.push(combo);
  }
  return sources;
}

// Invert a substitution or insertion. The search branches between "this token
// passed through unchanged" and "this token is the output of the rule". Every
// complete candidate is verified by applying the rule forward again.
function substitutionCandidates(tokens, rule, context, combos, options) {
  const feature = Boolean(rule.featureOutput);
  const replacement = rule.replacement || [];
  const width = feature ? 1 : replacement.length;
  const results = new Map();
  const bestAt = new Map();
  let truncated = false;
  let visited = 0;
  const stack = [{ index: 0, pred: [], score: 0 }];

  const push = (index, pred, score) => {
    const key = `${index}\u0000${tokenKey(pred)}`;
    const previous = bestAt.get(key);
    // Keep the lowest-cost path to a state. A state reached with more rule
    // applications cannot lead to a better (fewer-change) reconstruction.
    if (previous !== undefined && previous <= score) return;
    bestAt.set(key, score);
    stack.push({ index, pred, score });
  };

  while (stack.length) {
    const state = stack.pop();
    visited += 1;
    if (visited > options.maxStates) {
      truncated = true;
      break;
    }
    if (state.index === tokens.length) {
      const key = tokenKey(state.pred);
      const previous = results.get(key);
      // If one form is reachable by several paths, keep the path that uses
      // the fewest rules. All distinct forms remain as candidates.
      if (!previous || state.score < previous.score) {
        results.set(key, { tokens: state.pred, score: state.score, loss: 0 });
      }
      continue;
    }

    // The token passed through the rule untouched.
    push(state.index + 1, [...state.pred, tokens[state.index]], state.score);

    // The token is the rule's output. For a literal output the slice must
    // match exactly; for a feature output the actually spelled sound varies
    // with the input and is checked below.
    let applies = false;
    if (width > 0 && state.index + width <= tokens.length) {
      applies = feature || replacement.every((token, offset) => tokens[state.index + offset] === token);
    }
    if (!applies) continue;
    const sources = feature
      ? featureSources(rule, context, tokens[state.index], combos)
      : combos;
    // The search is a LIFO stack; push in reverse so the first target
    // alternative (for example *p in a p/t/k merger) is processed first.
    for (const source of [...sources].reverse()) {
      push(state.index + width, [...state.pred, ...source], state.score + 1);
    }
  }

  const verified = [];
  for (const candidate of results.values()) {
    const applied = applyRule(candidate.tokens, rule, context);
    if (applied.error || !sameTokens(applied.tokens, tokens)) continue;
    verified.push(candidate);
  }
  return { candidates: verified, truncated };
}

// Invert a deletion. There is no evidence in the output for how many segments
// disappeared or where they sat, so try the fewest insertions first and keep
// only candidates that the forward rule reproduces exactly. The identity
// candidate stays available as a fallback for a rule that simply did not fire.
function deletionCandidates(tokens, rule, context, combos, options) {
  const identity = identityCandidate(tokens);
  const forward = applyRule(tokens, rule, context);
  const identityValid = !forward.error && sameTokens(forward.tokens, tokens);

  for (let loss = 1; loss <= options.maxLoss; loss += 1) {
    const generated = new Map();
    let truncated = false;
    let visited = 0;

    const add = (pred) => {
      if (generated.size >= options.maxCandidates) {
        truncated = true;
        return;
      }
      generated.set(tokenKey(pred), pred);
    };

    const build = (index, pred, remaining) => {
      visited += 1;
      if (visited > options.maxStates) {
        truncated = true;
        return;
      }
      if (generated.size >= options.maxCandidates) {
        truncated = true;
        return;
      }
      if (index === tokens.length && remaining === 0) {
        add(pred);
        return;
      }
      if (index < tokens.length) {
        // Keep the observed token, then continue to the next one.
        build(index + 1, [...pred, tokens[index]], remaining);
      }
      if (remaining > 0) {
        // Restore one deleted sequence at this boundary and stay here, so
        // consecutive deleted segments can share a boundary.
        for (const combo of combos) {
          build(index, [...pred, ...combo], remaining - 1);
          if (generated.size >= options.maxCandidates) break;
        }
      }
    };

    build(0, [], loss);

    const exact = [];
    for (const pred of generated.values()) {
      const applied = applyRule(pred, rule, context);
      if (applied.error || !sameTokens(applied.tokens, tokens)) continue;
      exact.push({ tokens: pred, score: loss, loss });
    }
    if (exact.length) {
      const candidates = identityValid ? [...exact, identity] : exact;
      return { candidates, truncated, loss };
    }
  }

  return { candidates: identityValid ? [identity] : [], truncated: false, loss: 0 };
}

function invertRuleAll(tokens, compiled, context, options = {}) {
  const rule = compiled?.rule || compiled;
  if (!rule || !Array.isArray(rule.target)) {
    return { candidates: [identityCandidate(tokens)], truncated: false, loss: 0 };
  }
  // The rule did not apply to this lexical item in the forward direction, so
  // its only exact predecessor is the unchanged form.
  if (ruleExceptsGloss(rule, options.gloss)) {
    return { candidates: [identityCandidate(tokens)], truncated: false, loss: 0 };
  }
  const settings = optionsWithDefaults(options);
  const { combos, truncated: targetsTruncated } = targetCombinations(
    rule,
    context,
    settings.maxTargetCombinations
  );
  if (!combos.length) {
    return { candidates: [], truncated: targetsTruncated, loss: 0 };
  }

  const feature = Boolean(rule.featureOutput);
  const replacement = rule.replacement || [];
  if (!feature && !replacement.length) {
    if (!rule.target.length) {
      return { candidates: [identityCandidate(tokens)], truncated: targetsTruncated, loss: 0 };
    }
    const result = deletionCandidates(tokens, rule, context, combos, settings);
    return { ...result, truncated: result.truncated || targetsTruncated };
  }

  const result = substitutionCandidates(tokens, rule, context, combos, settings);
  return { ...result, truncated: result.truncated || targetsTruncated };
}

// Every exact inverse is a legitimate reconstruction: a form can be inherited
// unchanged even when a rule could also have produced it. Deduplicate by form,
// keep the lowest-cost path, and return every form ordered by fewest rule
// applications (then least inferred loss). The unchanged candidate is therefore
// shown first, but it never hides the alternatives that use a rule.
function compareCandidates(left, right) {
  return (left.score || 0) - (right.score || 0) || (left.loss || 0) - (right.loss || 0);
}

function compareWithPriority(left, right, priority) {
  const leftPriority = priority ? priority(left) : 0;
  const rightPriority = priority ? priority(right) : 0;
  return leftPriority - rightPriority || compareCandidates(left, right);
}

function rankCandidates(candidates, limit = DEFAULTS.maxCandidates, priority = null) {
  const deduped = new Map();
  for (const candidate of candidates) {
    const key = tokenKey(candidate.tokens);
    const previous = deduped.get(key);
    if (!previous || compareCandidates(candidate, previous) < 0) deduped.set(key, candidate);
  }
  const ranked = [...deduped.values()].sort((left, right) => compareWithPriority(left, right, priority));
  return {
    candidates: ranked.slice(0, limit),
    truncated: ranked.length > limit,
  };
}

// Invert one compiled rule against one form. `candidates` contains every exact
// inverse, ordered by fewest rule applications. The unchanged/inherited form is
// included whenever the forward rule leaves it alone.
export function invertRule(tokens, rule, context, options = {}) {
  const result = invertRuleAll(tokens, rule, context, options);
  const ranked = rankCandidates(result.candidates, options.maxCandidates, options.priority);
  return {
    ...result,
    candidates: ranked.candidates,
    truncated: result.truncated || ranked.truncated,
  };
}

// Expand one reverse step across a set of candidates. Each candidate keeps its
// accumulated score and loss count; identical forms reached by different paths
// keep the lowest-cost path. Candidates with different intermediate targets are
// kept separate until the final parallel-forward check.
function expandCandidates(candidates, rule, context, options) {
  const next = new Map();
  let truncated = false;
  for (const candidate of candidates) {
    const inverted = invertRuleAll(candidate.tokens, rule, context, options);
    if (inverted.truncated) truncated = true;
    for (const predecessor of inverted.candidates) {
      const tokens = predecessor.tokens;
      const target = candidate.parallelTarget || null;
      const key = `${tokenKey(tokens)}\u0000${target ? tokenKey(target) : ""}`;
      const score = candidate.score + predecessor.score;
      const loss = candidate.loss + (predecessor.loss || 0);
      const nextCandidate = { tokens, score, loss, parallelTarget: target };
      const previous = next.get(key);
      if (previous && compareCandidates(previous, nextCandidate) <= 0) continue;
      next.set(key, nextCandidate);
    }
  }
  let list = [...next.values()];
  if (list.length > options.maxCandidates) {
    truncated = true;
    list = list.sort((left, right) => compareWithPriority(left, right, options.priority)).slice(0, options.maxCandidates);
  }
  return { candidates: list, truncated };
}

// Apply only the top-level (parallel) rules of one stage. This is the forward
// check used after reversing that pass; sequential children are handled by
// their own single-rule checks before this point.
function applyParallelOnly(tokens, groups, context, gloss = "") {
  if (!groups.length) return { ok: true, tokens: [...tokens], errors: [] };
  const stage = {
    language: null,
    context,
    groups: groups.map((group) => ({ ...group, children: [] })),
  };
  const result = deriveStages(tokens, [stage], context, { gloss });
  return {
    ok: !result.errors.length && !result.fatal,
    tokens: result.tokens,
    errors: result.errors,
  };
}

// Invert a compiled rule-stage list (the result of compileRuleStages). The
// forward order is: parallel top-level rules, then children in display order.
// The reverse order is therefore: children backwards, then the parallel pass.
export function invertRules(tokens, groups, context, options = {}) {
  const settings = optionsWithDefaults(options);
  const gloss = settings.gloss || "";
  const usable = (groups || []).filter((group) => group.rule?.enabled !== false);
  const warnings = [];
  const exceptions = [];
  for (const group of usable) {
    if (ruleExceptsGloss(group.rule, gloss)) exceptions.push(group.label);
    else if (!group.compiled?.ok && !group.compiled?.empty) {
      warnings.push(group.compiled?.error || "A rule could not be compiled.");
    }
    for (const child of group.children || []) {
      if (child.rule.enabled === false) continue;
      if (ruleExceptsGloss(child.rule, gloss)) exceptions.push(child.label);
      else if (!child.compiled?.ok && !child.compiled?.empty) {
        warnings.push(child.compiled?.error || "A rule could not be compiled.");
      }
    }
  }

  let candidates = [identityCandidate(tokens)];
  let truncated = false;

  for (const group of [...usable].reverse()) {
    for (const child of [...(group.children || [])].reverse()) {
      if (child.rule.enabled === false || !child.compiled?.ok) continue;
      if (ruleExceptsGloss(child.rule, gloss)) continue;
      const expanded = expandCandidates(candidates, child.compiled.rule, context, settings);
      candidates = expanded.candidates;
      truncated = truncated || expanded.truncated;
      if (!candidates.length) {
        return { candidates: [], truncated, warnings, exceptions, loss: 0 };
      }
    }
  }

  // Remember the output of the parallel pass for each candidate. It is the
  // reference the forward group check must reproduce after the rules reverse.
  for (const candidate of candidates) {
    candidate.parallelTarget = [...candidate.tokens];
  }

  for (const group of [...usable].reverse()) {
    if (!group.compiled?.ok || ruleExceptsGloss(group.rule, gloss)) continue;
    const expanded = expandCandidates(candidates, group.compiled.rule, context, settings);
    candidates = expanded.candidates;
    truncated = truncated || expanded.truncated;
    if (!candidates.length) {
      return { candidates: [], truncated, warnings, exceptions, loss: 0 };
    }
  }

  const topGroups = usable.filter((group) => group.compiled?.ok);
  if (topGroups.length) {
    candidates = candidates.filter((candidate) => {
      if (!candidate.parallelTarget) return false;
      const forward = applyParallelOnly(candidate.tokens, topGroups, context, gloss);
      return forward.ok && sameTokens(forward.tokens, candidate.parallelTarget);
    });
  }

  const ranked = rankCandidates(candidates, settings.maxCandidates, settings.priority);
  truncated = truncated || ranked.truncated;
  const list = ranked.candidates.map((candidate) => ({
    tokens: candidate.tokens,
    score: candidate.score,
    loss: candidate.loss,
  }));
  return {
    candidates: list,
    truncated,
    warnings: [...new Set(warnings)],
    exceptions: [...new Set(exceptions)],
    loss: list.length ? Math.max(...list.map((candidate) => candidate.loss)) : 0,
  };
}

// Invert this language's own sound changes from a recorded form. `parent` is
// the immediate ancestor; the helper deliberately stops there, because each
// generation's rules are compiled against that generation's grammar. Running
// the helper again on the result reconstructs the next generation back.
export function reconstructForm(form, project, languageId, options = {}) {
  const lineage = getLineage(project, languageId);
  const language = lineage.at(-1) || null;
  const parent = lineage.length > 1 ? lineage[lineage.length - 2] : null;
  const input = String(form ?? "").trim();
  const requestedGloss = String(options.gloss ?? "").trim();
  const empty = {
    ok: false,
    reason: language ? "empty" : "not-found",
    language,
    parent,
    inputTokens: [],
    inputText: "",
    gloss: requestedGloss,
    candidates: [],
    text: "",
    ambiguous: false,
    unchanged: false,
    lossy: false,
    truncated: false,
    warnings: [],
    exceptions: [],
  };
  if (!language) return empty;
  if (!parent) return { ...empty, reason: "root" };
  if (!input) return empty;

  const context = contextForLanguage(project, languageId);
  const tokens = context.tokenize(input);
  if (!tokens.length) return empty;

  const gloss = requestedGloss || inferGloss(language, input);
  const lexicon = parentLexicon(parent);
  const evidenceCache = new Map();
  const evidenceFor = (text) => {
    if (!evidenceCache.has(text)) evidenceCache.set(text, parentMatchFor(text, lexicon, gloss));
    return evidenceCache.get(text);
  };
  const priority = (candidate) => {
    const match = evidenceFor(candidate.tokens.join(""));
    if (match.parentMatch === "gloss") return 0;
    if (match.parentMatch === "form") return 1;
    return 2;
  };

  const groups = compileRuleStages(language.soundChanges || [], context);
  const inverted = invertRules(tokens, groups, context, { ...options, gloss, priority });
  const candidates = inverted.candidates.map((candidate) => {
    const text = candidate.tokens.join("");
    const match = evidenceFor(text);
    return {
      ...candidate,
      text,
      parentMatch: match.parentMatch,
      parentGloss: match.parentGloss,
    };
  });
  const alternativeTexts = [...new Set(candidates.map((candidate) => candidate.text))];
  return {
    ok: candidates.length > 0,
    reason: candidates.length ? "" : "no-inverse",
    language,
    parent,
    inputTokens: tokens,
    inputText: tokens.join(""),
    gloss,
    candidates,
    text: candidates[0]?.text || "",
    ambiguous: alternativeTexts.length > 1,
    unchanged: candidates.some((candidate) => candidate.score === 0),
    lossy: candidates.some((candidate) => candidate.loss > 0),
    truncated: inverted.truncated,
    warnings: inverted.warnings,
    exceptions: inverted.exceptions || [],
  };
}

// Human-readable alternatives for a result. All exact candidates are included:
// mergers produce several sources, and an unchanged/inherited form may sit
// alongside a rule-derived one.
export function reconstructionAlternatives(result) {
  if (!result || !result.candidates?.length) return [];
  return [...new Set(result.candidates.map((candidate) => candidate.text))];
}
