import { store } from "./store.js";
import { findLanguage, getLineage } from "./model.js";
import {
  buildClassIndex,
  filterSuggestions,
  suggestClassRefs,
  suggestQuery,
} from "./naturalclasses.js";
import { decodeHashPart } from "./routes.js";
import { esc, icon } from "./ui.js";

// Class autocomplete for rule notation fields (.rule-input — sound changes
// and allophony).
//
// Chart classes are the most open-ended notation in rule text: `plosive.plain`
// only works when it is spelled the way the chart spells it. While a rule
// field holds a token that could plausibly be a class reference (two
// characters or more — a single letter is an ordinary phoneme, so typing a
// rule never opens the list by itself), this module offers the matching
// `suggestClassRefs()` entries of the current lineage: keyboard navigable,
// caret preserved on acceptance. Enter accepts, Escape dismisses, and Tab is
// never intercepted so focus navigation keeps its usual meaning. Accepting
// fires a synthetic input event so every existing listener (rule status,
// tester re-run, autosave, undo) treats it exactly like typing. The query
// and matching policy lives in naturalclasses.js, DOM-free and covered by
// the engine tests.

const TARGET_SELECTOR = ".rule-input";

// Characters that end a token. Dots stay inside the token so `plosive.pl`
// keeps matching through the dot; dashes as well, since labels fold dashes
// (`dental-alveolar`).
const TOKEN_BREAK = /[\s>,_#/[\]^|;*(]/u;

const MAX_ITEMS = 8;
const MENU_ID = "class-complete-listbox";
const optionId = (index) => `${MENU_ID}-option-${index}`;

const state = {
  open: false,
  menu: null,
  target: null,
  token: { start: 0, end: 0, text: "" },
  items: [],
  // The lineage's suggestions are computed once when the popup opens, not on
  // every keystroke; typing a rule does not change the charts, so a per-open
  // cache is enough.
  suggestions: [],
  active: 0,
  // Guards against the just-accepted insertion's own synthetic input event
  // re-running the trigger check. Single-phoneme insertions from the
  // phoneme keyboard are kept out by the two-letter trigger instead.
  busy: false,
};

function isTarget(element) {
  return element instanceof HTMLInputElement && element.isConnected && element.matches(TARGET_SELECTOR);
}

function ruleLanguageId() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "language" || !parts[1]) return null;
  return decodeHashPart(parts[1]);
}

// The class index resolves against the whole lineage — the same charts a
// compiled rule would see — so inherited labels autocomplete too.
function suggestionsFor() {
  const languageId = ruleLanguageId();
  const language = languageId ? findLanguage(store.project, languageId) : null;
  if (!language) return [];
  const index = buildClassIndex(
    getLineage(store.project, language.id).flatMap((member) => [
      { chart: member.inventory.consonants, kind: "consonant" },
      { chart: member.inventory.vowels, kind: "vowel" },
    ])
  );
  return suggestClassRefs(index);
}

function tokenAt(input) {
  const value = input.value;
  const caret = typeof input.selectionStart === "number" ? input.selectionStart : value.length;
  let start = caret;
  while (start > 0 && !TOKEN_BREAK.test(value[start - 1])) start -= 1;
  let end = caret;
  while (end < value.length && !TOKEN_BREAK.test(value[end])) end += 1;
  return { start, end, text: value.slice(start, end) };
}

function itemMarkup(item, index) {
  const sample = item.members.slice(0, 4).join(" ");
  const more = item.members.length > 4 ? ` +${item.members.length - 4}` : "";
  const chart = item.chart ? `${item.chart}·` : "";
  return `
    <button type="button" class="cc-item ${index === state.active ? "is-active" : ""}" id="${optionId(index)}" data-cc-index="${index}" role="option" aria-selected="${index === state.active ? "true" : "false"}">
      <span class="cc-ref">${esc(chart)}${esc(item.ref)}</span>
      <span class="cc-meta" title="${esc(item.members.join(" "))}">${item.members.length} ${item.members.length === 1 ? "member" : "members"} — ${esc(sample)}${esc(more)}</span>
    </button>`;
}

function buildMenu() {
  const menu = document.createElement("div");
  menu.className = "class-complete";
  menu.id = MENU_ID;
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Chart class suggestions");
  menu.innerHTML = `<div class="cc-head">${icon("grid")}<span>Chart classes</span></div><div class="cc-body" data-cc-body></div>`;
  // Accept on mousedown-with-preventDefault so the caret never leaves the
  // field before the click lands.
  menu.addEventListener("mousedown", (event) => {
    if (event.target.closest(".cc-item")) event.preventDefault();
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest(".cc-item");
    if (item) {
      accept(Number(item.dataset.ccIndex));
    }
  });
  state.menu = menu;
  return menu;
}

function refreshMenu() {
  if (!state.menu) return;
  const body = state.menu.querySelector("[data-cc-body]");
  body.innerHTML = state.items.map(itemMarkup).join("");
  // The active option is what a screen reader announces while focus stays in
  // the text field; it must always name a row that exists.
  if (state.target && state.items.length) {
    state.target.setAttribute("aria-activedescendant", optionId(state.active));
  }
}

function positionMenu() {
  if (!state.menu || !state.target) return;
  const anchor = state.target.getBoundingClientRect();
  const rect = state.menu.getBoundingClientRect();
  let left = anchor.left;
  let top = anchor.bottom + 4;
  if (left + rect.width > window.innerWidth - 12) left = window.innerWidth - rect.width - 12;
  if (top + rect.height > window.innerHeight - 12) top = anchor.top - rect.height - 6;
  state.menu.style.left = `${Math.max(10, left)}px`;
  state.menu.style.top = `${Math.max(10, top)}px`;
}

function open(target) {
  state.target = target;
  if (!state.menu || !state.menu.isConnected) document.body.appendChild(buildMenu());
  state.open = true;
  // Cache the lineage's suggestions for this open session; filtering each
  // keystroke only walks this list.
  state.suggestions = suggestionsFor();
  target.setAttribute("role", "combobox");
  target.setAttribute("aria-autocomplete", "list");
  target.setAttribute("aria-expanded", "true");
  target.setAttribute("aria-controls", MENU_ID);
}

function close() {
  if (!state.open) return;
  state.open = false;
  state.menu?.remove();
  if (state.target) {
    state.target.setAttribute("aria-expanded", "false");
    state.target.removeAttribute("aria-controls");
    state.target.removeAttribute("aria-activedescendant");
    state.target.removeAttribute("aria-autocomplete");
    state.target.removeAttribute("role");
  }
  state.target = null;
  state.items = [];
  state.suggestions = [];
}

// Recompute the suggestion list from the field's current text and caret,
// then render and position the (possibly rebuilt) menu. Returned early when
// the field is gone or the token stopped looking like a class query — the
// list is never left stale or invisible.
function refreshForTarget() {
  if (!state.open || !isTarget(state.target)) {
    close();
    return;
  }
  const token = tokenAt(state.target);
  state.token = token;
  const query = suggestQuery(token.text);
  if (!query) {
    close();
    return;
  }
  state.items = filterSuggestions(state.suggestions, query, MAX_ITEMS);
  // The list was rebuilt, so the highlight restarts: a clamped stale index
  // would accept a different row than the arrow keys had shown.
  state.active = 0;
  // Silence beats a permanent "no matches" nag: the popup is only worth its
  // screen space while it has something to offer.
  if (!state.items.length) {
    close();
    return;
  }
  refreshMenu();
  positionMenu();
}

function setActive(next) {
  if (!state.items.length) return;
  state.active = (next + state.items.length) % state.items.length;
  state.target?.setAttribute("aria-activedescendant", optionId(state.active));
  state.menu?.querySelectorAll(".cc-item").forEach((element) => {
    const index = Number(element.dataset.ccIndex);
    element.classList.toggle("is-active", index === state.active);
    element.setAttribute("aria-selected", index === state.active ? "true" : "false");
  });
}

function accept(index) {
  const input = state.target;
  const item = state.items[index];
  if (!item || !isTarget(input)) {
    close();
    return;
  }
  const ref = item.ref;
  input.setRangeText(ref, state.token.start, state.token.end, "end");
  close();
  // The next input event — ours below, or anything the phoneme keyboard
  // later inserts — must not reopen the list over the finished token.
  state.busy = true;
  window.setTimeout(() => {
    state.busy = false;
  }, 0);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function onInput(event) {
  if (state.busy) return;
  const element = event.target;
  if (!isTarget(element)) return;
  if (!state.open) {
    // The trigger is the token, not the keystroke: only a token that could
    // plausibly be a class reference (two characters or more — one letter is
    // an ordinary phoneme) opens the list. Deleting letters inside a longer
    // token can reach that too; single-phoneme insertions from the phoneme
    // keyboard never do.
    if (!suggestQuery(tokenAt(element).text)) return;
    open(element);
  } else if (state.target !== element) {
    state.target = element;
  }
  refreshForTarget();
}

function onKeyDown(event) {
  if (!state.open || !isTarget(event.target)) return;
  if (state.target !== event.target) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActive(state.active + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActive(state.active - 1);
  } else if (event.key === "Enter" && state.items.length) {
    event.preventDefault();
    accept(state.active);
  } else if (event.key === "Escape") {
    close();
  }
  // Tab is never intercepted: leaving the field keeps its usual behavior.
}

function onPointerDown(event) {
  if (!state.open) return;
  const element = event.target instanceof Element ? event.target : null;
  if (state.menu?.contains(element) || element === state.target) return;
  close();
}

function onScroll(event) {
  if (event.target instanceof Node && state.menu?.contains(event.target)) return;
  close();
}

function onResize() {
  positionMenu();
}

function onHashChange() {
  close();
}

function onFocusIn(event) {
  if (!isTarget(event.target)) return;
  // Focus moves happen on every tab switch; only an already-open popup
  // follows focus, typing is what opens one.
  if (state.open && state.target !== event.target) close();
}

function onFocusOut(event) {
  if (state.open && isTarget(event.target)) {
    // Keep the list while the pointer travels to it (mousedown already
    // prevents the caret from leaving, so this is just tidiness).
    window.setTimeout(() => {
      if (state.open && !isTarget(state.target)) close();
    }, 0);
  }
}

export function initClassAutocomplete() {
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
  window.addEventListener("hashchange", onHashChange);
}
