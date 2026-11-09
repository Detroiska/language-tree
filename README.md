# Language Tree

A local-first web tool for documenting a constructed language family. It keeps the family tree, phoneme inventories, diachronic sound changes, synchronic allophony, and a small lexicon in one git-friendly JSON file per project.

The app is dependency-free: a small Python standard-library server serves a vanilla JavaScript frontend. No build step, package manager, or database is required to run it. Optional lint tooling (ESLint and Ruff) is installed separately; see **Development**.

## Run it

Requirements: Python 3.10 or newer.

```powershell
# Windows
.\start.bat

# or directly
python server.py
```

```sh
# macOS / Linux
./start.sh

# or directly
python3 server.py
```

The app opens at <http://127.0.0.1:8765/>. Use `--no-browser` to suppress the browser launch, or `--port 9000` to choose another port.

The repository ships with a demo family, `data/example_project.json`: a documented Classical Nahuatl root whose 221-word lexicon comes from the Wiktionary Classical Nahuatl lemmas, plus 22 speculative descendants in two branches (a Proto-Balto-Slavic-style branch and a Proto-Arabic-style branch) over three derived generations, ending in Lithuanian, Polish, Palestinian, Mahri and more. Every `.json` file directly under `data/` is a project: use the project switcher under the app title to list them and open one, and the server remembers that choice in the gitignored `data/.active-project`. Other project files, such as `data/personal_project.json`, are gitignored too, so personal families stay local; only `example_project.json` is tracked. Add a project by dropping its `.json` file into `data/` and picking it in the switcher.

## What is here

- **Editable family tree** — root languages and daughter languages, with add, rename, delete, and reparent actions.
- **Phonology charts** — separate consonant and vowel charts with editable rows and columns. Any row or column can be subdivided (aspiration, labialization, rounding, and so on). Charts list contrastive **phonemes**; derived surface allophones live in a separate table below them.
- **Distinctive features** — a curated IPA feature table for roughly 180 common symbols, plus per-language overrides for custom sounds. Features are read from the symbol itself, never from chart labels, and can be queried in rules, categories, templates, and forbidden sequences with `[+nasal]`, `[-voice]`, or `[+syllabic -round]`. α-notation copies feature values between segments, as in `n > [αplace] / _ [αplace]`.
- **Phonotactics** — a per-language syllable template, named sound categories (`N` nasals, `G` glides, and whatever else you define), chart classes derived live from the phonology tables (`plosive.plain`, `V.back`), feature bundles (`[+sonorant]`), plus optional allowed/forbidden onset and coda lists and forbidden-sequence constraints. Vocabulary forms are checked against the inventory and the template. The same syllabifier assigns per-language **stress** — none, initial, penult, antepenult, final, or weight-sensitive — which surface forms display as `ˈka.sa` and rule environments can test.
- **Sound changes** — standard-style notation such as `p > f / V _ V`, `[plosive.plain] > ∅ / _ #`, `[+nasal] > ∅ / _ #`, or `n > [αplace] / _ [αplace]`, with a live tester against ancestral forms that explains why a rule did not apply and offers a one-click fix for conflicting top-level rules. Morpheme cuts written `kat+ta` are presentation-level boundaries that rule environments can test (`t > d / + _`), so juncture-conditioned changes need no morphology engine. A rule can be marked **optional** with a descriptive **rate**: the primary derivation skips it, and a variant can force it back in. A **Reconstruction** panel inverts the same chain from a recorded daughter form, reporting mergers, inferred losses, and unchanged alternatives while ranking parent-lexicon matches first. A **Rule library** panel offers curated attested changes — Grimm's law, Verner's law, the High German shift, Slavic palatalization, Celtic lenition, Latin rhotacism — as one-click insertable groups that arrive disabled and labeled illustrative. Top-level rules apply together; dotted child rules run in sequence. These are **diachronic** rules: they derive each language’s phonemic form from its ancestor and feed the cognate chain.
- **Allophony** — **synchronic** surface rules such as `/p/ > [pʰ] / # _ V`, `p > pʰ / # _ V`, or `/s/ > [+voice] / V _ V`, applied in list order to this language’s phonemic forms. Rules can opt into **repeat-until-stable** application and a **word** or **syllable** environment domain, so vowel, nasal, and sibilant harmony can spread across intervening segments without looping forever. Rules can be **optional** the same way: skipped in the primary surface, testable as a variant. Inputs and environments accept the same categories, chart classes, and features as sound changes. A derived allophone table and a surface tester show the mapping; daughters inherit a copy of the rules as a starting grammar, but an ancestor’s allophony is never applied during historical derivation.
- **Phonemic / phonetic notation** — forms are stored as bare IPA and displayed as `/…/` when phonemic and `[…]` when surface. Pasting delimiters into word forms, chart cells, or bulk imports strips them safely; all comparison, search, and phonotactics stay level-agnostic. Surface notation also adds predicted stress (`ˈ`, `ˌ`) and syllable dots from the language’s phonotactics, and a `+` morpheme cut stays where a form puts it; these marks are presentation only and never become segments.
- **Basic vocabulary** — gloss + phonemic IPA form, with a live `[…]` surface preview when allophony or stress is defined, an inherited-form check that applies the current language's sound changes to the parent's words, and a phonotactic validity check on every form.
- **Cognate explorer** — follow any recorded gloss down the family: each daughter's chain-derived phonemic form next to its recorded form, with diverging segments highlighted in both, an optional surface column that includes stress and syllables, a one-click record action, and a whole-lexicon matrix view.
- **Sound correspondences** — the cognate explorer's all-glosses view tabulates per-position correspondences between a source language and its descendants: each source segment by word position, the dominant reflex in every daughter with counts, rare singleton reflexes marked as irregular, and inserted segments listed separately. Switch between recorded forms and chain-derived forms.
- **Subgrouping evidence** — a family-level report over every internal node with at least two daughters: branch innovations, changes shared by every daughter branch, changes shared by only some, and which rules are unique to the clade. Nodes are marked supported, weak, or unsupported so the stored tree can be checked against the stored sound changes.
- **Sound-change timeline** — every rule in the family, grouped by the relative stage recorded on its card, so the relative chronology of a branch's changes can be written down for the reader without touching derivations.
- **X-SAMPA copy actions** — any vocabulary row can be copied as pure-ASCII X-SAMPA for notes, diffs, and external tools, with round-trip conversion handled by a dependency-free module.
- **Lexicon analytics** — a per-language tab over the vocabulary and charts: phoneme frequency with bars, never-used and off-chart callouts, onset and coda tallies from the syllabifier, a consonant/vowel token ratio, voicing-pair and chart-gap symmetry checks, and an allophone-leakage detector for surface-only symbols recorded in phonemic forms.
- **Undo / redo** — `Ctrl+Z` / `Ctrl+Shift+Z` (or the buttons in the sidebar footer) undo and redo any edit — words, rules, charts, tree changes — with rapid typing merged into single steps and each step written back to the project file.
- **Quick search** — `Ctrl+K` jumps anywhere in the project: languages (including by lineage path), words by gloss, form, or note, sound changes by notation, allophony rules, plus the global views. Results highlight the hit.
- **Phoneme keyboard** — `Ctrl+Alt+K` (`Cmd+Option+K` on macOS), or the small keyboard button that appears beside a focused IPA field, opens a palette of insertable sounds. Word forms, Phonotactics category sounds, and testers show the current language's chart phonemes, the rule tester shows the parent's, rule fields add the lineage union plus syntax keys, and chart cells get a curated IPA reference.
- **Chart-class autocomplete** — typing in a sound-change or allophony rule field suggests the class references the lineage's charts actually support (`plosive.plain`, `V.back`), with member counts; ↑/↓/Enter or a click inserts the exact spelling at the caret, so a mistyped class cannot sneak in.
- **Bulk vocabulary import / export** — paste a TSV, CSV, space-aligned, or JSON word list into any language with a live preview and dedupe control; export the same list back to TSV (spreadsheets) or JSON (tools).
- **Family report & JSON backup** — download the whole family as a plain-text Markdown report or a self-contained HTML page (tree, inventories, phonotactics, sound changes, allophony, vocabulary, cognate sets), or snapshot the exact project document as JSON.
- **Selectable JSON projects** — any `.json` file under `data/`, pretty-printed for readable diffs. The sidebar switcher lists them and remembers the active file; the tracked `example_project.json` is the demo family, while personal projects stay gitignored.

## Using the app

### Phonemic and phonetic notation

The app separates the two levels in the interface, not in storage:

- **`/…/` is phonemic** — the contrastive lexical form. Inventories, phonotactics, sound changes, cognate comparison, and word storage all operate on this level.
- **`[…]` is phonetic** — the surface form produced by the current language’s allophony. It is always derived for display; there is no separate surface lexicon to maintain.
- Word forms and inventory cells are stored as **bare IPA** (`kasa`, not `/kasa/`). The `/…/` and `[…]` wrappers are added only when the app renders them. Pasting delimiters into a word form, chart cell, or bulk import strips them on the way in, so they cannot break tokenization or comparison.
- If a word is recorded directly (rather than derived by sound changes), the surface form is still computed by running the language’s allophony from that recorded phonemic form.
- **`+` marks a morpheme cut** — `kat+ta` stores the same segments as `katta`, but rule environments can test the juncture. It is a display layer, not a morphology engine: comparison, search, and phonotactics ignore it, while derivation, allophony, reconstruction, and syllable display carry it through. `#` remains the word edge.

### Family tree

The family tree is the home view. Each card is a language.

- Use **New root language** to begin a family.
- Hover a card and press **+** to create a daughter. Its inventory is copied from the parent; rules and words start empty.
- Click a card to open the language workspace.
- Use the **⋯** card menu for **Add sibling** (a language beside it, sharing its parent) and **Add ancestor** (a new language above it). Ancestor creation is how you build a family backwards in time: the new ancestor takes the descendant's chart as its starting point, then you strip it down. A root language can gain an ancestor this way, turning it into a daughter.
- Use the **⋯** card menu to rename or delete a branch. Deletion has an undo action in the toast.
- Change a language's ancestor in **Overview → Position in the tree**; **Add ancestor** and **Add sibling** buttons are also available there.

### Phonology

The consonant chart starts with place columns and manner rows. The vowel chart starts with height rows and front/central/back columns, each split into unrounded/rounded subcolumns. Charts are **phonemic**: list contrastive sounds here, not their surface variants. A derived **Allophones** table below the charts shows what the current allophony rules produce.

- Click a cell to type sounds. Separate multiple sounds with spaces or commas.
- Pasting `/p/` or `[pʰ]` into a cell stores the bare sound (`p`, `pʰ`); the level marks are presentation, not data.
- Use the **⋯** menu on any row or column header to rename it, add a sibling, add a subrow/subcolumn, reorder it, or delete it.
- When a leaf is subdivided, its existing sounds move into a new **Plain** subdivision so nothing disappears.
- Chart notes are free-form.

Below the charts, the **Distinctive features** panel lists every charted sound and allophone with its current bundle. The table shows whether a bundle comes from the curated IPA table, a language override, or a derived place feature (labial, coronal, dorsal, radical), and calls out symbols with no bundle yet.

- **Feature bundles are tri-state**: `+`, `−`, or not applicable. Place is categorical (`bilabial`, `alveolar`, `velar`, …); anterior and the place-derived features are recalculated when place changes.
- **Overrides are per language** and copied to daughters, siblings, and ancestors along with the rest of the grammar. Click **Define** or **Edit** on a row to open the structured editor; custom sounds such as `t͡s`, `kʰ`, or an invented click need an override before feature rules can see them.
- **Features come from IPA symbols, not chart labels.** Renaming a row never changes a bundle. A symbol the curated table does not know shows as **missing** until you define it.
- **Precedence inside brackets** is literal sound → category → chart class → feature bundle. That keeps existing `[back]` chart classes working; write `[+back]` to force the feature reading.
- An override that no longer matches a charted sound or allophone output is kept under **unused overrides** until you remove it, so renaming a sound does not silently discard your work.

### Phonotactics

The **Phonotactics** tab describes the shapes a syllable may take and the sequences a word may not contain. A new language starts with `(C)V(C)`; daughters inherit their parent's template, categories, constraints, and stress system, which you can then adjust.

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
| `N`, `G`, `L`, … | a sound category defined for this language |
| `p`, `t͡ʃ`, … | a literal sound (write `\N` to keep a literal after defining N) |
| `[ptk]` | one of the listed sounds |
| `[Nt]` | sets may mix literals and categories; `[^N]` matches anything else |
| `[+sonorant]` | a feature bundle, expanded to the charted sounds that carry those features |
| `plosive.plain`, `back`, `V.back` | a chart class derived from the phonology tables (see below) |
| `(C)` | an optional group |
| `(C|CC)` | optional alternatives inside a group |
| `C?V` | optional single slot |

**Categories** give the template more letters. Each language keeps its own list (name + members) in the Categories panel: `N` for nasals, `G` for glides, `L` for liquids, `T` for stops, `OBS` for whatever you want. Rules of thumb:

- Names are 1–6 capital letters; `C` and `V` are built in and cannot be redefined. `C` and `V` still match category members in their own slots, so subsets need no extra notation — in `NVC` the final `C` admits nasals.
- A category's sound list may also name `C`, `V`, a chart class (below), a feature bundle, or another category's letter, so classes compose: `S = N L G` or `S = [+sonorant]` collects all sonorants, `T = plosive.plain l` collects the plain stops plus l. Browse "Insert from the chart" to pull the sounds of a chart row without typing IPA.
- A shape needs at least one nucleus-capable slot: `V`, a literal vowel, or a category whose members are all vowels. Mixed sets (glides+vowels) can fill onset and coda slots but cannot carry the nucleus alone.
- Categories work in **forbidden sequences** too: `NN` bans adjacent nasals. Onset and coda lists (allowed or forbidden) stay literal.

**Chart classes** name a slice of the phonology table instead of listing sounds. Write the labels of the rows and columns, joined by dots — `plosive.plain` (the plain stops), `plosive.velar`, `dental-alveolar`, `V.back`, `V.back.short`, or just `back`. The classes are read from the charts on every render, so renaming a row or moving a sound updates every rule, template, and category that uses it.

- A sound belongs to a class when **every** listed label applies to it, on whichever axis (row or column) that label occurs in that chart. Labels present on both axes constrain both — that is why `plosive.plain` picks out p, t and k but not the aspirated pʰ/tʰ/kʰ or the prenasal m͜b/n͜d, and why `back` is exactly the back vowels {u, o, uː, oː}.
- `V.` / `C.` pin the reference to the vowel or consonant chart (`V.back`, `C.plosive.plain`). Without a pin, a class covers every chart that mentions the labels.
- A bare word counts as a class when it matches a chart label (case, spaces, slashes and dashes all fold: `Dental/Alveolar` ↔ `dental-alveolar`). Single letters stay phonemes; write `\X` to force a literal sound when a name collides with a label.
- A dotted class reference that names no label **fails loudly** ("No chart row or column is labelled …"). A bare word matching no label falls back to literal sounds; when that word is a three-letter-or-longer run that could be a mistyped class name (every letter a charted phoneme, mixing a vowel and a consonant), the rule gets an informational warning naming the letters it reads, so a typo cannot pass unnoticed — short sequences like diphthongs (`aw > oː`) stay quiet. Write the sounds with spaces (`b a c k`) or a leading backslash (`\back`) when the literal reading is intended. A chart class on the output side still expands to concrete sounds; a bracketed feature bundle is a delta instead (see below).
- Inside compact template runs the class comes after the leading atoms: `CV.back` is a consonant plus a back vowel, `T.velar` is a T sound followed by a velar sound.
- Classes work in sets and forbidden sequences too: `[back t]`, `[^back]`, `[plosive.plain]#` (bans a final plain stop), `[back][plosive.plain]` (a back vowel before a plain stop).

While typing in a sound-change or allophony rule field, a small **class autocomplete** lists the class references the current lineage's charts actually support, with their member counts; choose one with ↑/↓ and Enter, or click it, and it is inserted at the caret. The list opens only when the token being typed could plausibly be a class reference — two characters or more — and closes when nothing matches, so a single phoneme letter never opens it, and `Tab` keeps its usual focus behavior.

Constraints are optional lists:

- **Onsets** and **codas** each have an **Allowed** / **Forbidden** switch. An allowed list restricts the clusters the template permits; an empty allowed list allows everything. A forbidden list rejects the clusters listed; an empty forbidden list forbids nothing. Empty onsets or codas are always allowed, and the switch is per list, so allowed onsets can combine with forbidden codas. Switching keeps both lists, so you can flip back without retyping.
- **Forbidden sequences** match anywhere in the word. `VV` bans adjacent vowels, `CCC` bans three-consonant runs, `#CC` bans word-initial clusters, and `CC#` bans word-final clusters. `C`, `V`, categories, chart classes, feature bundles, `[ptk]`, literals, and `#` are supported; examples: `NN` (nasal+nasal), `[+nasal][+nasal]` (the same through features), `[plosive.plain]#` (final plain stop), `[back][plosive.plain]` (back vowel before a plain stop).

The template is expanded into a finite set of syllable shapes. Words are syllabified with the maximal onset principle, and every sound must be in the language's own chart. The **Try a form** panel validates an arbitrary word, while **Vocabulary check** lists every recorded form with its syllable break and any problems. The same check appears in the Vocabulary tab.

#### Stress

The **Stress** panel picks one system per language:

| System | Primary stress lands on |
| --- | --- |
| None | no stress mark (the default) |
| Initial | the first syllable |
| Penultimate | the second-to-last syllable |
| Antepenultimate | the third-to-last syllable |
| Final | the last syllable |
| Weight-sensitive | a heavy penult (coda, long nucleus, or diphthong); otherwise the antepenult, or the first syllable in a short word |

Stress is computed from the same maximal-onset syllabifier as the template; it is not stored in the token stream. Surface forms render it as `ˈ` before the stressed syllable and a dot between syllables, so `kasa` displays as `ˈka.sa` under initial stress. The **Mark stress in vocabulary** button writes the predicted mark into recorded forms when you want exports and external tools to keep it; the editor otherwise continues to derive stress live. Stress marks and dots are ignored by tokenization, comparison, derivation, and phonotactic checks.

The stress system and syllable boundaries are also available to rule environments (see **Sound changes**): `a > ə / ˈ _` changes the vowel of the stressed syllable, and `s > z / _ .` changes a coda but not an onset. Because the setting lives under phonotactics, new daughters inherit it along with the template.

### Sound changes

Rules form two tiers. A **top-level rule** (1, 2, 3, 4) is checked only against the language’s ancestral form — the form inherited from its parent. Top-level rules never see each other’s output, so their order does not change whether they apply. If two top-level rules change the same part of a form, the derivation stops and reports a conflict.

A rule’s **sequential children** (1.1, 1.2, …) run after the whole top-level pass, in order, against the changed form. Use them for genuine feeding or bleeding: rule 1 `p > f` can feed rule 1.1 `a > ə / f _`, which can feed 1.2 `t > s / ə _`. A top-level rule still only sees the ancestral form even after a sequential rule has changed it. Only one level of nesting is supported for now.

```text
1    p > f                 checked against the inherited form
1.1  a > ə / f _           runs after the top-level pass
1.2  t > s / ə _           runs after 1.1
2    k > x                 also checked against the inherited form
```

```text
p > f / V _ V       p becomes f between vowels
V > ∅ / _ #         word-final vowels are lost
∅ > ʔ / V _ V       a glottal stop is inserted between vowels
k > tʃ / _ i        k palatalizes before i
[td] > ∅ / _ #      word-final t or d is lost
[plosive.plain] > ∅ / _ #   word-final plain stops are lost
[+nasal] > ∅ / _ #  word-final nasals are lost through their features
N > ∅ / _ #         word-final members of the N category are lost
t > tʰ / _ back     t aspirates before a back vowel
C > ∅ / _ C         a consonant is lost before another consonant
t > [+voice] / V _ V    t voices between vowels (the result must be charted)
n > [αplace] / _ [αplace]  n takes the place of the following consonant
V > [αround] / [αround] _  rounding spreads from the preceding vowel
C V > V C           consonant-vowel pairs metathesize (ka > ak)
a i > i a           two vowels exchange
V > Vː / _ #        final vowels lengthen
V > ∅ / ˈ _         a vowel in the stressed syllable is lost
s > z / _ .          s voices at the end of a syllable
```

Supported notation:

| Piece | Meaning |
| --- | --- |
| `>` `→` `->` | input / output separator |
| `/` | starts an environment |
| `_` | position of the input inside the environment |
| `#` | word boundary |
| `+` | morpheme boundary, testable in the environment |
| `V` / `C` | any vowel / consonant in the charted ancestry |
| `[aeiou]` | set of sounds |
| `[^aeiou]` | negated set |
| `[plosive.plain]`, `back`, `V.back` | chart class — labels dotted together, read from the phonology tables |
| `[+nasal]`, `[-voice]`, `[+syllabic +round]` | feature bundle — exact signs; bare `[back]` stays a chart class |
| `[αplace]`, `[βvoice]` | α-variable — binds to the matching feature in the input or environment and copies it on output |
| echo (`V`, `C`, `N`, `plosive.velar` on the output side) | copies the matched input segment — the k-th echo of a kind pairs with the k-th input atom of that kind |
| `N`, `G`, `OBS`, … | category defined in Phonotactics — expands to its member sounds |
| `ˈ` / `ˌ` | primary / secondary stress on the following syllable, testable in the environment |
| `.` / `σ` | syllable boundary, testable in the environment |
| `∅` / `0` | deletion on the output side; insertion on the input side |

Stress, syllable, and morpheme atoms are environment-only; `+` is split off automatically, so both `t > d / + _` and `t > d / a+ _` work. A left-side `ˈ` tests the stress of the syllable that contains the target segment, which is what makes `V > ə / ˈ _` affect the stressed vowel rather than the segment immediately after a stress mark. A right-side `_ .` tests the boundary immediately after the target. `.` and `σ` mean the same thing. A `+` on either side tests a cut in the form: `t > d / + _` changes a morpheme-initial `t`, while `t > d / _ +` changes a morpheme-final one. `#` never matches `+`, so word-edge rules stay distinct. Use the Stress panel under **Phonotactics** to choose the language’s stress system; with `None`, only syllable-edge atoms match, and a stress atom in a rule produces a warning instead of failing silently.

Chart classes work on the input side and in environments, alone or inside a set: `[plosive.plain] > ∅ / _ #`, `t > tʰ / _ back`, `u > ∅ / [plosive.plain] _`. A class expands to the concrete sounds the charts currently list, so a renamed row immediately changes which sounds a rule touches. A broken class name is reported in the rule's status instead of silently matching nothing.

Feature bundles work wherever chart classes do: `[+nasal] > ∅ / _ #`, `s > ∅ / _ [+voice]`, `[+syllabic -back] > ∅ / _ #`. Bundle members are the charted sounds whose IPA-derived bundles satisfy every term, so a custom symbol needs a **Features** override first. Feature bundles are checked last inside brackets, after literal sounds, categories, and chart classes; that is why `[back]` keeps its chart meaning and `[+back]` forces the feature. Mixing a sound and a feature in one bracket (`[+nasal p]`) is an error rather than a guess.

A **feature output** is a change, not a symbol: `t > [+voice] / V _ V` voices the matched segment, and `[+nasal] > [-voice]` devoices nasals. In a **sound change**, the engine applies the signs as a delta to the segment's existing bundle, then looks for the charted sound with that exact bundle. If none exists, the rule fails loudly with the nearest charted candidates and the features that differ; it never invents an off-chart phoneme. Feature outputs must apply to exactly one matched segment. Multi-segment outputs use concrete sounds or the echoes described next.

An **echo output** copies what the input matched instead of spelling fixed sounds. A class word (`V`, `C`), a category (`N`, `OBS`), or a chart class (`plosive.velar`) on the right of `>` repeats the segment the input matched, pairing output echoes of a kind with input atoms of that kind in order (the k-th `V` echo carries the k-th matched vowel). This writes metathesis and exchange directly: `C V > V C` swaps every consonant-vowel pair (`ka` → `ak`, `pata` → `apat`), `a i > i a` exchanges two vowels (`tai` → `tia`), and `N V > V N` copies the matched nasal into its new place. A glued diacritic travels with each copy as one token, which is how lengthening and labialization are written: `V > Vː / _ #` gives `kasa` → `kasaː`, `V > Vʷ / _ u` gives `katau` → `kataʷu`. Input segments the output never echoes are deleted (`C V > C / _ #` gives `ta` → `t`). Matching stays left-to-right and non-overlapping, so metathesis does not re-feed its own output. A rule that echoes every matched segment back into its own place (`C V > C V`) is rejected as a no-op — write the specific sounds out (`k t > t k`) when only one exchange is intended. Echoes are also rejected in insertions (`∅ > V`) and when a class is echoed more often than the input matches it.

**α-notation** ties two segments together. A variable such as `α` or `β` binds to a feature value on a segment in the input or the environment, then copies it into the output: `n > [αplace] / _ [αplace]` produces `ŋ` before `k`, `ɲ` before `c`, and so on. A variable copies **one feature**, not the whole segment: `[αplace] > ∅ / _ [αplace]` deletes any homorganic pair, not only identical sounds, and `n > [αplace] / _ [αplace]` changes `n` even before a sound that merely shares its place. The same variable must have the same value everywhere it appears; a variable that is never bound is a compile error. An α-rule is **total**: if a trigger binds a value the target cannot realize — `h` (glottal) or `w` (labial-velar) are common surprises for place — the derivation stops with an error. Restrict the trigger with a set or category when that can happen, for example `n > [αplace] / _ [plosive.plain]`. Only one Greek letter prefixes a feature name (`αplace`, `βvoice`), and α-variables are not allowed in categories or phonotactic templates in this version.

Custom categories (`N` nasals, `G` glides, `OBS` obstruents, …) are the same named groups you define in the **Phonotactics** tab. They work on the input side and in environments, alone or in sets (`N > ∅ / _ #`, `a > e / _ N`, `[N s] > z`). The compiler reads the current language's category definitions and expands them against the charted ancestry, so a rule can still name an ancestral sound. In the output a category word works as an echo of the matched segment (above); otherwise outputs must be concrete sounds or a feature delta — an α-variable cannot stand on the right of `>` without brackets.

Top-level rules are applied together to the ancestral form. Within one rule, matching is left-to-right and non-overlapping; each rule runs exactly once per application and does not re-feed its own output. Sequential rules then run in order on the result, so they can see segments and environments created by earlier changes. A conflict between top-level rules is reported in the rule tester, the inherited check, and the cognate explorer. Disabling a top-level rule also disables its sequential children (marked **Parent disabled**).

Insertions are zero-width, so two top-level insertion rules at the same boundary do not conflict: both apply, in list order. A replacement at that boundary still conflicts with either insertion. Use a sequential child when one insertion must feed another rule.

The **Rule library** panel (Sound changes tab, beside the notation help) lists curated groups from real language history — Grimm's law, Verner's law, the High German consonant shift, the first Slavic palatalization, Insular Celtic lenition, and Latin rhotacism — each written in the notation above. **Insert** appends a group's rules to the current language as disabled drafts with notes `"<name> (illustrative): <description>"`, and a toast offers one-click undo; a group whose notations are all already present shows **Inserted** instead. The groups are illustrative, not universal: they assume PIE-style inventories, and every installed rule compiles against your language's charts and stays inert until enabled, so nothing applies before it is reviewed. The data lives in the DOM-free `web/js/soundlaws.js`, and the test suites verify every library rule compiles warning-free against a reference inventory plus spot-check the historical outputs.

The **Rule tester** applies the current language’s rules to a form from its immediate ancestor and shows the ancestral pass and every sequential step. Its output is **phonemic** (`/…/`); when the language has allophony or stress, a **Surface** line applies it to show `[…]` with stress marks and syllable dots. A rule that matches nothing says why in its step: the input matched no part of the form, or the left/right environment failed at every place the input itself did match. When two top-level rules conflict over the same part of the ancestral form, the tester offers **Make rule N sequential under rule M** — one click converts the later rule into a sequential child of the earlier one as a single undo step (offered only when that rule has no children of its own). The **Inherited vocabulary check** compares the derived output with the current language’s recorded glosses, shows the surface form alongside it, and can record the derived phonemic form; a **Differs** row highlights exactly which segments diverged on both sides, and an empty form shows as `∅`. Derivations with a rule error cannot be recorded.

Every sound-change rule can carry **lexical exceptions**: a comma-separated list of glosses the rule never applies to, edited under the rule card. Exceptions are keyed by gloss rather than form, so they keep working as a word changes from one generation to the next; matching is trimmed and case-insensitive, and the input suggests glosses from the lineage’s vocabulary. An exception skips that rule only — other rules still apply — and the derivation marks the rule as a lexical exception instead of reporting a failed match. The inherited check adds an **Exception** chip (its tooltip names the skipped rules) and counts excepted words in the summary, so a predicted form that looks irregular is explained without disabling the rule. The cognate explorer does the same for each cell. Reconstruction also respects the gloss: an excepted rule is not inverted for that word, and the panel notes which rules were skipped.

Any rule can also be marked **optional**. Optional rules document **variation** rather than a change everyone underwent — a mirrored merger, a lenition some dialects took, a sporadic loss. The primary derivation skips optional rules everywhere the baseline is meaningful: the tester's phonemic output, the inherited check, and the cognate chain all follow the mandatory path, so the checked forms stay reproducible. Each optional rule records a **rate** (0–100); it is purely descriptive documentation of how common the change is, never random, so the same input always produces the same derivation. To explore a variant, tick the rule in the tester's **Optional changes** list — the derivation reruns with that change forced in, in the right place in the chain. Semantics follow the rule tiers: an optional **top-level** rule controls its whole group (skipped, it takes its sequential children with it), while an optional **child** is skipped independently. The inherited check gains an **Include optional changes** toggle that runs the comparison with every optional rule on, and rows following the primary path are tagged **optional skipped** with the rule names. The cognate explorer offers the same picker for every optional rule on the chain (naming each rule's language, since ids are unique across the family), tags matrix cells where optional changes were skipped, and its trace explains each language's skipped list. Reconstruction treats optional changes as possibilities: it inverts each optional rule as if it applied and also keeps the analysis where it did not, and the panel notes which optional rules it considered.

Every rule can also carry a **stage** on its card: an integer the editor chooses as the rule's relative position in the language's history. Stages are documentation only, exactly like the rate — no derivation or tester reads them, allophony stays undated, and a rule without a stage is simply undated. The **Sound-change timeline** view (sidebar, below Subgrouping evidence) groups every rule in the family by that stage, ascending, with the undated rules listed separately and linked back to each language's Sound changes tab, so the relative chronology across daughter languages reads at a glance.

The **Reconstruction** panel runs the same rules backwards. Enter a recorded daughter form and it proposes the possible form(s) inherited from the immediate ancestor, written with the comparative-method asterisk (`*kasa`). Every candidate is checked by applying the rules forward again, so a form the rules cannot produce is reported instead of guessed. The unchanged form is kept as a candidate: a rule describes what happens when its input occurs, but an output segment can also have been inherited. For example, after `p > f`, `afa` reconstructs as both `*afa` (inherited) and `*apa` (from `p`); after `ŋ͡g > n͜d`, `n͜da` reconstructs as both `*n͜da` and `*ŋ͡ga`. Mergers likewise return the unchanged form plus every possible source (`[p t k] > ʔ` can yield `*ʔa`, `*pa`, `*ta`, and `*ka`). The parent's recorded lexicon is used as evidence when it has a word for the same gloss: a candidate that matches the parent's form for that gloss ranks first, then a candidate that matches any parent form, then the fewest rule applications. Choosing a vocabulary suggestion carries its gloss into the check, and the gloss is inferred automatically when the daughter records the form exactly once. Every exact alternative remains visible, so parent evidence guides the reading without hiding a rule-derived possibility. Feature changes invert through their feature bundle; insertions are removed again. Echo outputs invert through the forms their matched sources produce: after `p V > V p`, a recorded `ap` reconstructs as both `*ap` (inherited) and `*pa`; after `a i > i a`, `tia` reconstructs as both `*tia` and `*tai`; and after final lengthening `V > Vː / _ #`, `takaː` reconstructs as `*taka`. Deletions are genuinely underdetermined, so the helper restores the smallest amount of lost material that makes the rule apply and flags that alternative as inferred. Reconstruction works one generation at a time: run the result through the parent's own rules to reach the next ancestor.

Sound changes are strictly **diachronic**: an ancestor’s allophony is not part of the chain and is never applied while deriving a daughter. Allophony is edited in its own tab (below) and applies only to the language whose rules it belongs to.

Feature bundles are intentionally a lean layer: each feature is `+`, `−`, or not applicable, place is a single categorical value, and there are no feature geometries, multivalued features, or rules that rewrite several segments from one feature output. Feature changes are deltas on one matched segment (echo outputs copy and reorder matched segments instead). Sound changes resolve them only to sounds already present in the current generation’s chart; add the sound or an override rather than expecting an off-chart phoneme. Allophony is the exception: when the chart has no match, it may spell the result with the curated IPA table and its documented diacritics (see below). α-variables are not accepted in category definitions or phonotactic templates yet. An echo with a glued diacritic emits copies like the input wrote them plus the mark; with the long sound charted ahead of its base (`aː`, `a`) the surface form re-reads as one segment, so round-tripping is documented to be exact only for charted lengths.

Other limitations of the current engine: stress is one system per language with no lexical exceptions, feet, or iterative secondary stress; reconstruction inverts one generation at a time, uses the parent lexicon as evidence when available, but still lists every exact alternative and infers deleted material rather than recovering it — with optional rules it checks every combination of applied/unused optional changes up to four of them in one generation, then falls back to the none-applied and all-applied analyses. Optional rules describe variation, but nothing drives it: rates are documentation, and there is no conditioned, dialect-based, or random application. Lexical exceptions are available per sound-change and allophony rule, but not for stress placement or phonotactic constraints. That is deliberate for this first version; the parser is isolated in `web/js/phonology.js` so it can grow. Phonotactics deliberately uses a finite expansion of optional groups rather than full regex repetition, and checks phonemic lexical forms only; morpheme cuts are a presentation layer for rule environments, not a morphology module, and they do not trigger resyllabification, surface-only repair, or allomorphy. Allophony rules are ordered rewrite rules; by default each applies once to adjacent segments, with opt-in repeat-to-stable application and word/syllable environment domains for harmony. They do not model cyclicity or morphologically conditioned domains.

### Allophony

The **Allophony** tab is the synchronic surface layer, separate from the diachronic **Sound changes** tab. Rules map a phoneme to a surface allophone in a context:

```text
/p/ > [pʰ] / # _ V     p is aspirated word-initially
/t/ > [t͡s] / _ i      t becomes an affricate before i
/n/ > [ŋ] / _ k        n assimilates to a following k
/N/ > [ŋ] / _ k        every nasal in the N category does
∅ > [ʔ] / V _ V        a glottal stop is inserted between vowels
p > pʰ / # _ V         slashes and brackets are optional
/s/ > [+voice] / V _ V s voices between vowels (z is synthesized if not charted)
/n/ > [αplace] / _ [αplace]  n copies the following place
/V/ > [αround] / [αround] _  rounding spreads rightward
/a/ > [u] / u _        with Repeat + Domain “Across word”: rounding spreads through later vowels
```

Environments accept the same stress and syllable atoms as sound changes: `a > ə / ˈ _` affects the stressed vowel, `s > z / _ .` affects a coda, and `s > z / . _` affects an onset. Stress comes from the language’s Phonotactics setting, and syllable edges come from the same template.

- Rules run **in list order** by default: each rule applies exactly once to the output of the previous rule. Reorder them with the arrow buttons or disable one with its switch. A rule can opt into **Repeat until stable**, which re-applies it to its own output until a pass changes nothing. The **Limit** field caps that loop (default 12 passes); if the rule is still changing at the cap it stops there, the tester labels the step as runaway, and a warning explains how to narrow or bound it.
- Each rule also accepts **lexical exceptions**, a comma-separated list of glosses it is skipped for. They use the same gloss-keyed matching as sound changes, so an exception survives changes to the word’s form. The surface tester labels a skipped rule **lexical exception**, and the vocabulary preview, cognate explorer, and report all pass each word’s gloss so their surfaces agree with the inherited check.
- A rule can be marked **Optional** — e.g. languagewide `w` loss that some words took. The primary surface skips it, the derived **Allophones** table leaves it out, and the surface tester lists it under **Optional changes**; tick it to see the variant surface. Like sound changes, each optional rule carries a descriptive **Rate** (0–100) that documents how common it is without randomizing output.
- **Domain** controls what “next to” means in the environment. **Adjacent** is the default and requires touching segments. **Across word** lets each environment atom skip intervening segments anywhere in the word; **Within syllable** does the same but stops at the target’s syllable edges. This is what lets `/a/ > [u] / u _` spread rounding through `ukata` with **Across word**, while the same rule under **Within syllable** changes only vowels in the syllable that contains a `u`. Domains apply even without repeating, but they are designed for harmony rules.
- Inputs may be concrete sounds, `V` / `C`, chart classes, Phonotactics categories (`N`, `G`, …), feature bundles, or bracketed sets, using the same matcher as sound changes. Outputs are surface forms; an allophone does **not** need to appear on the phonology chart. The tokenizer learns the outputs (`kʰ`, `t͡s`, …) so they remain one segment.
- A bracketed output with signs is a **feature change**, not a surface symbol: `/s/ > [+voice] / V _ V` voices the matched segment and resolves the new bundle against the current chart first. If no charted sound matches, the allophony layer synthesizes a conservative surface symbol from the curated IPA table — an exact symbol such as `z` or `ŋ` when one exists, otherwise a base plus at most two documented diacritics, so `p > [+spread_glottis]` yields `pʰ` even when `pʰ` is not charted. The rule stops only when no safe spelling can be derived, and the surface test names the nearest charted candidates. The allophone table expands feature inputs such as `[+nasal]` into their charted members; α-variable targets show the written bundle because their result depends on context.
- **Groups** keep related rules together without changing how they run. Choose **Group rules**, tick the rules, then **Group selected**. The group takes the next top-level number and its rules become `2.1`, `2.2`, `2.3`; the following standalone rule continues at `3`. Only adjacent rules can be grouped, so the flattened order — and the output — never changes. A group header has an optional name, a collapse control, and a switch that turns off every rule inside while preserving each rule's own switch. **Add rule** in the header appends to the group; **Ungroup** removes the container and keeps the rules; the trash button deletes the group together with its rules. Groups are organizational only: the engine, the **Allophones** table, search, and reports all use the same flattened order and rule numbers.
- The **Allophones** table is derived from the active mandatory rules: phoneme, surface allophone, environment, and the rule number. It is a view of the rules, not separate data.
- The **Surface tester** runs the current language’s allophony on any phonemic form and shows both `/…/` and `[…]`, with numbered steps for changed rules; skipped optional rules are labelled and re-derivable there.
- A daughter starts with a **copy** of its parent’s allophony list, just as it starts with a copy of the inventory and phonotactics. Editing the copy does not change the parent. The copy is a starting grammar, not history: an ancestor’s allophony is never applied while deriving the daughter's phonemic forms.

### Vocabulary

The lexicon is intentionally small: gloss, phonemic IPA form, optional note. Forms are displayed as `/…/`; when the language has allophony or stress, a live `[…]` surface preview appears under each form, with predicted stress and syllable dots. Pasting `/kasa/` or `[kʰasa]` stores the bare form (`kasa`, `kʰasa`). The **Phonotactics** column reports whether the form uses charted sounds and fits the syllable template; hover the chip or look under the form for the first problem. For a daughter language, the **Inherited check** column shows whether a form matches the output of the direct sound changes applied to the parent's word with the same gloss. A dash means that gloss is not in the ancestor's list.

Each row carries a **Copy X-SAMPA** action: the form is converted to pure-ASCII X-SAMPA (the standard Wells mapping, with tie-barred affricates written `k_x`, stress `"`, length `:`) and placed on the clipboard, so it can be pasted into notes, diffs, or external tools without depending on Unicode support there. The toast shows the converted text. This is a one-way export convenience — do not type X-SAMPA into the form field, and keep sound-change rules in the project's notation (`V`, `C`, `_`, `#` mean other things in X-SAMPA, so rule strings cannot survive conversion). The conversion module is DOM-free (`web/js/xsampa.js`) and round-trips the whole curated IPA table; characters with no documented X-SAMPA encoding pass through unchanged.

### Cognate explorer

The **Cognate explorer** follows one recorded word down the whole family. Open it from the sidebar, or press the trace button on any vocabulary row.

- **Pick a source language**, then either trace a single gloss or browse **all glosses** as a matrix with one chip per descended language.
- Each chip compares the recorded form with the output of that language's **chain of rules**: every language applies its own staged rules to what it receives from the ancestor, starting strictly below the source. A language's own rules never re-apply to its recorded forms. Each stage is compiled with that generation's own charts and categories, so redefining `N` in a daughter does not change what an ancestor's `N > ∅ / _ #` meant.
- Status chips reuse the vocabulary conventions: **Matches** agrees with the derivation, **Differs** has a recorded form that does not (the tooltip shows what the rules predict), and a dash means the gloss is not recorded in that language. A **Rule error** chip means a rule on the chain fails to compile.
- Derived and recorded columns are **phonemic** (`/…/`). When a language has allophony, an extra **Surface** column shows its `[…]` form. Surface forms are applied after the historical chain and never feed it.
- A **Differs** status aligns the two forms per segment and highlights the diverging sounds on both sides; an empty side shows `∅`.
- Below the matrix, **Sound correspondences** aggregates those alignments into a comparative table. A row is a source segment in a word position (`p` initial, `a` medial, …), and each descendant column shows the dominant reflex with its count, followed by less frequent variants. A singleton variant that contrasts with a dominant reflex is highlighted in gold and listed under **Irregular correspondences** with its gloss and expected reflex; inserted segments are listed separately. **Recorded** uses the lexicon, while **Derived** replays the rule chains and fills glosses that were never recorded.
- The correspondence table is a live computation, not stored data. Alignment is a minimal edit-distance pass with a word-edge bias, so it is an aid to inspection rather than a claim about the underlying sound law; complex metathesis may still need the trace view.
- Expand a row with the chevron to see the derivation step by step. **Record** (or **Use derived**) writes the derived phonemic form into that language's lexicon when a reflex is correct.
- Comparison is by gloss only: the first entry with the same gloss (case-insensitive) is used, matching the inherited check. Languages outside the source's line of descent are not compared.

### Subgrouping evidence

The **Subgrouping evidence** view tests the shape of the family tree against the sound changes already stored in it. Open it from the sidebar or with `Ctrl+K`. Every internal node with at least two daughters is treated as a subgrouping claim and gets a panel:

- **Branch innovations** are the changes recorded on the branch leading to that node. They apply to the whole clade below it.
- **Shared across all branches** lists rules that occur on every daughter branch — the classic shared-innovation test.
- **Shared by some branches** lists rules present on more than one daughter branch but not all. These support a smaller subgroup, not the node itself.
- A rule is marked **unique** when the same normalized notation does not occur anywhere outside the clade. Rule notation is normalized for comparison (`→` and `->` count as `>`, and runs of whitespace collapse), and disabled rules are ignored.
- A node is **Supported** when at least one branch or all-branch innovation is unique to its clade, **Weak** when such changes exist but every one of them also occurs outside, and **Unsupported** when the branch records no change and no change is shared by all daughters. The warning explains which case applies; **Open branch** jumps to the node's Sound changes tab.

The report is derived live from the rules — nothing extra is stored. It deliberately checks the tree against sound changes only; cognate sets and lexical evidence are not folded into the support score.

### Sound-change timeline

The **Sound-change timeline** view (sidebar, below Subgrouping evidence) reads the **stage** field from every sound-change rule in the family and groups them for the reader: one panel per stage, ascending, each rule listed under its own language with a link to that language's Sound changes tab; rules without a stage land in an **Undated** panel. Stage numbers are integers the editor chooses — relative positions, not calendar dates — and they are documentation only: derivations, the tester, and subgrouping all ignore them, so adding or changing a stage can never alter a stored form. Library-inserted drafts carry no stage until you set one.

### Quick search

Press `Ctrl+K` (`Cmd+K` on macOS), or use **Quick search** in the sidebar, to jump anywhere in the project:

- Search covers **languages** (name and lineage path — typing an ancestor finds its daughters), **words** (gloss, IPA form, note), **sound changes** (notation and note), **allophony rules** (notation and note), plus the family tree, cognate explorer, and subgrouping evidence as direct actions. Pasting `/…/` or `[…]` into the search box is accepted; the delimiters are stripped before matching.
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

- **Markdown report** (`{project}-report.md`) — GitHub-flavored plain text: a box-drawing tree sketch, one section per language (consonant and vowel charts as tables, feature overrides, phonotactics, sound changes with a *(disabled)* marker, allophony and derived allophones, the full vocabulary), and a closing **cognate sets** matrix that groups words sharing a gloss across the family.
- **HTML report** (`{project}-report.html`) — the same content as a self-contained styled page. No external assets, so it opens anywhere and prints nicely; a table of contents links to each language.
- **JSON backup** (`{project}-backup-YYYY-MM-DD.json`) — the exact project document, a round-trippable snapshot of the active file in `data/`.

The report writes lexical forms as `/…/` and surface examples as `[…]`, including predicted stress and syllable dots when the language defines them. The cognate matrix matches glosses case-insensitively and keeps the first recorded form per gloss — the same conventions as the vocabulary tables. Reports list recorded forms, not derived ones; watching the rules produce reflexes is the cognate explorer's job.

## Data and git

Everything is saved to the active project file in `data/` automatically after a short debounce. Switching projects flushes pending changes and stores the new filename in `data/.active-project`, so the next launch reopens it. The file is deliberately human-readable and stable enough for line-based diffs. Each language keeps its diachronic `soundChanges` and its ordered synchronic `allophony` list as separate arrays, and word/chart forms are stored as bare IPA. Rules can also carry `optional: true` and a descriptive integer `rate` (0–100) for variation; the engine treats an unset flag as mandatory and the load-time normalization clamps the rate. The allophony array holds rule objects and optional one-level group containers (`{ "type": "group", "name", "collapsed", "enabled", "rules": [...] }`); groups are flattened in display order whenever rules are applied or counted.

Each language also keeps `featureOverrides`, keyed by normalized IPA symbol. An override stores a complete bundle (`place` as a string or `null`, every other feature as `true`, `false`, or `null`); sounds without an override fall back to the curated table in `web/js/features.js`. Overrides are copied when a daughter, sibling, or ancestor is created, and they travel with the language in the JSON backup.

The repository ignores every `data/*.json` project except `data/example_project.json`, so personal families are not committed by accident. If you do want to version one intentionally, force-add it by name:

```powershell
git add -f data/my_family.json
git commit -m "Document Old Coastal sound changes"
```

The server writes atomically (`.json.tmp` then replace), so an interrupted save does not leave a half-written project. For projects kept outside git, the JSON backup download is a portable snapshot; copy the file aside before risky edits if you want another safety net.


## Development

The app itself has no runtime dependencies. Optional linting uses npm for ESLint and Ruff for Python:

```sh
npm install       # ESLint
npm test          # engine, bulk, and server suites
npm run lint      # ESLint over web/js and tests, Ruff over server.py
```

`npm test` runs the three plain-Node suites; each can also be run directly. The server suite also needs Python 3.10+ because it launches a temporary copy of `server.py`:

```sh
node tests/engine.test.mjs
node tests/bulk.test.mjs
node tests/server.test.mjs
```

The engine suite covers rule compilation and application, chart-derived classes, the IPA feature table and per-language overrides, the IPA-table collision audit, feature queries, feature deltas and α-notation, feature bundles in categories and phonotactics, echo outputs (literal exchange, class metathesis, category and chart-class echoes, glued lengthening and labialization, echo-with-deletion, allophony surfaces and phoneme-table inhibition, and their compile-time rejections), the attested sound-change library (every shipped rule compiles warning-free against a reference inventory, draft shapes and ids, and historical spot checks), the X-SAMPA converter (curated-table round trips with the documented foldings, digraph and underscore binding precedence, whole-form survival, and passthrough behavior), the stage migration and family timeline grouping (integer normalization, on-load stage fields, ascending stages with stored order, and the undated bucket), the tokenizer (including tie-bar affricates), inert-rule warnings, phonotactic constraints, stress placement and display across all systems, weight-sensitive heavy syllables (including macron nuclei), stress- and syllable-conditioned rules, morpheme-cut tokenization/display and cut-conditioned sound changes and allophony (including insertion and deletion at a cut), cut-preserving reconstruction, reconstruction of unchanged, one-to-one, merger, insertion, deletion, feature, sequential, and parallel alternatives, parent-lexicon evidence and gloss normalization, per-rule lexical exceptions (gloss normalization, case and whitespace matching, sequential and lineage application, exception step markers, allophony skips including iterative rules, reconstruction skips, and migration defaults), optional sound changes and allophony (migration defaults and rate clamping, primary-path skips, forced variants, optional top-level groups and independent children, rule listings, the primary allophone table, and reconstruction across skipped/applied combinations), subgrouping support/weak/unsupported classification, notation delimiter stripping, allophony parsing/order/surface forms, chained allophony feeding, iterative allophony with pass limits and runaway warnings, word- and syllable-bounded harmony, feature allophones and off-chart surface synthesis, rule groups and dotted numbering, non-charted allophone tokenization, allophony inheritance without historical leakage, project migration (including id normalization for languages, rules, and words), the Markdown/HTML report builders, plus segment-level diff alignment, correspondence alignment and tabulation (recorded vs. derived, irregular singletons, insertions), rule-inertness explanations and top-level conflict detection, the lexicon analytics computations, and the class-autocomplete query/ranking policy. The bulk suite covers the word-list parser: RFC 4180 quoting (delimiters, doubled quotes, and line breaks inside quoted fields), headers in both column orders, delimiter detection, the JSON fast path and its table fallback, and the add/update/skip duplicate modes. The server suite starts an isolated copy of `server.py` on an ephemeral port and covers JSON error envelopes for unsupported methods, empty and oversized request bodies, gzip round trips and truncation, revision conflicts, concurrent reads and writes, the loopback Host check, and the framing/cache/CSP headers.

`npm run lint` runs ESLint over `web/js` and `tests` and Ruff over `server.py` (install Ruff with `pip install ruff` if it is not already on `PATH`). CI runs the linters and all three Node suites on every pull request and on `main`.

## Project layout

```text
language-tree/
├─ server.py               # local HTTP server + JSON API
├─ start.bat               # Windows launcher
├─ start.sh                # macOS / Linux launcher
├─ package.json            # dev-only test and lint scripts
├─ eslint.config.mjs       # ESLint configuration
├─ pyproject.toml          # Ruff configuration
├─ data/
│  ├─ example_project.json # tracked demo project (Classical Nahuatl family)
│  ├─ personal_project.json # ignored local project (not in a fresh clone)
│  └─ .active-project      # ignored pointer to the last opened project
├─ tests/
│  ├─ engine.test.mjs
│  ├─ bulk.test.mjs
│  └─ server.test.mjs
└─ web/
   ├─ index.html
   ├─ css/styles.css
   └─ js/
      ├─ app.js            # boot, routing, sidebar
      ├─ store.js          # load, autosave, save status
      ├─ api.js
      ├─ model.js          # data model, defaults, tree/chart helpers
      ├─ routes.js         # hash decoding and language links
      ├─ notation.js       # /…/ and […] display helpers; strips level marks
      ├─ naturalclasses.js # chart-derived natural classes (plosive.plain, V.back)
      ├─ categories.js     # custom sound categories (N, G, OBS, …)
      ├─ features.js       # IPA feature table, overrides, bundles, α-notation
      ├─ phonology.js      # sound-change parser, allophony engine, derivation
      ├─ reconstruction.js # reverse rule application, inherited alternatives, ambiguity
      ├─ subgrouping.js    # shared-innovation evidence for internal tree nodes
      ├─ timeline.js       # stages grouped across the family for the timeline view
      ├─ prosody.js        # stress placement, syllabification display, stress marks
      ├─ phonotactics.js   # syllable template parser and word checker
      ├─ phonotacticsCheck.js # per-render checker and stress-marking helper
      ├─ diff.js           # minimal segment alignment for comparing forms
      ├─ correspondences.js # per-position correspondences for the cognate explorer
      ├─ analytics.js      # lexicon/inventory analytics computations
      ├─ search.js         # Ctrl+K quick search palette
      ├─ autocomplete.js   # chart-class autocomplete for rule fields
      ├─ keyboard.js       # phoneme keyboard palette for IPA fields
      ├─ languageActions.js # add/rename language actions shared by tree and tabs
      ├─ derivation.js     # shared derivation-step renderer
      ├─ ruleEditor.js     # shared sound-change and allophony editor pieces
      ├─ soundlaws.js      # attested sound-change library
      ├─ escape.js         # HTML escaping for DOM-free builders
      ├─ gloss.js          # gloss normalization shared by lexicon and reports
      ├─ bulk.js           # vocabulary import/export parsing and writers
      ├─ xsampa.js         # X-SAMPA <-> IPA conversion for stored forms
      ├─ report.js         # Markdown/HTML family report builders
      ├─ reportUi.js       # browser-only report downloads and menu
      ├─ ui.js             # icons, modals, menus, toasts
      └─ views/
         ├─ tree.js
         ├─ language.js
         ├─ inventory.js
         ├─ phonotactics.js
         ├─ soundchanges.js
         ├─ allophony.js
         ├─ vocabulary.js
         ├─ analytics.js
         ├─ cognates.js
         ├─ subgrouping.js
         └─ timeline.js
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

## License

MIT — see [LICENSE](LICENSE).
