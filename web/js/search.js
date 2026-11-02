import { getLineage } from "./model.js";
import { esc, icon } from "./ui.js";

// The command palette: Ctrl+K opens a searchable index of the whole project —
// languages (by name and by lineage path), words (gloss, form, note), sound
// changes (notation, note), plus the two global views. Results jump straight
// to the matching tab and highlight the hit.
const TYPE_META = {
  language: { label: "Language", icon: "language" },
  word: { label: "Word", icon: "book" },
  rule: { label: "Rule", icon: "sound" },
  view: { label: "View", icon: "tree" },
};

function indexEntries(project) {
  const entries = [
    {
      type: "view",
      title: "Family tree",
      subtitle: "All languages drawn as a chart",
      searchText: "family tree chart tree overview",
      hash: "#/tree",
      focus: null,
    },
    {
      type: "view",
      title: "Cognate explorer",
      subtitle: "Follow words through the family",
      searchText: "cognate explorer derivation reflexes compare",
      hash: "#/cognates",
      focus: null,
    },
  ];

  for (const language of project.languages) {
    const lineage = getLineage(project, language.id);
    const path = lineage.length > 1 ? lineage.slice(0, -1).map((item) => item.name).join(" › ") : "";
    entries.push({
      type: "language",
      id: language.id,
      title: language.name,
      subtitle: path || "Root language",
      searchText: `${language.name} ${path}`,
      hash: `#/language/${encodeURIComponent(language.id)}/overview`,
      focus: { kind: "language", id: language.id },
    });

    for (const word of language.vocabulary) {
      if (!word.gloss.trim() && !word.form.trim()) continue;
      entries.push({
        type: "word",
        id: word.id,
        languageId: language.id,
        title: word.gloss || "(no gloss)",
        subtitle: `${word.form || "∅"} · ${language.name}`,
        searchText: `${word.gloss} ${word.form} ${word.note} ${language.name}`,
        hash: `#/language/${encodeURIComponent(language.id)}/vocabulary`,
        focus: { kind: "word", id: word.id },
      });
    }

    language.soundChanges.forEach((rule, index) => {
      entries.push({
        type: "rule",
        id: rule.id,
        languageId: language.id,
        title: rule.notation.trim() || "Empty rule",
        subtitle: `${language.name} · rule ${index + 1}${rule.enabled === false ? " · off" : ""}`,
        searchText: `${rule.notation} ${rule.note} ${language.name}`,
        hash: `#/language/${encodeURIComponent(language.id)}/changes`,
        focus: { kind: "rule", id: rule.id },
      });
    });
  }
  return entries;
}

// Lower is better. Title hits rank above text-only matches; within a title,
// earlier occurrences and exact matches rank highest.
function scoreEntry(entry, query) {
  const title = entry.title.toLowerCase();
  const haystack = entry.searchText.toLowerCase();
  if (!haystack.includes(query)) return -1;
  if (title === query) return 0;
  const at = title.indexOf(query);
  if (at < 0) return 3;
  return 1 + Math.min(at / 50, 0.9);
}

const TYPE_ORDER = { view: 0, language: 1, word: 2, rule: 3 };

function rankedEntries(entries, query) {
  const scored = [];
  for (const entry of entries) {
    const score = query ? scoreEntry(entry, query) : 0;
    if (score < 0) continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || TYPE_ORDER[a.entry.type] - TYPE_ORDER[b.entry.type]);
  return scored.slice(0, 40).map((item) => item.entry);
}

function highlightTitle(entry, query) {
  const title = entry.title;
  if (!query) return esc(title);
  const at = title.toLowerCase().indexOf(query);
  if (at < 0) return esc(title);
  return `${esc(title.slice(0, at))}<mark>${esc(title.slice(at, at + query.length))}</mark>${esc(title.slice(at + query.length))}`;
}

export function createQuickSearch({ getProject, openResult }) {
  let overlay = null;
  let input = null;
  let list = null;
  let summary = null;
  let results = [];
  let active = 0;
  let restoreFocusTo = null;

  const isOpen = () => Boolean(overlay);

  function mount() {
    const project = getProject();
    if (!project) return false;
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("has-modal");

    overlay = document.createElement("div");
    overlay.className = "palette-backdrop";
    overlay.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="Quick search">
        <div class="palette-input-row">
          <span class="palette-icon">${icon("search")}</span>
          <input class="palette-input" type="text" placeholder="Search languages, words, rules…" autocomplete="off" spellcheck="false" aria-label="Search the project">
          <kbd class="palette-esc">esc</kbd>
        </div>
        <div class="palette-list" role="listbox" aria-label="Search results"></div>
        <div class="palette-foot">
          <span class="palette-summary"></span>
          <span class="palette-keys"><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close</span>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    input = overlay.querySelector(".palette-input");
    list = overlay.querySelector(".palette-list");
    summary = overlay.querySelector(".palette-summary");
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close();
    });

    input.addEventListener("input", () => refresh());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActive(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(-1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        activate(active);
      }
    });
    refresh();
    input.focus();
    return true;
  }

  function refresh() {
    const project = getProject();
    if (!project) return;
    const query = input.value.trim().toLowerCase();
    const entries = indexEntries(project);
    // With no query the palette is a jump list: the global views plus every
    // language. Typed queries search the whole index.
    results = rankedEntries(query ? entries : entries.filter((entry) => entry.type === "view" || entry.type === "language"), query);

    const words = entries.filter((entry) => entry.type === "word").length;
    const rules = entries.filter((entry) => entry.type === "rule").length;
    summary.textContent = query
      ? `${results.length} result${results.length === 1 ? "" : "s"} · ${project.languages.length} languages · ${words} words · ${rules} rules indexed`
      : `${project.languages.length} languages · ${words} words · ${rules} rules indexed`;

    active = 0;
    if (!results.length) {
      list.innerHTML = `
        <div class="palette-empty">
          ${icon("info")}
          <p>No matches for “${esc(input.value.trim())}”. Try a gloss, an IPA form, a rule, or a language name.</p>
        </div>`;
      return;
    }
    list.innerHTML = results
      .map((entry, index) => {
        const meta = TYPE_META[entry.type] || TYPE_META.view;
        return `
          <button class="palette-result${index === 0 ? " is-active" : ""}" type="button" role="option" data-index="${index}" aria-selected="${index === 0 ? "true" : "false"}">
            <span class="palette-result-icon">${icon(meta.icon)}</span>
            <span class="palette-result-text">
              <span class="palette-result-title">${highlightTitle(entry, query)}</span>
              <span class="palette-result-subtitle">${esc(entry.subtitle)}</span>
            </span>
            <span class="palette-result-type">${esc(meta.label)}</span>
          </button>`;
      })
      .join("");
    list.querySelectorAll("[data-index]").forEach((button) => {
      button.addEventListener("click", () => activate(Number(button.dataset.index)));
    });
    const first = list.firstElementChild;
    if (first) first.scrollIntoView({ block: "nearest" });
  }

  function moveActive(step) {
    if (!results.length) return;
    setActive((active + step + results.length) % results.length);
  }

  function setActive(index) {
    active = index;
    list.querySelectorAll(".palette-result").forEach((button) => {
      const selected = Number(button.dataset.index) === index;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });
    const target = list.querySelector(`[data-index="${index}"]`);
    if (target) target.scrollIntoView({ block: "nearest" });
  }

  function activate(index) {
    const entry = results[index];
    if (!entry) return;
    close();
    openResult(entry);
  }

  function close() {
    overlay?.remove();
    overlay = null;
    input = null;
    list = null;
    summary = null;
    document.body.classList.remove("has-modal");
    restoreFocusTo?.focus();
    restoreFocusTo = null;
  }

  function open() {
    // A dialog owns the screen — do not stack the palette on top. The check
    // looks at the DOM rather than the has-modal class, whose removal is
    // delayed by the dialog's closing animation.
    if (document.querySelector(".modal-backdrop:not(.modal-leaving)")) return false;
    return mount();
  }

  function toggle() {
    if (isOpen()) {
      close();
      return true;
    }
    return open();
  }

  return { open, close, toggle, isOpen };
}
