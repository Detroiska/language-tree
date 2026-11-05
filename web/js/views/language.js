import {
  ancestorsOf,
  canSetParent,
  childrenOf,
  createAncestor,
  createLanguage,
  createSibling,
  deleteLanguage,
  descendantIds,
  descendantsCount,
  findLanguage,
  getLineage,
  languageStats,
  restoreDeletedLanguages,
  setParent,
} from "../model.js";
import {
  confirmDialog,
  esc,
  icon,
  openMenu,
  promptDialog,
  toast,
} from "../ui.js";
import { renderAllophony } from "./allophony.js";
import { renderAnalytics } from "./analytics.js";
import { renderInventory } from "./inventory.js";
import { renderPhonotactics } from "./phonotactics.js";
import { renderChanges } from "./soundchanges.js";
import { renderVocabulary } from "./vocabulary.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "phonology", label: "Phonology" },
  { id: "allophony", label: "Allophony" },
  { id: "phonotactics", label: "Phonotactics" },
  { id: "changes", label: "Sound changes" },
  { id: "vocabulary", label: "Vocabulary" },
  { id: "analytics", label: "Analytics" },
];

function tabId(value) {
  return TABS.some((tab) => tab.id === value) ? value : "overview";
}

function languageTabHref(language, tab) {
  // Ids are percent-encoded so a hand-edited id can never break out of the
  // href attribute; parseRoute() decodes each segment again.
  return `#/language/${encodeURIComponent(language.id)}/${tab}`;
}

function headerActions(ctx) {
  openMenu(ctx.anchor, [
    { label: "Open in family tree", icon: "tree", onClick: () => ctx.navigate("#/tree") },
    { label: "Add daughter language", icon: "plus", onClick: () => addDaughter(ctx) },
    { label: "Add sibling language", icon: "plus", onClick: () => addSibling(ctx) },
    { label: "Add ancestor language", icon: "arrowUp", onClick: () => addAncestor(ctx) },
    { separator: true },
    { label: "Delete language…", icon: "trash", danger: true, onClick: () => deleteCurrent(ctx) },
  ]);
}

async function addDaughter(ctx) {
  const name = await promptDialog({
    title: "Add a daughter language",
    label: `Name of the new language descended from ${ctx.language.name}`,
    value: `${ctx.language.name} daughter`,
    placeholder: "e.g. Old Coastal",
    confirmLabel: "Create language",
    help: "Its chart is copied from this language. Sound changes and vocabulary start empty.",
  });
  if (!name) return;
  const child = createLanguage(
    name,
    ctx.language.id,
    ctx.language.inventory,
    ctx.language.phonotactics,
    ctx.language.allophony,
    ctx.language.featureOverrides
  );
  ctx.project.languages.push(child);
  ctx.touch({ label: `Add language ${child.name}` });
  ctx.refresh();
  ctx.navigate(languageTabHref(child, "overview"));
  toast(`Created ${child.name}.`, { type: "success" });
}

async function addAncestor(ctx) {
  const name = await promptDialog({
    title: "Add an ancestor language",
    label: `Name of the language ancestral to ${ctx.language.name}`,
    value: `Proto-${ctx.language.name}`,
    placeholder: "e.g. Proto-Coastal",
    confirmLabel: "Create ancestor",
    help: `${ctx.language.name} becomes its daughter. Its chart starts as a copy of ${ctx.language.name}, so you can work backwards from a descendant.`,
  });
  if (!name) return;
  const ancestor = createAncestor(ctx.project, ctx.language.id, name);
  if (!ancestor) return;
  ctx.touch({ label: `Add language ${ancestor.name}` });
  ctx.refresh();
  ctx.navigate(languageTabHref(ancestor, "overview"));
  toast(`Created ${ancestor.name} above ${ctx.language.name}.`, { type: "success" });
}

async function addSibling(ctx) {
  const siblingOf = ctx.language.parentId ? "sister language" : "sibling root language";
  const name = await promptDialog({
    title: `Add a ${siblingOf}`,
    label: `Name of the new language beside ${ctx.language.name}`,
    value: `${ctx.language.name} sister`,
    placeholder: "e.g. Old Inland",
    confirmLabel: "Create language",
    help: `It shares ${ctx.language.name}'s parent and starts with a copy of its chart.`,
  });
  if (!name) return;
  const sibling = createSibling(ctx.project, ctx.language.id, name);
  if (!sibling) return;
  ctx.touch({ label: `Add language ${sibling.name}` });
  ctx.refresh();
  ctx.navigate(languageTabHref(sibling, "overview"));
  toast(`Created ${sibling.name} beside ${ctx.language.name}.`, { type: "success" });
}

async function renameLanguage(ctx) {
  const name = await promptDialog({
    title: "Rename language",
    label: "Language name",
    value: ctx.language.name,
    confirmLabel: "Rename",
  });
  if (!name || name === ctx.language.name) return;
  ctx.language.name = name;
  ctx.touch({ label: "Rename language" });
  ctx.refresh();
}

async function deleteCurrent(ctx) {
  const languageName = ctx.language.name;
  const count = descendantsCount(ctx.project, ctx.language.id);
  const message = count
    ? `<strong>${esc(languageName)}</strong> and its <strong>${count}</strong> descendant${count === 1 ? "" : "s"} will be removed. You can undo this immediately afterward; once committed, earlier versions also remain in git history.`
    : `<strong>${esc(languageName)}</strong> will be removed. You can undo this immediately afterward; once committed, earlier versions also remain in git history.`;
  const confirmed = await confirmDialog("Delete this language?", message, {
    confirmLabel: count ? `Delete ${count + 1} languages` : "Delete language",
    danger: true,
  });
  if (!confirmed) return;
  const parentId = ctx.language.parentId;
  const branchIds = new Set([ctx.language.id, ...descendantIds(ctx.project, ctx.language.id)]);
  const removed = ctx.project.languages
    .map((item, index) => ({ language: item, index }))
    .filter(({ language: item }) => branchIds.has(item.id));
  deleteLanguage(ctx.project, ctx.language.id);
  ctx.touch({ label: `Delete language ${languageName}` });
  ctx.refresh();
  if (parentId && findLanguage(ctx.project, parentId)) ctx.navigate(languageTabHref({ id: parentId }, "overview"));
  else ctx.navigate("#/tree");
  toast(`Deleted ${languageName}.`, {
    type: "info",
    duration: 7000,
    action: {
      label: "Undo",
      onClick: () => {
        if (!restoreDeletedLanguages(ctx.project, removed)) return;
        ctx.touch({ label: `Restore language ${languageName}` });
        ctx.refresh();
        toast(`Restored ${languageName}.`, { type: "success" });
      },
    },
  });
}

function languageHeader(ctx, activeTab) {
  const { language } = ctx;
  const lineage = getLineage(ctx.project, language.id);
  const parent = lineage.length > 1 ? lineage[lineage.length - 2] : null;
  const stats = languageStats(language);
  const childCount = childrenOf(ctx.project, language.id).length;
  return `
    <header class="page-head language-head">
      <div class="language-head-main">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="#/tree">Family tree</a>
          ${parent ? `<span class="crumb-sep">${icon("chevronRight")}</span><a href="${languageTabHref(parent, "overview")}">${esc(parent.name)}</a>` : ""}
          <span class="crumb-sep">${icon("chevronRight")}</span>
          <span class="crumb-current">${esc(language.name)}</span>
        </nav>
        <div class="language-title-row">
          <h1>${esc(language.name)}</h1>
          <button class="icon-button title-edit" type="button" data-rename-language title="Rename language" aria-label="Rename language">${icon("edit")}</button>
        </div>
        <p class="page-subtitle">
          ${parent ? `Daughter of <a href="${languageTabHref(parent, "overview")}">${esc(parent.name)}</a>` : "Root language"}
          <span class="subtitle-dot">·</span>
          ${childCount} ${childCount === 1 ? "daughter" : "daughters"}
          <span class="subtitle-dot">·</span>
          ${stats.consonants + stats.vowels} charted sounds
        </p>
      </div>
      <div class="page-actions">
        <button class="button button-quiet" type="button" data-view-tree>${icon("tree")}<span>View in tree</span></button>
        <button class="button button-primary" type="button" data-add-daughter>${icon("plus")}<span>Add daughter</span></button>
        <button class="icon-button menu-trigger" type="button" data-language-menu title="More actions" aria-label="More language actions">${icon("more")}</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Language sections">
      ${TABS.map(
        (tab) => `
          <a class="tab ${activeTab === tab.id ? "is-active" : ""}" href="${languageTabHref(language, tab.id)}" ${activeTab === tab.id ? 'aria-current="page"' : ""}>
            <span>${tab.label}</span>
            ${
              tab.id === "phonology"
                ? `<span class="tab-count">${stats.consonants + stats.vowels}</span>`
                : tab.id === "changes"
                  ? `<span class="tab-count">${stats.changes}</span>`
                  : tab.id === "allophony"
                    ? `<span class="tab-count">${stats.allophony}</span>`
                    : tab.id === "vocabulary"
                    ? `<span class="tab-count">${stats.words}</span>`
                    : ""
            }
          </a>`
      ).join("")}
    </nav>
  `;
}

function renderOverview(content, ctx) {
  const { language } = ctx;
  const stats = languageStats(language);
  const lineage = getLineage(ctx.project, language.id);
  const parent = lineage.length > 1 ? lineage[lineage.length - 2] : null;
  const children = childrenOf(ctx.project, language.id);
  const blocked = descendantIds(ctx.project, language.id);
  const parentOptions = ctx.project.languages
    .filter((candidate) => candidate.id !== language.id && !blocked.has(candidate.id))
    .map((candidate) => {
      const depth = Math.max(0, getLineage(ctx.project, candidate.id).length - 1);
      const prefix = depth ? `${"· ".repeat(depth)}` : "";
      return `<option value="${esc(candidate.id)}" ${candidate.id === language.parentId ? "selected" : ""}>${esc(prefix + candidate.name)}</option>`;
    })
    .join("");

  content.innerHTML = `
    <div class="overview-grid">
      <section class="overview-main">
        <div class="stat-grid">
          <button class="stat-card" type="button" data-goto-tab="phonology">
            <span class="stat-label">Phonology</span>
            <span class="stat-value">${stats.consonants + stats.vowels}</span>
            <span class="stat-detail">${stats.consonants} consonants · ${stats.vowels} vowels</span>
            ${icon("grid", "stat-icon")}
          </button>
          <button class="stat-card" type="button" data-goto-tab="changes">
            <span class="stat-label">Sound changes</span>
            <span class="stat-value">${stats.changes}</span>
            <span class="stat-detail">${parent ? `from ${esc(parent.name)}` : "root language"}</span>
            ${icon("sound", "stat-icon")}
          </button>
          <button class="stat-card" type="button" data-goto-tab="vocabulary">
            <span class="stat-label">Vocabulary</span>
            <span class="stat-value">${stats.words}</span>
            <span class="stat-detail">${stats.words === 1 ? "lexical entry" : "lexical entries"}</span>
            ${icon("book", "stat-icon")}
          </button>
          <div class="stat-card stat-card-static">
            <span class="stat-label">Generation</span>
            <span class="stat-value">${lineage.length}</span>
            <span class="stat-detail">${children.length} direct ${children.length === 1 ? "daughter" : "daughters"}</span>
            ${icon("tree", "stat-icon")}
          </div>
        </div>

        <section class="panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>Notes</h2>
              <p>Free-form background, classification, or open questions.</p>
            </div>
          </header>
          <div class="panel-body">
            <textarea class="textarea notes-area" rows="7" data-language-notes placeholder="Describe the language, its speakers, its position in the family…">${esc(language.notes)}</textarea>
          </div>
        </section>

        <section class="panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>Daughter languages</h2>
              <p>Direct descendants in the family tree.</p>
            </div>
            <button class="button button-quiet button-small" type="button" data-add-daughter>${icon("plus")}Add daughter</button>
          </header>
          ${
            children.length
              ? `<div class="child-list">${children
                  .map((child) => {
                    const childStats = languageStats(child);
                    return `<a class="child-row" href="${languageTabHref(child, "overview")}">
                      <span class="child-marker"></span>
                      <span class="child-copy"><strong>${esc(child.name)}</strong><span>${childStats.changes} rules · ${childStats.words} words</span></span>
                      ${icon("chevronRight")}
                    </a>`;
                  })
                  .join("")}</div>`
              : `<div class="panel-body"><div class="inline-empty">${icon("tree")}<span>No daughter languages yet.</span><button class="text-button" type="button" data-add-daughter>Create one</button></div></div>`
          }
        </section>
      </section>

      <aside class="overview-aside">
        <section class="panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>Position in the tree</h2>
              <p>Changing the parent changes which language the sound changes are compared against.</p>
            </div>
          </header>
          <div class="panel-body form-stack">
            <label class="field">
              <span class="field-label">Ancestral language</span>
              <select class="select" data-parent-select>
                <option value="">No parent (root language)</option>
                ${parentOptions}
              </select>
            </label>
            <div class="lineage-block">
              <span class="field-label">Lineage</span>
              <div class="lineage-inline">
                ${lineage
                  .map((item, index) => {
                    const current = index === lineage.length - 1;
                    return `${index > 0 ? `<span class="lineage-arrow">${icon("chevronRight")}</span>` : ""}<a class="lineage-chip ${current ? "is-current" : ""}" href="${languageTabHref(item, "overview")}">${esc(item.name)}</a>`;
                  })
                  .join("")}
              </div>
            </div>
            <div class="lineage-actions">
              <button class="button button-quiet button-small" type="button" data-add-ancestor>${icon("arrowUp")}<span>Add ancestor</span></button>
              <button class="button button-quiet button-small" type="button" data-add-sibling>${icon("plus")}<span>Add sibling</span></button>
            </div>
          </div>
        </section>

        <section class="panel quick-panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>Continue documenting</h2>
            </div>
          </header>
          <div class="quick-links">
            <button type="button" data-goto-tab="phonology"><span class="quick-icon">${icon("grid")}</span><span><strong>Open the charts</strong><small>Add consonants and vowels</small></span>${icon("chevronRight")}</button>
            <button type="button" data-goto-tab="phonotactics"><span class="quick-icon">${icon("sliders")}</span><span><strong>Set phonotactics</strong><small>Syllable template and word checks</small></span>${icon("chevronRight")}</button>
            <button type="button" data-goto-tab="changes"><span class="quick-icon">${icon("sound")}</span><span><strong>Write sound changes</strong><small>Staged rules from the ancestor</small></span>${icon("chevronRight")}</button>
            <button type="button" data-goto-tab="vocabulary"><span class="quick-icon">${icon("book")}</span><span><strong>Add vocabulary</strong><small>Test the rules on real forms</small></span>${icon("chevronRight")}</button>
          </div>
        </section>
      </aside>
    </div>
  `;

  const notes = content.querySelector("[data-language-notes]");
  notes.addEventListener("input", () => {
    language.notes = notes.value;
    ctx.touch({ label: "Edit notes" });
  });

  content.querySelectorAll("[data-goto-tab]").forEach((button) => {
    button.addEventListener("click", () => ctx.navigate(languageTabHref(language, button.dataset.gotoTab)));
  });

  content.querySelectorAll("[data-add-daughter]").forEach((button) => {
    button.addEventListener("click", () => addDaughter(ctx));
  });

  content.querySelectorAll("[data-add-ancestor]").forEach((button) => {
    button.addEventListener("click", () => addAncestor(ctx));
  });

  content.querySelectorAll("[data-add-sibling]").forEach((button) => {
    button.addEventListener("click", () => addSibling(ctx));
  });

  const parentSelect = content.querySelector("[data-parent-select]");
  parentSelect.addEventListener("change", () => {
    const nextParent = parentSelect.value || null;
    if (!canSetParent(ctx.project, language.id, nextParent)) {
      toast("That move would create a cycle in the family tree.", { type: "error" });
      parentSelect.value = language.parentId || "";
      return;
    }
    if (!setParent(ctx.project, language.id, nextParent)) {
      toast("Could not change the parent language.", { type: "error" });
      return;
    }
    ctx.touch({ label: "Change parent language" });
    ctx.refresh();
    toast(nextParent ? "Parent language updated. Inherited checks now use the new ancestor." : "Language is now a root.", { type: "success" });
  });
}

export function renderLanguage(container, ctx, tabValue) {
  const activeTab = tabId(tabValue);
  container.innerHTML = `
    <section class="page language-page">
      ${languageHeader(ctx, activeTab)}
      <div class="language-content" data-language-content></div>
    </section>
  `;

  const content = container.querySelector("[data-language-content]");
  const headerCtx = { ...ctx, anchor: null };
  container.querySelector("[data-rename-language]").addEventListener("click", () => renameLanguage(ctx));
  container.querySelectorAll("[data-view-tree]").forEach((button) => button.addEventListener("click", () => ctx.navigate("#/tree")));
  container.querySelectorAll("[data-add-daughter]").forEach((button) => button.addEventListener("click", () => addDaughter(ctx)));
  const menuButton = container.querySelector("[data-language-menu]");
  menuButton.addEventListener("click", () => {
    headerCtx.anchor = menuButton;
    headerActions(headerCtx);
  });

  if (activeTab === "phonology") renderInventory(content, ctx);
  else if (activeTab === "phonotactics") renderPhonotactics(content, ctx);
  else if (activeTab === "changes") renderChanges(content, ctx);
  else if (activeTab === "allophony") renderAllophony(content, ctx);
  else if (activeTab === "vocabulary") renderVocabulary(content, ctx);
  else if (activeTab === "analytics") renderAnalytics(content, ctx);
  else renderOverview(content, ctx);
}
