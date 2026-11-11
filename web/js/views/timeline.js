import { timelineStages } from "../timeline.js";
import { esc, icon, summaryChip } from "../ui.js";

// A family-level report: the sound changes of every language grouped by their
// documentation-only stage. A stage is an integer the editor picks per rule, so
// stages order changes relative to each other — they are not calendar dates —
// and nothing in a derivation reads them. Rules without an exact integer stage
// are undated and listed in their own group at the end.

function stageRuleMarkup(entry) {
  const { rule, language } = entry;
  const notation = rule.notation.trim() || "Empty rule";
  // Mirror the sound-changes card status cue only for rules that are switched
  // off; enabled rules carry no badge anywhere else in the app.
  const state = rule.enabled === false
    ? `<span class="subgroup-tag" title="The rule is recorded but switched off on its card">off</span>`
    : "";
  const note = rule.note.trim();
  return `
    <li class="subgroup-rule">
      <a class="lineage-chip" href="#/language/${encodeURIComponent(language.id)}/changes" title="Open the sound changes of ${esc(language.name)}">${esc(language.name)}</a>
      <code class="ipa">${esc(notation)}</code>
      ${state}
      <span class="subgroup-rule-where">${esc(note)}</span>
    </li>`;
}

function stagePanel(stage) {
  return `
    <section class="panel subgroup-panel" id="stage-${esc(String(stage.date))}">
      <header class="panel-head">
        <div class="panel-title">
          <h2>Stage ${esc(String(stage.date))}</h2>
          <p>${stage.rules.length} change${stage.rules.length === 1 ? "" : "s"} — stage numbers are relative, editor-chosen integers, not calendar dates</p>
        </div>
      </header>
      <div class="panel-body subgroup-body">
        <ul class="subgroup-rule-list">${stage.rules.map(stageRuleMarkup).join("")}</ul>
      </div>
    </section>`;
}

function undatedPanel(undated) {
  return `
    <section class="panel subgroup-panel" id="stage-undated">
      <header class="panel-head">
        <div class="panel-title">
          <h2>Undated</h2>
          <p>${undated.length} change${undated.length === 1 ? "" : "s"} in stored order</p>
        </div>
      </header>
      <div class="panel-body subgroup-body">
        <ul class="subgroup-rule-list">${undated.map(stageRuleMarkup).join("")}</ul>
        <p class="subgroup-hint">Stages are documentation only: they order changes in this report and no derivation reads them. A rule without a stage simply has no relative position recorded yet — set one in the Stage field on its card.</p>
      </div>
    </section>`;
}

function emptyState(ctx) {
  // Jump straight to the changes tab of the first language when the family has
  // one; a fresh project has no language to route to, so fall back to the tree.
  const first = ctx.project.languages.find((language) => language);
  const link = first
    ? `<a class="button button-primary" href="#/language/${encodeURIComponent(first.id)}/changes">${icon("sound")}<span>Open sound changes</span></a>`
    : `<a class="button button-primary" href="#/tree">${icon("tree")}<span>Open family tree</span></a>`;
  return `
    <section class="panel">
      <div class="empty-workspace subgroup-empty">
        <div class="empty-icon">${icon("sound")}</div>
        <h2>No stages to show yet</h2>
        <p>The Timeline orders the family's sound changes by their relative stage. Add sound changes to a language and set the Stage field on a rule to place it here.</p>
        ${link}
      </div>
    </section>`;
}

export function renderTimeline(container, ctx) {
  const report = timelineStages(ctx.project);
  const datedLanguages = new Set(
    report.stages.flatMap((stage) => stage.rules.map((entry) => entry.language))
  );
  // Count languages with at least one dated rule, not every language.
  const datedCount = report.stages.reduce((sum, stage) => sum + stage.rules.length, 0);
  const total = datedCount + report.undated.length;

  container.innerHTML = `
    <div class="page workspace-stack subgrouping-page">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Timeline</p>
          <h2>Sound-change timeline</h2>
          <p class="section-copy">Every sound change in the family, grouped by the relative stage recorded on its card. Stages describe chronology for the reader only — they never affect how forms are derived.</p>
        </div>
        <div class="inventory-summary">
          ${summaryChip("dated rules", datedCount)}
          ${summaryChip("languages", datedLanguages.size)}
          ${summaryChip("undated", report.undated.length)}
        </div>
      </section>
      ${total
        ? `${report.stages.map(stagePanel).join("")}${report.undated.length ? undatedPanel(report.undated) : ""}`
        : emptyState(ctx)
      }
    </div>`;
}
