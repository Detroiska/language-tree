// Subgrouping evidence.
//
// A tree is a claim: this group of languages shares a common ancestor that the
// others do not. The comparative method tests that claim with shared
// innovations. This module reads the sound changes already stored on each
// branch and reports, for every internal node with two or more daughters:
//
//   - the node's own branch innovations (changes that apply to every
//     descendant through the derivation chain),
//   - rules present on every direct daughter branch,
//   - rules present on some but not all daughter branches,
//   - which rules are absent outside the clade and therefore uniquely support
//     it.
//
// It is deliberately DOM-free so the computations can be tested under Node.
// The panel in views/subgrouping.js formats the result.

import { childrenOf, descendantIds, getLineage } from "./model.js";

function normalizeNotation(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replaceAll("→", ">")
    .replaceAll("->", ">")
    .replace(/\s+/g, " ")
    .trim();
}

function ruleMap(language) {
  const map = new Map();
  for (const rule of language?.soundChanges || []) {
    if (rule.enabled === false) continue;
    const key = normalizeNotation(rule.notation);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        key,
        notation: normalizeNotation(rule.notation),
        sources: [language.name],
      });
    }
  }
  return map;
}

function recordFor(key, notation, sourceLanguages, unique) {
  return {
    key,
    notation,
    sources: sourceLanguages.map((language) => language.name),
    unique: Boolean(unique),
  };
}

function descendantLanguages(project, languageId) {
  const ids = descendantIds(project, languageId);
  return project.languages.filter((language) => ids.has(language.id));
}

function outsideLanguages(project, language, descendantSet) {
  return project.languages.filter(
    (candidate) => candidate.id !== language.id && !descendantSet.has(candidate.id)
  );
}

function sharedKeys(daughterMaps) {
  if (!daughterMaps.length) return new Set();
  let shared = new Set(daughterMaps[0].rules.keys());
  for (const item of daughterMaps.slice(1)) {
    for (const key of [...shared]) {
      if (!item.rules.has(key)) shared.delete(key);
    }
    if (!shared.size) break;
  }
  return shared;
}

function ruleCounts(daughterMaps) {
  const counts = new Map();
  for (const item of daughterMaps) {
    for (const key of item.rules.keys()) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// One node of the report. `ancestral` is the node's own branch; `shared` is the
// intersection of the rules stored on every daughter branch; `partial` holds
// rules found on at least two but not all daughter branches. Rules deeper than
// a direct daughter are evidence for the node where they sit, not for this one,
// so they do not inflate the counts here.
function nodeEvidence(project, language, children) {
  const descendantSet = descendantIds(project, language.id);
  const descendants = descendantLanguages(project, language.id);
  const daughterMaps = children.map((child) => ({
    language: child,
    rules: ruleMap(child),
  }));
  const outside = outsideLanguages(project, language, descendantSet);
  const outsideSignatures = new Set();
  for (const candidate of outside) {
    for (const ancestor of getLineage(project, candidate.id)) {
      for (const key of ruleMap(ancestor).keys()) outsideSignatures.add(key);
    }
  }

  const sharedKeySet = sharedKeys(daughterMaps);
  const counts = ruleCounts(daughterMaps);

  const ancestral = [...ruleMap(language).values()].map((record) =>
    recordFor(record.key, record.notation, [language], !outsideSignatures.has(record.key))
  );

  const shared = [...sharedKeySet]
    .map((key) => {
      const source = daughterMaps.find((item) => item.rules.has(key));
      const record = source?.rules.get(key);
      if (!record) return null;
      return recordFor(
        key,
        record.notation,
        daughterMaps
          .filter((item) => item.rules.has(key))
          .map((item) => item.language),
        !outsideSignatures.has(key)
      );
    })
    .filter(Boolean)
    .sort((left, right) => left.notation.localeCompare(right.notation));

  const partial = [...counts.entries()]
    .filter(([key, count]) => count >= 2 && count < children.length && !sharedKeySet.has(key))
    .map(([key, count]) => {
      const source = daughterMaps.find((item) => item.rules.has(key));
      const record = source?.rules.get(key);
      if (!record) return null;
      return {
        key,
        notation: record.notation,
        sources: daughterMaps
          .filter((item) => item.rules.has(key))
          .map((item) => item.language.name),
        unique: !outsideSignatures.has(key),
        count,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.count - left.count || left.notation.localeCompare(right.notation));

  const uniqueSupport = new Set([
    ...ancestral.filter((rule) => rule.unique).map((rule) => rule.key),
    ...shared.filter((rule) => rule.unique).map((rule) => rule.key),
  ]);
  const support = uniqueSupport.size;
  const hasEvidence = ancestral.length > 0 || shared.length > 0;
  const status = support > 0 ? "supported" : hasEvidence ? "weak" : "unsupported";
  const warning =
    status === "supported"
      ? ""
      : status === "weak"
        ? "Changes are present, but the same rules also occur outside this clade, so they do not uniquely support it."
        : "No shared sound change supports this node.";

  return {
    language,
    depth: Math.max(0, getLineage(project, language.id).length - 1),
    children: children.map((child) => ({ id: child.id, name: child.name })),
    descendants: descendants.map((descendant) => ({
      id: descendant.id,
      name: descendant.name,
    })),
    ancestral,
    shared,
    partial,
    support,
    status,
    warning,
  };
}

// Build the subgrouping report for every internal node with at least two
// daughters. Single-child nodes are not subgrouping tests, so they are omitted.
export function subgroupingEvidence(project) {
  const nodes = [];
  for (const language of project?.languages || []) {
    const children = childrenOf(project, language.id);
    if (children.length < 2) continue;
    nodes.push(nodeEvidence(project, language, children));
  }
  nodes.sort(
    (left, right) =>
      left.depth - right.depth || left.language.name.localeCompare(right.language.name)
  );

  return {
    nodes,
    tested: nodes.length,
    supported: nodes.filter((node) => node.status === "supported").length,
    weak: nodes.filter((node) => node.status === "weak").length,
    unsupported: nodes.filter((node) => node.status === "unsupported").length,
  };
}
