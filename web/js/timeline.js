// Family-level chronology of sound changes.
//
// Each sound-change rule may carry a stage: an integer the editor picks as a
// relative position in the language's history. This module groups every
// language's dated rules by stage, ascending, and collects the rules with no
// stage so the Timeline view can list them separately. Stages exist only for
// documentation: an integer chosen here never feeds a derivation, it orders
// rules in the report the same way the optional/rate field is descriptive.
//
// Deliberately DOM-free so the grouping can be tested under Node. The panel in
// views/timeline.js formats the result.

// A rule is dated only when its stage is an exact integer. Rules inserted from
// the rule library have no `date` field at all, and anything missing, null, or
// non-integer means the editor has not recorded a relative position yet.
export function timelineStages(project) {
  const stages = new Map();
  const undated = [];
  for (const language of project?.languages || []) {
    for (const rule of language?.soundChanges || []) {
      if (Number.isInteger(rule.date)) {
        if (!stages.has(rule.date)) stages.set(rule.date, []);
        stages.get(rule.date).push({ rule, language });
      } else {
        undated.push({ rule, language });
      }
    }
  }
  return {
    // Ascending stage order; rules inside a stage keep stored order because
    // they were appended in that order.
    stages: [...stages.keys()]
      .sort((a, b) => a - b)
      .map((date) => ({ date, rules: stages.get(date) })),
    undated,
  };
}
