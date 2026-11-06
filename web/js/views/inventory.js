import {
  addAxisChild,
  addAxisSibling,
  allophonyRules,
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
import { allophoneCandidates, allophoneTable } from "../phonology.js";
import {
  FEATURE_DEFINITIONS,
  IPA_FEATURES,
  createFeatureResolver,
  defaultBundle,
  derivedFeatures,
  describeBundle,
  normalizeBundle,
  soundKey,
} from "../features.js";
import { formatPhonemic, formatPhonetic, stripLevelMarks } from "../notation.js";
import { confirmDialog, esc, icon, openMenu, openModal, promptDialog, toast } from "../ui.js";

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
  return [
    ...new Set(
      String(value || "")
        .normalize("NFC")
        .split(/[\s,]+/)
        .map((item) => stripLevelMarks(item))
        .filter(Boolean)
    ),
  ];
}

function updateChartCount(container, chart, kind) {
  const target = container.querySelector(`[data-chart-count="${kind}"]`);
  if (!target) return;
  const count = new Set(chartPhonemeList(chart)).size;
  target.textContent = `${count} ${count === 1 ? "phoneme" : "phonemes"}`;
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
        ctx.touch({ label: "Edit chart" });
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
          ctx.touch({ label: "Edit chart" });
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
      ctx.touch({ label: "Edit chart" });
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
    ctx.touch({ label: "Edit chart notes" });
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
    ctx.touch({ label: `Add chart ${singular}` });
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
    ctx.touch({ label: `Add chart ${singular}` });
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
    ctx.touch({ label: "Rename chart label" });
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
    ctx.touch({ label: `Delete chart ${axis === "rows" ? "row" : "column"}` });
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
        ctx.touch({ label: `Move chart ${singular}` });
        ctx.refresh();
      }
    } },
    { label: moveLater, icon: laterIcon, disabled: context.index === context.siblings.length - 1, onClick: () => {
      if (moveAxisNode(nodes, nodeId, 1)) {
        ctx.touch({ label: `Move chart ${singular}` });
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
    ctx.touch({ label: `Add chart ${singular}` });
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
          <span class="count-pill" data-chart-count="${kind}">${count} ${count === 1 ? "phoneme" : "phonemes"}</span>
          <button class="button button-quiet button-small" type="button" data-add-axis="rows">${icon("plus")}Row</button>
          <button class="button button-quiet button-small" type="button" data-add-axis="columns">${icon("plus")}Column</button>
        </div>
      </header>
      ${tableMarkup(chart, kind)}
      <div class="chart-notes">
        <label class="field">
          <span class="field-label">Chart notes <span class="field-optional">optional</span></span>
          <textarea class="textarea textarea-small" rows="2" data-chart-notes="${kind}" placeholder="Marginal phonemes, orthographic notes, open questions…">${esc(chart.notes || "")}</textarea>
        </label>
      </div>
    </section>`;
}

function allophonePanelMarkup(ctx) {
  const table = allophoneTable(ctx.project, ctx.language.id);
  if (!table.rows.length) {
    return `
      <section class="panel allophone-panel">
        <header class="panel-head">
          <div class="panel-title">
            <h2>Allophones</h2>
            <p>Surface variants that are not phonemes live here, not on the charts.</p>
          </div>
          <a class="button button-quiet button-small" href="#/language/${encodeURIComponent(ctx.language.id)}/allophony">${icon("sound")}Allophony rules</a>
        </header>
        <div class="panel-body">
          <div class="inline-empty">${icon("info")}<span>No surface allophones are active yet. Add a synchronic rule in Allophony.</span><a class="text-button" href="#/language/${encodeURIComponent(ctx.language.id)}/allophony">Open Allophony</a></div>
        </div>
      </section>`;
  }
  const rows = table.rows
    .map(
      (row) => `
        <tr>
          <td><code class="ipa">${esc(formatPhonemic(row.phoneme))}</code></td>
          <td><code class="ipa">${esc(formatPhonetic(row.allophone))}</code></td>
          <td><code class="ipa">${esc(row.environment || "—")}</code></td>
          <td><span class="muted">${esc(row.label)}</span> <code class="rule-inline">${esc(row.notation)}</code></td>
        </tr>`
    )
    .join("");
  return `
    <section class="panel allophone-panel">
      <header class="panel-head">
        <div class="panel-title">
          <h2>Allophones</h2>
          <p>Surface variants produced by this language's allophony rules.</p>
        </div>
        <a class="button button-quiet button-small" href="#/language/${encodeURIComponent(ctx.language.id)}/allophony">${icon("sound")}Allophony rules</a>
      </header>
      <div class="table-scroll">
        <table class="data-table allophone-table">
          <thead><tr><th>Phoneme</th><th>Allophone</th><th>Environment</th><th>Rule</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="table-foot">The table is derived from the Allophony rules. The charts above list phonemes; these are the surface variants they produce.</p>
    </section>`;
}

const FEATURE_GROUPS = [
  {
    title: "Major class and manner",
    names: [
      "syllabic",
      "consonantal",
      "sonorant",
      "continuant",
      "nasal",
      "lateral",
      "trill",
      "tap",
      "delayed_release",
      "prenasalized",
      "click",
      "implosive",
    ],
  },
  {
    title: "Laryngeal",
    names: ["voice", "spread_glottis", "constricted_glottis"],
  },
  {
    title: "Vowel",
    names: ["high", "low", "back", "central", "round", "atr", "long"],
  },
  {
    title: "Secondary articulation",
    names: ["rhotic", "labialized", "palatalized", "velarized", "pharyngealized"],
  },
];

function featureSounds(language) {
  const charted = [
    ...chartPhonemeList(language.inventory.consonants),
    ...chartPhonemeList(language.inventory.vowels),
  ];
  const allophones = allophoneCandidates(allophonyRules(language.allophony || []));
  const active = [...new Set([...charted, ...allophones])];
  const overrideKeys = Object.keys(language.featureOverrides || {});
  return {
    active,
    unused: overrideKeys.filter((sound) => !active.some((item) => soundKey(item) === soundKey(sound))),
  };
}

function featureSource(sound, resolver) {
  if (resolver.hasOverride(sound)) return { id: "override", label: "override" };
  if (IPA_FEATURES[soundKey(sound)]) return { id: "ipa", label: "IPA table" };
  if (resolver.bundleFor(sound)) return { id: "derived", label: "derived" };
  return { id: "missing", label: "missing" };
}

function bundleText(bundle) {
  if (!bundle) return "Not defined";
  const pieces = describeBundle(bundle);
  const derived = derivedFeatures(bundle).map((name) => `+${name}`);
  return [...pieces, ...derived].join(" ");
}

function featureRowsMarkup(sounds, resolver, { unused = false } = {}) {
  return sounds
    .map((sound) => {
      const bundle = resolver.bundleFor(sound);
      const source = unused ? { id: "unused", label: "unused override" } : featureSource(sound, resolver);
      return `
        <tr class="feature-row ${bundle ? "" : "is-missing"}" data-feature-sound="${esc(sound)}">
          <td><code class="ipa">${esc(sound)}</code></td>
          <td><span class="feature-bundle">${esc(bundleText(bundle))}</span></td>
          <td><span class="feature-source is-${source.id}">${esc(source.label)}</span></td>
          <td class="feature-row-actions">
            <button class="button button-quiet button-small" type="button" data-feature-edit="${esc(sound)}">${icon("edit")}${bundle ? "Edit" : "Define"}</button>
          </td>
        </tr>`;
    })
    .join("");
}

function featurePanelMarkup(ctx) {
  const resolver = createFeatureResolver(ctx.language.featureOverrides);
  const { active, unused } = featureSounds(ctx.language);
  const missing = active.filter((sound) => !resolver.bundleFor(sound));
  const resolved = active.length - missing.length;
  const countLabel = `${resolved} of ${active.length} ${active.length === 1 ? "symbol" : "symbols"} resolved`;
  return `
    <section class="panel feature-panel">
      <header class="panel-head">
        <div class="panel-title">
          <h2>Distinctive features</h2>
          <p>Features come from IPA symbols, never from chart labels. Overrides describe custom sounds; rules can query features with [+nasal] or [αplace].</p>
        </div>
        <span class="count-pill ${missing.length ? "is-warning" : ""}" data-feature-count>${esc(countLabel)}</span>
      </header>
      <div class="panel-body feature-panel-body">
        ${
          missing.length
            ? `<div class="notice notice-quiet feature-missing">
                ${icon("info")}
                <p><strong>${missing.length === 1 ? "One symbol has" : `${missing.length} symbols have`} no feature bundle yet:</strong> ${missing
                  .map((sound) => `<code class="ipa">${esc(sound)}</code>`)
                  .join(", ")}. Define them here so feature rules can see ${missing.length === 1 ? "it" : "them"}.</p>
                <button class="button button-quiet button-small" type="button" data-feature-define-missing="${esc(missing[0])}">Define ${esc(missing[0])}</button>
              </div>`
            : ""
        }
        <div class="table-scroll">
          <table class="data-table feature-table">
            <thead><tr><th>Sound</th><th>Feature bundle</th><th>Source</th><th></th></tr></thead>
            <tbody>${featureRowsMarkup(active, resolver)}</tbody>
          </table>
        </div>
        ${
          unused.length
            ? `<details class="feature-unused">
                <summary>${unused.length} unused ${unused.length === 1 ? "override" : "overrides"}</summary>
                <p class="field-help">These overrides no longer correspond to a charted sound or an allophone output. They are kept until you remove them.</p>
                <div class="table-scroll">
                  <table class="data-table feature-table">
                    <tbody>${featureRowsMarkup(unused, resolver, { unused: true })}</tbody>
                  </table>
                </div>
              </details>`
            : ""
        }
        <p class="table-foot">A feature bundle is tri-state: +, −, or not applicable. Place is categorical; coronal, dorsal, labial, and radical are derived from it. Sound-change outputs resolve back to the current chart, so an off-chart mutation fails loudly. Allophony may instead synthesize a conservative surface symbol from this curated table and its documented diacritics.</p>
      </div>
    </section>`;
}

function selectValue(value) {
  if (value === true) return "+";
  if (value === false) return "-";
  return "";
}

function derivedFeatureMarkup(bundle) {
  const pieces = [];
  if (bundle.anterior === true) pieces.push("+anterior");
  else if (bundle.anterior === false) pieces.push("−anterior");
  for (const name of derivedFeatures(bundle)) pieces.push(`+${name}`);
  return pieces.length ? pieces.map((piece) => `<span class="feature-pill">${esc(piece)}</span>`).join("") : `<span class="muted">none</span>`;
}

function featureEditorMarkup(sound, bundle) {
  const groupMarkup = FEATURE_GROUPS.map(
    (group) => `
      <fieldset class="feature-group">
        <legend>${esc(group.title)}</legend>
        <div class="feature-grid">
          ${group.names
            .map((name) => {
              const def = FEATURE_DEFINITIONS[name];
              return `
                <label class="feature-field">
                  <span class="feature-field-label">${esc(def.label)}</span>
                  <select class="select select-small" data-feature="${name}" aria-label="${esc(def.label)}">
                    <option value="+" ${selectValue(bundle[name]) === "+" ? "selected" : ""}>+</option>
                    <option value="-" ${selectValue(bundle[name]) === "-" ? "selected" : ""}>−</option>
                    <option value="" ${selectValue(bundle[name]) === "" ? "selected" : ""}>n/a</option>
                  </select>
                </label>`;
            })
            .join("")}
        </div>
      </fieldset>`
  ).join("");
  return `
    <form class="form-stack feature-editor">
      <div class="feature-editor-head">
        <code class="ipa feature-editor-sound">${esc(sound)}</code>
        <p class="field-help">Changes are saved as a complete override for this language.</p>
      </div>
      <fieldset class="feature-group">
        <legend>Place</legend>
        <label class="feature-field feature-place-field">
          <span class="feature-field-label">place</span>
          <select class="select" data-feature="place" aria-label="Place">
            <option value="" ${bundle.place === null ? "selected" : ""}>not applicable</option>
            ${FEATURE_DEFINITIONS.place.values
              .map((value) => `<option value="${esc(value)}" ${bundle.place === value ? "selected" : ""}>${esc(value)}</option>`)
              .join("")}
          </select>
        </label>
        <div class="feature-derived-block">
          <span class="field-label">Derived features</span>
          <div data-feature-derived>${derivedFeatureMarkup(bundle)}</div>
        </div>
      </fieldset>
      ${groupMarkup}
      <div class="feature-preview-block">
        <span class="field-label">Preview</span>
        <code class="feature-preview" data-feature-preview>[${esc(describeBundle(bundle).join(" "))}]</code>
      </div>
    </form>`;
}

function openFeatureEditor(ctx, sound) {
  const resolver = createFeatureResolver(ctx.language.featureOverrides);
  const source = resolver.bundleFor(sound);
  const bundle = normalizeBundle(source || defaultBundle());
  const hasOverride = resolver.hasOverride(sound);
  openModal({
    title: `Features for “${sound}”`,
    width: "wide",
    body: featureEditorMarkup(sound, bundle),
    footer: `
      ${hasOverride ? `<button class="button button-quiet button-danger" type="button" data-feature-remove>Remove override</button>` : ""}
      <button class="button button-quiet" type="button" data-feature-cancel>Cancel</button>
      <button class="button button-primary" type="button" data-feature-save>Save features</button>
    `,
    onMount({ root, close }) {
      const readBundle = () => {
        const raw = defaultBundle();
        for (const select of root.querySelectorAll("[data-feature]")) {
          const name = select.dataset.feature;
          if (name === "place") raw.place = select.value || null;
          else raw[name] = select.value === "" ? null : select.value === "+";
        }
        return normalizeBundle(raw);
      };
      const refreshPreview = () => {
        const current = readBundle();
        const preview = root.querySelector("[data-feature-preview]");
        if (preview) preview.textContent = `[${describeBundle(current).join(" ")}]`;
        const derived = root.querySelector("[data-feature-derived]");
        if (derived) derived.innerHTML = derivedFeatureMarkup(current);
      };
      root.querySelector(".feature-editor")?.addEventListener("submit", (event) => event.preventDefault());
      root.querySelector(".feature-editor")?.addEventListener("change", refreshPreview);
      root.querySelector("[data-feature-cancel]")?.addEventListener("click", close);
      root.querySelector("[data-feature-save]")?.addEventListener("click", () => {
        const current = readBundle();
        ctx.language.featureOverrides = {
          ...(ctx.language.featureOverrides || {}),
          [soundKey(sound)]: current,
        };
        ctx.touch({ label: `Edit features for ${sound}` });
        ctx.refresh();
        close();
        toast(`Saved features for ${sound}.`, { type: "success" });
      });
      root.querySelector("[data-feature-remove]")?.addEventListener("click", () => {
        const next = { ...(ctx.language.featureOverrides || {}) };
        delete next[soundKey(sound)];
        ctx.language.featureOverrides = next;
        ctx.touch({ label: `Remove feature override for ${sound}` });
        ctx.refresh();
        close();
        toast(`Removed the feature override for ${sound}.`, { type: "success" });
      });
    },
  });
}

function bindFeaturePanel(container, ctx) {
  container.querySelectorAll("[data-feature-edit]").forEach((button) => {
    button.addEventListener("click", () => openFeatureEditor(ctx, button.dataset.featureEdit));
  });
  const missing = container.querySelector("[data-feature-define-missing]");
  if (missing) {
    missing.addEventListener("click", () => openFeatureEditor(ctx, missing.dataset.featureDefineMissing));
  }
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
          <p class="section-copy">Lay out contrastive sounds on a chart. Charts are independent per language; when you create a daughter, it starts with a copy of its ancestor’s chart. How those sounds combine into syllables is set in <a href="#/language/${encodeURIComponent(language.id)}/phonotactics">Phonotactics</a>.</p>
        </div>
        <div class="inventory-summary">
          <span><strong>${new Set(chartPhonemeList(consonants)).size}</strong> consonants</span>
          <span><strong>${new Set(chartPhonemeList(vowels)).size}</strong> vowels</span>
        </div>
      </section>
      ${chartPanel(ctx, consonants, "consonants", "Consonants", "Manner of articulation × place of articulation")}
      ${chartPanel(ctx, vowels, "vowels", "Vowels", "Height × backness, with rounding as subcolumns")}
      ${featurePanelMarkup(ctx)}
      ${allophonePanelMarkup(ctx)}
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
  bindFeaturePanel(container, ctx);
}
