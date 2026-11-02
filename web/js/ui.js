const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  tree: '<path d="M12 4v6M12 10 6 16M12 10l6 6"/><circle cx="12" cy="3.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="5" cy="17.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="17.5" r="1.7" fill="currentColor" stroke="none"/>',
  language: '<path d="M4 5.5h16M12 5.5v13M7.5 18.5h9"/><path d="M7 9.5h10M7.5 13h9"/>',
  edit: '<path d="M4 20h4.3L19.5 8.8a2.3 2.3 0 0 0 0-3.3l-1-1a2.3 2.3 0 0 0-3.3 0L4 15.7V20Z"/><path d="m13.8 6.2 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5M10.5 7.5v6M7.5 10.5h6"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5M7.5 10.5h6"/>',
  fit: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M20 15v5h-5"/>',
  sound: '<path d="M4 10v4h3l4 4V6L7 10H4Z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  book: '<path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h12.5v15H7a2.5 2.5 0 0 0-2.5 2.5V5.5Z"/><path d="M4.5 20.5A2.5 2.5 0 0 1 7 18h12.5"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17"/>',
  sliders: '<path d="M4 7h7M15 7h5M4 17h4M12 17h8"/><circle cx="13" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  warning: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 9v5M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.1"/>',
  save: '<path d="M5 3.5h12l2.5 2.5v14.5h-15V3.5Z"/><path d="M8 3.5v5h7v-5M8 20.5v-6h8v6"/>',
  sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5H5V5h5"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M18.4 9A7.5 7.5 0 0 0 5.8 6.2L4 8M5.6 15A7.5 7.5 0 0 0 18.2 17.8L20 16"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  drag: '<circle cx="9" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1" fill="currentColor" stroke="none"/>',
};

export function icon(name, className = "") {
  const body = paths[name] || paths.info;
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((element) => {
    const name = element.getAttribute("data-icon");
    element.innerHTML = icon(name);
  });
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let toastCounter = 0;

export function toast(message, options = {}) {
  const { type = "info", duration = 3600, action = null } = options;
  const root = document.getElementById("toast-root");
  const id = `toast-${++toastCounter}`;
  const element = document.createElement("div");
  element.className = `toast toast-${type}`;
  element.id = id;
  const glyph = type === "error" ? "warning" : type === "success" ? "check" : "info";
  element.innerHTML = `
    <span class="toast-icon">${icon(glyph)}</span>
    <span class="toast-message">${esc(message)}</span>
    ${action ? `<button class="toast-action" type="button">${esc(action.label)}</button>` : ""}
    <button class="toast-close" type="button" aria-label="Dismiss">${icon("x")}</button>
  `;
  root.appendChild(element);
  const remove = () => {
    element.classList.add("toast-leaving");
    window.setTimeout(() => element.remove(), 180);
  };
  let timer = window.setTimeout(remove, duration);
  element.querySelector(".toast-close").addEventListener("click", () => {
    window.clearTimeout(timer);
    remove();
  });
  if (action) {
    element.querySelector(".toast-action").addEventListener("click", () => {
      window.clearTimeout(timer);
      action.onClick();
      remove();
    });
  }
  return { close: remove };
}

function closeModal() {
  const root = document.getElementById("modal-root");
  const backdrop = root.querySelector(".modal-backdrop");
  if (!backdrop) return;
  backdrop.classList.add("modal-leaving");
  window.setTimeout(() => {
    backdrop.remove();
    if (!root.querySelector(".modal-backdrop")) document.body.classList.remove("has-modal");
  }, 140);
}

export function openModal({ title, body, footer = "", width = "medium", onMount = null }) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal modal-${width}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-head">
          <h2 id="modal-title">${esc(title)}</h2>
          <button type="button" class="icon-button modal-close" aria-label="Close">${icon("x")}</button>
        </header>
        <div class="modal-body">${body}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ""}
      </section>
    </div>
  `;
  document.body.classList.add("has-modal");
  const backdrop = root.querySelector("[data-modal-backdrop]");
  const close = closeModal;
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) close();
  });
  root.querySelector(".modal-close").addEventListener("click", close);
  const keyHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      window.removeEventListener("keydown", keyHandler);
    }
  };
  window.addEventListener("keydown", keyHandler);
  const focusable = root.querySelector("input, textarea, select, button:not(.modal-close)");
  if (focusable) window.setTimeout(() => focusable.focus(), 30);
  if (onMount) onMount({ root, close, backdrop });
  return { root, close };
}

export function confirmDialog(title, message, options = {}) {
  const { confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = options;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const { root, close } = openModal({
      title,
      width: "small",
      body: `<p class="modal-copy">${message}</p>`,
      footer: `
        <button type="button" class="button button-quiet" data-cancel>${esc(cancelLabel)}</button>
        <button type="button" class="button ${danger ? "button-danger" : "button-primary"}" data-confirm>${esc(confirmLabel)}</button>
      `,
      onMount({ root, close }) {
        root.querySelector("[data-cancel]").addEventListener("click", () => {
          finish(false);
          close();
        });
        root.querySelector("[data-confirm]").addEventListener("click", () => {
          finish(true);
          close();
        });
        const backdrop = root.querySelector(".modal-backdrop");
        backdrop.addEventListener("pointerdown", (event) => {
          if (event.target === backdrop) finish(false);
        });
        window.setTimeout(() => root.querySelector("[data-confirm]")?.focus(), 40);
      },
    });
    const observer = new MutationObserver(() => {
      if (!document.getElementById("modal-root").querySelector(".modal-backdrop")) {
        finish(false);
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById("modal-root"), { childList: true });
    void root;
    void close;
  });
}

export function promptDialog({ title, label, value = "", placeholder = "", confirmLabel = "Save", help = "" }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const { root, close } = openModal({
      title,
      width: "small",
      body: `
        <form class="form-stack" id="prompt-form">
          <label class="field">
            <span class="field-label">${esc(label)}</span>
            <input class="input" name="value" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
            ${help ? `<span class="field-help">${help}</span>` : ""}
          </label>
        </form>
      `,
      footer: `
        <button type="button" class="button button-quiet" data-cancel>Cancel</button>
        <button type="submit" form="prompt-form" class="button button-primary">${esc(confirmLabel)}</button>
      `,
      onMount({ root, close }) {
        const form = root.querySelector("#prompt-form");
        const input = form.querySelector("input");
        input.focus();
        input.select();
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const result = input.value.trim();
          if (!result) {
            input.classList.add("input-invalid");
            input.focus();
            return;
          }
          finish(result);
          close();
        });
        root.querySelector("[data-cancel]").addEventListener("click", () => {
          finish(null);
          close();
        });
        const backdrop = root.querySelector(".modal-backdrop");
        backdrop.addEventListener("pointerdown", (event) => {
          if (event.target === backdrop) finish(null);
        });
        void close;
      },
    });
    const observer = new MutationObserver(() => {
      if (!document.getElementById("modal-root").querySelector(".modal-backdrop")) {
        finish(null);
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById("modal-root"), { childList: true });
    void root;
  });
}

let menuCleanup = null;

export function closeMenu() {
  if (menuCleanup) {
    menuCleanup();
    menuCleanup = null;
  }
  document.getElementById("menu-root").innerHTML = "";
}

export function openMenu(anchor, items) {
  closeMenu();
  const root = document.getElementById("menu-root");
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = items
    .map((item, index) => {
      if (item.separator) return `<div class="menu-separator" role="separator"></div>`;
      return `
        <button type="button" class="menu-item ${item.danger ? "menu-item-danger" : ""}" data-menu-index="${index}" ${item.disabled ? "disabled" : ""} role="menuitem">
          <span class="menu-icon">${item.icon ? icon(item.icon) : ""}</span>
          <span>${esc(item.label)}</span>
          ${item.shortcut ? `<span class="menu-shortcut">${esc(item.shortcut)}</span>` : ""}
        </button>
      `;
    })
    .join("");
  root.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + menuRect.width > window.innerWidth - 12) left = window.innerWidth - menuRect.width - 12;
  if (top + menuRect.height > window.innerHeight - 12) top = rect.top - menuRect.height - 6;
  menu.style.left = `${Math.max(12, left)}px`;
  menu.style.top = `${Math.max(12, top)}px`;

  const outside = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closeMenu();
  };
  const onScroll = () => closeMenu();
  window.setTimeout(() => document.addEventListener("pointerdown", outside), 0);
  window.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  menu.querySelectorAll("[data-menu-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items[Number(button.dataset.menuIndex)];
      closeMenu();
      if (item && !item.disabled) item.onClick();
    });
  });

  menuCleanup = () => {
    document.removeEventListener("pointerdown", outside);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
  };
}

export function debounce(callback, wait = 250) {
  let timeout = null;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), wait);
  };
}
