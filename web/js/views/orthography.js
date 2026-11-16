import { uid } from "../model.js";
import { fromOrthography, hasOrthography, toOrthography } from "../orthography.js";
import { esc, icon, toast } from "../ui.js";

// Per-language orthography editor: an ordered phoneme <-> grapheme table and a
// two-way tester. Conversion is DOM-free (orthography.js); this view only
// renders and edits the table, with tester text remembered per language.

const testerState = new Map();

function stateFor(language) {
  if (!testerState.has(language.id)) testerState.set(language.id, { phonemic: "", orthographic: "" });
  return testerState.get(language.id);
}

function pairRows(pairs) {
  return pairs
    .map(
      (pair) => `
        <tr data-ortho-id="${esc(pair.id)}">
          <td class="ortho-phonemes"><code class="ipa"><input class="table-input ipa-input" data-ortho-field="phonemes" value="${esc(pair.phonemes)}" aria-label="Phonemes" autocomplete="off" spellcheck="false"></code></td>
          <td class="ortho-arrow" aria-hidden="true">↔</td>
          <td class="ortho-graph"><input class="table-input" data-ortho-field="graph" value="${esc(pair.graph)}" aria-label="Grapheme" autocomplete="off" spellcheck="false"></td>
          <td class="ortho-note"><input class="table-input" data-ortho-field="note" value="${esc(pair.note ?? "")}" placeholder="optional note" aria-label="Pair note" autocomplete="off"></td>
          <td class="row-actions"><button class="icon-button icon-button-small danger-hover" type="button" data-ortho-remove title="Remove pair" aria-label="Remove pair">${icon("trash")}</button></td>
        </tr>`
    )
    .join("");
}

export function renderOrthography(container, ctx) {
  const { language } = ctx;
  const table = language.orthography || { pairs: [] };
  const pairs = Array.isArray(table.pairs) ? table.pairs : [];
  const state = stateFor(language);
  const enabled = hasOrthography(table);

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Writing system</p>
          <h2>Orthography</h2>
          <p class="section-copy">Map phonemes to the graphemes your language actually uses. Conversion is longest-match: unpaired sounds pass through unchanged, so a partial table is fine. This spelling layer never feeds sound changes, phonotactics, or cognates.</p>
        </div>
        <div class="inventory-summary"><span><strong>${pairs.length}</strong> ${pairs.length === 1 ? "pair" : "pairs"}</span></div>
      </section>

      <section class="panel ortho-panel">
        <header class="panel-head">
          <div class="panel-title">
            <h2>${esc(language.name)} graphemes</h2>
            <p>Write several phonemes in one cell for digraphs and affricates. Order does not matter: the longest matching pair always wins.</p>
          </div>
          <button class="button button-primary button-small" type="button" data-ortho-add>${icon("plus")}Add pair</button>
        </header>
        ${
          pairs.length
            ? `<div class="table-scroll ortho-scroll"><table class="data-table ortho-table">
                <thead><tr><th>Phonemes</th><th></th><th>Grapheme</th><th>Note</th><th class="row-actions-head"></th></tr></thead>
                <tbody>${pairRows(pairs)}</tbody>
              </table></div>`
            : `<div class="ortho-empty">
                <div class="empty-icon small">${icon("keyboard")}</div>
                <h3>No graphemes yet</h3>
                <p>Add a pair such as <code>ʃ</code> → <code>sh</code>, then test it below or read your lexicon in its own spelling.</p>
              </div>`
        }
      </section>

      <section class="panel ortho-panel">
        <header class="panel-head">
          <div class="panel-title">
            <h2>Test conversion</h2>
            <p>${enabled ? "Type on either side to convert in that direction." : "Add at least one pair to see conversion here."}</p>
          </div>
        </header>
        <div class="panel-body ortho-tester">
          <label class="ortho-test-field">
            <span>Phonemic form</span>
            <textarea class="input ipa-input" data-ortho-phonemic rows="1" wrap="off" placeholder="e.g. ʃaka" spellcheck="false" aria-label="Phonemic form">${esc(state.phonemic)}</textarea>
            <span class="ortho-test-result">Written: <code class="ipa" data-ortho-written>${esc(enabled ? toOrthography(state.phonemic, table) : "—")}</code></span>
          </label>
          <label class="ortho-test-field">
            <span>Orthographic form</span>
            <textarea class="input" data-ortho-orthographic rows="1" wrap="off" placeholder="e.g. shaka" spellcheck="false" aria-label="Orthographic form">${esc(state.orthographic)}</textarea>
            <span class="ortho-test-result">Spoken: <code class="ipa" data-ortho-spoken>${esc(enabled ? fromOrthography(state.orthographic, table) : "—")}</code></span>
          </label>
        </div>
      </section>
    </div>`;

  const addButton = container.querySelector("[data-ortho-add]");
  addButton?.addEventListener("click", () => {
    const pair = { id: uid("graph"), phonemes: "", graph: "", note: "" };
    pairs.push(pair);
    language.orthography = { ...table, pairs };
    ctx.touch({ label: "Add grapheme pair" });
    ctx.refresh();
    window.setTimeout(() => {
      const row = document.querySelector(`[data-ortho-id="${CSS.escape(pair.id)}"]`);
      row?.querySelector('[data-ortho-field="phonemes"]')?.focus();
    }, 0);
  });

  container.querySelectorAll("[data-ortho-id]").forEach((row) => {
    const pair = pairs.find((entry) => entry.id === row.dataset.orthoId);
    if (!pair) return;
    row.querySelectorAll("[data-ortho-field]").forEach((input) => {
      input.addEventListener("input", () => {
        pair[input.dataset.orthoField] = input.value;
        language.orthography = { ...table, pairs };
        ctx.touch({ label: "Edit grapheme pair", coalesceKey: pair.id });
        if (input.dataset.orthoField === "phonemes" || input.dataset.orthoField === "graph") {
          refreshTester(container, table, state);
        }
      });
      input.addEventListener("blur", () => {
        const trimmed = input.value.trim();
        if (trimmed !== input.value) {
          input.value = trimmed;
          pair[input.dataset.orthoField] = trimmed;
          ctx.touch({ label: "Edit grapheme pair", coalesceKey: pair.id });
          refreshTester(container, table, state);
        }
      });
    });
    row.querySelector("[data-ortho-remove]")?.addEventListener("click", () => {
      const index = pairs.indexOf(pair);
      if (index < 0) return;
      pairs.splice(index, 1);
      language.orthography = { ...table, pairs };
      ctx.touch({ label: "Remove grapheme pair" });
      ctx.refresh();
      toast("Grapheme pair removed.", { type: "info" });
    });
  });

  const phonemicInput = container.querySelector("[data-ortho-phonemic]");
  const orthographicInput = container.querySelector("[data-ortho-orthographic]");
  phonemicInput?.addEventListener("input", () => {
    state.phonemic = phonemicInput.value;
    refreshTester(container, table, state);
  });
  orthographicInput?.addEventListener("input", () => {
    state.orthographic = orthographicInput.value;
    refreshTester(container, table, state);
  });
}

function refreshTester(container, table, state) {
  const written = container.querySelector("[data-ortho-written]");
  if (written) written.textContent = hasOrthography(table) ? toOrthography(state.phonemic, table) || "—" : "—";
  const spoken = container.querySelector("[data-ortho-spoken]");
  if (spoken) spoken.textContent = hasOrthography(table) ? fromOrthography(state.orthographic, table) || "—" : "—";
}
