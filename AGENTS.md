# AGENTS.md

## Project
Local-first web tool for documenting a constructed language family: vanilla-JS SPA + Python-stdlib server (`server.py`), no build step and no runtime npm or pip dependencies. All state lives in one git-friendly JSON file, `data/project.json`. The unit and server tests are plain Node scripts with no framework and no DOM; the UI smoke test uses Playwright.

## Commands
- Setup:     npm install                    # dev-only ESLint and Playwright; npx playwright install chromium on first UI run
- Test:      npm test                       # runs all three Node suites; each can also run directly:
             node tests/engine.test.mjs    # engine suite: rule compilation, features, phonotactics, stress, reconstruction, subgrouping, reports, analytics
             node tests/bulk.test.mjs      # word-list import/export parser (RFC 4180 CSV/TSV, JSON)
             node tests/server.test.mjs    # server API: JSON errors, gzip, revisions, Host check, headers; needs Python 3.10+; each exits non-zero on failure
- Lint:      npm run lint                   # ESLint over web/js and tests, Ruff over server.py; install Ruff with `python -m pip install ruff`
- UI test:   npm run test:ui                # Playwright smoke test; starts a throwaway server on 127.0.0.1:8876
- Typecheck: none
- Run:       python3 server.py --no-browser   # http://127.0.0.1:8765/ ; Python 3.10+; flags: --port 9000, --host 0.0.0.0 (trusted network only). ./start.sh / start.bat pass flags through

## Layout
- server.py            # local HTTP server + the only three API endpoints (GET/PUT /api/project, GET /api/health); saves atomically via data/project.json.tmp, accepts gzip request bodies
- web/index.html, web/css/styles.css   # app shell and the single stylesheet
- web/js/              # DOM-free engine ES modules importable from Node (model, notation, naturalclasses, features, categories, phonology, reconstruction, subgrouping, prosody, phonotactics, phonotacticsCheck, diff, correspondences, analytics, bulk, report, routes) plus UI modules (app, store, api, ui, search, autocomplete, keyboard)
- web/js/views/        # one render module per tab; views/language.js owns the tab bar
- tests/               # three Node suites in plain-assertion style that print "N passed, M failed"; engine.test.mjs covers every DOM-free module — not one test file per source module; server.test.mjs spawns server.py against a temp data directory; ui-server.mjs and ui/smoke.spec.mjs are the Playwright smoke test
- package.json, eslint.config.mjs, pyproject.toml, playwright.config.mjs   # dev-only tooling: npm scripts, ESLint, Ruff, Playwright
- .github/workflows/tests.yml   # CI: linters, all three Node suites, and the Playwright smoke test on every pull request and on main after merge
- data/project.json    # the complete project document (ships with the demo family). Not generated: ordinary app-edited data, pretty-printed for line-based diffs; the app rewrites it on every save

## Rules

### Code
- Match the style of neighboring code; no new runtime dependencies without asking — dependency-free is a design goal (the server is stdlib-only, and npm is dev-only for lint and UI tests). Keep `package-lock.json` in sync when dev tooling changes.
- Bug fix: write the failing regression test first, then fix it.
- New behavior ships with tests — extend tests/engine.test.mjs, or add tests/<name>.test.mjs in the same plain-assertion style and mention it in the README "Tests" section. UI behavior also belongs in the Playwright smoke test when practical.
- Keep new engine logic in DOM-free modules under web/js/ so Node tests can import it; DOM access and rendering stay in web/js/views/ and the UI modules.
- New persisted fields ship with defaults and migration in `ensureProject()` (model.js), saved through `ctx.touch()` so autosave fires; the JSON document is the boundary between UI and storage (README "Extending it" has the full recipe).

### Git
- One task = one branch; never commit to main.
- Push the branch to origin and open a pull request without asking, once all three Node suites, lint, and the UI smoke test pass locally.
- File a GitHub issue (`gh issue create`) for any bug you find outside the current task; if you also fix it, reference the issue in the pull request.
- Merge with `gh pr merge --squash --delete-branch`, and only when the pull request's CI run is green. Never merge red CI, never push to main directly, never force-push.
- Fix a red branch with a new commit on the same branch.
- Never `git add -A`; stage only files you intentionally changed.
- `BACKLOG.md` is a local planning file (gitignored): edit it freely, but never commit, stage, or push it.
- When the owner agrees a feature or fix should be added, record it in `BACKLOG.md` before starting work.
- One logical change per commit. Message: a capitalized imperative one-liner, e.g. "Add bulk parser tests and document the suite" or "Fix save conflicts, id collisions, and parsing edge cases" — no area prefix, no conventional commits. Read `git log` first and match its style.
- Changes to data/project.json picked up while testing the app go in their own "Update project data" commit, never mixed with code changes.

### Do not touch
- data/*.tmp, data/*.bak, __pycache__/, .venv/ (transient, gitignored)
- .codex/, .opencode/ and other deliberately untracked working files
- .gitignore and .gitattributes (owner-managed; .bat stays CRLF, everything else LF)
- Never hand-reformat or rewrite data/project.json; the server owns its formatting (2-space pretty JSON, atomic replace)

## Done means
- All three Node suites, lint, and the UI smoke test pass; paste the last lines of each Node suite (e.g. `425 passed, 0 failed`, `30 passed, 0 failed`) and the lint/UI result, do not summarize them.
- List every changed file with a one-line reason.
- Anything deleted or renamed is called out explicitly.

## Ask before
- Deleting code or data, changing public interfaces (the three HTTP endpoints, the project.json document schema), adding dependencies,
- anything the plan did not mention.
