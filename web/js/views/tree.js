import {
  childrenOf,
  createLanguage,
  deleteLanguage,
  descendantIds,
  descendantsCount,
  languageStats,
  restoreDeletedLanguages,
  rootLanguages,
} from "../model.js";
import { addAncestor, addRootLanguage, addSibling, renameLanguage } from "../languageActions.js";
import { languageHref } from "../routes.js";
import { confirmDialog, esc, icon, openMenu, promptDialog, toast } from "../ui.js";
import { openReportMenu } from "../reportUi.js";

const NODE_WIDTH = 196;
const NODE_HEIGHT = 86;
const H_GAP = 34;
const V_GAP = 104;
const PADDING = 70;

function layoutFamily(project) {
  const roots = rootLanguages(project);
  const nodes = [];
  let cursorX = 0;

  function walk(language, depth) {
    const children = childrenOf(project, language.id);
    let x;
    if (!children.length) {
      x = cursorX + NODE_WIDTH / 2;
      cursorX += NODE_WIDTH + H_GAP;
    } else {
      const childPositions = children.map((child) => walk(child, depth + 1));
      x = (childPositions[0] + childPositions[childPositions.length - 1]) / 2;
    }
    const node = {
      language,
      x,
      y: depth * (NODE_HEIGHT + V_GAP),
      depth,
      children: [],
    };
    nodes.push(node);
    return x;
  }

  const rootPositions = roots.map((root) => {
    const x = walk(root, 0);
    cursorX += 100;
    return x;
  });

  const byId = new Map(nodes.map((node) => [node.language.id, node]));
  for (const node of nodes) {
    node.children = childrenOf(project, node.language.id).map((child) => byId.get(child.id)).filter(Boolean);
  }

  const minX = nodes.length ? Math.min(...nodes.map((node) => node.x - NODE_WIDTH / 2)) : 0;
  const maxX = nodes.length ? Math.max(...nodes.map((node) => node.x + NODE_WIDTH / 2)) : NODE_WIDTH;
  const minY = nodes.length ? Math.min(...nodes.map((node) => node.y)) : 0;
  const maxY = nodes.length ? Math.max(...nodes.map((node) => node.y + NODE_HEIGHT)) : NODE_HEIGHT;
  for (const node of nodes) {
    node.left = node.x - NODE_WIDTH / 2 - minX + PADDING;
    node.top = node.y - minY + PADDING;
  }

  return {
    roots,
    nodes,
    byId,
    rootPositions,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
    bounds: { minX, maxX, minY, maxY },
  };
}

function nodeCard(node) {
  const { language, depth } = node;
  const stats = languageStats(language);
  const isRoot = depth === 0;
  const hasChildren = childrenOfCache.has(language.id);
  return `
    <article class="tree-node ${isRoot ? "tree-node-root" : ""}" style="left:${node.left}px;top:${node.top}px;width:${NODE_WIDTH}px;height:${NODE_HEIGHT}px" data-lang-id="${esc(language.id)}">
      <button class="node-main" type="button" data-action="open" title="Open ${esc(language.name)}">
        <span class="node-kicker">${isRoot ? "Root language" : `Generation ${depth + 1}`}${hasChildren ? " · ancestor" : ""}</span>
        <span class="node-name">${esc(language.name)}</span>
        <span class="node-meta">
          <span title="Consonants">${stats.consonants} C</span>
          <span class="meta-dot"></span>
          <span title="Vowels">${stats.vowels} V</span>
          <span class="meta-dot"></span>
          <span title="Sound changes">${stats.changes} rules</span>
        </span>
      </button>
      <div class="node-actions">
        <button type="button" class="node-action" data-action="add-child" title="Add daughter language" aria-label="Add daughter language">${icon("plus")}</button>
        <button type="button" class="node-action" data-action="menu" title="Language actions" aria-label="Language actions">${icon("more")}</button>
      </div>
    </article>
  `;
}

let childrenOfCache = new Set();

function edgePath(parent, child) {
  const x1 = parent.left + NODE_WIDTH / 2;
  const y1 = parent.top + NODE_HEIGHT;
  const x2 = child.left + NODE_WIDTH / 2;
  const y2 = child.top;
  const mid = y1 + (y2 - y1) * 0.52;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

async function addChild(ctx, language) {
  const name = await promptDialog({
    title: "Add a daughter language",
    label: `Name of the new language descended from ${language.name}`,
    value: `${language.name} daughter`,
    placeholder: "e.g. Old Coastal",
    confirmLabel: "Create language",
    help: "Its chart and syllable template start as a copy of the ancestor’s. Sound changes and words start empty.",
  });
  if (!name) return;
  const child = createLanguage(
    name,
    language.id,
    language.inventory,
    language.phonotactics,
    language.allophony,
    language.featureOverrides
  );
  ctx.project.languages.push(child);
  ctx.touch({ label: `Add language ${child.name}` });
  ctx.refresh();
  ctx.navigate(languageHref(child));
  toast(`Created ${child.name}. Its chart was copied from ${language.name}.`, { type: "success" });
}

async function removeLanguage(ctx, language) {
  const descendants = descendantsCount(ctx.project, language.id);
  const branchIds = new Set([language.id, ...descendantIds(ctx.project, language.id)]);
  const wordCount = ctx.project.languages
    .filter((item) => branchIds.has(item.id))
    .reduce((total, item) => total + item.vocabulary.length, 0);
  const message = descendants
    ? `<strong>${esc(language.name)}</strong> and its <strong>${descendants}</strong> descendant${descendants === 1 ? "" : "s"} will be removed. You can undo this immediately afterward; once committed, earlier versions also remain in git history.`
    : `<strong>${esc(language.name)}</strong> will be removed. You can undo this immediately afterward; once committed, earlier versions also remain in git history.`;
  const confirmed = await confirmDialog("Delete this language?", message, {
    confirmLabel: descendants ? `Delete ${descendants + 1} languages` : "Delete language",
    danger: true,
    html: true,
  });
  if (!confirmed) return;
  const removed = ctx.project.languages
    .map((item, index) => ({ language: item, index }))
    .filter(({ language: item }) => branchIds.has(item.id));
  deleteLanguage(ctx.project, language.id);
  ctx.touch({ label: `Delete language ${language.name}` });
  ctx.refresh();
  const detail = wordCount ? ` ${wordCount} word${wordCount === 1 ? "" : "s"} were removed with the branch.` : "";
  toast(`Deleted ${language.name}.${detail}`, {
    type: "info",
    duration: 7000,
    action: {
      label: "Undo",
      onClick: () => {
        if (!restoreDeletedLanguages(ctx.project, removed)) return;
        ctx.touch({ label: `Restore language ${language.name}` });
        ctx.refresh();
        toast(`Restored ${language.name}.`, { type: "success" });
      },
    },
  });
}

function openNodeMenu(ctx, anchor, language) {
  openMenu(anchor, [
    { label: "Open language", icon: "edit", onClick: () => ctx.navigate(languageHref(language)) },
    { label: "Add daughter", icon: "plus", onClick: () => addChild(ctx, language) },
    { label: "Add sibling", icon: "plus", onClick: () => addSibling(ctx, language) },
    { label: "Add ancestor", icon: "arrowUp", onClick: () => addAncestor(ctx, language) },
    { separator: true },
    { label: "Rename", icon: "edit", onClick: () => renameLanguage(ctx, language) },
    { label: "Delete branch…", icon: "trash", danger: true, onClick: () => removeLanguage(ctx, language) },
  ]);
}

export function renderTree(container, ctx) {
  const family = layoutFamily(ctx.project);
  childrenOfCache = new Set(ctx.project.languages.filter((language) => childrenOf(ctx.project, language.id).length).map((language) => language.id));
  const stats = {
    languages: ctx.project.languages.length,
    words: ctx.project.languages.reduce((total, language) => total + language.vocabulary.length, 0),
    rules: ctx.project.languages.reduce((total, language) => total + language.soundChanges.length, 0),
  };

  const edges = family.nodes
    .flatMap((node) => node.children.map((child) => `<path class="tree-edge" d="${edgePath(node, child)}"/>`))
    .join("");

  const nodesHtml = family.nodes.map((node) => nodeCard(node)).join("");

  container.innerHTML = `
    <section class="page tree-page">
      <header class="page-head tree-page-head">
        <div class="page-heading">
          <p class="eyebrow">Workspace</p>
          <h1>Family tree</h1>
          <p class="page-subtitle">${stats.languages} language${stats.languages === 1 ? "" : "s"} · ${stats.rules} sound change${stats.rules === 1 ? "" : "s"} · ${stats.words} word${stats.words === 1 ? "" : "s"}</p>
        </div>
        <div class="page-actions">
          <button class="button button-quiet" type="button" id="report-menu" title="Download a Markdown or HTML report of the family, or a JSON backup" aria-label="Download report or backup">${icon("download")}<span>Report / backup</span></button>
          <button class="button button-primary" type="button" id="add-root">${icon("plus")}<span>New root language</span></button>
        </div>
      </header>

      ${
        !family.roots.length
          ? `<div class="empty-workspace panel">
              <div class="empty-icon">${icon("tree")}</div>
              <h2>No languages yet</h2>
              <p>Create a root language to begin documenting a family.</p>
              <button class="button button-primary" type="button" id="empty-add-root">${icon("plus")}<span>Create a root language</span></button>
            </div>`
          : `<div class="tree-viewport" id="tree-viewport" aria-label="Editable language family tree">
              <div class="tree-stage" id="tree-stage" style="width:${family.width}px;height:${family.height}px;transform-origin:0 0">
                <svg class="tree-edges" width="${family.width}" height="${family.height}" viewBox="0 0 ${family.width} ${family.height}" aria-hidden="true">${edges}</svg>
                ${nodesHtml}
              </div>
              <div class="tree-tools" aria-label="Tree zoom controls">
                <button class="icon-button" type="button" id="zoom-out" title="Zoom out" aria-label="Zoom out">${icon("zoomOut")}</button>
                <span class="zoom-readout" id="zoom-readout">100%</span>
                <button class="icon-button" type="button" id="zoom-in" title="Zoom in" aria-label="Zoom in">${icon("zoomIn")}</button>
                <span class="tool-separator"></span>
                <button class="icon-button" type="button" id="fit-tree-floating" title="Fit tree" aria-label="Fit tree">${icon("fit")}</button>
              </div>
            </div>`
      }
    </section>
  `;

  const addRoot = () => addRootLanguage(ctx);

  container.querySelector("#add-root")?.addEventListener("click", addRoot);
  container.querySelector("#empty-add-root")?.addEventListener("click", addRoot);

  const reportButton = container.querySelector("#report-menu");
  if (reportButton) {
    reportButton.addEventListener("click", () => openReportMenu(reportButton, ctx.project));
  }

  const viewport = container.querySelector("#tree-viewport");
  if (!viewport) return;
  const stage = container.querySelector("#tree-stage");
  const readout = container.querySelector("#zoom-readout");
  let zoom = 1;
  let panX = 0;
  let panY = 0;

  const applyTransform = () => {
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    readout.textContent = `${Math.round(zoom * 100)}%`;
  };

  const fit = (minimum = 0.32, align = "center") => {
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (!viewportWidth || !viewportHeight) return;
    const scale = Math.min(1.05, (viewportWidth - 64) / family.width, (viewportHeight - 64) / family.height);
    zoom = Math.max(minimum, scale);
    panX = (viewportWidth - family.width * zoom) / 2;
    panY = align === "top" ? 24 : (viewportHeight - family.height * zoom) / 2;
    applyTransform();
  };

  const zoomAt = (factor, clientX = viewport.clientWidth / 2, clientY = viewport.clientHeight / 2) => {
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const next = Math.min(2.2, Math.max(0.25, zoom * factor));
    const ratio = next / zoom;
    panX = x - (x - panX) * ratio;
    panY = y - (y - panY) * ratio;
    zoom = next;
    applyTransform();
  };

  container.querySelector("#fit-tree-floating")?.addEventListener("click", () => fit());
  container.querySelector("#zoom-in")?.addEventListener("click", () => zoomAt(1.18));
  container.querySelector("#zoom-out")?.addEventListener("click", () => zoomAt(1 / 1.18));

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (event.target.closest(".tree-tools")) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0011);
      zoomAt(factor, event.clientX, event.clientY);
    },
    { passive: false }
  );

  let drag = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".tree-node") || event.target.closest(".tree-tools")) return;
    drag = { startX: event.clientX, startY: event.clientY, panX, panY };
    viewport.classList.add("is-panning");
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!drag) return;
    panX = drag.panX + event.clientX - drag.startX;
    panY = drag.panY + event.clientY - drag.startY;
    applyTransform();
  });
  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    viewport.classList.remove("is-panning");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  viewport.addEventListener("click", (event) => {
    const node = event.target.closest(".tree-node");
    if (!node) return;
    const language = ctx.project.languages.find((item) => item.id === node.dataset.langId);
    if (!language) return;
    const actionButton = event.target.closest("[data-action]");
    const action = actionButton?.dataset.action;
    if (action === "add-child") {
      event.stopPropagation();
      addChild(ctx, language);
      return;
    }
    if (action === "menu") {
      event.stopPropagation();
      openNodeMenu(ctx, actionButton, language);
      return;
    }
    if (action === "open" || !action) {
      ctx.navigate(languageHref(language));
    }
  });

  // Start readable for large families; the Fit button still zooms out to the
  // whole canvas for an overview.
  requestAnimationFrame(() => fit(0.8, "top"));
}
