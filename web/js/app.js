import {
  childrenOf,
  findLanguage,
  projectStats,
} from "./model.js";
import { store } from "./store.js";
import {
  closeMenu,
  confirmDialog,
  esc,
  hydrateIcons,
  icon,
  openMenu,
  promptDialog,
  toast,
} from "./ui.js";
import { createQuickSearch } from "./search.js";
import { initPhonemeKeyboard } from "./keyboard.js";
import { initClassAutocomplete } from "./autocomplete.js";
import { addRootLanguage } from "./languageActions.js";
import { decodeHashPart } from "./routes.js";
import { renderCognates } from "./views/cognates.js";
import { renderLanguage, TABS } from "./views/language.js";
import { renderSubgrouping } from "./views/subgrouping.js";
import { renderTimeline } from "./views/timeline.js";
import { renderTree } from "./views/tree.js";

const appShell = document.getElementById("app-shell");
const mainRoot = document.getElementById("main");
const viewRoot = document.getElementById("view");
const sidebarTree = document.getElementById("sidebar-tree");
const sidebarCount = document.getElementById("sidebar-count");
const sidebarAddRoot = document.getElementById("sidebar-add-root");
const sidebarTreeLink = document.getElementById("sidebar-tree-link");
const sidebarCognatesLink = document.getElementById("sidebar-cognates-link");
const sidebarSubgroupingLink = document.getElementById("sidebar-subgrouping-link");
const sidebarTimelineLink = document.getElementById("sidebar-timeline-link");
const projectName = document.getElementById("project-name");
const projectSwitch = document.getElementById("project-switch");
const projectFileLabel = document.getElementById("project-file");
const saveState = document.getElementById("save-state");
const scrim = document.getElementById("sidebar-scrim");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const undoButton = document.getElementById("undo-button");
const redoButton = document.getElementById("redo-button");
const TAB_IDS = new Set(TABS.map((tab) => tab.id));
const SIDEBAR_HIDDEN_KEY = "language-tree.sidebar-hidden";
const NARROW_SIDEBAR = "(max-width: 780px)";

let currentRoute = null;
let booted = false;
let quickSearch = null;
let pendingSearchFocus = null;

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!raw || raw === "tree") return { view: "tree" };
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "language" && parts[1]) {
    return {
      view: "language",
      id: decodeHashPart(parts[1]),
      tab: TAB_IDS.has(parts[2]) ? parts[2] : "overview",
    };
  }
  if (parts[0] === "cognates") {
    return {
      view: "cognates",
      id: parts[1] ? decodeHashPart(parts[1]) : null,
      wordId: parts[2] ? decodeHashPart(parts[2]) : null,
    };
  }
  if (parts[0] === "subgrouping") return { view: "subgrouping" };
  if (parts[0] === "timeline") return { view: "timeline" };
  return { view: "tree" };
}

function routeHash(route) {
  if (route.view === "language") return `#/language/${encodeURIComponent(route.id)}/${route.tab || "overview"}`;
  if (route.view === "cognates") {
    if (route.id) {
      return `#/cognates/${encodeURIComponent(route.id)}${route.wordId ? `/${encodeURIComponent(route.wordId)}` : ""}`;
    }
    return "#/cognates";
  }
  if (route.view === "subgrouping") return "#/subgrouping";
  if (route.view === "timeline") return "#/timeline";
  return "#/tree";
}

function sidebarNavMarkup(project, parentId, depth, activeId) {
  const children = childrenOf(project, parentId);
  if (!children.length) return "";
  return `
    <ul class="sidebar-tree-list" style="--depth:${depth}">
      ${children
        .map((language) => {
          const kids = childrenOf(project, language.id);
          return `
            <li>
              <button class="sidebar-lang ${language.id === activeId ? "is-active" : ""}" type="button" data-sidebar-lang="${esc(language.id)}" ${language.id === activeId ? 'aria-current="page"' : ""}>
                <span class="sidebar-node-dot"></span>
                <span class="sidebar-lang-name">${esc(language.name)}</span>
                ${kids.length ? `<span class="sidebar-child-count" title="${kids.length} direct daughters">${kids.length}</span>` : ""}
              </button>
              ${sidebarNavMarkup(project, language.id, depth + 1, activeId)}
            </li>`;
        })
        .join("")}
    </ul>`;
}

function updateProjectSwitcher() {
  const file = store.projectFile;
  projectFileLabel.textContent = file || "No project";
  projectSwitch.title = file ? `Project file: data/${file} — click to switch` : "Click to choose a project file";
}

function storedSidebarHidden() {
  try {
    return window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
  } catch {
    // Storage can be unavailable in hardened browser modes; default to open.
    return false;
  }
}

function isNarrowSidebar() {
  return window.matchMedia(NARROW_SIDEBAR).matches;
}

function sidebarIsVisible() {
  return isNarrowSidebar()
    ? document.body.classList.contains("sidebar-open")
    : !appShell.classList.contains("sidebar-hidden");
}

function updateSidebarToggle() {
  if (!sidebarToggle) return;
  const visible = sidebarIsVisible();
  const label = visible ? "Hide language navigation" : "Show language navigation";
  sidebarToggle.setAttribute("aria-expanded", String(visible));
  sidebarToggle.setAttribute("aria-label", label);
  sidebarToggle.title = label;
}

function closeSidebarOverlay() {
  if (!document.body.classList.contains("sidebar-open")) return;
  document.body.classList.remove("sidebar-open");
  updateSidebarToggle();
}

function setDesktopSidebarHidden(hidden) {
  appShell.classList.toggle("sidebar-hidden", hidden);
  try {
    window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // The toggle still works for this session when storage is unavailable.
  }
  if (hidden && sidebar?.contains(document.activeElement)) sidebarToggle?.focus();
  updateSidebarToggle();
}

if (storedSidebarHidden()) appShell.classList.add("sidebar-hidden");

async function switchToProject(file) {
  if (!file) return;
  try {
    if (!(await store.switchProject(file))) return;
  } catch (error) {
    toast(error.message || String(error), { type: "error", duration: 6000 });
    updateProjectSwitcher();
    return;
  }
  updateProjectSwitcher();
  booted = true;
  appShell.classList.add("is-ready");
  window.history.replaceState(null, "", "#/tree");
  render();
  toast(`Opened ${file}.`, { type: "success", duration: 2600 });
}

async function openProjectMenu() {
  try {
    await store.loadProjectList();
  } catch {
    // Keep the last listing visible; the server may simply be restarting.
  }
  const active = store.projectFile;
  const items = store.projects.map((entry) => {
    const count = Number.isInteger(entry.languages)
      ? `${entry.languages} ${entry.languages === 1 ? "language" : "languages"}`
      : "";
    if (entry.error) {
      return {
        label: `${entry.file} — invalid project`,
        icon: "warning",
        disabled: true,
      };
    }
    return {
      label: `${entry.file}${entry.title ? ` — ${entry.title}` : ""}`,
      icon: entry.file === active ? "check" : "book",
      shortcut: entry.file === active ? "open" : count,
      disabled: entry.file === active,
      onClick: () => void switchToProject(entry.file),
    };
  });
  if (!items.length) {
    items.push({ label: "No .json project files in data/", disabled: true });
  } else {
    items.push(
      { separator: true },
      { label: "Add a .json file to data/ to create another project.", disabled: true }
    );
  }
  openMenu(projectSwitch, items);
}

function renderSidebar(route) {
  if (!store.project) return;
  updateProjectSwitcher();
  const stats = projectStats(store.project);
  const activeId = route?.view === "language" ? route.id : null;
  const roots = store.project.languages.filter((language) => !language.parentId || !findLanguage(store.project, language.parentId));

  sidebarCount.textContent = String(stats.languages);
  projectName.textContent = store.project.title;
  projectName.title = `${store.project.title} — click to rename`;
  document.title = route?.view === "language" && findLanguage(store.project, route.id)
    ? `${findLanguage(store.project, route.id).name} · ${store.project.title}`
    : route?.view === "cognates"
      ? `Cognate explorer · ${store.project.title}`
      : route?.view === "subgrouping"
        ? `Subgrouping evidence · ${store.project.title}`
        : route?.view === "timeline"
          ? `Sound-change timeline · ${store.project.title}`
          : `${store.project.title} · Language Tree`;

  if (!store.project.languages.length) {
    sidebarTree.innerHTML = `<p class="sidebar-empty">No languages yet.</p>`;
  } else {
    sidebarTree.innerHTML = roots
      .map((root) => `
        <div class="sidebar-root">
          <button class="sidebar-lang sidebar-root-lang ${root.id === activeId ? "is-active" : ""}" type="button" data-sidebar-lang="${esc(root.id)}" ${root.id === activeId ? 'aria-current="page"' : ""}>
            <span class="sidebar-node-dot root-dot"></span>
            <span class="sidebar-lang-name">${esc(root.name)}</span>
            <span class="sidebar-root-label">root</span>
          </button>
          ${sidebarNavMarkup(store.project, root.id, 0, activeId)}
        </div>`)
      .join("");
  }
  sidebarTreeLink.classList.toggle("is-active", route?.view === "tree");
  sidebarTreeLink.setAttribute("aria-current", route?.view === "tree" ? "page" : "false");
  if (sidebarCognatesLink) {
    sidebarCognatesLink.classList.toggle("is-active", route?.view === "cognates");
    sidebarCognatesLink.setAttribute("aria-current", route?.view === "cognates" ? "page" : "false");
  }
  if (sidebarSubgroupingLink) {
    sidebarSubgroupingLink.classList.toggle("is-active", route?.view === "subgrouping");
    sidebarSubgroupingLink.setAttribute("aria-current", route?.view === "subgrouping" ? "page" : "false");
  }
  if (sidebarTimelineLink) {
    sidebarTimelineLink.classList.toggle("is-active", route?.view === "timeline");
    sidebarTimelineLink.setAttribute("aria-current", route?.view === "timeline" ? "page" : "false");
  }
}

function makeContext(route) {
  // project and language resolve through getters so a context stays valid
  // after undo/redo replaces store.project: toast callbacks that capture ctx
  // then mutate ctx.project would otherwise edit a detached clone and the
  // change would be lost silently.
  return {
    get project() {
      return store.project;
    },
    get language() {
      return route.view === "language" ? findLanguage(store.project, route.id) : null;
    },
    route,
    touch: (options) => store.touch(options),
    navigate: (hash) => store.navigate(hash),
    refresh: () => render({ preserveScroll: true }),
  };
}

function updateHistoryControls() {
  if (undoButton) undoButton.disabled = !store.canUndo();
  if (redoButton) redoButton.disabled = !store.canRedo();
}

// Undo/redo re-render the whole view. Describing the focused element and its
// caret beforehand lets typing continue seamlessly where it left off.
function focusDescriptor() {
  const element = document.activeElement;
  if (!element || element === document.body || !element.parentElement) return null;
  const parts = [];
  let node = element;
  while (node && node !== document.body && node.parentElement) {
    const parent = node.parentElement;
    parts.push(`*:nth-child(${Array.prototype.indexOf.call(parent.children, node) + 1})`);
    node = parent;
  }
  if (node !== document.body) return null;
  parts.reverse();
  const caret =
    typeof element.selectionStart === "number"
      ? { start: element.selectionStart, end: element.selectionEnd ?? element.selectionStart }
      : null;
  return { selector: `:scope > ${parts.join(" > ")}`, caret };
}

function restoreFocus(descriptor) {
  if (!descriptor) return;
  let element = null;
  try {
    element = document.body.querySelector(descriptor.selector);
  } catch {
    return;
  }
  if (!element) return;
  element.focus();
  if (descriptor.caret && typeof element.setSelectionRange === "function") {
    try {
      element.setSelectionRange(descriptor.caret.start, descriptor.caret.end ?? descriptor.caret.start);
    } catch {
      // Some inputs reject caret restoration; restoring focus is enough.
    }
  }
}

function runHistoryStep(action) {
  // A dialog is showing: its input state lives outside the document, so a
  // document-level undo would desync it.
  if (document.body.classList.contains("has-modal")) return false;
  const descriptor = focusDescriptor();
  const outcome = action();
  if (!outcome) return false;
  render({ preserveScroll: true });
  restoreFocus(descriptor);
  // Undo used to happen silently; the label says what was reverted.
  if (outcome.label) {
    toast(`${outcome.redo ? "Redid" : "Undid"}: ${outcome.label}.`, { type: "info", duration: 2200 });
  }
  return true;
}

// Quick search results ask the app to reveal a specific element after the
// jump: the word row, the rule card, or the language header. render() calls
// applySearchFocus() once the route's view is on screen.
function applySearchFocus() {
  if (!pendingSearchFocus) return;
  const { kind, id } = pendingSearchFocus;
  pendingSearchFocus = null;
  let element = null;
  let highlight = null;
  if (kind === "word") {
    highlight = viewRoot.querySelector(`[data-word-id="${CSS.escape(id)}"]`);
    element = highlight?.querySelector("[data-word-field='gloss']") || highlight;
  } else if (kind === "rule") {
    highlight = viewRoot.querySelector(`[data-rule-id="${CSS.escape(id)}"]`);
    element = highlight?.querySelector(".rule-input") || highlight;
  } else if (kind === "allophony") {
    highlight = viewRoot.querySelector(`[data-allo-rule-id="${CSS.escape(id)}"]`);
    element = highlight?.querySelector(".rule-input") || highlight;
  } else if (kind === "allophonyGroup") {
    highlight = viewRoot.querySelector(`[data-allo-group-id="${CSS.escape(id)}"]`);
    element = highlight?.querySelector("[data-allo-group-collapse]") || highlight;
  } else if (kind === "language") {
    highlight = viewRoot.querySelector(".language-title-row h1") || viewRoot.querySelector("h1");
    element = highlight;
  }
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: "auto" });
  if (element !== document.body) element.focus({ preventScroll: true });
  if (highlight !== element) {
    highlight?.classList.add("is-search-hit");
    window.setTimeout(() => highlight.classList.remove("is-search-hit"), 1800);
  }
}

function openSearchResult(result) {
  pendingSearchFocus = result.focus || null;
  const hash = result.hash;
  if (window.location.hash === hash) {
    // Already on the exact route: re-render fresh, then reveal the hit.
    render({ preserveScroll: true });
    applySearchFocus();
  } else {
    // The hashchange listener renders, and render() consumes the pending focus.
    store.navigate(hash);
  }
}

function render(options = {}) {
  if (!store.project) return;
  closeMenu();
  closeSidebarOverlay();
  const route = parseRoute();
  currentRoute = route;

  if (route.view === "language" && !findLanguage(store.project, route.id)) {
    window.history.replaceState(null, "", "#/tree");
    render();
    return;
  }
  if (route.view === "cognates" && route.id && !findLanguage(store.project, route.id)) {
    window.history.replaceState(null, "", "#/cognates");
    render();
    return;
  }
  if (route.view === "cognates" && route.id && route.wordId) {
    const language = findLanguage(store.project, route.id);
    const word = language?.vocabulary.find((entry) => entry.id === route.wordId);
    if (!word || !word.gloss.trim() || !word.form.trim()) {
      window.history.replaceState(null, "", `#/cognates/${encodeURIComponent(route.id)}`);
      render();
      return;
    }
  }
  const normalizedHash = routeHash(route);
  if (window.location.hash !== normalizedHash) {
    window.history.replaceState(null, "", normalizedHash);
  }

  renderSidebar(route);
  const ctx = makeContext(route);
  try {
    if (route.view === "tree") {
      renderTree(viewRoot, ctx);
    } else if (route.view === "cognates") {
      renderCognates(viewRoot, ctx);
    } else if (route.view === "subgrouping") {
      renderSubgrouping(viewRoot, ctx);
    } else if (route.view === "timeline") {
      renderTimeline(viewRoot, ctx);
    } else {
      renderLanguage(viewRoot, ctx, route.tab);
    }
  } catch (error) {
    // A view bug should not leave a blank workspace: the project itself is
    // intact, so replace the partial render with a recoverable notice.
    console.error(error);
    renderViewError(error);
  }
  if (!options.preserveScroll) mainRoot.scrollTo({ top: 0, behavior: "auto" });
  applySearchFocus();
}

function renderViewError(error) {
  viewRoot.innerHTML = `
    <div class="boot-error">
      <div class="empty-icon">${icon("warning")}</div>
      <h1>This view could not be rendered</h1>
      <p>${esc(error.message || String(error))}</p>
      <div class="boot-error-actions">
        <button class="button button-primary" type="button" id="retry-render">${icon("refresh")}Try again</button>
      </div>
      <p class="boot-hint">Your project is still saved. Switching tabs may work, or reload the page if the error repeats.</p>
    </div>`;
  viewRoot.querySelector("#retry-render").addEventListener("click", () => render());
}

function bootError(error) {
  viewRoot.innerHTML = `
    <div class="boot-error">
      <div class="empty-icon">${icon("warning")}</div>
      <h1>The project could not be loaded</h1>
      <p>${esc(error.message || String(error))}</p>
      <div class="boot-error-actions">
        <button class="button button-primary" type="button" id="retry-load">${icon("refresh")}Try again</button>
        <button class="button button-quiet" type="button" id="reload-page">${icon("external")}Reload page</button>
      </div>
      <p class="boot-hint">The local server is normally started with <code>start.bat</code> or <code>python server.py</code>. Project files live in <code>data/</code>; use the project switcher in the top bar to open another one.</p>
    </div>`;
  // "Try again" re-runs the load in place — a server that was just started
  // does not need a full page reload — while "Reload page" resets everything.
  viewRoot.querySelector("#retry-load").addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Retrying…";
    void boot();
  });
  viewRoot.querySelector("#reload-page").addEventListener("click", () => window.location.reload());
}

function setSaveState(state, error) {
  saveState.dataset.state = state;
  const label = saveState.querySelector(".save-label");
  if (!label) return;
  if (state === "saving") label.textContent = "Saving…";
  else if (state === "pending") label.textContent = "Unsaved changes";
  else if (state === "error") label.textContent = "Save failed";
  else if (state === "conflict") label.textContent = "Save conflict";
  else if (state === "loading") label.textContent = "Loading…";
  else label.textContent = store.lastSavedAt ? `Saved · ${new Date(store.lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Saved";
  const file = store.projectFile ? `data/${store.projectFile}` : "the project file";
  saveState.title =
    state === "conflict"
      ? `${error || "The project was changed by another tab or window"} — click to resolve`
      : state === "error"
        ? `${error || "Could not save"} — click to retry`
        : state === "saved"
          ? `All changes are written to ${file}`
          : "Changes are written automatically";
}

async function boot() {
  try {
    // Load the listing first: if the active document is broken, the switcher
    // must still be usable so the user can open a different project.
    await store.loadProjectList();
    updateProjectSwitcher();
    await store.load();
    booted = true;
    appShell.classList.add("is-ready");
    if (!window.location.hash) window.history.replaceState(null, "", "#/tree");
    render();
  } catch (error) {
    console.error(error);
    updateProjectSwitcher();
    bootError(error);
  }
}

async function init() {
  hydrateIcons();
  store.onStatus(setSaveState);
  store.onHistory(updateHistoryControls);
  // When another tab saved a newer document and this tab was clean, the store
  // reloads it in place; re-render the current view so the newer data shows.
  store.onResync(() => {
    if (!booted || !store.project) return;
    render({ preserveScroll: true });
    toast("Reloaded the newer project — another tab or window saved changes.", { type: "info", duration: 3200 });
  });
  projectSwitch.addEventListener("click", () => void openProjectMenu());
  projectName.addEventListener("click", async () => {
    if (!store.project) return;
    const title = await promptDialog({
      title: "Rename project",
      label: "Project title",
      value: store.project.title,
      confirmLabel: "Rename",
    });
    if (!title || !store.project || title === store.project.title) return;
    store.project.title = title;
    store.touch({ label: "Rename project" });
    renderSidebar(currentRoute);
    toast("Project renamed.", { type: "success" });
  });
  sidebarAddRoot.addEventListener("click", () => addRootLanguage(makeContext({ view: "tree" })));
  sidebarTree.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sidebar-lang]");
    if (!button) return;
    store.navigate(`#/language/${button.dataset.sidebarLang}/overview`);
  });
  saveState.addEventListener("click", async () => {
    if (store.saveState === "conflict") {
      // Another tab saved over this tab's baseline. Both exits are destructive
      // to one side, so spell them out and let the user pick.
      const choice = await confirmDialog(
        "Save conflict",
        "The project file was changed by another tab or window after this tab last saved. “Save anyway” overwrites the file with this tab's version. “Reload page” discards this tab's unsaved edits and loads the newer version.",
        { confirmLabel: "Save anyway", cancelLabel: "Reload page", danger: true }
      );
      if (choice === true) {
        store.flush({ force: true });
        toast("Overwriting the newer project with this tab's version…", { type: "info", duration: 2200 });
      } else if (choice === false) {
        window.location.reload();
      }
      return;
    }
    if (store.saveState === "error" || store.dirty) {
      store.flush();
      toast("Retrying save…", { type: "info", duration: 1800 });
    }
  });

  undoButton?.addEventListener("click", () => runHistoryStep(() => store.undo()));
  redoButton?.addEventListener("click", () => runHistoryStep(() => store.redo()));

  // The phoneme keyboard wires its own global listeners (combo, focus
  // tracking, floating affordance) and needs no per-view setup.
  initPhonemeKeyboard();

  // Chart-class autocomplete over rule notation fields, also self-wiring.
  initClassAutocomplete();

  quickSearch = createQuickSearch({
    getProject: () => store.project,
    openResult: openSearchResult,
  });
  document.getElementById("sidebar-search")?.addEventListener("click", () => quickSearch.open());

  updateSidebarToggle();
  sidebarToggle?.addEventListener("click", () => {
    if (isNarrowSidebar()) {
      document.body.classList.toggle("sidebar-open");
      updateSidebarToggle();
      return;
    }
    setDesktopSidebarHidden(!appShell.classList.contains("sidebar-hidden"));
  });
  scrim.addEventListener("click", closeSidebarOverlay);
  window.matchMedia(NARROW_SIDEBAR).addEventListener("change", () => {
    closeSidebarOverlay();
    updateSidebarToggle();
  });

  try {
    await boot();
  } catch {
    // boot() reports its own failures through bootError().
  }

  window.addEventListener("hashchange", () => {
    if (booted) render();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.body.classList.contains("sidebar-open")) return;
    closeSidebarOverlay();
  });
  window.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k") {
      // The palette ignores a screen already owned by a dialog; when it is
      // open, Ctrl+K closes it. Chrome's address-bar search is suppressed.
      event.preventDefault();
      quickSearch.toggle();
      return;
    }
    if (quickSearch.isOpen()) return; // while searching, undo stays paused
    if (key === "z" && event.shiftKey) {
      if (runHistoryStep(() => store.redo())) event.preventDefault();
      return;
    }
    if (key === "z") {
      if (runHistoryStep(() => store.undo())) event.preventDefault();
      return;
    }
    if (key === "y") {
      if (runHistoryStep(() => store.redo())) event.preventDefault();
    }
  });
}

init();
