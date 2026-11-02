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
- **Ordered sound changes** — standard-style notation such as `p > f / V _ V`, with a live tester against ancestral forms.
- **Basic vocabulary** — gloss + IPA form, with an inherited-form check that applies the current language's rules to the parent's words.
- **Single JSON project** — `data/project.json`, pretty-printed for readable diffs and git history.

## Using the app

### Family tree

The family tree is the home view. Each card is a language.

- Use **New root language** to begin a family.
- Hover a card and press **+** to create a daughter. Its inventory is copied from the parent; rules and words start empty.
- Click a card to open the language workspace.
- Use the **⋯** card menu to rename or delete a branch. Deletion has an undo action in the toast.
- Change a language's ancestor in **Overview → Position in the tree**.

### Phonology

The consonant chart starts with place columns and manner rows. The vowel chart starts with height rows and front/central/back columns, each split into unrounded/rounded subcolumns.

- Click a cell to type sounds. Separate multiple sounds with spaces or commas.
- Use the **⋯** menu on any row or column header to rename it, add a sibling, add a subrow/subcolumn, reorder it, or delete it.
- When a leaf is subdivided, its existing sounds move into a new **Plain** subdivision so nothing disappears.
- Chart notes are free-form.

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

Limitations of the current engine: no feature bundles, stress, syllable-boundary notation, optional elements, phonological exceptions, or allomorphy. That is deliberate for this first version; the parser is isolated in `web/js/phonology.js` so it can grow.

### Vocabulary

The lexicon is intentionally small: gloss, IPA form, optional note. For a daughter language, the **Inherited check** column shows whether a form matches the output of the direct sound changes applied to the parent's word with the same gloss. A dash means that gloss is not in the ancestor's list.

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
      ├─ ui.js             # icons, modals, menus, toasts
      └─ views/
         ├─ tree.js
         ├─ language.js
         ├─ inventory.js
         ├─ soundchanges.js
         └─ vocabulary.js
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

The local server exposes only two endpoints:

- `GET /api/project` — read the complete project.
- `PUT /api/project` — validate and atomically replace the complete project.

It binds to `127.0.0.1` by default. Set `--host 0.0.0.0` only on a trusted network; there is no authentication layer.
