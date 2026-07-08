# Modern Jenkins Notifier

A Manifest V3 browser extension (Chrome + Firefox) that polls Jenkins jobs/views and shows desktop
notifications and a toolbar badge on build status changes.

## Commands

Install deps first: `npm install` (no lockfile-only install exists; `node_modules` is not checked in).

- Run all tests: `npm test` (jest)
- Run a single test file: `npx jest test/services.test.js`
- Run a single test by name: `npx jest test/services.test.js -t "test name substring"`
- Watch mode: `npm run test:watch`
- Coverage: `npm run test:coverage`
- Suite-specific scripts also exist: `npm run test:ui` (popup.test.js), `npm run test:services`,
  `npm run test:browser`, `npm run test:performance` (runs `--runInBand`), `npm run test:all`
  (`--runInBand --verbose`)
- Build distributable zips for both browsers: `./build.sh` — produces `dist/chrome.zip` and
  `dist/firefox.xpi` from `manifest.json`/html, patching browser-specific differences with `sed`.
  There is no separate lint step.

## Architecture

The extension has four entry points loaded by `manifest.json`, all consuming the shared,
dependency-free service layer in `js/services.js`:

- `js/background.js` — MV3 service worker (`background.service_worker`, `type: module`). Owns the
  polling loop, toolbar badge/title updates, `chrome.alarms` (1-minute periodic refresh),
  notification-click handling, and the `addBuildPage` message handler used when a user adds a job
  from a Jenkins page via keyboard shortcut.
- `js/content.js` — injected into Jenkins job pages (`*://*/*/job/*`) both declaratively (manifest
  `content_scripts`) and imperatively (`chrome.scripting.executeScript` from background.js on tab
  update/activate). Listens for a configurable keyboard shortcut (default Shift+J) to message the
  background script and add the current job/build page to monitoring.
- `js/popup.js` — renders the toolbar popup (job list, add-job form) using `<template>` elements
  from `popup.html`.
- `js/options.js` — renders `options.html` (refresh interval, notification mode, shortcut config).

`js/services.js` reimplements a minimal AngularJS-style DI/runtime from scratch (this predates the
MV3 rewrite and the pattern is preserved intentionally):
- `_` — a small lodash-like `forEach`/`clone` utility.
- `$q` — a thin Promise wrapper (`defer`, `when`, `all`) mimicking Angular's `$q`.
- `$rootScope` — a global pub/sub event bus (`$broadcast`/`$on`); events are named like
  `'Options::options.changed'` and `'Jobs::jobs.initialized' | 'Jobs::jobs.changed'`.
- `Storage` — promisified wrapper over `chrome.storage.local`.
- `Notification` — promisified wrapper over `chrome.notifications.create`.
- `jenkins(url)` — fetches a Jenkins job/view/folder via `api/json/`; for folders/views it also
  fetches `cc.xml` (CCTray format) to resolve last build numbers of sub-jobs, since the JSON API
  alone doesn't expose that for folder children. XML parsing has two code paths: `DOMParser` in
  page contexts, and a regex-based fallback because `DOMParser` is unavailable in the MV3 service
  worker context.
- `Jobs` — in-memory `jobs` map (keyed by job URL) persisted to `chrome.storage.local`, with
  `add`/`remove`/`setUrls`/`updateStatus`/`updateAllStatus`. Each job's default shape includes an
  optional `customName` (user-set override of the Jenkins-derived `name`, set from the Options
  page); anywhere a job name is displayed or used (popup list, build notifications) should prefer
  `customName || name`. `setUrls` accepts an array of `{url, name}` entries (plain strings are
  still accepted for backward compatibility) and preserves `customName` across `updateStatus`
  refreshes.
- `buildNotifier` / `buildWatcher` — compare old vs. new job state to decide whether to fire a
  desktop notification (respects the `notification` option: `all` / `unstable` / `none`), and
  manage the `setInterval` polling loop, restarting it when options change.
- All service singletons (`Storage`, `Notification`, `Jobs`, `jenkins`, `buildNotifier`,
  `buildWatcher`, `defaultJobData`) are created once at module load and exported directly (no DI
  container) — call `Services.init()` to bootstrap options/jobs from storage and start polling.

Two manifests exist because Chrome and Firefox need different permission models:
`manifest.json` (Chrome, `optional_host_permissions`) and `manifest_firefox.json` (reference for
Firefox's `browser_specific_settings`/`host_permissions`); `build.sh` is the source of truth for
how the two packages actually differ at build time (it derives both from `manifest.json` via
`sed`, not from `manifest_firefox.json` directly).

## Conventions

- Source files use ES modules (`import`/`export`) with `type: module` service worker; no bundler —
  files are shipped/loaded as-is, so avoid adding imports that require bundling/transpilation.
- Files under `js/` keep the original GNU AGPLv3 header comment block; preserve it when editing
  existing files.
- Tests live in `test/*.test.js` with mocks in `test/mocks/` (`chrome.mock.js`, `services.mock.js`,
  `popup.mock.js`). `test/setup.js` installs the global `chrome` mock, fake timers, DOM
  template/importNode polyfills, and resets mocks in `beforeEach`.
  - `global.flushPromises()` (test/setup.js) is broken/deadlocks under the global fake timers
    (its first `setTimeout` never fires because nothing advances the fake clock first) — don't use
    it; use a local helper like `await Promise.resolve()` (x2) instead.
  - `test/popup.test.js` hangs indefinitely (~100% CPU) on both new and unmodified baseline code;
    root cause not identified. Avoid adding to or running it; it also fully mocks `../js/popup.js`
    via `popup.mock.js` rather than exercising the real module. Prefer adding real-module coverage
    of `js/popup.js` behavior to `test/browser-api.test.js` instead (it already imports
    `documentReady` from the real module).
  - `js/options.js` has no exports and wires everything at import time as a side effect (top-level
    `document.querySelector` + `DOMContentLoaded`). To test it: set up
    `document.body.innerHTML` *before* requiring the module, and use `jest.resetModules()` +
    `require()` (not static `import`) so the module re-executes against the fresh DOM — see
    `test/options.test.js`.
- `babel.config.js` (repo root) provides `@babel/preset-env` and is required for Jest to parse
  ES module syntax at all — don't remove it.
- Jest env is `jsdom`; tests run with `--runInBand` for the performance suite specifically to avoid
  timing interference.

## Commit messages

- Do not add a `Co-authored-by` trailer to commits in this repository.
