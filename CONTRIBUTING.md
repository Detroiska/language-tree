# Contributing

Language Tree is a local-first tool for documenting a constructed language family. The app itself has no runtime dependencies: a Python standard-library server serves a vanilla JavaScript frontend, and all state lives in `data/project.json`.

## Development setup

Requirements:

- Python 3.10 or newer
- Node.js 22.13 or newer (CI uses Node 24)
- npm, for the optional development tooling only

```sh
npm install
npx playwright install chromium   # first UI test run only
python3 server.py --no-browser    # http://127.0.0.1:8765/
```

`npm install` adds ESLint and Playwright as dev dependencies. Ruff is installed separately and must be on `PATH` for the Python lint step:

```sh
python -m pip install ruff
```

## Tests and lint

```sh
npm test          # engine, bulk, and server suites
npm run lint      # ESLint over web/js and tests, Ruff over server.py
npm run test:ui   # Playwright UI smoke test
```

The three Node suites can also be run directly:

```sh
node tests/engine.test.mjs
node tests/bulk.test.mjs
node tests/server.test.mjs
```

The engine suite covers every DOM-free module. The server suite starts a temporary copy of `server.py` on an ephemeral port, and the UI smoke test serves a throwaway copy of the app on `127.0.0.1:8876`; neither touches the tracked `data/project.json`.

## Project conventions

- Keep engine logic in DOM-free ES modules under `web/js/` so the Node suites can import it. DOM access and rendering belong in `web/js/views/` and the UI modules.
- Match the style of neighboring code. There is no build step and no runtime package manager; new runtime dependencies are out of scope unless the owner agrees.
- Bug fixes start with a failing regression test. New behavior ships with tests, either in `tests/engine.test.mjs` or in a new `tests/<name>.test.mjs` in the same plain-assertion style.
- New persisted fields need defaults and migration in `ensureProject()` (`web/js/model.js`), and edits must save through `ctx.touch()` so autosave fires. The JSON document is the boundary between the UI and storage.
- Do not hand-format `data/project.json`; the server owns its formatting. Data changes that come from testing the app belong in their own commit, separate from code changes.

## Pull requests

- Work on a branch, never directly on `main`.
- Keep one logical change per commit. Messages are capitalized imperative one-liners, such as `Add bulk parser tests and document the suite`; no area prefixes or conventional-commit tags.
- Before opening a pull request, run `npm test`, `npm run lint`, and `npm run test:ui`.
- Push the branch and open the pull request. Merge is squash-only, and only after CI is green.
- File an issue for a bug outside the scope of the current change. If you fix it too, reference the issue in the pull request.

## License

Language Tree is released under the MIT License. By contributing, you agree that your changes are provided under the same license.
