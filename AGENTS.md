# AGENTS.md

## Repo shape
- This repo is a small app with Python backend code in `webapp/app.py`, support scripts in `scripts/`, and frontend runtime code in `webapp/static/`.
- Runtime data at repo root matters: `survey_photos.yaml`, `photos/`, and `track/`. Most commands must be run from the repository root so those relative paths resolve correctly.
- `track/MHCG-HITW-SURVEY.gpx` drives `/api/track` and `/api/track-profile`; `track/MHCG-HITW-PINS.gpx` drives `/api/pins`.

## Exact commands
- Setup: `make install` or `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
- Dev/test setup: `make install-dev`
- Regenerate manifest: `make extract` or `.venv/bin/python3 scripts/extract_photo_exif_to_yaml.py`
- Run locally: `make serve` or `.venv/bin/uvicorn webapp.app:app --reload --port 8765`
- Python tests: `make test-py`
- Frontend tests: `make test-js`
- All tests: `make test`
- Definition-of-done check: `make ci`
- Docker dev: `make docker-up-build` or `docker compose up -d --build`
- Remote-photo-cache dev mode: `docker compose --profile remote-cache up -d --build survey-viewer-remote-cache` on `http://127.0.0.1:8767/`

## Verification
- `make ci` is the local definition of done and should pass before work is considered complete.
- `make test` runs both Python and frontend tests with coverage summaries.
- Coverage is currently enforced at 85% line coverage per covered file.
- Useful smoke checks after backend changes:
  - `http://127.0.0.1:8765/api/photos`
  - `http://127.0.0.1:8765/api/track-profile`
  - `http://127.0.0.1:8765/api/pins`
  - `http://127.0.0.1:8765/survey.kml`

## Behavior quirks worth remembering
- `scripts/extract_photo_exif_to_yaml.py` preserves existing `notes` in `survey_photos.yaml` by filename. Do not break that merge behavior casually.
- EXIF timestamps are interpreted as local wall-clock time in `America/Los_Angeles` by default and emitted with an offset.
- The FastAPI app caches photos, track/profile, and pins in memory. If you change `survey_photos.yaml` or GPX files outside the app, restart the server/container to pick up the new data.
- `uvicorn --reload` only watches Python files; data-file edits do not invalidate caches.
- `/media/{filename}` first serves from local `photos/`, then from `PHOTO_CACHE_DIR`, then optionally downloads from `PHOTO_REMOTE_BASE_URL`. The app explicitly guards against Git LFS pointer files.
- Render is intentionally read-only for notes via `NOTES_READ_ONLY=true` in `render.yaml`; local Docker does mount `survey_photos.yaml` read-write.

## Editing guidance
- For non-trivial work, do planning in `PLAN.md` at the repo root, not only in chat. Write or update the plan first, let the user review it, and wait for approval before executing the plan.
- Keep changes minimal and local; `webapp/app.py` is intentionally a single-file app.
- If you change how photos/track/pins are loaded or written, check both local-disk mode and remote-cache mode because deployment behavior differs.
- Follow a red-green-refactor loop where `make ci` is introduced early and rerun after meaningful changes until it passes.
