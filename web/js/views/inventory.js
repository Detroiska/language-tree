import {
  addAxisChild,
  addAxisSibling,
  cellKey,
  chartMaxDepth,
  chartLeaves,
  chartPhonemeList,
  countLeaves,
  findAxisNode,
  findAxisNodeContext,
  moveAxisNode,
  nodeLeafIds,
  removeAxisNode,
  splitCellKey,
  uid,
} from "../model.js";
import { confirmDialog, esc, icon, openMenu, promptDialog, toast } from "../ui.js";

function plural(value, singular, pluralForm = `${singular}s`) {
  return value === 1 ? singular : pluralForm;
}

function axisNodesAtDepth(nodes, depth) {
  const result = [];
  const walk = (items, currentDepth) => {
    for (const node of items) {
      if (currentDepth === depth) result.push(node);
      if (node.children?.length) walk(node.children, currentDepth + 1);
    }
  };
  walk(nodes, 0);
  return result;
}

function columnHeaderRows(columns, rowHeaderColumns, corner = { left: "Manner", right: "Place" }) {
  const maxDepth = chartMaxDepth(columns);
  const rows = [];
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const cells = axisNodesAtDepth(columns, depth)
      .map((node) => {
        const group = node.children?.length > 0;
        const rowSpan = group ? 1 : maxDepth - depth + 1;
        return `
          <th class="axis-head col-head ${group ? "axis-group" : "axis-leaf"}" colspan="${countLeaves(node)}" rowspan="${rowSpan}" data-axis="columns" data-node-id="${esc(node.id)}">
            <span class="axis-label">${esc(node.label)}</span>
            <button class="axis-menu" type="button" data-axis="columns" data-node-id="${esc(node.id)}" aria-label="Actions for ${esc(node.label)}" title="Actions for ${esc(node.label)}">${icon("more")}</button>
          </th>`;
      })
      .join("");
    rows.push(`<tr>${depth === 0 ? `<th class="axis-corner" colspan="${rowHeaderColumns}" rowspan="${maxDepth + 1}"><span class="corner-manner">${esc(corner.left)}</span><span class="corner-slash">/</span><span class="corner-place">${esc(corner.right)}</span></th>` : ""}${cells}</tr>`);
  }
  return rows.join("");
}

function rowHeaderCells(rowLeaves, seenGroups, headerColumns) {
  return rowLeaves
    .map((leaf) => {
      let html = "";
      for (let depth = 0; depth < leaf.path.length; depth += 1) {
        const node = leaf.path[depth];
        const group = node.children?.length > 0;
        if (group) {
          if (seenGroups.has(node.id)) continue;
          seenGroups.add(node.id);
          html += `
            <th class="axis-head row-head axis-group" rowspan="${countLeaves(node)}" data-axis="rows" data-node-id="${esc(node.id)}">
              <span class="axis-label" style="--axis-depth:${depth}">${esc(node.label)}</span>
              <button class="axis-menu" type="button" data-axis="rows" data-node-id="${esc(node.id)}" aria-label="Actions for ${esc(node.label)}" title="Actions for ${esc(node.label)}">${icon("more")}</button>
            </th>`;
        } else {
          // A leaf shallower than the deepest row tree must span the remaining
          // header columns. Otherwise its data cells start one column too far
          // left and clicks map to the wrong column IDs.
          const colspan = Math.max(1, headerColumns - depth);
          html += `
            <th class="axis-head row-head axis-leaf" colspan="${colspan}" rowspan="1" data-axis="rows" data-node-id="${esc(node.id)}">
              <span class="axis-label" style="--axis-depth:${depth}">${esc(node.label)}</span>
              <button class="axis-menu" type="button" data-axis="rows" data-node-id="${esc(node.id)}" aria-label="Actions for ${esc(node.label)}" title="Actions for ${esc(node.label)}">${icon("more")}</button>
            </th>`;
        }
      }
      return html;
    })
    .join("");
}

function chipsMarkup(values) {
  return values
    .map(
      (phoneme, index) => `
        <span class="phoneme-chip" title="${esc(phoneme)}">
          <span class="chip-text">${esc(phoneme)}</span>
          <button class="chip-remove" type="button" data-chip-index="${index}" aria-label="Remove ${esc(phoneme)}">${icon("x")}</button>
        </span>`
    )
    .join("");
}

function dataCellMarkup(chart, row, column) {
  const key = cellKey(row.node.id, column.node.id);
  const values = chart.cells[key] || [];
  return `
    <td class="phoneme-cell ${values.length ? "" : "is-empty"}" data-row-id="${esc(row.node.id)}" data-col-id="${esc(column.node.id)}" data-cell-key="${esc(key)}">
      <div class="cell-inner">
        <div class="phoneme-chips">${chipsMarkup(values)}</div>
        <button class="cell-plus" type="button" aria-label="Add a sound" title="Add a sound">${icon("plus")}</button>
      </div>
    </td>`;
}

function tableMarkup(chart, kind) {
  const corner = kind === "vowels" ? { left: "Height", right: "Backness" } : { left: "Manner", right: "Place" };
  if (!chart.rows.length || !chart.columns.length) {
    return `
      <div class="chart-empty">
        <div class="empty-icon small">${icon("grid")}</div>
        <p>${!chart.rows.length ? "Add a row" : "Add a column"} to start laying out this chart.</p>
        <div class="chart-empty-actions">
          <button class="button button-quiet button-small" type="button" data-add-axis="rows">${icon("plus")}Row</button>
          <button class="button button-quiet button-small" type="button" data-add-axis="columns">${icon("plus")}Column</button>
        </div>
      </div>`;
  }
  const rowLeaves = chartLeaves(chart.rows);
  const columnLeaves = chartLeaves(chart.columns);
  const rowHeaderColumns = chartMaxDepth(chart.rows) + 1;
  const seenGroups = new Set();
  const body = rowLeaves
    .map(
      (row) => `
        <tr>
          ${rowHeaderCells([row], seenGroups, rowHeaderColumns)}
          ${columnLeaves.map((column) => dataCellMarkup(chart, row, column)).join("")}
        </tr>`
    )
    .join("");

  return `
    <div class="chart-scroll">
      <table class="phonology-table chart-${kind}" aria-label="${kind === "consonants" ? "Consonant" : "Vowel"} chart">
        <thead>${columnHeaderRows(chart.columns, rowHeaderColumns, corner)}</thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function splitPhonemes(value) {
  return [...new Set(String(value || "").normalize("NFC").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
}

function updateChartCount(container, chart, kind) {
  const target = container.querySelector(`[data-chart-count="${kind}"]`);
  if (!target) return;
  const count = new Set(chartPhonemeList(chart)).size;
  target.textContent = `${count} ${count === 1 ? "sound" : "sounds"}`;
}

function refreshCell(td, chart, values, container, kind) {
  const chips = td.querySelector(".phoneme-chips");
  chips.innerHTML = chipsMarkup(values);
  td.classList.toggle("is-empty", values.length === 0);
  updateChartCount(container, chart, kind);
}

function addValuesToCell(chart, rowId, columnId, values) {
  const key = cellKey(rowId, columnId);
  const existing = chart.cells[key] || [];
  const next = [...new Set([...existing, ...values])];
  if (next.length) chart.cells[key] = next;
  else delete chart.cells[key];
  return next;
}

function removeValueFromCell(chart, rowId, columnId, index) {
  const key = cellKey(rowId, columnId);
  const existing = chart.cells[key] || [];
  existing.splice(index, 1);
  if (existing.length) chart.cells[key] = existing;
  else delete chart.cells[key];
  return existing;
}

function bindCellEditing(container, ctx, chart, kind) {
  const openEditors = new Set();

  const closeEditor = (td, commit) => {
    const input = td.querySelector(".cell-input");
    if (!input) return;
    if (commit) {
      const values = splitPhonemes(input.value);
      if (values.length) {
        const next = addValuesToCell(chart, td.dataset.rowId, td.dataset.colId, values);
        refreshCell(td, chart, next, container, kind);
        ctx.touch();
      }
    }
    input.remove();
    td.querySelector(".cell-plus")?.classList.remove("is-hidden");
    openEditors.delete(td);
  };

  const openEditor = (td) => {
    for (const other of [...openEditors]) {
      if (other !== td) closeEditor(other, true);
    }
    const existing = td.querySelector(".cell-input");
    if (existing) {
      existing.focus();
      existing.select();
      return;
    }
    const input = document.createElement("input");
    input.className = "cell-input";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "p, t, k";
    input.setAttribute("aria-label", "Add sounds to this cell");
    td.querySelector(".cell-inner").appendChild(input);
    td.querySelector(".cell-plus")?.classList.add("is-hidden");
    openEditors.add(td);
    input.focus();

    let closing = false;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const values = splitPhonemes(input.value);
        if (values.length) {
          const next = addValuesToCell(chart, td.dataset.rowId, td.dataset.colId, values);
          refreshCell(td, chart, next, container, kind);
          ctx.touch();
        }
        input.value = "";
      } else if (event.key === "Escape") {
        event.preventDefault();
        closing = true;
        closeEditor(td, false);
      }
    });
    input.addEventListener("blur", () => {
      if (closing) {
        closing = false;
        return;
      }
      closeEditor(td, true);
    });
  };

  container.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".chip-remove");
    const td = event.target.closest(".phoneme-cell");
    if (!td) return;
    if (removeButton) {
      event.stopPropagation();
      const index = Number(removeButton.dataset.chipIndex);
      const values = removeValueFromCell(chart, td.dataset.rowId, td.dataset.colId, index);
      refreshCell(td, chart, values, container, kind);
      ctx.touch();
      return;
    }
    if (event.target.closest(".cell-input")) return;
    openEditor(td);
  });
}

function bindNotes(container, ctx, chart, kind) {
  const notes = container.querySelector(`[data-chart-notes="${kind}"]`);
  if (!notes) return;
  notes.addEventListener("input", () => {
    chart.notes = notes.value;
    ctx.touch();
  });
}

function alignStickyRowHeaders(panel) {
  const table = panel.querySelector(".phonology-table");
  if (!table) return;
  const tableLeft = table.getBoundingClientRect().left;
  const offsets = new Map();
  const cells = [...table.querySelectorAll("tbody th.row-head")];
  for (const cell of cells) {
    const depth = Number(cell.querySelector(".axis-label")?.style.getPropertyValue("--axis-depth") || 0);
    if (offsets.has(depth)) continue;
    // The first cell at each depth establishes that header column's natural
    // offset. Measuring with getBoundingClientRect avoids relying on magic
    // pixel widths, which differ with the label text.
    offsets.set(depth, Math.max(0, Math.round(cell.getBoundingClientRect().left - tableLeft)));
  }
  for (const cell of cells) {
    const depth = Number(cell.querySelector(".axis-label")?.style.getPropertyValue("--axis-depth") || 0);
    cell.style.left = `${offsets.get(depth) || 0}px`;
  }
}

function copyCellsToPlain(chart, axis, nodeId, plainId) {
  for (const [key, values] of Object.entries(chart.cells)) {
    const ids = splitCellKey(key);
    if ((axis === "rows" && ids.rowId === nodeId) || (axis === "columns" && ids.columnId === nodeId)) {
      const destination = axis === "rows" ? cellKey(plainId, ids.columnId) : cellKey(ids.rowId, plainId);
      chart.cells[destination] = values;
      delete chart.cells[key];
    }
  }
}

function addSubdivision(ctx, chart, axis, nodeId) {
  const node = findAxisNode(axis === "rows" ? chart.rows : chart.columns, nodeId);
  if (!node) return;
  const singular = axis === "rows" ? "subrow" : "subcolumn";
  promptDialog({
    title: `Add a ${singular}`,
    label: `Name of the new ${singular} under “${node.label}”`,
    value: axis === "rows" ? "New subrow" : "New subcolumn",
    placeholder: axis === "rows" ? "e.g. Aspirated" : "e.g. Labialized",
    confirmLabel: `Add ${singular}`,
    help: "The parent becomes a group. Existing sounds in its cells are moved to a new “Plain” subdivision so nothing is lost.",
  }).then((label) => {
    if (!label) return;
    let moved = false;
    if (!node.children.length) {
      const plain = { id: uid(axis === "rows" ? "row" : "col"), label: "Plain", children: [] };
      node.children.push(plain);
      copyCellsToPlain(chart, axis, node.id, plain.id);
      moved = true;
    }
    const added = addAxisChild(axis === "rows" ? chart.rows : chart.columns, node.id, label, axis === "rows" ? "row" : "col");
    if (!added) return;
    ctx.touch();
    ctx.refresh();
    if (moved) {
      toast(`Existing sounds under “${node.label}” moved to the new “Plain” ${singular.replace("sub", "")}.`, { type: "info", duration: 5200 });
    }
  });
}

function addSibling(ctx, chart, axis, nodeId) {
  const singular = axis === "rows" ? "row" : "column";
  promptDialog({
    title: `Add a ${singular}`,
    label: `Name of the new ${singular}`,
    value: axis === "rows" ? "New row" : "New column",
    confirmLabel: `Add ${singular}`,
  }).then((label) => {
    if (!label) return;
    const added = addAxisSibling(axis === "rows" ? chart.rows : chart.columns, nodeId, label, axis === "rows" ? "row" : "col");
    if (!added) return;
    ctx.touch();
    ctx.refresh();
  });
}

function renameAxisNode(ctx, chart, axis, nodeId) {
  const node = findAxisNode(axis === "rows" ? chart.rows : chart.columns, nodeId);
  if (!node) return;
  promptDialog({
    title: "Rename",
    label: axis === "rows" ? "Row label" : "Column label",
    value: node.label,
    confirmLabel: "Rename",
  }).then((label) => {
    if (!label || label === node.label) return;
    node.label = label;
    ctx.touch();
    ctx.refresh();
  });
}

function deleteAxisNode(ctx, chart, axis, nodeId) {
  const nodes = axis === "rows" ? chart.rows : chart.columns;
  const node = findAxisNode(nodes, nodeId);
  if (!node) return;
  const leafIds = new Set(nodeLeafIds(node));
  let sounds = 0;
  for (const [key, values] of Object.entries(chart.cells)) {
    const ids = splitCellKey(key);
    if ((axis === "rows" && leafIds.has(ids.rowId)) || (axis === "columns" && leafIds.has(ids.columnId))) {
      sounds += values.length;
    }
  }
  const isGroup = node.children?.length > 0;
  const message = isGroup
    ? `<strong>${esc(node.label)}</strong> and its ${leafIds.size} ${plural(leafIds.size, "subdivision")} will be deleted${sounds ? `, including ${sounds} ${plural(sounds, "sound")}` : ""}.`
    : `<strong>${esc(node.label)}</strong> will be deleted${sounds ? `, including ${sounds} ${plural(sounds, "sound")}` : ""}.`;
  confirmDialog("Delete chart section?", message, {
    confirmLabel: "Delete",
    danger: true,
  }).then((confirmed) => {
    if (!confirmed) return;
    for (const [key] of Object.entries(chart.cells)) {
      const ids = splitCellKey(key);
      if ((axis === "rows" && leafIds.has(ids.rowId)) || (axis === "columns" && leafIds.has(ids.columnId))) {
        delete chart.cells[key];
      }
    }
    removeAxisNode(nodes, nodeId);
    ctx.touch();
    ctx.refresh();
  });
}

function openAxisActions(ctx, anchor, chart, axis, nodeId) {
  const nodes = axis === "rows" ? chart.rows : chart.columns;
  const context = findAxisNodeContext(nodes, nodeId);
  if (!context) return;
  const singular = axis === "rows" ? "row" : "column";
  const sub = axis === "rows" ? "subrow" : "subcolumn";
  const moveEarlier = axis === "rows" ? "Move up" : "Move left";
  const moveLater = axis === "rows" ? "Move down" : "Move right";
  const earlierIcon = axis === "rows" ? "arrowUp" : "chevronLeft";
  const laterIcon = axis === "rows" ? "arrowDown" : "chevronRight";
  openMenu(anchor, [
    { label: "Rename", icon: "edit", onClick: () => renameAxisNode(ctx, chart, axis, nodeId) },
    { label: `Add ${sub}`, icon: "plus", onClick: () => addSubdivision(ctx, chart, axis, nodeId) },
    { label: `Add ${singular} after`, icon: "plus", onClick: () => addSibling(ctx, chart, axis, nodeId) },
    { separator: true },
    { label: moveEarlier, icon: earlierIcon, disabled: context.index === 0, onClick: () => {
      if (moveAxisNode(nodes, nodeId, -1)) {
        ctx.touch();
        ctx.refresh();
      }
    } },
    { label: moveLater, icon: laterIcon, disabled: context.index === context.siblings.length - 1, onClick: () => {
      if (moveAxisNode(nodes, nodeId, 1)) {
        ctx.touch();
        ctx.refresh();
      }
    } },
    { separator: true },
    { label: `Delete ${singular}…`, icon: "trash", danger: true, onClick: () => deleteAxisNode(ctx, chart, axis, nodeId) },
  ]);
}

function addTopLevel(ctx, chart, axis) {
  const singular = axis === "rows" ? "row" : "column";
  promptDialog({
    title: `Add a ${singular}`,
    label: `${axis === "rows" ? "Row" : "Column"} label`,
    value: axis === "rows" ? "New row" : "New column",
    confirmLabel: `Add ${singular}`,
  }).then((label) => {
    if (!label) return;
    const node = { id: uid(axis === "rows" ? "row" : "col"), label, children: [] };
    if (axis === "rows") chart.rows.push(node);
    else chart.columns.push(node);
    ctx.touch();
    ctx.refresh();
  });
}

function chartPanel(ctx, chart, kind, title, subtitle) {
  const count = new Set(chartPhonemeList(chart)).size;
  return `
    <section class="panel chart-panel" data-chart="${kind}">
      <header class="panel-head chart-head">
        <div class="panel-title">
          <h2>${title}</h2>
          <p>${subtitle}</p>
        </div>
        <div class="panel-actions">
          <span class="count-pill" data-chart-count="${kind}">${count} ${count === 1 ? "sound" : "sounds"}</span>
          <button class="button button-quiet button-small" type="button" data-add-axis="rows">${icon("plus")}Row</button>
          <button class="button button-quiet button-small" type="button" data-add-axis="columns">${icon("plus")}Column</button>
        </div>
      </header>
      <div class="chart-hint">
        ${icon("info")}
        <span>Click any cell to add sounds. Use the <strong>⋯</strong> menu in a header to add subrows, subcolumns, rename, reorder, or delete.</span>
      </div>
      ${tableMarkup(chart, kind)}
      <div class="chart-notes">
        <label class="field">
          <span class="field-label">Chart notes <span class="field-optional">optional</span></span>
          <textarea class="textarea textarea-small" rows="2" data-chart-notes="${kind}" placeholder="Allophony, marginal phonemes, orthographic notes…">${esc(chart.notes || "")}</textarea>
        </label>
      </div>
    </section>`;
}

export function renderInventory(container, ctx) {
  const { language } = ctx;
  const consonants = language.inventory.consonants;
  const vowels = language.inventory.vowels;

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Phonology</p>
          <h2>Phonemic inventory</h2>
          <p class="section-copy">Lay out contrastive sounds on a chart. Charts are independent per language; when you create a daughter, it starts with a copy of its ancestor’s chart. How those sounds combine into syllables is set in <a href="#/language/${language.id}/phonotactics">Phonotactics</a>.</p>
        </div>
        <div class="inventory-summary">
          <span><strong>${new Set(chartPhonemeList(consonants)).size}</strong> consonants</span>
          <span><strong>${new Set(chartPhonemeList(vowels)).size}</strong> vowels</span>
        </div>
      </section>
      ${chartPanel(ctx, consonants, "consonants", "Consonants", "Manner of articulation × place of articulation")}
      ${chartPanel(ctx, vowels, "vowels", "Vowels", "Height × backness, with rounding as subcolumns")}
    </div>
  `;

  container.querySelectorAll("[data-chart]").forEach((panel) => {
    const kind = panel.dataset.chart;
    const chart = kind === "consonants" ? consonants : vowels;
    alignStickyRowHeaders(panel);
    panel.querySelectorAll("[data-add-axis]").forEach((button) => {
      button.addEventListener("click", () => addTopLevel(ctx, chart, button.dataset.addAxis));
    });
    panel.addEventListener("click", (event) => {
      const menuButton = event.target.closest(".axis-menu");
      if (!menuButton) return;
      event.preventDefault();
      event.stopPropagation();
      openAxisActions(ctx, menuButton, chart, menuButton.dataset.axis, menuButton.dataset.nodeId);
    });
    bindCellEditing(panel, ctx, chart, kind);
    bindNotes(panel, ctx, chart, kind);
  });
}
