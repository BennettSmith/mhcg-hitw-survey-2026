# PLAN

## Status
- Approved
- Completed

## Goal
- Add automated test coverage for all first-class application code in this repo.
- Introduce a deterministic local `make ci` workflow first, then use it as the primary red-green-refactor loop driver until all planned work is complete.
- Enforce a minimum of 85% line coverage per covered source file.

## In Scope
- Python test coverage for `webapp/app.py`.
- Python test coverage for `scripts/extract_photo_exif_to_yaml.py`.
- Python test coverage for a new helper at `scripts/check_coverage.py`.
- Frontend test coverage for executable JavaScript currently embedded in `webapp/static/index.html`.
- Extract that JavaScript into `webapp/static/app.js`.
- Add local tooling and Make targets needed to install dev dependencies, run tests, and enforce coverage gates.
- Update contributor-facing docs to describe the new workflow.

## Out Of Scope
- Hosted CI workflows such as GitHub Actions.
- Intentional UI/UX changes beyond behavior-preserving refactors needed for testability.
- CSS extraction or other frontend asset restructuring beyond moving the inline JavaScript into `webapp/static/app.js`.

## Agreed Constraints
- Use isolated synthetic or canned fixture data; do not rely on checked-in runtime data from `photos/`, `track/`, or `survey_photos.yaml`.
- Keep production refactors minimal, local, and behavior-preserving.
- Keep runtime frontend delivery build-free; Node tooling is for tests only.
- Treat modern browsers as the supported baseline; no legacy non-module fallback is required.
- `make ci` should run a deterministic set of checks locally and fail clearly when tooling is missing.
- Coverage enforcement is line coverage only for now, not branch coverage.
- Coverage gates are per module/file, not aggregate-only.
- Coverage checks must fail if an expected covered file is missing from the relevant coverage report.
- Exclude standard `if __name__ == "__main__":` boilerplate from Python coverage accounting.
- Execution should proceed in red-green-refactor mode, with `make ci` introduced early even if it initially fails.
- After each meaningful implementation step, run `make ci`, inspect failures, refine the code/tests/tooling, and repeat until `make ci` passes cleanly.

## Tooling Decisions
- Python tests: `pytest` + `pytest-cov`.
- Frontend tests: `vitest` + `jsdom`.
- Node package manager: `npm` with committed `package-lock.json`.
- Dev dependency bootstrap: `make install-dev` installs both Python and Node test dependencies.
- Python coverage policy enforcement: new helper script at `scripts/check_coverage.py` reading a JSON coverage report.
- Frontend coverage policy enforcement: `vitest` native per-file thresholds.
- Repo config additions: `requirements-dev.txt`, `pytest.ini`, and `.coveragerc`.

## Source Files Subject To 85% Coverage Gate
- `webapp/app.py`
- `scripts/extract_photo_exif_to_yaml.py`
- `scripts/check_coverage.py`
- `webapp/static/app.js`
- Any additional first-class frontend source files introduced during the extraction/refactor

## Production Code Changes
1. Refactor `webapp/app.py` to add a small app/config seam while preserving the existing `webapp.app:app` runtime entrypoint.
2. Move app cache state behind that seam so test app instances have isolated caches and a reset path.
3. Add a minimal static-files route or mount so `index.html` can load `webapp/static/app.js`.
4. Extract the inline JavaScript from `webapp/static/index.html` into `webapp/static/app.js`.
5. Structure the extracted frontend code as a browser ES module exposing an `initSurveyApp(...)` entrypoint plus only the small number of additional helper exports needed for direct testing.

## Test Layout
- `tests/`
- `tests/fixtures/`
- `tests/conftest.py`
- Python tests split across app, extraction script, and coverage-helper concerns.
- Frontend tests added under the repo test structure used by the chosen Vitest setup.

## Python Test Strategy
1. Add helper-level unit tests for parsing, validation, file handling, and error branches in `webapp/app.py` where that gives efficient coverage.
2. Add integration-style FastAPI tests using isolated temp paths and fixture data for:
   - `/api/photos`
   - `/api/config`
   - `/api/photos/{filename}/notes`
   - `/api/track`
   - `/api/track-profile`
   - `/api/pins`
   - `/survey.kml`
   - `/media/{filename}`
   - `/`
3. Fully cover local-file, cached-file, remote-download, Git LFS pointer, invalid filename, and missing-file media behaviors.
4. Cover remote photo download success and failure paths with mocks/stubs around network access; do not make real network calls.
5. Test KML behavior semantically by parsing XML and asserting key structure and content rather than snapshotting exact text.
6. Add unit and CLI-level tests for `scripts/extract_photo_exif_to_yaml.py` using synthetic EXIF-like objects, mocked `PIL.Image.open`, temp files, and temp output paths.
7. Verify note preservation behavior in the extraction script explicitly.
8. Add direct tests for `scripts/check_coverage.py`, including success, below-threshold failures, and missing-file failures.

## Frontend Test Strategy
1. Keep runtime behavior build-free but test the extracted ES module with `vitest` and `jsdom`.
2. Use a lightweight Leaflet stub rather than real Leaflet.
3. Use fake timers for debounce and timeout-driven behaviors.
4. Focus tests on app logic, DOM updates, fetch flows, selection behavior, notes persistence behavior, and other exported pure/helper logic.
5. Assert semantics and state transitions rather than brittle full-DOM snapshots.

## Makefile Changes
- Add `install-dev`.
- Add `test-py`.
- Add `test-js`.
- Add `test` to orchestrate both Python and frontend tests.
- Add `ci` first, even if it initially fails, then evolve it into the final definition-of-done target.
- Have final `ci` run `test` and then enforce the Python coverage policy helper, while relying on `vitest` to enforce frontend per-file thresholds.
- Make `test` show both Python and frontend coverage summaries.
- Make `test` and `ci` fail fast with clear messages if required Python or Node tooling is missing.
- Make `ci` print explicit phase labels for its sub-steps.

## Execution Order
1. Introduce the `make ci` target first so there is an explicit, canonical definition-of-done command from the beginning of implementation, even if it fails initially.
2. Add the minimum supporting Make targets and dependency/bootstrap wiring needed for `make ci` to run deterministically and report useful failures.
3. Iteratively implement the required Python and frontend refactors, tests, coverage configuration, and helper tooling.
4. After each meaningful change set, run `make ci`, use the failures to guide the next red-green-refactor step, and continue looping until the full plan is complete.
5. Finish by updating docs so the repo guidance matches the final `make ci` workflow.

## Documentation Changes
- Update `README.md` to document:
  - `make install-dev`
  - `make test`
  - `make ci`
  - the local definition-of-done workflow
- Update `AGENTS.md` to replace the current "no test suite" guidance with the new testing and verification workflow.

## Verification Plan
1. Run `make install-dev` in a clean local environment if needed.
2. Run targeted Python and frontend test commands during development.
3. Run `make test` and confirm both Python and frontend coverage summaries appear.
4. Run `make ci` and confirm:
   - Python tests pass
   - frontend tests pass
   - per-file Python coverage gates pass
   - per-file frontend coverage gates pass
   - failure output is concise and actionable when a gate is missed

## Risks To Watch
- The app currently binds paths, environment-derived settings, and caches at import time; the seam must stay minimal while making tests deterministic.
- The frontend script is large and tightly coupled to DOM globals and Leaflet; extraction should avoid accidental behavior changes.
- The static asset serving change must preserve current runtime behavior for `/` while making `app.js` reachable.
- Python and Node coverage outputs must remain predictable so `make ci` stays trustworthy.

## Approval
- Approved by user; execution completed.
