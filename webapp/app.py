"""
Local survey photo viewer: list metadata, image, and OpenTopoMap for each photo.

From the repository root:

  .venv/bin/uvicorn webapp.app:app --reload --port 8765

Then open http://127.0.0.1:8765/

Docker (from repo root):

  docker compose up --build
  # same URL if you map 8765:8000 in docker-compose.yml
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = (ROOT / "photos").resolve()
TRACK_DIR = (ROOT / "track").resolve()
GPX_PATH = (TRACK_DIR / "MHCG-HITW-SURVEY.gpx").resolve()
YAML_PATH = ROOT / "survey_photos.yaml"
STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Survey photo viewer")
_photos_cache: list[dict] | None = None
_track_cache: list[list[float]] | None = None


def _parse_gpx_track_points(path: Path) -> list[list[float]]:
    """Return [lat, lon] pairs from all trkpt elements in a GPX 1.1 file."""
    if not path.is_file() or path.parent.resolve() != TRACK_DIR:
        return []
    tree = ET.parse(path)
    root = tree.getroot()
    points: list[list[float]] = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag != "trkpt":
            continue
        lat_s, lon_s = el.get("lat"), el.get("lon")
        if lat_s is None or lon_s is None:
            continue
        try:
            points.append([float(lat_s), float(lon_s)])
        except ValueError:
            continue
    return points


def _load_track_coordinates() -> list[list[float]]:
    global _track_cache
    if _track_cache is not None:
        return _track_cache
    _track_cache = _parse_gpx_track_points(GPX_PATH)
    return _track_cache


def _load_photos() -> list[dict]:
    global _photos_cache
    if _photos_cache is not None:
        return _photos_cache
    if not YAML_PATH.is_file():
        _photos_cache = []
        return _photos_cache
    with YAML_PATH.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    _photos_cache = data.get("photos") or []
    return _photos_cache


@app.get("/api/photos")
def api_photos() -> list[dict]:
    return _load_photos()


@app.get("/api/track")
def api_track() -> dict:
    """Hike polyline as [[lat, lon], ...] for Leaflet (empty if GPX missing)."""
    coords = _load_track_coordinates()
    return {"coordinates": coords}


@app.get("/media/{filename}")
def media(filename: str) -> FileResponse:
    """Serve a file from ./photos (basename only; no path traversal)."""
    name = Path(filename).name
    if name != filename or not name or name.startswith("."):
        raise HTTPException(status_code=404, detail="Invalid filename")
    path = (PHOTOS_DIR / name).resolve()
    if path.parent != PHOTOS_DIR or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, filename=name)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
