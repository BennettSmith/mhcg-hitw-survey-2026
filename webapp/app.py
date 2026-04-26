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

import html
import math
import os
import shutil
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

import yaml
from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"
PHOTO_DOWNLOAD_TIMEOUT_SECONDS = 30
_EARTH_RADIUS_M = 6_371_000.0


@dataclass(slots=True)
class AppConfig:
    photos_dir: Path
    track_dir: Path
    gpx_path: Path
    pins_gpx_path: Path
    yaml_path: Path
    static_dir: Path
    photo_remote_base_url: str
    photo_cache_dir: Path
    photo_download_timeout_seconds: int
    notes_read_only: bool


@dataclass(slots=True)
class AppCaches:
    photos: list[dict] | None = None
    track_coordinates: list[list[float]] | None = None
    track_profile: dict | None = None
    pins: list[dict] | None = None

    def invalidate_photos(self) -> None:
        self.photos = None

    def reset(self) -> None:
        self.photos = None
        self.track_coordinates = None
        self.track_profile = None
        self.pins = None


def _default_app_config() -> AppConfig:
    photos_dir = (ROOT / "photos").resolve()
    track_dir = (ROOT / "track").resolve()
    return AppConfig(
        photos_dir=photos_dir,
        track_dir=track_dir,
        gpx_path=(track_dir / "MHCG-HITW-SURVEY.gpx").resolve(),
        pins_gpx_path=(track_dir / "MHCG-HITW-PINS.gpx").resolve(),
        yaml_path=ROOT / "survey_photos.yaml",
        static_dir=STATIC_DIR,
        photo_remote_base_url=os.environ.get("PHOTO_REMOTE_BASE_URL", "").rstrip("/"),
        photo_cache_dir=Path(os.environ.get("PHOTO_CACHE_DIR", "/tmp/survey-photo-cache")).resolve(),
        photo_download_timeout_seconds=PHOTO_DOWNLOAD_TIMEOUT_SECONDS,
        notes_read_only=os.environ.get("NOTES_READ_ONLY", "").strip().lower()
        in {"1", "true", "yes", "on"},
    )


def _gpx_local_tag(el: ET.Element) -> str:
    return el.tag.split("}")[-1]


def _parse_gpx_waypoints(path: Path, *, track_dir: Path) -> list[dict]:
    """
    Parse GPX <wpt> for ranger / trail notes (name = note text).
    Only files directly under ./track are accepted.
    """
    if not path.is_file() or path.parent.resolve() != track_dir.resolve():
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


def _load_pins(caches: AppCaches, config: AppConfig) -> list[dict]:
    if caches.pins is not None:
        return caches.pins
    caches.pins = _parse_gpx_waypoints(config.pins_gpx_path, track_dir=config.track_dir)
    return caches.pins


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def _parse_gpx_track_profile(path: Path, *, track_dir: Path) -> dict:
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
    if not path.is_file() or path.parent.resolve() != track_dir.resolve():
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


def _load_track_profile(caches: AppCaches, config: AppConfig) -> dict:
    if caches.track_profile is not None:
        return caches.track_profile
    caches.track_profile = _parse_gpx_track_profile(config.gpx_path, track_dir=config.track_dir)
    return caches.track_profile


def _load_track_coordinates(caches: AppCaches, config: AppConfig) -> list[list[float]]:
    if caches.track_coordinates is not None:
        return caches.track_coordinates
    profile = _load_track_profile(caches, config)
    caches.track_coordinates = profile["coordinates"]
    return caches.track_coordinates


def _read_photos_from_disk(yaml_path: Path) -> list[dict]:
    if not yaml_path.is_file():
        return []
    with yaml_path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return list(data.get("photos") or [])


def _load_photos(caches: AppCaches, config: AppConfig) -> list[dict]:
    if caches.photos is not None:
        return caches.photos
    caches.photos = _read_photos_from_disk(config.yaml_path)
    return caches.photos


def invalidate_photos_cache(caches: AppCaches) -> None:
    caches.invalidate_photos()


def _photo_path_for_filename(filename: str, photos_dir: Path) -> tuple[str, Path]:
    name = Path(filename).name
    if name != filename or not name or name.startswith("."):
        raise ValueError("Invalid filename")
    path = (photos_dir / name).resolve()
    if path.parent != photos_dir.resolve():
        raise ValueError("Invalid filename")
    return name, path


def _cached_photo_path_for_name(name: str, photo_cache_dir: Path) -> Path:
    path = (photo_cache_dir / name).resolve()
    if path.parent != photo_cache_dir.resolve():
        raise ValueError("Invalid filename")
    return path


def _remote_photo_url(name: str, photo_remote_base_url: str) -> str | None:
    if not photo_remote_base_url:
        return None
    return f"{photo_remote_base_url}/{quote(name)}"


def _looks_like_git_lfs_pointer(path: Path) -> bool:
    try:
        if path.stat().st_size > 1024:
            return False
        return path.read_bytes().startswith(b"version https://git-lfs.github.com/spec/")
    except OSError:
        return False


def _download_remote_photo(name: str, destination: Path, config: AppConfig) -> None:
    url = _remote_photo_url(name, config.photo_remote_base_url)
    if url is None:
        raise HTTPException(
            status_code=404,
            detail="Photo file is missing and no remote photo source is configured",
        )

    config.photo_cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_name(f".{destination.name}.tmp")
    request = Request(url, headers={"User-Agent": "mhcg-hitw-survey-viewer/1.0"})
    try:
        with urlopen(request, timeout=config.photo_download_timeout_seconds) as response:
            content_type = response.headers.get_content_type()
            if not content_type.startswith("image/"):
                raise HTTPException(
                    status_code=502,
                    detail=f"Remote photo source returned {content_type}, not an image",
                )
            with tmp.open("wb") as f:
                shutil.copyfileobj(response, f)
        if _looks_like_git_lfs_pointer(tmp):
            tmp.unlink(missing_ok=True)
            raise HTTPException(
                status_code=502,
                detail="Remote photo source returned a Git LFS pointer, not the real image bytes",
            )
        os.replace(tmp, destination)
    except HTTPException:
        raise
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise HTTPException(status_code=502, detail=f"Could not cache remote photo: {exc}") from exc


def _with_photo_media_info(row: dict, config: AppConfig) -> dict:
    out = dict(row)
    filename = str(out.get("filename") or "")
    try:
        name, path = _photo_path_for_filename(filename, config.photos_dir)
    except ValueError:
        out["media_status"] = "invalid_filename"
        out["media_url"] = None
        out["media_bytes"] = 0
        return out

    out["media_url"] = f"/media/{name}"
    if not path.is_file():
        cache_path = _cached_photo_path_for_name(name, config.photo_cache_dir)
        if cache_path.is_file() and not _looks_like_git_lfs_pointer(cache_path):
            out["media_status"] = "cached"
            out["media_bytes"] = cache_path.stat().st_size
        elif config.photo_remote_base_url:
            out["media_status"] = "remote_uncached"
            out["media_bytes"] = 0
        else:
            out["media_status"] = "missing"
            out["media_bytes"] = 0
    elif _looks_like_git_lfs_pointer(path):
        if config.photo_remote_base_url:
            out["media_status"] = "remote_uncached"
            out["media_bytes"] = 0
        else:
            out["media_status"] = "git_lfs_pointer"
            out["media_bytes"] = path.stat().st_size
    else:
        out["media_status"] = "ok"
        out["media_bytes"] = path.stat().st_size
    return out


def _kml_text_node(parent: ET.Element, tag: str, text: object) -> ET.Element:
    child = ET.SubElement(parent, tag)
    child.text = "" if text is None else str(text)
    return child


def _photo_link_for_kml(request: FastAPIRequest, filename: str, config: AppConfig) -> str:
    name = Path(filename).name
    return _remote_photo_url(name, config.photo_remote_base_url) or str(request.url_for("media", filename=name))


def _photo_description_for_kml(row: dict, photo_url: str) -> str:
    filename = html.escape(str(row.get("filename") or "Photo"))
    taken_at = html.escape(str(row.get("taken_at") or ""))
    notes = html.escape(str(row.get("notes") or "")).replace("\n", "<br/>")
    photo_url_attr = html.escape(photo_url, quote=True)
    parts = [
        f"<h2>{filename}</h2>",
        f'<p><a href="{photo_url_attr}">Open full photo</a></p>',
        f'<p><img src="{photo_url_attr}" alt="{filename}" width="420"/></p>',
    ]
    if taken_at:
        parts.append(f"<p><strong>Taken:</strong> {taken_at}</p>")
    if notes:
        parts.append(f"<p><strong>Notes:</strong><br/>{notes}</p>")
    return "".join(parts)


def _build_survey_kml(
    request: FastAPIRequest,
    config: AppConfig,
    photos: list[dict],
    pins: list[dict],
    profile: dict,
) -> bytes:
    kml = ET.Element("kml", xmlns="http://www.opengis.net/kml/2.2")
    doc = ET.SubElement(kml, "Document")
    _kml_text_node(doc, "name", "MHCG HITW Survey 2026")

    track_style = ET.SubElement(doc, "Style", id="survey-track")
    line_style = ET.SubElement(track_style, "LineStyle")
    _kml_text_node(line_style, "color", "ff7a6f2f")
    _kml_text_node(line_style, "width", "4")

    photo_style = ET.SubElement(doc, "Style", id="photo-pin")
    icon_style = ET.SubElement(photo_style, "IconStyle")
    _kml_text_node(icon_style, "color", "ff7a6f2f")
    _kml_text_node(icon_style, "scale", "1.1")

    ranger_style = ET.SubElement(doc, "Style", id="ranger-pin")
    ranger_icon = ET.SubElement(ranger_style, "IconStyle")
    _kml_text_node(ranger_icon, "color", "ff2019d7")
    _kml_text_node(ranger_icon, "scale", "1.1")

    coords = profile.get("coordinates") or []
    elevations = profile.get("elevations_m") or []
    if len(coords) >= 2:
        placemark = ET.SubElement(doc, "Placemark")
        _kml_text_node(placemark, "name", "Survey track")
        _kml_text_node(placemark, "styleUrl", "#survey-track")
        line = ET.SubElement(placemark, "LineString")
        _kml_text_node(line, "tessellate", "1")
        coord_parts: list[str] = []
        for i, pair in enumerate(coords):
            lat, lon = pair
            ele = elevations[i] if i < len(elevations) and not math.isnan(elevations[i]) else 0
            coord_parts.append(f"{lon},{lat},{ele}")
        _kml_text_node(line, "coordinates", " ".join(coord_parts))

    photos_folder = ET.SubElement(doc, "Folder")
    _kml_text_node(photos_folder, "name", "Photo locations")
    for row in photos:
        filename = str(row.get("filename") or "")
        lat = row.get("latitude")
        lon = row.get("longitude")
        if lat is None or lon is None:
            continue
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (TypeError, ValueError):
            continue
        photo_url = _photo_link_for_kml(request, filename, config)
        placemark = ET.SubElement(photos_folder, "Placemark")
        _kml_text_node(placemark, "name", filename)
        _kml_text_node(placemark, "styleUrl", "#photo-pin")
        _kml_text_node(placemark, "description", _photo_description_for_kml(row, photo_url))
        point = ET.SubElement(placemark, "Point")
        _kml_text_node(point, "coordinates", f"{lon_f},{lat_f},0")

    ranger_folder = ET.SubElement(doc, "Folder")
    _kml_text_node(ranger_folder, "name", "Ranger pins")
    for pin in pins:
        lat = pin.get("latitude")
        lon = pin.get("longitude")
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (TypeError, ValueError):
            continue
        placemark = ET.SubElement(ranger_folder, "Placemark")
        _kml_text_node(placemark, "name", pin.get("name") or "Ranger pin")
        _kml_text_node(placemark, "styleUrl", "#ranger-pin")
        description = f"Time: {pin.get('taken_at') or ''}"
        if pin.get("elevation_m") is not None:
            description += f"<br/>Elevation: {pin.get('elevation_m')} m"
        _kml_text_node(placemark, "description", description)
        point = ET.SubElement(placemark, "Point")
        _kml_text_node(point, "coordinates", f"{lon_f},{lat_f},0")

    ET.indent(kml, space="  ")
    return ET.tostring(kml, encoding="utf-8", xml_declaration=True)


class PhotoNotesBody(BaseModel):
    notes: str = Field(default="", max_length=16000)


def create_app(config: AppConfig | None = None) -> FastAPI:
    app_config = config or _default_app_config()
    app = FastAPI(title="Survey photo viewer")
    caches = AppCaches()
    app.state.config = app_config
    app.state.caches = caches
    app.mount("/static", StaticFiles(directory=app_config.static_dir), name="static")

    @app.get("/api/photos")
    def api_photos() -> list[dict]:
        return [_with_photo_media_info(row, app_config) for row in _load_photos(caches, app_config)]

    @app.get("/api/config")
    def api_config() -> dict:
        return {"notes_read_only": app_config.notes_read_only}

    @app.put("/api/photos/{filename}/notes")
    def put_photo_notes(filename: str, body: PhotoNotesBody) -> dict:
        """Persist field notes for one photo in survey_photos.yaml (basename only)."""
        if app_config.notes_read_only:
            raise HTTPException(status_code=403, detail="Notes are read-only in this deployment")
        name = Path(filename).name
        if name != filename or not name or name.startswith("."):
            raise HTTPException(status_code=400, detail="Invalid filename")
        photos = _read_photos_from_disk(app_config.yaml_path)
        found = False
        for row in photos:
            if row.get("filename") == name:
                row["notes"] = body.notes
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Photo not in manifest")
        with app_config.yaml_path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(
                {"photos": photos},
                f,
                sort_keys=False,
                allow_unicode=True,
                default_flow_style=False,
            )
        invalidate_photos_cache(caches)
        return {"ok": True, "filename": name, "notes": body.notes}

    @app.get("/api/track")
    def api_track() -> dict:
        """Hike polyline as [[lat, lon], ...] for Leaflet (empty if GPX missing)."""
        coords = _load_track_coordinates(caches, app_config)
        return {"coordinates": coords}

    @app.get("/api/track-profile")
    def api_track_profile() -> dict:
        """
        GPX track with cumulative horizontal distance (m) and elevation (m) per vertex.
        """
        return _load_track_profile(caches, app_config)

    @app.get("/api/pins")
    def api_pins() -> list[dict]:
        """Waypoints from track/MHCG-HITW-PINS.gpx (ranger notes along the trail)."""
        return _load_pins(caches, app_config)

    @app.get("/survey.kml")
    def survey_kml(request: FastAPIRequest) -> Response:
        headers = {"Content-Disposition": 'inline; filename="mhcg-hitw-survey-2026.kml"'}
        return Response(
            _build_survey_kml(
                request,
                app_config,
                _load_photos(caches, app_config),
                _load_pins(caches, app_config),
                _load_track_profile(caches, app_config),
            ),
            media_type="application/vnd.google-earth.kml+xml",
            headers=headers,
        )

    @app.get("/media/{filename}")
    def media(filename: str) -> FileResponse:
        """Serve a photo from local disk, cache, or the configured GitHub raw source."""
        try:
            name, path = _photo_path_for_filename(filename, app_config.photos_dir)
        except ValueError:
            raise HTTPException(status_code=404, detail="Invalid filename")

        if path.is_file() and not _looks_like_git_lfs_pointer(path):
            return FileResponse(path, filename=name, media_type="image/jpeg")

        cache_path = _cached_photo_path_for_name(name, app_config.photo_cache_dir)
        if cache_path.is_file() and not _looks_like_git_lfs_pointer(cache_path):
            return FileResponse(cache_path, filename=name, media_type="image/jpeg")

        if app_config.photo_remote_base_url:
            _download_remote_photo(name, cache_path, app_config)
            return FileResponse(cache_path, filename=name, media_type="image/jpeg")

        if not path.is_file():
            raise HTTPException(
                status_code=404,
                detail="Photo file is missing from the deployed photos directory",
            )
        raise HTTPException(
            status_code=409,
            detail="Photo file is a Git LFS pointer, not the real image bytes",
        )

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(app_config.static_dir / "index.html")

    return app


app = create_app()
