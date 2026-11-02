import { ancestorsOf, uid } from "../model.js";
import { deriveForm } from "../phonology.js";
import { esc, icon, toast } from "../ui.js";

function parentFor(ctx) {
  return ancestorsOf(ctx.project, ctx.language.id).at(-1) || null;
}

function normalizeGloss(value) {
  return String(value || "").trim().toLowerCase();
}

function expectedFor(ctx, word, parent) {
  if (!parent) return null;
  const parentWord = parent.vocabulary.find(
    (candidate) => candidate.form.trim() && normalizeGloss(candidate.gloss) === normalizeGloss(word.gloss) && word.gloss.trim()
  );
  if (!parentWord) return null;
  return {
    parentWord,
    derived: deriveForm(parentWord.form, ctx.project, ctx.language.id, { directOnly: true }).text,
  };
}

function sameForm(a, b) {
  const normalize = (value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  return normalize(a) === normalize(b);
}

function checkCellMarkup(word, expected) {
  if (!expected) return `<span class="muted">—</span>`;
  if (!word.form.trim()) return `<span class="status-chip status-missing">${icon("info")}No form</span>`;
  if (sameForm(word.form, expected.derived)) {
    return `<span class="status-chip status-match" title="Matches the derived form">${icon("check")}Matches</span>`;
  }
  return `<span class="status-chip status-differs" title="Expected ${esc(expected.derived)}">${icon("warning")}Expected ${esc(expected.derived) || "∅"}</span>`;
}

function updateRowCheck(row, ctx, word, parent) {
  const cell = row.querySelector("[data-word-check]");
  if (!cell) return;
  cell.innerHTML = checkCellMarkup(word, expectedFor(ctx, word, parent));
}

export function renderVocabulary(container, ctx) {
  const { language } = ctx;
  const parent = parentFor(ctx);
  const hasParent = Boolean(parent);
  const words = language.vocabulary;
  let checks = 0;
  let matches = 0;
  if (parent) {
    for (const word of words) {
      const expected = expectedFor(ctx, word, parent);
      if (!expected) continue;
      checks += 1;
      if (word.form.trim() && sameForm(word.form, expected.derived)) matches += 1;
    }
  }

  const rows = words
    .map(
      (word) => `
        <tr data-word-id="${esc(word.id)}">
          <td class="word-gloss"><input class="table-input gloss-input" data-word-field="gloss" value="${esc(word.gloss)}" placeholder="meaning" autocomplete="off" aria-label="Gloss"></td>
          <td class="word-form"><input class="table-input ipa-input" data-word-field="form" value="${esc(word.form)}" placeholder="IPA form" autocomplete="off" spellcheck="false" aria-label="Word form"></td>
          ${hasParent ? `<td class="word-check" data-word-check>${checkCellMarkup(word, expectedFor(ctx, word, parent))}</td>` : ""}
          <td class="word-note"><input class="table-input" data-word-field="note" value="${esc(word.note)}" placeholder="optional note" autocomplete="off" aria-label="Word note"></td>
          <td class="row-actions"><button class="icon-button icon-button-small danger-hover" type="button" data-delete-word title="Delete word" aria-label="Delete word">${icon("trash")}</button></td>
        </tr>`
    )
    .join("");

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Lexicon</p>
          <h2>Vocabulary</h2>
          <p class="section-copy">A small working list in IPA. ${hasParent ? `Forms are compared with the output of this language’s rules applied to ${esc(parent.name)} words with the same gloss.` : "Add words here; daughter languages can use them to test inherited forms."}</p>
        </div>
        <div class="inventory-summary">
          <span><strong>${words.length}</strong> ${words.length === 1 ? "word" : "words"}</span>
          ${hasParent ? `<span><strong>${matches}/${checks}</strong> checks match</span>` : ""}
        </div>
      </section>

      <section class="panel lexicon-panel">
        <header class="panel-head">
          <div class="panel-title">
            <h2>${esc(language.name)} lexicon</h2>
            <p>${hasParent ? `Expected forms come from ${esc(parent.name)} via the ordered rules.` : "Root vocabulary is the starting point for descendant checks."}</p>
          </div>
          <button class="button button-primary button-small" type="button" data-add-word>${icon("plus")}Add word</button>
        </header>
        ${
          words.length
            ? `
              <div class="table-scroll">
                <table class="data-table word-table">
                  <thead>
                    <tr>
                      <th class="gloss-col">Gloss</th>
                      <th class="form-col">Form <span class="th-note">IPA</span></th>
                      ${hasParent ? `<th class="check-col">Inherited check</th>` : ""}
                      <th>Note</th>
                      <th class="row-actions-head"></th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
              <p class="table-foot">${hasParent ? "A dash means no word with that gloss exists in the ancestor. The check uses only this language’s direct sound changes." : "Add descendant languages to compare their forms against these roots."}</p>
            `
            : `
              <div class="lexicon-empty">
                <div class="empty-icon small">${icon("book")}</div>
                <h3>No words yet</h3>
                <p>Start with a handful of basic vocabulary items. They will become the test bed for sound changes.</p>
                <button class="button button-primary button-small" type="button" data-add-word>${icon("plus")}Add the first word</button>
              </div>`
        }
      </section>
    </div>
  `;

  const addWord = () => {
    const word = { id: uid("word"), gloss: "", form: "", note: "" };
    language.vocabulary.push(word);
    ctx.touch();
    ctx.refresh();
    window.setTimeout(() => {
      const row = document.querySelector(`[data-word-id="${word.id}"]`);
      row?.querySelector('[data-word-field="gloss"]')?.focus();
    }, 0);
  };
  container.querySelectorAll("[data-add-word]").forEach((button) => button.addEventListener("click", addWord));

  container.querySelectorAll("[data-word-id]").forEach((row) => {
    const word = language.vocabulary.find((entry) => entry.id === row.dataset.wordId);
    if (!word) return;
    row.querySelectorAll("[data-word-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.wordField;
        word[field] = input.value;
        ctx.touch();
        if (field === "gloss" || field === "form") updateRowCheck(row, ctx, word, parent);
      });
      if (input.dataset.wordField === "gloss") {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            row.querySelector('[data-word-field="form"]')?.focus();
          }
        });
      }
      if (input.dataset.wordField === "form") {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            row.querySelector('[data-word-field="note"]')?.focus();
          }
        });
      }
    });
    row.querySelector("[data-delete-word]")?.addEventListener("click", () => {
      const index = language.vocabulary.indexOf(word);
      if (index < 0) return;
      const [removed] = language.vocabulary.splice(index, 1);
      ctx.touch();
      ctx.refresh();
      toast("Word deleted.", {
        type: "info",
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            language.vocabulary.splice(index, 0, removed);
            ctx.touch();
            ctx.refresh();
          },
        },
      });
    });
  });
}
