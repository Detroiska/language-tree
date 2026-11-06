// HTML escaping shared by DOM-free builders and UI modules. Keeping this
// separate from ui.js lets report, diff, and derivation markup run under Node
// without pulling in a module that owns modals, menus, and toasts.

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
