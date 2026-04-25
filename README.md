# MHCG HITW survey 2026

This repository holds trail survey photos, a generated metadata manifest, a GPX hike track, and a small local web viewer that lists each photo’s EXIF-derived fields, shows the image, and plots the full track plus the selected photo’s location on OpenTopoMap layers.

### Web viewer

![Screenshot of the survey web app: photo list, metadata, image preview, survey track map, and photo location map](app-screenshot.png)

The **web viewer** (see above) is meant for reviewing a survey after you are off the trail. The left column lists every photo with a filter, so you can jump by filename or time. Picking a row loads EXIF-based metadata (including coordinates), shows the full-resolution image, draws the **entire GPX hike** on one topo map with a marker for where that photo sits along the route, and zooms a second map to the **exact photo location**. Below the image you can type **trail / ranger notes** for that location; they are saved into **`survey_photos.yaml`** so you can hand them to land managers later. You can copy coordinates in several formats from a drop-down, move through the list with the **↑** / **↓** arrow keys (when not typing in a text field), and pan or zoom the maps when you need more context.

---

## Layout

| Path | Role |
|------|------|
| `photos/` | Source images (JPEG/HEIC, etc.) |
| `track/` | GPX file for the survey hike (`MHCG-HITW-SURVEY.gpx`), shown in the viewer |
| `survey_photos.yaml` | Generated manifest (photos + optional **notes**); updated by the viewer when you save trail notes |
| `scripts/extract_photo_exif_to_yaml.py` | Builds `survey_photos.yaml` from EXIF |
| `webapp/` | FastAPI app and static viewer page |

---

## Quick start

Fastest way to run the **web viewer in Docker** and open it in a browser. Host Python is **not** required for this path (everything runs in the container). You still need this repo on disk with **`photos/`**, **`track/`**, and **`survey_photos.yaml`** next to **`docker-compose.yml`**. If `survey_photos.yaml` is missing or stale, generate it first (see [EXIF → YAML conversion](#exif--yaml-conversion)).

### Prerequisites

**macOS**

- [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/) (or Docker Engine plus the [Compose V2 plugin](https://docs.docker.com/compose/install/) so the command **`docker compose`** works)
- This repository checked out or copied so the folders above exist at the project root

**Windows**

- [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) (the installer usually enables **WSL 2**; follow Docker’s prompts until `docker` works in a terminal)
- The same repository layout on disk (`docker-compose.yml`, `photos/`, `track/`, `survey_photos.yaml`, …)

**Both:** a network connection in the browser for **OpenTopoMap** tiles.

### Start the app (Docker)

1. Open a terminal (**Terminal** on Mac, **PowerShell** or **Command Prompt** on Windows).
2. Change directory to the **repository root** (the folder that contains `docker-compose.yml`).
3. Run:

```bash
docker compose up -d --build
```

The first build can take a few minutes. When the container is up, the UI is at **http://127.0.0.1:8765/** (compose maps host port **8765** to port **8000** in the container).

### Open a browser

- **macOS** (Terminal): `open http://127.0.0.1:8765/`
- **Windows Command Prompt:** `start http://127.0.0.1:8765/`
- **Windows PowerShell:** `Start-Process "http://127.0.0.1:8765/"`

Or paste **http://127.0.0.1:8765/** into Chrome, Edge, or Safari.

### Makefile shortcut (macOS / Linux)

If **GNU Make** is installed (macOS: often included with **Xcode Command Line Tools**), from the repo root you can build, start Docker, wait a moment, and open the default browser in one go:

```bash
make browse
```

**Windows** does not include `make` by default, so the usual approach is **`docker compose up -d --build`** plus one of the **Open a browser** commands above. You can add Make later (e.g. Chocolatey, MSYS2, or WSL) if you want the same Makefile targets.

### Stop the stack

```bash
docker compose down
```

On systems with Make, **`make docker-down`** does the same.

---

## EXIF → YAML conversion

The script **`scripts/extract_photo_exif_to_yaml.py`** walks an image directory, reads embedded EXIF with [Pillow](https://python-pillow.org/), and writes **`survey_photos.yaml`**.

### What it extracts

- **Filename** — basename only (as stored in the manifest).
- **Time** — first available of `DateTimeOriginal`, `DateTimeDigitized`, then `DateTime`. EXIF stores this as a local wall-clock string with no timezone. The script interprets that instant in an **IANA timezone** (default `America/Los_Angeles`) using the standard library `zoneinfo`, so daylight saving (PDT) vs standard (PST) follows real calendar rules. Output is **ISO-8601 with numeric offset** (for example `2026-04-17T08:26:25-07:00`).
- **Position** — latitude and longitude from the GPS IFD, converted from degrees/minutes/seconds to decimal degrees, rounded to seven decimal places.

### Supported inputs

Files matching: `*.jpg`, `*.jpeg`, `*.JPG`, `*.JPEG`, `*.heic`, `*.HEIC` under the chosen directory. Names are sorted case-insensitively.

### Skipped files

Images are skipped (with a message on stderr) if the file cannot be opened, if there is no usable datetime, if the datetime string cannot be parsed, or if GPS coordinates are missing.

### Output shape

The YAML file has a single top-level key `photos`, whose value is a list of records:

```yaml
photos:
  - filename: example.jpeg
    taken_at: '2026-04-17T08:26:25-07:00'
    latitude: 35.1231278
    longitude: -115.4327306
    notes: ''
```

Re-running the EXIF script **keeps** any existing `notes` for matching filenames. New photos get `notes: ''`.

### Setup and invocation

Use a virtual environment so dependencies do not touch the system Python (recommended on macOS with PEP 668):

```bash
cd /path/to/MHCG-HITW-SURVEY-2026
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Regenerate the manifest from the repo root:

```bash
.venv/bin/python3 scripts/extract_photo_exif_to_yaml.py
```

Defaults: read **`./photos`**, write **`./survey_photos.yaml`**, timezone **`America/Los_Angeles`**.

Useful options:

```text
--photos DIR     Image directory (default: photos)
--out FILE       Output YAML path (default: survey_photos.yaml)
--tz IANA        IANA timezone name for wall-clock EXIF times (default: America/Los_Angeles)
```

Example:

```bash
.venv/bin/python3 scripts/extract_photo_exif_to_yaml.py --photos photos --out survey_photos.yaml --tz America/Los_Angeles
```

---

## Web viewer

The viewer is a **FastAPI** application in **`webapp/app.py`**. It exposes:

- **`GET /api/photos`** — JSON list loaded from `survey_photos.yaml` (cached in memory after the first request). Each item may include a **`notes`** string.
- **`PUT /api/photos/{filename}/notes`** — JSON body `{"notes": "…"}` updates that photo’s notes in `survey_photos.yaml` on disk and refreshes the cache (basename only; max length 16 000 characters).
- **`GET /api/track`** — JSON `{"coordinates": [[lat, lon], ...]}` from all GPX `trkpt` points (cached after the first request; same geometry as the profile endpoint).
- **`GET /api/track-profile`** — JSON with **`coordinates`**, **`distances_m`** (cumulative horizontal distance along the track in meters), **`elevations_m`** (from GPX `<ele>`), and **`total_distance_m`**, used for the elevation chart (cached with the track).
- **`GET /media/{filename}`** — serves files from **`photos/`** by basename only (path traversal is rejected).
- **`GET /`** — HTML UI: filterable list, metadata, photo preview, an **elevation profile** (canvas) with distance on the horizontal axis and a marker for the selected photo’s position along the trail, and two **Leaflet** maps (**OpenTopoMap**): one fitted to the full hike track, one zoomed to the selected photo’s coordinates (map tiles need network access in the browser).

### Run locally (uvicorn)

From the repository root (so `survey_photos.yaml` and `photos/` resolve correctly):

```bash
.venv/bin/pip install -r requirements.txt   # if not already done
.venv/bin/uvicorn webapp.app:app --reload --port 8765
```

Open **http://127.0.0.1:8765/** in a browser.

`--reload` watches Python files only. If you regenerate **`survey_photos.yaml`**, restart the server (or hit the process with a code change) so the in-memory list reloads.

### Run with Docker

From the repository root:

```bash
docker compose up --build
```

Compose maps host **8765** to container **8000** and mounts **`./survey_photos.yaml`** read-write (so trail notes can be saved from the app), and **`./photos`** and **`./track`** read-only.

Open **http://127.0.0.1:8765/**.

After changing **`survey_photos.yaml`** on the host, restart the container so the API cache picks up the new file:

```bash
docker compose restart
```

Equivalent **`docker run`** (build the image first with `docker build -t survey-viewer .`):

```bash
docker run --rm -p 8765:8000 \
  -v "$(pwd)/survey_photos.yaml:/work/survey_photos.yaml" \
  -v "$(pwd)/photos:/work/photos:ro" \
  -v "$(pwd)/track:/work/track:ro" \
  survey-viewer
```

The image also copies **`track/`** at build time, so the last volume is optional unless you want to override the baked-in GPX. Mount **`survey_photos.yaml`** without `:ro` if you want the app to persist **notes** from the browser.

---

## Dependencies

Declared in **`requirements.txt`**: Pillow and PyYAML for the conversion script; FastAPI and Uvicorn for the web app. The Docker image installs the same file and runs Uvicorn on port 8000 inside the container.
