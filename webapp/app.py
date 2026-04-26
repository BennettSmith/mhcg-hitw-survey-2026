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

import math
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = (ROOT / "photos").resolve()
TRACK_DIR = (ROOT / "track").resolve()
GPX_PATH = (TRACK_DIR / "MHCG-HITW-SURVEY.gpx").resolve()
PINS_GPX_PATH = (TRACK_DIR / "MHCG-HITW-PINS.gpx").resolve()
YAML_PATH = ROOT / "survey_photos.yaml"
STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Survey photo viewer")
_photos_cache: list[dict] | None = None
_track_cache: list[list[float]] | None = None
_profile_cache: dict | None = None
_pins_cache: list[dict] | None = None

_EARTH_RADIUS_M = 6_371_000.0


def _gpx_local_tag(el: ET.Element) -> str:
    return el.tag.split("}")[-1]


def _parse_gpx_waypoints(path: Path) -> list[dict]:
    """
    Parse GPX <wpt> for ranger / trail notes (name = note text).
    Only files directly under ./track are accepted.
    """
    if not path.is_file() or path.parent.resolve() != TRACK_DIR:
        return []
    tree = ET.parse(path)
    root = tree.getroot()
    out: list[dict] = []
    for el in root.iter():
        if _gpx_local_tag(el) != "wpt":
            continue
        lat_s, lon_s = el.get("lat"), el.get("lon")
        if lat_s is None or lon_s is None:
            continue
        try:
            lat, lon = float(lat_s), float(lon_s)
        except ValueError:
            continue
        name = ""
        taken_at: str | None = None
        elevation_m: float | None = None
        for child in el:
            tag = _gpx_local_tag(child)
            if tag == "name" and child.text:
                name = child.text.strip()
            elif tag == "time" and child.text:
                taken_at = child.text.strip()
            elif tag == "ele" and child.text:
                try:
                    elevation_m = float(child.text.strip())
                except ValueError:
                    elevation_m = None
        pin_index = len(out)
        out.append(
            {
                "name": name or "(unnamed waypoint)",
                "latitude": lat,
                "longitude": lon,
                "taken_at": taken_at,
                "elevation_m": elevation_m,
                "pin_index": pin_index,
            }
        )
    return out


def _load_pins() -> list[dict]:
    global _pins_cache
    if _pins_cache is not None:
        return _pins_cache
    _pins_cache = _parse_gpx_waypoints(PINS_GPX_PATH)
    return _pins_cache


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def _parse_gpx_track_profile(path: Path) -> dict:
    """
    Parse trkpt sequence: lat, lon, elevation (m), cumulative distance (m).
    Returns coordinates for Leaflet plus parallel arrays for the elevation chart.
    """
    empty: dict = {
        "coordinates": [],
        "distances_m": [],
        "elevations_m": [],
        "total_distance_m": 0.0,
    }
    if not path.is_file() or path.parent.resolve() != TRACK_DIR:
        return empty
    tree = ET.parse(path)
    root = tree.getroot()
    coords: list[list[float]] = []
    dists: list[float] = []
    eles: list[float] = []
    cum = 0.0
    prev_lat: float | None = None
    prev_lon: float | None = None
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag != "trkpt":
            continue
        lat_s, lon_s = el.get("lat"), el.get("lon")
        if lat_s is None or lon_s is None:
            continue
        try:
            lat, lon = float(lat_s), float(lon_s)
        except ValueError:
            continue
        ele: float | None = None
        for child in el:
            if child.tag.split("}")[-1] == "ele" and child.text:
                try:
                    ele = float(child.text.strip())
                except ValueError:
                    ele = None
                break
        if ele is None:
            ele = float("nan")
        if prev_lat is not None and prev_lon is not None:
            cum += _haversine_m(prev_lat, prev_lon, lat, lon)
        prev_lat, prev_lon = lat, lon
        coords.append([lat, lon])
        dists.append(cum)
        eles.append(ele)
    return {
        "coordinates": coords,
        "distances_m": dists,
        "elevations_m": eles,
        "total_distance_m": cum,
    }


def _load_track_coordinates() -> list[list[float]]:
    global _track_cache
    if _track_cache is not None:
        return _track_cache
    prof = _load_track_profile()
    _track_cache = prof["coordinates"]
    return _track_cache


def _load_track_profile() -> dict:
    global _profile_cache
    if _profile_cache is not None:
        return _profile_cache
    _profile_cache = _parse_gpx_track_profile(GPX_PATH)
    return _profile_cache


def _read_photos_from_disk() -> list[dict]:
    if not YAML_PATH.is_file():
        return []
    with YAML_PATH.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return list(data.get("photos") or [])


def _load_photos() -> list[dict]:
    global _photos_cache
    if _photos_cache is not None:
        return _photos_cache
    _photos_cache = _read_photos_from_disk()
    return _photos_cache


def invalidate_photos_cache() -> None:
    global _photos_cache
    _photos_cache = None


class PhotoNotesBody(BaseModel):
    notes: str = Field(default="", max_length=16000)


@app.get("/api/photos")
def api_photos() -> list[dict]:
    return _load_photos()


@app.put("/api/photos/{filename}/notes")
def put_photo_notes(filename: str, body: PhotoNotesBody) -> dict:
    """Persist field notes for one photo in survey_photos.yaml (basename only)."""
    name = Path(filename).name
    if name != filename or not name or name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    photos = _read_photos_from_disk()
    found = False
    for row in photos:
        if row.get("filename") == name:
            row["notes"] = body.notes
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Photo not in manifest")
    with YAML_PATH.open("w", encoding="utf-8") as f:
        yaml.safe_dump(
            {"photos": photos},
            f,
            sort_keys=False,
            allow_unicode=True,
            default_flow_style=False,
        )
    invalidate_photos_cache()
    return {"ok": True, "filename": name, "notes": body.notes}


@app.get("/api/track")
def api_track() -> dict:
    """Hike polyline as [[lat, lon], ...] for Leaflet (empty if GPX missing)."""
    coords = _load_track_coordinates()
    return {"coordinates": coords}


@app.get("/api/track-profile")
def api_track_profile() -> dict:
    """
    GPX track with cumulative horizontal distance (m) and elevation (m) per vertex.
    """
    return _load_track_profile()


@app.get("/api/pins")
def api_pins() -> list[dict]:
    """Waypoints from track/MHCG-HITW-PINS.gpx (ranger notes along the trail)."""
    return _load_pins()


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
