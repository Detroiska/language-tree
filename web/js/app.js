import {
  childrenOf,
  createLanguage,
  findLanguage,
  projectStats,
} from "./model.js";
import { store } from "./store.js";
import {
  closeMenu,
  esc,
  hydrateIcons,
  icon,
  promptDialog,
  toast,
} from "./ui.js";
import { renderLanguage } from "./views/language.js";
import { renderTree } from "./views/tree.js";

const appShell = document.getElementById("app-shell");
const viewRoot = document.getElementById("view");
const sidebarTree = document.getElementById("sidebar-tree");
const sidebarCount = document.getElementById("sidebar-count");
const sidebarAddRoot = document.getElementById("sidebar-add-root");
const sidebarTreeLink = document.getElementById("sidebar-tree-link");
const projectName = document.getElementById("project-name");
const saveState = document.getElementById("save-state");
const scrim = document.getElementById("sidebar-scrim");
const TAB_IDS = new Set(["overview", "phonology", "changes", "vocabulary"]);

let currentRoute = null;
let booted = false;

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!raw || raw === "tree") return { view: "tree" };
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "language" && parts[1]) {
    return {
      view: "language",
      id: decodeURIComponent(parts[1]),
      tab: TAB_IDS.has(parts[2]) ? parts[2] : "overview",
    };
  }
  return { view: "tree" };
}

function routeHash(route) {
  if (route.view === "language") return `#/language/${encodeURIComponent(route.id)}/${route.tab || "overview"}`;
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

function renderSidebar(route) {
  if (!store.project) return;
  const stats = projectStats(store.project);
  const activeId = route?.view === "language" ? route.id : null;
  const roots = store.project.languages.filter((language) => !language.parentId || !findLanguage(store.project, language.parentId));

  sidebarCount.textContent = String(stats.languages);
  projectName.textContent = store.project.title;
  projectName.title = `${store.project.title} — click to rename`;
  document.title = route?.view === "language" && findLanguage(store.project, route.id)
    ? `${findLanguage(store.project, route.id).name} · ${store.project.title}`
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
}

async function addRootLanguage() {
  if (!store.project) return;
  const name = await promptDialog({
    title: "Add a root language",
    label: "Name of the root language",
    value: "Proto-Language",
    placeholder: "e.g. Proto-North",
    confirmLabel: "Create language",
    help: "A root has no ancestor and starts with the default consonant and vowel charts.",
  });
  if (!name) return;
  const language = createLanguage(name, null);
  store.project.languages.push(language);
  store.touch();
  render();
  store.navigate(`#/language/${language.id}/overview`);
  toast(`Created root language ${language.name}.`, { type: "success" });
}

function makeContext(route) {
  const language = route.view === "language" ? findLanguage(store.project, route.id) : null;
  return {
    project: store.project,
    language,
    route,
    touch: (options) => store.touch(options),
    navigate: (hash) => store.navigate(hash),
    refresh: () => render({ preserveScroll: true }),
  };
}

function render(options = {}) {
  if (!store.project) return;
  closeMenu();
  document.body.classList.remove("sidebar-open");
  const route = parseRoute();
  currentRoute = route;

  if (route.view === "language" && !findLanguage(store.project, route.id)) {
    window.history.replaceState(null, "", "#/tree");
    render();
    return;
  }
  const normalizedHash = routeHash(route);
  if (window.location.hash !== normalizedHash) {
    window.history.replaceState(null, "", normalizedHash);
  }

  renderSidebar(route);
  const ctx = makeContext(route);
  if (route.view === "tree") {
    renderTree(viewRoot, ctx);
  } else {
    renderLanguage(viewRoot, ctx, route.tab);
  }
  if (!options.preserveScroll) window.scrollTo({ top: 0, behavior: "auto" });
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
      <p class="boot-hint">The local server is normally started with <code>start.bat</code> or <code>python server.py</code>. Data is stored in <code>data/project.json</code>.</p>
    </div>`;
  viewRoot.querySelector("#retry-load").addEventListener("click", () => window.location.reload());
  viewRoot.querySelector("#reload-page").addEventListener("click", () => window.location.reload());
}

function setSaveState(state, error) {
  saveState.dataset.state = state;
  const label = saveState.querySelector(".save-label");
  if (!label) return;
  if (state === "saving") label.textContent = "Saving…";
  else if (state === "pending") label.textContent = "Unsaved changes";
  else if (state === "error") label.textContent = "Save failed";
  else if (state === "loading") label.textContent = "Loading…";
  else label.textContent = "Saved";
  saveState.title =
    state === "error"
      ? `${error || "Could not save"} — click to retry`
      : state === "saved"
        ? "All changes are written to data/project.json"
        : "Changes are written automatically";
}

async function init() {
  hydrateIcons();
  store.onStatus(setSaveState);
  projectName.addEventListener("click", async () => {
    const title = await promptDialog({
      title: "Rename project",
      label: "Project title",
      value: store.project.title,
      confirmLabel: "Rename",
    });
    if (!title || title === store.project.title) return;
    store.project.title = title;
    store.touch();
    renderSidebar(currentRoute);
    toast("Project renamed.", { type: "success" });
  });
  sidebarAddRoot.addEventListener("click", addRootLanguage);
  sidebarTree.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sidebar-lang]");
    if (!button) return;
    store.navigate(`#/language/${button.dataset.sidebarLang}/overview`);
  });
  saveState.addEventListener("click", () => {
    if (store.saveState === "error" || store.dirty) {
      store.flush();
      toast("Retrying save…", { type: "info", duration: 1800 });
    }
  });

  const sidebarToggle = document.createElement("button");
  sidebarToggle.className = "sidebar-toggle";
  sidebarToggle.type = "button";
  sidebarToggle.setAttribute("aria-label", "Open language navigation");
  sidebarToggle.innerHTML = icon("menu");
  document.body.appendChild(sidebarToggle);
  sidebarToggle.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  scrim.addEventListener("click", () => document.body.classList.remove("sidebar-open"));

  try {
    await store.load();
    booted = true;
    appShell.classList.add("is-ready");
    if (!window.location.hash) window.history.replaceState(null, "", "#/tree");
    render();
  } catch (error) {
    console.error(error);
    bootError(error);
  }

  window.addEventListener("hashchange", () => {
    if (booted) render();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") document.body.classList.remove("sidebar-open");
  });
}

init();
