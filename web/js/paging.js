// Shared paging for the long check tables and the cognate matrix. Views own
// filter and page state; this module keeps the page math and pager markup
// identical everywhere. It is DOM-free so the tests can import it under Node.

import { esc } from "./escape.js";

export const CHECK_PAGE_SIZE = 50;
export const MATRIX_PAGE_SIZE = 25;

function normalizePageSize(pageSize) {
  return Math.max(1, Math.floor(Number(pageSize) || 0));
}

export function pageCount(total, pageSize = CHECK_PAGE_SIZE) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  return Math.max(1, Math.ceil(count / normalizePageSize(pageSize)));
}

export function clampPage(page, total, pageSize = CHECK_PAGE_SIZE) {
  return Math.min(pageCount(total, pageSize), Math.max(1, Math.floor(Number(page) || 1)));
}

export function paginate(items, page = 1, pageSize = CHECK_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const size = normalizePageSize(pageSize);
  const current = clampPage(page, list.length, size);
  const start = (current - 1) * size;
  const end = Math.min(start + size, list.length);
  return {
    items: list.slice(start, end),
    total: list.length,
    page: current,
    pages: pageCount(list.length, size),
    pageSize: size,
    start,
    end,
    // One-based, inclusive display bounds. Empty tables get 0–0.
    first: list.length ? start + 1 : 0,
    last: end,
  };
}

export function pagerMarkup(
  { page, pages, first, last, total },
  { noun = "rows", label = "Table pages" } = {}
) {
  if (!total) return "";
  const current = Math.max(1, Math.floor(Number(page) || 1));
  const count = Math.max(1, Math.floor(Number(pages) || 1));
  return `
    <nav class="table-pager" aria-label="${esc(label)}" data-pager>
      <span class="table-pager-range">${first}–${last} of ${total} ${esc(noun)}</span>
      ${
        count > 1
          ? `<div class="table-pager-controls">
              <button class="button button-quiet button-small" type="button" data-pager-action="first" data-pager-page="1" ${current === 1 ? "disabled" : ""}>First</button>
              <button class="button button-quiet button-small" type="button" data-pager-action="previous" data-pager-page="${current - 1}" ${current === 1 ? "disabled" : ""}>Previous</button>
              <span class="table-pager-status" data-pager-status aria-live="polite">Page ${current} of ${count}</span>
              <button class="button button-quiet button-small" type="button" data-pager-action="next" data-pager-page="${current + 1}" ${current === count ? "disabled" : ""}>Next</button>
              <button class="button button-quiet button-small" type="button" data-pager-action="last" data-pager-page="${count}" ${current === count ? "disabled" : ""}>Last</button>
            </div>`
          : ""
      }
    </nav>`;
}

// Paging replaces the DOM around the control that was activated. Put keyboard
// focus back on the equivalent new control so repeated activation works. At a
// boundary the matching control is disabled, so focus the one that reverses
// the move instead of dropping off the pager.
export function focusPager(root, action) {
  const pager = root?.querySelector?.("[data-pager]");
  if (!pager) return false;
  const buttons = Array.from(pager.querySelectorAll?.("[data-pager-action]") || []).filter(
    (button) => !button.disabled
  );
  if (!buttons.length) return false;
  const byAction = new Map(buttons.map((button) => [button.dataset.pagerAction, button]));
  const reverse = action === "next" || action === "last" ? "previous" : "next";
  const target = byAction.get(action) || byAction.get(reverse) || buttons[0];
  target.focus();
  return true;
}
