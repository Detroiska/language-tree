import { subgroupingEvidence } from "../subgrouping.js";
import { esc, icon } from "../ui.js";

// A family-level report: every internal node with two or more daughters is a
// claim that its descendants form a clade. The comparative method tests that
// claim with shared innovations, so this view lists each node's own branch
// rules, the rules repeated on every daughter branch, and the rules shared by
// only part of the clade. A rule is support only when it occurs nowhere
// outside the clade; the panel flags those explicitly.

const STATUS = {
  supported: {
    label: "Supported",
    icon: "check",
    chip: "status-match",
    title: "At least one branch or shared innovation is unique to this clade",
  },
  weak: {
    label: "Weak",
    icon: "warning",
    chip: "status-differs",
    title: "Changes exist, but none is unique to this clade",
  },
  unsupported: {
    label: "Unsupported",
    icon: "x",
    chip: "status-invalid",
    title: "No shared sound change supports this node",
  },
};

function statusBadge(status) {
  const meta = STATUS[status] || STATUS.unsupported;
  return `<span class="status-chip ${meta.chip} subgroup-status" title="${esc(meta.title)}">${icon(meta.icon)}${esc(meta.label)}</span>`;
}

function ruleMarkup(rule) {
  const uniqueness = rule.unique
    ? `<span class="subgroup-tag is-unique" title="No rule with this notation occurs outside the clade">unique</span>`
    : `<span class="subgroup-tag" title="The same rule also occurs outside the clade">also outside</span>`;
  return `
    <li class="subgroup-rule">
      <code class="ipa">${esc(rule.notation)}</code>
      ${uniqueness}
    </li>`;
}

function ruleList(rules, emptyText) {
  if (!rules.length) return `<p class="subgroup-none">${esc(emptyText)}</p>`;
  return `<ul class="subgroup-rule-list">${rules.map(ruleMarkup).join("")}</ul>`;
}

function partialMarkup(rule) {
  const sourceText = rule.sources.join(", ");
  return `
    <li class="subgroup-rule">
      <code class="ipa">${esc(rule.notation)}</code>
      <span class="subgroup-tag">${esc(`${rule.count} of ${rule.total}`)}</span>
      <span class="subgroup-rule-where">${sourceText ? `on ${esc(sourceText)}` : ""}</span>
    </li>`;
}

function partialList(rules, total) {
  if (!rules.length) return `<p class="subgroup-none">No change is shared by only part of the clade.</p>`;
  return `<ul class="subgroup-rule-list">${rules
    .map((rule) => partialMarkup({ ...rule, total }))
    .join("")}</ul>`;
}

function nodePanel(node) {
  const daughterLinks = node.children
    .map(
      (child) =>
        `<a class="lineage-chip" href="#/language/${encodeURIComponent(child.id)}/changes" title="Open the sound changes of ${esc(child.name)}">${esc(child.name)}</a>`
    )
    .join("");
  return `
    <section class="panel subgroup-panel" id="subgroup-${esc(node.language.id)}">
      <header class="panel-head">
        <div class="panel-title">
          <h2>${esc(node.language.name)}</h2>
          <p>${node.descendants.length} descendant${node.descendants.length === 1 ? "" : "s"} across ${node.children.length} daughter branches</p>
        </div>
        <div class="panel-actions">
          ${statusBadge(node.status)}
          <a class="button button-quiet button-small" href="#/language/${encodeURIComponent(node.language.id)}/changes">${icon("sound")}<span>Open branch</span></a>
        </div>
      </header>
      <div class="panel-body subgroup-body">
        <div class="subgroup-clade">
          <span class="subgroup-label">Daughters</span>
          <div class="subgroup-langs">${daughterLinks}</div>
        </div>
        ${
          node.warning
            ? `<div class="notice subgroup-notice">${icon("warning")}<p>${esc(node.warning)}</p></div>`
            : ""
        }
        <div class="subgroup-columns">
          <section class="subgroup-column">
            <h3>Branch innovations</h3>
            <p class="subgroup-hint">Changes recorded on the branch leading to ${esc(node.language.name)}.</p>
            ${ruleList(node.ancestral, "No sound change is recorded on this branch.")}
          </section>
          <section class="subgroup-column">
            <h3>Shared across all branches</h3>
            <p class="subgroup-hint">The same change is recorded on every daughter branch.</p>
            ${ruleList(node.shared, "No change is shared by every daughter branch.")}
          </section>
          <section class="subgroup-column">
            <h3>Shared by some branches</h3>
            <p class="subgroup-hint">Recorded on more than one daughter branch, but not all — weaker evidence for a subgroup.</p>
            ${partialList(node.partial, node.children.length)}
          </section>
        </div>
      </div>
    </section>`;
}

function summaryChip(label, value) {
  return `<span><strong>${esc(value)}</strong> ${esc(label)}</span>`;
}

function emptyState() {
  return `
    <section class="panel">
      <div class="empty-workspace subgroup-empty">
        <div class="empty-icon">${icon("tree")}</div>
        <h2>No subgroups to test yet</h2>
        <p>Subgrouping evidence compares the sound changes on sister branches beneath an internal node. Add a language with two or more daughters to see its clade tested here.</p>
        <a class="button button-primary" href="#/tree">${icon("tree")}<span>Open family tree</span></a>
      </div>
    </section>`;
}

export function renderSubgrouping(container, ctx) {
  const report = subgroupingEvidence(ctx.project);
  const nodes = report.nodes;

  container.innerHTML = `
    <div class="workspace-stack subgrouping-page">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Subgrouping</p>
          <h2>Subgrouping evidence</h2>
          <p class="section-copy">A tree claims that a group of languages shares an ancestor the rest do not. This report tests every internal node with shared sound changes: a rule supports a clade when it appears inside the clade and nowhere outside it.</p>
        </div>
        <div class="inventory-summary">
          ${summaryChip("nodes tested", report.tested)}
          ${summaryChip("supported", report.supported)}
          ${summaryChip("weak", report.weak)}
          ${summaryChip("unsupported", report.unsupported)}
        </div>
      </section>
      ${nodes.length ? nodes.map(nodePanel).join("") : emptyState()}
    </div>`;
}
