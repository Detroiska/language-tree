# Changelog

Notable changes to Language Tree. The project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-06

First public release.

### Added

- Editable family tree with root, daughter, sibling, and ancestor creation, renaming, reparenting, and branch deletion with undo.
- Consonant and vowel charts with editable rows, columns, subdivisions, chart notes, and derived allophone tables.
- IPA-derived distinctive features with per-language overrides, feature bundles, feature deltas, and α-notation in rules and phonotactics.
- Phonotactic templates, custom sound categories, chart classes, allowed/forbidden onset and coda lists, forbidden sequences, syllabification, and six stress systems.
- Diachronic sound changes with sequential children, top-level conflict detection, a live tester, lexical exceptions, optional rules with descriptive rates, and documentation-only stages.
- A curated rule library of attested changes, available as disabled illustrative drafts.
- One-generation reconstruction with parent-lexicon evidence and explicit alternatives for mergers, insertions, deletions, and echo outputs.
- Synchronic allophony with ordered rules, groups, repeat-until-stable application, word/syllable domains, optional rules, and off-chart surface synthesis.
- Vocabulary editing with surface previews, inherited-form checks, phonotactic validation, and X-SAMPA copy actions.
- Bulk vocabulary import and export for TSV, CSV, aligned text, and JSON.
- Cognate explorer with chain derivation, segment-level diffs, sound-correspondence tables, and one-click recording.
- Subgrouping evidence reports and a family-wide sound-change timeline.
- Markdown and self-contained HTML family reports, plus JSON project backups.
- Quick search and a phoneme keyboard with chart-class autocomplete for rule fields.
- A single human-readable `data/project.json` document with autosave, undo/redo, and atomic server writes.

### Tooling

- Plain-Node engine, bulk, and server test suites.
- ESLint and Ruff linting.
- A Playwright smoke test that boots the app, adds a language, edits a rule, and verifies the save through the API.
- CI runs the linters, all three Node suites, and the UI smoke test on every pull request and on `main`.
- A Content Security Policy on all server responses.
