import {
  ancestorsOf,
  chartPhonemeList,
  findLanguage,
  getLineage,
} from "./model.js";
import { store } from "./store.js";
import { esc, icon, toast } from "./ui.js";
import { decodeHashPart } from "./routes.js";

// A small virtual keyboard for IPA: while any phoneme-typing field is focused,
// Ctrl+Alt+K (Cmd+Option+K on macOS) opens a palette of the sounds in that
// language's charts. Clicking a key inserts at the caret through
// setRangeText() plus a synthetic input event, so every existing listener
// (live phonotactics, inherited checks, autosave, undo) fires exactly as if
// the symbol had been typed by hand.

// Fields the keyboard serves: word forms and testers (.ipa-input), sound
// change and allophony notation (.rule-input), the chart cell editor
// (.cell-input), and a Phonotactics category's sound list.
const TARGET_SELECTOR = ".ipa-input, .rule-input, .cell-input, .class-sounds-input";

// Ctrl+Alt+K was chosen because the app already owns Ctrl+K (quick search)
// and Ctrl/Cmd+Alt combos stay clear of the undo/redo handler in app.js,
// which bails out on altKey. On macOS this is Cmd+Option+K.
const COMBO_KEY = "k";

// Chart cells define the inventory itself, so their palette shows a curated
// IPA reference rather than the language's own (still-growing) sound list.
const REFERENCE = {
  consonants: [
    "p", "t", "k", "b", "d", "g", "ʔ", "ʈ", "ɖ", "c", "ɟ", "q", "ɢ",
    "tʃ", "dʒ", "ts", "dz", "tɬ",
    "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "ʂ", "ʐ", "x", "ɣ", "χ", "ʁ", "ħ", "ʕ", "h", "ɦ",
    "m", "n", "ɲ", "ŋ", "ɴ", "r", "ɾ", "ɽ", "l", "ʎ", "ʟ", "j", "w", "ʍ", "ɰ",
  ],
  vowels: [
    "i", "y", "ɨ", "ʉ", "ɯ", "u", "ɪ", "ʏ", "ʊ", "e", "ø", "ɘ", "ɵ", "ɤ", "o",
    "ə", "ɛ", "œ", "ɜ", "ɞ", "ʌ", "ɔ", "æ", "ɐ", "a", "ɶ", "ɑ", "ɒ",
  ],
  diacritics: ["ː", "ˑ", "ʰ", "ʷ", "ʲ", "ⁿ", "ˀ", "ʼ", "̃", "́", "̀", "̌", "̥", "̬"],
};

// Rule notation needs its own grammar symbols next to the sounds it mentions.
const RULE_SYNTAX = [">", "/", "_", "#", "∅", "[", "]", "^", ".", "V", "C", "ː", "+", "−", "=", "α", "β"];

const state = {
  open: false,
  palette: null,
  affordance: null,
  // The field inserts go into. Kept even when focus wanders off it, so the
  // palette dims instead of forgetting its target.
  target: null,
};

function isTarget(element) {
  return (
    element instanceof HTMLInputElement &&
    element.isConnected &&
    !element.disabled &&
    !element.readOnly &&
    element.matches(TARGET_SELECTOR)
  );
}

// The route hash is the only source of "which language is on screen"; app.js
// keeps its own parser private, and re-importing it would be circular.
function routeLanguageId() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "language" || !parts[1]) return null;
  return decodeHashPart(parts[1]);
}

function targetLabel(input) {
  if (input.matches('[data-word-field="form"]')) return "word form";
  if (input.matches("[data-test-input]")) return "rule tester";
  if (input.matches("[data-phonotactics-test]")) return "test form";
  if (input.matches(".rule-input")) return "sound change";
  if (input.matches(".cell-input")) return "chart cell";
  if (input.matches(".class-sounds-input")) return "category sounds";
  return "focused field";
}

/* ---- Keysets ---------------------------------------------------------- */

function chartSections(language) {
  const consonants = [...new Set(chartPhonemeList(language.inventory.consonants))];
  const vowels = [...new Set(chartPhonemeList(language.inventory.vowels))];
  return [
    { label: "Consonants", symbols: consonants },
    { label: "Vowels", symbols: vowels },
  ];
}

function keysetFor(input) {
  const languageId = routeLanguageId();
  const language = languageId ? findLanguage(store.project, languageId) : null;

  if (input.matches(".cell-input")) {
    return [
      { label: "Consonants", symbols: REFERENCE.consonants },
      { label: "Vowels", symbols: REFERENCE.vowels },
      { label: "Diacritics", symbols: REFERENCE.diacritics },
    ];
  }

  if (input.matches(".rule-input")) {
    // Rules may reference sounds from anywhere in the ancestry (chart classes
    // resolve against every chart on the lineage), so offer the union.
    const consonants = new Set();
    const vowels = new Set();
    if (language) {
      for (const member of getLineage(store.project, language.id)) {
        for (const phoneme of chartPhonemeList(member.inventory.consonants)) consonants.add(phoneme);
        for (const phoneme of chartPhonemeList(member.inventory.vowels)) vowels.add(phoneme);
      }
    }
    return [
      { label: "Consonants", symbols: [...consonants] },
      { label: "Vowels", symbols: [...vowels] },
      { label: "Rule syntax", symbols: RULE_SYNTAX },
    ];
  }

  if (input.matches("[data-test-input]")) {
    // The rule tester types an *ancestor* form, so it gets the parent's
    // inventory, not the current language's.
    const parent = language ? ancestorsOf(store.project, language.id).at(-1) || null : null;
    return parent ? chartSections(parent) : [];
  }

  return language ? chartSections(language) : [];
}

/* ---- Palette ----------------------------------------------------------- */

function keyMarkup(symbol) {
  return `<button class="ipa-key" type="button" data-symbol="${esc(symbol)}" title="Insert ${esc(symbol)}" aria-label="Insert ${esc(symbol)}">${esc(symbol)}</button>`;
}

function sectionMarkup(section) {
  if (!section.symbols.length) return "";
  return `
    <div class="ipa-kb-section">
      <span class="ipa-kb-label">${esc(section.label)}</span>
      <div class="ipa-kb-keys">${section.symbols.map(keyMarkup).join("")}</div>
    </div>`;
}

function refreshBody() {
  if (!state.palette || !state.target) return;
  const sections = keysetFor(state.target);
  const anyKeys = sections.some((section) => section.symbols.length);
  state.palette.querySelector("[data-kb-body]").innerHTML = anyKeys
    ? sections.map(sectionMarkup).join("")
    : `<p class="ipa-kb-empty">No sounds in these charts yet — add some on the Phonology tab first.</p>`;
  const label = state.palette.querySelector("[data-kb-target]");
  if (label) label.textContent = `→ ${targetLabel(state.target)}`;
  state.palette.classList.remove("is-idle");
}

function buildPalette() {
  if (state.palette) return state.palette;
  const palette = document.createElement("div");
  palette.className = "ipa-keyboard";
  palette.setAttribute("role", "toolbar");
  palette.setAttribute("aria-label", "Phoneme keyboard");
  palette.innerHTML = `
    <div class="ipa-kb-head">
      <span class="ipa-kb-title">${icon("keyboard")}Phoneme keyboard</span>
      <span class="ipa-kb-target" data-kb-target></span>
      <button class="ipa-kb-close" type="button" aria-label="Close phoneme keyboard">${icon("x")}</button>
    </div>
    <div class="ipa-kb-body" data-kb-body></div>
    <p class="ipa-kb-foot"><kbd>Ctrl Alt K</kbd> toggles · <kbd>Esc</kbd> closes · keys insert at the caret</p>
  `;
  // Inserting on mousedown-with-preventDefault keeps the caret in the field;
  // click then lands on the key without the input ever losing focus.
  palette.addEventListener("mousedown", (event) => {
    if (event.target.closest(".ipa-key")) event.preventDefault();
  });
  palette.addEventListener("click", (event) => {
    const key = event.target.closest(".ipa-key");
    if (key) {
      insertSymbol(key.dataset.symbol);
      return;
    }
    if (event.target.closest(".ipa-kb-close")) close();
  });
  state.palette = palette;
  return palette;
}

function positionPalette() {
  if (!state.palette || !state.target) return;
  const anchor = state.target.getBoundingClientRect();
  const rect = state.palette.getBoundingClientRect();
  let left = anchor.left;
  let top = anchor.bottom + 6;
  if (left + rect.width > window.innerWidth - 12) left = window.innerWidth - rect.width - 12;
  if (top + rect.height > window.innerHeight - 12) top = anchor.top - rect.height - 6;
  state.palette.style.left = `${Math.max(10, left)}px`;
  state.palette.style.top = `${Math.max(10, top)}px`;
}

function insertSymbol(symbol) {
  const input = state.target;
  // A re-render (add/delete word, undo, navigation) replaced the field: the
  // palette is now pointing at a detached node, so it closes instead of
  // silently dropping the click.
  if (!isTarget(input)) {
    close();
    return;
  }
  const start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
  const end = typeof input.selectionEnd === "number" ? input.selectionEnd : start;
  input.setRangeText(symbol, start, end, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function open() {
  // A stale target (its field was removed by a re-render) must not reopen
  // the palette; toggle() reports the hint toast instead.
  if (!state.target || !isTarget(state.target)) return;
  const palette = buildPalette();
  if (!palette.isConnected) document.body.appendChild(palette);
  state.open = true;
  refreshBody();
  positionPalette();
  hideAffordance();
  wireOpenListeners();
}

function close() {
  if (!state.open) return;
  state.open = false;
  state.palette?.remove();
  unwireOpenListeners();
  positionAffordance();
}

function toggle() {
  if (state.open) {
    close();
    return;
  }
  const active = document.activeElement;
  if (isTarget(active)) state.target = active;
  if (state.target && isTarget(state.target)) {
    open();
  } else {
    // Focus is elsewhere and the remembered field is gone (re-render,
    // navigation): say what the combo needs rather than reopening blindly.
    state.target = null;
    toast("Focus an IPA field — a word form, rule, chart cell, or category sounds — then press Ctrl Alt K.", { type: "info", duration: 2800 });
  }
}

/* ---- Listeners while the palette is open ------------------------------- */

function onEscape(event) {
  // Capture phase: the palette claims Escape before the modal handler, the
  // chart cell editor, or the sidebar so a single press closes only itself.
  // During IME composition Escape belongs to the input method, not the palette.
  if (event.isComposing || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

function onPointerDown(event) {
  if (state.palette?.contains(event.target)) return;
  if (state.affordance?.contains(event.target)) return;
  // Clicking another IPA field just retargets the palette via focusin.
  if (event.target instanceof Element && event.target.closest(TARGET_SELECTOR)) return;
  close();
}

function onScroll(event) {
  // Scrolling inside the palette body is fine; any other scroll would leave
  // the palette stranded away from its anchor, so it closes (like the
  // context menus do).
  if (event.target instanceof Node && state.palette?.contains(event.target)) return;
  close();
}

function onResize() {
  positionPalette();
}

function onHashChange() {
  close();
}

function wireOpenListeners() {
  window.addEventListener("keydown", onEscape, true);
  document.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
  window.addEventListener("hashchange", onHashChange);
}

function unwireOpenListeners() {
  window.removeEventListener("keydown", onEscape, true);
  document.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("hashchange", onHashChange);
}

/* ---- Floating affordance ----------------------------------------------- */

// Key combos are undiscoverable, and touch devices have no keyboard at all,
// so a small button floats beside the focused field as a visible way in.
function ensureAffordance() {
  if (state.affordance) return state.affordance;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ipa-kb-affordance";
  button.hidden = true;
  button.setAttribute("aria-label", "Open the phoneme keyboard (Ctrl Alt K)");
  button.title = "Phoneme keyboard (Ctrl Alt K)";
  button.innerHTML = icon("keyboard");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    const active = document.activeElement;
    if (isTarget(active)) state.target = active;
    if (state.target) open();
  });
  document.body.appendChild(button);
  state.affordance = button;
  return button;
}

function positionAffordance() {
  const button = ensureAffordance();
  const input = document.activeElement;
  if (state.open || !isTarget(input)) {
    button.hidden = true;
    return;
  }
  const rect = input.getBoundingClientRect();
  const size = 30;
  let left = rect.right - size;
  let top = rect.bottom + 4;
  if (left > window.innerWidth - size - 8) left = window.innerWidth - size - 8;
  if (left < 8) left = 8;
  if (top > window.innerHeight - size - 8) top = Math.max(8, rect.top - size - 4);
  button.hidden = false;
  button.style.left = `${Math.round(left)}px`;
  button.style.top = `${Math.round(top)}px`;
}

function hideAffordance() {
  if (state.affordance) state.affordance.hidden = true;
}

/* ---- Global wiring ------------------------------------------------------ */

function onComboKeyDown(event) {
  if (event.defaultPrevented || event.isComposing) return;
  // AltGr arrives as Ctrl+Alt on Windows and Linux; it is typing, not a combo.
  if (event.getModifierState && event.getModifierState("AltGraph")) return;
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return;
  // macOS Option turns event.key into the composed character, so match the
  // physical key as a fallback (K sits at KeyK on nearly every Latin layout).
  if (event.key.toLowerCase() !== COMBO_KEY && event.code !== "KeyK") return;
  if (document.body.classList.contains("has-modal")) return;
  if (!store.project) return;
  event.preventDefault();
  toggle();
}

function onFocusIn(event) {
  const element = event.target;
  if (isTarget(element)) {
    state.target = element;
    if (state.open) {
      refreshBody();
      positionPalette();
    }
    positionAffordance();
  } else if (element instanceof Node && state.palette?.contains(element)) {
    // Tab reached a palette key: keep the palette live so Enter can insert.
    return;
  } else if (document.body.classList.contains("has-modal")) {
    // A dialog or quick search owns the screen now. Its backdrop sits below
    // the palette, and the palette's Escape handler would otherwise swallow
    // the key that should close the dialog, so dismiss it instead of dimming.
    close();
    hideAffordance();
  } else {
    // Focus left the target field: dim the keys but keep the palette around,
    // like an IME bar, until something closes it.
    state.palette?.classList.add("is-idle");
    hideAffordance();
  }
}

function onFocusOut(event) {
  // Fields are replaced on re-render (add/delete word, undo, navigation). The
  // browser fires focusout when the focused node is removed, so hide the
  // affordance before it can linger at the old field's coordinates.
  if (isTarget(event.target)) hideAffordance();
}

export function initPhonemeKeyboard() {
  window.addEventListener("keydown", onComboKeyDown);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);

  // The affordance follows its field when the page scrolls; repositioning is
  // two style writes, rAF-throttled to once per frame.
  let raf = 0;
  window.addEventListener(
    "scroll",
    () => {
      if (!state.affordance || state.affordance.hidden) return;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        positionAffordance();
      });
    },
    { passive: true, capture: true },
  );
  window.addEventListener("resize", positionAffordance);
}
