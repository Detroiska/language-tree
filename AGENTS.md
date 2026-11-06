# AGENTS.md

## Project
Local-first web tool for documenting a constructed language family: vanilla-JS SPA + Python-stdlib server (`server.py`), no build step, no npm or pip dependencies. All state lives in one git-friendly JSON file, `data/project.json`. Tests are plain Node scripts, no framework and no DOM.

## Commands
- Test:      node tests/engine.test.mjs   # engine suite: rule compilation, features, phonotactics, stress, reconstruction, subgrouping, reports, analytics
             node tests/bulk.test.mjs     # word-list import/export parser (RFC 4180 CSV/TSV, JSON); run both — each exits non-zero on failure
- Lint:      none
- Typecheck: none
- Run:       python3 server.py --no-browser   # http://127.0.0.1:8765/ ; Python 3.10+; flags: --port 9000, --host 0.0.0.0 (trusted network only). ./start.sh / start.bat pass flags through

## Layout
- server.py            # local HTTP server + the only three API endpoints (GET/PUT /api/project, GET /api/health); saves atomically via data/project.json.tmp, accepts gzip request bodies
- web/index.html, web/css/styles.css   # app shell and the single stylesheet
- web/js/              # DOM-free engine ES modules importable from Node (model, notation, naturalclasses, features, categories, phonology, reconstruction, subgrouping, prosody, phonotactics, phonotacticsCheck, diff, correspondences, analytics, bulk, report, routes) plus UI modules (app, store, api, ui, search, autocomplete, keyboard)
- web/js/views/        # one render module per tab; views/language.js owns the tab bar
- tests/               # two suites in plain-assertion style that print "N passed, M failed"; engine.test.mjs covers every DOM-free module — not one test file per source module
- .github/workflows/tests.yml   # CI: runs both suites on every pull request and on main after merge
- data/project.json    # the complete project document (ships with the demo family). Not generated: ordinary app-edited data, pretty-printed for line-based diffs; the app rewrites it on every save

## Rules

### Code
- Match the style of neighboring code; no new dependencies without asking — dependency-free is a design goal (there is no package.json, and the server is stdlib-only).
- Bug fix: write the failing regression test first, then fix it.
- New behavior ships with tests — extend tests/engine.test.mjs, or add tests/<name>.test.mjs in the same plain-assertion style and mention it in the README "Tests" section.
- Keep new engine logic in DOM-free modules under web/js/ so Node tests can import it; DOM access and rendering stay in web/js/views/ and the UI modules.
- New persisted fields ship with defaults and migration in `ensureProject()` (model.js), saved through `ctx.touch()` so autosave fires; the JSON document is the boundary between UI and storage (README "Extending it" has the full recipe).

### Git
- One task = one branch; never commit to main.
- Push the branch to origin and open a pull request without asking, once both suites pass locally.
- Merge with `gh pr merge --squash --delete-branch`, and only when the pull request's CI run is green. Never merge red CI, never push to main directly, never force-push.
- Fix a red branch with a new commit on the same branch.
- Never `git add -A`; stage only files you intentionally changed.
- One logical change per commit. Message: a capitalized imperative one-liner, e.g. "Add bulk parser tests and document the suite" or "Fix save conflicts, id collisions, and parsing edge cases" — no area prefix, no conventional commits. Read `git log` first and match its style.
- Changes to data/project.json picked up while testing the app go in their own "Update project data" commit, never mixed with code changes.

### Do not touch
- data/*.tmp, data/*.bak, __pycache__/, .venv/ (transient, gitignored)
- BACKLOG.md, .codex/, .opencode/ (deliberately untracked)
- .gitignore and .gitattributes (owner-managed; .bat stays CRLF, everything else LF)
- Never hand-reformat or rewrite data/project.json; the server owns its formatting (2-space pretty JSON, atomic replace)

## Done means
- Both test commands pass; paste the last lines of each (e.g. `425 passed, 0 failed`, `30 passed, 0 failed`), do not summarize them.
- List every changed file with a one-line reason.
- Anything deleted or renamed is called out explicitly.

## Ask before
- Deleting code or data, changing public interfaces (the three HTTP endpoints, the project.json document schema), adding dependencies,
- anything the plan did not mention.
