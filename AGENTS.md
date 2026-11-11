# AGENTS.md

## Project
Local-first web tool for documenting a constructed language family: vanilla-JS SPA + Python-stdlib server (`server.py`), no build step and no runtime npm or pip dependencies. Project state lives in JSON files under `data/`: `data/example_project.json` is the tracked demo family (23 languages, 5,083 vocabulary entries, ~810 KB — don't read or print it whole), while personal projects are gitignored. Tests are plain Node scripts with no framework and no DOM.

## Commands
- Setup:     npm install                    # dev-only ESLint
             python -m pip install ruff      # Ruff, needed by npm run lint
- Test:      npm test                       # runs the suites listed in package.json; each can also run directly:
             node tests/engine.test.mjs    # engine: rules, features, phonotactics, stress, reconstruction, subgrouping, reports, analytics, sound laws, X-SAMPA, timeline
             node tests/bulk.test.mjs      # word-list import/export parser (RFC 4180 CSV/TSV, JSON)
             node tests/server.test.mjs    # server API: JSON errors, gzip, revisions, Host check, headers, project listing/selection; needs Python 3.10+; each exits non-zero on failure
- Lint:      npm run lint                   # ESLint over web/js and tests, Ruff over server.py
- Typecheck: none
- Run:       python server.py --no-browser  # Windows; use python3 on macOS/Linux; http://127.0.0.1:8765/ ; Python 3.10+; flags: --port 9000, --host 0.0.0.0 (trusted network only). ./start.sh / start.bat pass flags through

## Layout
- server.py            # local HTTP server + four API paths: GET /api/health, GET /api/projects, GET/PUT /api/project (?file=), PUT /api/projects/active; atomic 2-space JSON saves through a unique .<name>.<random>.tmp, gzip request bodies, X-Base-Revision concurrency, loopback Host check
- web/index.html, web/css/styles.css   # app shell and the single stylesheet
- web/js/              # DOM-free engine modules importable from Node plus UI modules; keep new engine logic DOM-free. README "Project layout" lists every module
- web/js/views/        # render modules for language tabs and family-level views; views/language.js owns the tab bar
- tests/               # plain-assertion Node suites that print "N passed, M failed"; engine.test.mjs covers the engine modules — not one test file per source module; server.test.mjs spawns server.py against a temp data directory
- package.json, eslint.config.mjs, pyproject.toml   # dev-only tooling: npm scripts, ESLint, Ruff
- .github/workflows/tests.yml   # CI: linters and every suite on Ubuntu and Windows (Node 24, Python 3.12) for every pull request and on main after merge
- data/example_project.json   # tracked demo family; every other data/*.json is a local, gitignored project. `data/.active-project` remembers the last opened file; the app rewrites project JSON on every save

## Rules

### Code
- Match the style of neighboring code; no new runtime dependencies without asking — dependency-free is a design goal (the server is stdlib-only, and npm is dev-only for lint). Keep `package-lock.json` in sync when dev tooling changes.
- Bug fix: write the failing regression test first, then fix it. Confirm the test fails against the parent commit before the fix.
- New behavior ships with tests. Extend `tests/engine.test.mjs`, or add `tests/<name>.test.mjs` in the same plain-assertion style; a new suite must also be added to `npm test` in `package.json` and to `.github/workflows/tests.yml`, and noted in README "Development".
- Keep new engine logic in DOM-free modules under `web/js/` so Node tests can import it; DOM access and rendering stay in `web/js/views/` and the UI modules. For UI changes, run the app and verify the affected flow; record the steps and result in the PR body.
- New persisted fields ship with defaults and migration in `ensureProject()` (model.js), saved through `ctx.touch()` so autosave fires; the JSON document is the boundary between UI and storage (README "Extending it" has the full recipe).
- Escape project/user text with `esc` before inserting it into HTML; preserve the server's loopback Host check, CSP, no-store, and X-Frame-Options headers.
- Update README for user-visible changes; update AGENTS.md when commands, layout, or test wiring change.

### Git
- One task = one branch with a short descriptive name; never commit to main.
- Push the branch to origin and open a pull request without asking, once `npm test` and `npm run lint` pass locally. Put the summary, test/lint results, manual UI verification (when relevant), and any issue link in the PR body.
- Open the pull request and stop. Code changes wait for `Review: approved` from a fresh-context reviewer and green CI on both jobs; docs-only changes may merge after green CI. Never merge your own code changes without that review.
- File a GitHub issue (`gh issue create`) for any bug you find outside the current task. If you also fix it, give that fix its own branch and pull request and reference the issue.
- Merge with `gh pr merge --squash --delete-branch`, only after the review gate and the pull request's CI run finishes green. Never merge pending or red CI, never push to main directly, never force-push.
- Fix a red branch with a new commit on the same branch.
- Never `git add -A`; stage only files you intentionally changed.
- `BACKLOG.md` is a local planning file (gitignored): edit it freely, but never commit, stage, or push it.
- When the owner approves a feature or fix, add a one-line `BACKLOG.md` entry (goal, acceptance criteria, issue link if any) before branching.
- One logical change per commit. Message: a capitalized imperative one-liner, e.g. "Add bulk parser tests and document the suite" or "Fix save conflicts, id collisions, and parsing edge cases" — no area prefix, no conventional commits. Read `git log` first and match its style.
- Changes to tracked project data (`data/example_project.json`) go in their own "Update project data" commit, never mixed with code changes. Never commit ignored personal project files or `data/.active-project`.

### Review
- Code changes need an independent review before merge. The author opens the PR and stops; a fresh-context reviewer agent or the owner reads the diff and the surrounding code. The author never reviews and merges their own code changes.
- Docs-only changes (Markdown, comments, BACKLOG) may self-merge after CI. CI configuration, scripts, tests, and source count as code.
- The reviewer starts from the PR diff and the checklist below, not from the author's summary. When no human reviewer is available, spawn a reviewer subagent with no prior task context; the author may post the reviewer's verdict as a PR comment.
- Sign-off is a PR comment that starts with `Review: approved`. If the reviewer finds a problem, they comment `Review: changes requested` with the reason; the author fixes it on the same branch and requests another review. GitHub blocks self-approval with one account, so the comment is the gate.
- Reviewer checklist:
  - Does the diff do what the PR says, and nothing unrelated?
  - Bug fix: is there a regression test that fails on the parent commit? Verify it; do not assume.
  - New behavior: are the new paths tested, including empty, missing, stale, and undo/autosave/project-switch states where relevant?
  - Were tests weakened, skipped, or made environment-dependent? If so, is the remaining assertion still meaningful?
  - UI: did the author run the app and verify the affected flow? Are the steps and result in the PR body?
  - Windows: will the change survive the Windows job (paths, locking, ports, process spawning, line endings)?
  - Escaping: is project/user text passed through `esc` before HTML insertion? Are the loopback Host check, CSP, no-store, and X-Frame-Options headers intact?
  - Persistence: are new fields defaulted and migrated in `ensureProject()` and saved through `ctx.touch()`?
  - Docs: is README updated for user-visible changes and AGENTS.md for command/layout/test-wiring changes? Are deletions and renames called out?
  - Verification: do `npm test` and `npm run lint` pass, and is the CI run green on both jobs?

### Do not touch
- data/*.tmp, data/*.bak, __pycache__/, .venv/ (transient, gitignored)
- .codex/, .opencode/ and other deliberately untracked working files — don't modify or commit them
- .gitignore and .gitattributes (owner-managed; .bat stays CRLF, everything else LF) — ask before changing
- Never hand-reformat or rewrite project JSON; the server owns its formatting (2-space pretty JSON, atomic replace). Only data/example_project.json is tracked.

## Done means
- `npm test` and `npm run lint` pass.
- Code changes have `Review: approved` from a fresh-context reviewer; docs-only changes may self-merge after CI.
- CI is green on Ubuntu and Windows and the PR is merged, or the work is explicitly handed off.
- Anything deleted or renamed is called out explicitly in the PR and final summary.

## Ask before
- Deleting code or data.
- Breaking changes to public interfaces: HTTP endpoints or the project document schema. Additive fields with defaults and migration in `ensureProject()` are allowed.
- Adding dependencies.
- Scope changes beyond the agreed task.
