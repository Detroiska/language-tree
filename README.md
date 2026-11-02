# Language Tree

A local-first web tool for documenting a constructed language family. It keeps the family tree, phoneme inventories, ordered sound changes, and a small lexicon in one git-friendly JSON file.

The app is dependency-free: a small Python standard-library server serves a vanilla JavaScript frontend. No build step, package manager, or database is required.

## Run it

Requirements: Python 3.10 or newer.

```powershell
# Windows
.\start.bat

# or directly
python server.py
```

The app opens at <http://127.0.0.1:8765/>. Use `--no-browser` to suppress the browser launch, or `--port 9000` to choose another port.

## What is here

- **Editable family tree** — root languages and daughter languages, with add, rename, delete, and reparent actions.
- **Phonology charts** — separate consonant and vowel charts with editable rows and columns. Any row or column can be subdivided (aspiration, labialization, rounding, and so on).
- **Phonotactics** — a per-language syllable template plus optional onset, coda, and forbidden-sequence constraints. Vocabulary forms are checked against the inventory and the template.
- **Ordered sound changes** — standard-style notation such as `p > f / V _ V`, with a live tester against ancestral forms.
- **Basic vocabulary** — gloss + IPA form, with an inherited-form check that applies the current language's rules to the parent's words and a phonotactic validity check on every form.
- **Cognate explorer** — follow any recorded gloss down the family: each daughter's chain-derived form next to its recorded form, with a one-click record action and a whole-lexicon matrix view.
- **Undo / redo** — `Ctrl+Z` / `Ctrl+Shift+Z` (or the buttons in the sidebar footer) undo and redo any edit — words, rules, charts, tree changes — with rapid typing merged into single steps and each step written back to the project file.
- **Quick search** — `Ctrl+K` jumps anywhere in the project: languages (including by lineage path), words by gloss, form, or note, sound changes by notation, plus the two global views. Results highlight the hit.
- **Bulk vocabulary import / export** — paste a TSV, CSV, space-aligned, or JSON word list into any language with a live preview and dedupe control; export the same list back to TSV (spreadsheets) or JSON (tools).
- **Family report & JSON backup** — download the whole family as a plain-text Markdown report or a self-contained HTML page (tree, inventories, phonotactics, rules, vocabulary, cognate sets), or snapshot the exact project document as JSON.
- **Single JSON project** — `data/project.json`, pretty-printed for readable diffs and git history.

## Using the app

### Family tree

The family tree is the home view. Each card is a language.

- Use **New root language** to begin a family.
- Hover a card and press **+** to create a daughter. Its inventory is copied from the parent; rules and words start empty.
- Click a card to open the language workspace.
- Use the **⋯** card menu for **Add sibling** (a language beside it, sharing its parent) and **Add ancestor** (a new language above it). Ancestor creation is how you build a family backwards in time: the new ancestor takes the descendant's chart as its starting point, then you strip it down. A root language can gain an ancestor this way, turning it into a daughter.
- Use the **⋯** card menu to rename or delete a branch. Deletion has an undo action in the toast.
- Change a language's ancestor in **Overview → Position in the tree**; **Add ancestor** and **Add sibling** buttons are also available there.

### Phonology

The consonant chart starts with place columns and manner rows. The vowel chart starts with height rows and front/central/back columns, each split into unrounded/rounded subcolumns.

- Click a cell to type sounds. Separate multiple sounds with spaces or commas.
- Use the **⋯** menu on any row or column header to rename it, add a sibling, add a subrow/subcolumn, reorder it, or delete it.
- When a leaf is subdivided, its existing sounds move into a new **Plain** subdivision so nothing disappears.
- Chart notes are free-form.

### Phonotactics

The **Phonotactics** tab describes the shapes a syllable may take and the sequences a word may not contain. A new language starts with `(C)V(C)`; daughters inherit their parent's template, which you can then adjust.

```text
(C)V(C)        optional onset, vowel, optional coda
(C)(C)V(C)     allows an onset cluster
CV(C)          requires an onset
(C)V(V)(C)     allows a diphthong or vowel sequence in the nucleus
```

Template syntax:

| Piece | Meaning |
| --- | --- |
| `C` / `V` | any charted consonant / vowel |
| `p`, `t͡ʃ`, … | a literal sound |
| `[ptk]` | one of the listed sounds |
| `(C)` | an optional group |
| `(C|CC)` | optional alternatives inside a group |
| `C?V` | optional single slot |

Constraints are optional lists:

- **Allowed onsets** and **allowed codas** restrict the clusters the template permits. Leaving a list empty allows everything; an empty onset or coda is always allowed.
- **Forbidden sequences** match anywhere in the word. `VV` bans adjacent vowels, `CCC` bans three-consonant runs, `#CC` bans word-initial clusters, and `CC#` bans word-final clusters. `C`, `V`, `[ptk]`, literals, and `#` are supported.

The template is expanded into a finite set of syllable shapes. Words are syllabified with the maximal onset principle, and every sound must be in the language's own chart. The **Try a form** panel validates an arbitrary word, while **Vocabulary check** lists every recorded form with its syllable break and any problems. The same check appears in the Vocabulary tab.

### Sound changes

Rules are listed in application order and run top to bottom.

```text
p > f / V _ V       p becomes f between vowels
V > ∅ / _ #         word-final vowels are lost
k > tʃ / _ i        k palatalizes before i
[td] > ∅ / _ #      word-final t or d is lost
C > ∅ / _ C         a consonant is lost before another consonant
```

Supported notation:

| Piece | Meaning |
| --- | --- |
| `>` `→` `->` | input / output separator |
| `/` | starts an environment |
| `_` | position of the input inside the environment |
| `#` | word boundary |
| `V` / `C` | any vowel / consonant in the charted ancestry |
| `[aeiou]` | set of sounds |
| `[^aeiou]` | negated set |
| `∅` / `0` | deletion |

Rules are applied in order. Within a rule, matching is left-to-right and non-overlapping. Each rule runs exactly once per application; it does not re-feed its own output.

The **Rule tester** applies the current language's direct rules to a form from its immediate ancestor and shows each step. The **Inherited vocabulary check** compares the derived output with the current language's recorded glosses. **Record** creates a vocabulary entry from a derived form.

Limitations of the current engine: no feature bundles, stress, syllable-boundary notation, optional elements, phonological exceptions, or allomorphy. That is deliberate for this first version; the parser is isolated in `web/js/phonology.js` so it can grow. Phonotactics deliberately uses a finite expansion of optional groups rather than full regex repetition, and checks surface forms only; it does not yet model resyllabification across morpheme boundaries or lexical exceptions.

### Vocabulary

The lexicon is intentionally small: gloss, IPA form, optional note. The **Phonotactics** column reports whether the form uses charted sounds and fits the syllable template; hover the chip or look under the form for the first problem. For a daughter language, the **Inherited check** column shows whether a form matches the output of the direct sound changes applied to the parent's word with the same gloss. A dash means that gloss is not in the ancestor's list.

### Cognate explorer

The **Cognate explorer** follows one recorded word down the whole family. Open it from the sidebar, or press the trace button on any vocabulary row.

- **Pick a source language**, then either trace a single gloss or browse **all glosses** as a matrix with one chip per descended language.
- Each chip compares the recorded form with the output of that language's **chain of rules**: every language applies its own ordered rules to what it receives from the ancestor, starting strictly below the source. A language's own rules never re-apply to its recorded forms.
- Status chips reuse the vocabulary conventions: **Matches** agrees with the derivation, **Differs** has a recorded form that does not (the tooltip shows what the rules predict), and a dash means the gloss is not recorded in that language. A **Rule error** chip means a rule on the chain fails to compile.
- Expand a row with the chevron to see the derivation step by step. **Record** (or **Use derived**) writes the derived form into that language's lexicon when a reflex is correct.
- Comparison is by gloss only: the first entry with the same gloss (case-insensitive) is used, matching the inherited check. Languages outside the source's line of descent are not compared.

### Quick search

Press `Ctrl+K` (`Cmd+K` on macOS), or use **Quick search** in the sidebar, to jump anywhere in the project:

- Search covers **languages** (name and lineage path — typing an ancestor finds its daughters), **words** (gloss, IPA form, note), and **sound changes** (notation and note), plus the family tree and cognate explorer as direct actions.
- `↑`/`↓` move through results, `Enter` opens the first match, `Esc` closes. Each result jumps to the right tab and briefly highlights the word, rule, or title it leads to.
- Empty states are handled: with no query the palette lists every language as a jump target, and a query with no matches says so. The palette never opens on top of a dialog, and `Ctrl+K` closes it again while it is open.

### Bulk import & export

Open **Import / export** in a language's vocabulary tab to move word lists in and out without retyping:

- **Import** accepts one gloss per line with columns `gloss → IPA form → note`, separated by tabs, semicolons, or commas (aligned whitespace works too), or a JSON array of `{gloss, form, note}`. A "gloss" header row is detected and skipped.
- The **preview** classifies every row live: *Add* (new), *Update* (a word with the matching gloss exists), *Keep* (duplicates ignored — switch modes with the radio buttons), or *Invalid* (no gloss). An entire import lands in the project as **one undo step**.
- Rows without a form import fine; they stay visible as drafts, and the phonotactics column simply reports "no form".
- **Export** writes the lexicon back as **TSV** (spreadsheet-friendly, with tabs inside notes collapsed to spaces) or **JSON** (exact strings), either as a clipboard copy or a `name-vocabulary.tsv/.json` file download.

### Family report & JSON backup

On the family tree header, **Report / backup** opens a menu with three downloads, all generated from the project exactly as it is on screen (including unsaved changes):

- **Markdown report** (`{project}-report.md`) — GitHub-flavored plain text: a box-drawing tree sketch, one section per language (consonant and vowel charts as tables, phonotactics, sound changes with a *(disabled)* marker, the full vocabulary), and a closing **cognate sets** matrix that groups words sharing a gloss across the family.
- **HTML report** (`{project}-report.html`) — the same content as a self-contained styled page. No external assets, so it opens anywhere and prints nicely; a table of contents links to each language.
- **JSON backup** (`{project}-backup-YYYY-MM-DD.json`) — the exact project document, a round-trippable snapshot of `data/project.json`.

The cognate matrix matches glosses case-insensitively and keeps the first recorded form per gloss — the same conventions as the vocabulary tables. Reports list recorded forms, not derived ones; watching the rules produce reflexes is the cognate explorer's job.

## Data and git

Everything is saved to `data/project.json` automatically after a short debounce. The file is deliberately human-readable and stable enough for line-based diffs.

```powershell
# Recommended documentation checkpoint
git add data/project.json
git commit -m "Document Old Coastal sound changes"
```

The server writes atomically (`.json.tmp` then replace), so an interrupted save does not leave a half-written project. Git is the safety net; commit whenever a language or branch reaches a useful state.

## Project layout

```text
language-tree/
├─ server.py               # local HTTP server + JSON API
├─ start.bat               # Windows launcher
├─ data/
│  └─ project.json         # the complete project document
└─ web/
   ├─ index.html
   ├─ css/styles.css
   └─ js/
      ├─ app.js            # boot, routing, sidebar
      ├─ store.js          # load, autosave, save status
      ├─ api.js
      ├─ model.js          # data model, defaults, tree/chart helpers
      ├─ phonology.js      # rule parser and derivation engine
      ├─ phonotactics.js   # syllable template parser and word checker
      ├─ search.js         # Ctrl+K quick search palette
      ├─ bulk.js           # vocabulary import/export parsing and writers
      ├─ report.js         # Markdown/HTML family report + JSON backup
      ├─ ui.js             # icons, modals, menus, toasts
      └─ views/
         ├─ tree.js
         ├─ language.js
         ├─ inventory.js
         ├─ phonotactics.js
         ├─ soundchanges.js
         ├─ vocabulary.js
         └─ cognates.js
```

### Extending it

The JSON document is the boundary between the UI and storage. To add a new documentation section:

1. Add a tab in `web/js/views/language.js`.
2. Add a new render module under `web/js/views/`.
3. Extend `ensureProject()` in `model.js` with defaults/migration for the new fields.
4. Add a way to edit/save through `ctx.touch()`; the whole document autosaves.
5. Add styles under `web/css/styles.css`.

The ledger of language IDs and tree links is kept as a simple adjacency list (`parentId` on each language), so future features such as cognate sets, sound laws shared across branches, or export to LaTeX can build on the same document without a schema rewrite.

## API

The local server exposes only three endpoints:

- `GET /api/project` — read the complete project.
- `PUT /api/project` — validate and atomically replace the complete project.
- `GET /api/health` — return a small liveness response.

It binds to `127.0.0.1` by default. Set `--host 0.0.0.0` only on a trusted network; there is no authentication layer.
