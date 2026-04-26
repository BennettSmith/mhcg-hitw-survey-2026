from __future__ import annotations

import io
import xml.etree.ElementTree as ET
from email.message import Message
from dataclasses import replace
from pathlib import Path

import pytest
import yaml
from fastapi import HTTPException
from fastapi.testclient import TestClient

from conftest import PINS_GPX_TEXT, TRACK_GPX_TEXT
from webapp.app import (
    AppCaches,
    AppConfig,
    _build_survey_kml,
    _cached_photo_path_for_name,
    _download_remote_photo,
    _haversine_m,
    _load_pins,
    _load_track_profile,
    _looks_like_git_lfs_pointer,
    _parse_gpx_track_profile,
    _parse_gpx_waypoints,
    _photo_description_for_kml,
    _photo_path_for_filename,
    _read_photos_from_disk,
    _remote_photo_url,
    _with_photo_media_info,
    create_app,
)


def test_parse_gpx_waypoints_and_track_profile(tmp_path: Path) -> None:
    track_dir = tmp_path / "track"
    track_dir.mkdir()
    pins_path = track_dir / "pins.gpx"
    track_path = track_dir / "track.gpx"
    pins_path.write_text(PINS_GPX_TEXT, encoding="utf-8")
    track_path.write_text(TRACK_GPX_TEXT, encoding="utf-8")

    pins = _parse_gpx_waypoints(pins_path, track_dir=track_dir)
    assert pins[0]["name"] == "Ranger note"
    assert pins[1]["name"] == "(unnamed waypoint)"
    assert _parse_gpx_waypoints(tmp_path / "elsewhere.gpx", track_dir=track_dir) == []

    profile = _parse_gpx_track_profile(track_path, track_dir=track_dir)
    assert len(profile["coordinates"]) == 3
    assert profile["distances_m"][0] == 0.0
    assert profile["total_distance_m"] > 0
    assert profile["elevations_m"] == [1000.0, 1010.0, 1020.0]


def test_haversine_and_photo_path_helpers(app_config: AppConfig) -> None:
    assert _haversine_m(35.1, -115.4, 35.1, -115.4) == 0.0
    name, path = _photo_path_for_filename("photo-1.jpg", app_config.photos_dir)
    assert name == "photo-1.jpg"
    assert path.name == "photo-1.jpg"
    with pytest.raises(ValueError):
        _photo_path_for_filename("../bad.jpg", app_config.photos_dir)
    cache_path = _cached_photo_path_for_name("photo-1.jpg", app_config.photo_cache_dir)
    assert cache_path.name == "photo-1.jpg"
    with pytest.raises(ValueError):
        _cached_photo_path_for_name("../bad.jpg", app_config.photo_cache_dir)
    assert _remote_photo_url("photo 1.jpg", "https://example.com/photos") == "https://example.com/photos/photo%201.jpg"
    assert _remote_photo_url("photo.jpg", "") is None


def test_lfs_detection_and_media_info_statuses(app_config: AppConfig) -> None:
    pointer_path = app_config.photos_dir / "pointer.jpg"
    pointer_path.write_text("version https://git-lfs.github.com/spec/v1\n", encoding="utf-8")
    assert _looks_like_git_lfs_pointer(pointer_path) is True
    app_config.photo_cache_dir.mkdir(parents=True, exist_ok=True)
    (app_config.photo_cache_dir / "photo-2.jpg").write_bytes(b"cache-bytes")

    ok = _with_photo_media_info({"filename": "photo-1.jpg"}, app_config)
    assert ok["media_status"] == "ok"
    cached = _with_photo_media_info({"filename": "photo-2.jpg"}, app_config)
    assert cached["media_status"] == "cached"
    invalid = _with_photo_media_info({"filename": "../bad.jpg"}, app_config)
    assert invalid["media_status"] == "invalid_filename"
    lfs = _with_photo_media_info({"filename": "pointer.jpg"}, app_config)
    assert lfs["media_status"] == "git_lfs_pointer"

    remote_config = replace(app_config, photo_remote_base_url="https://example.com/photos")
    uncached = _with_photo_media_info({"filename": "missing.jpg"}, remote_config)
    assert uncached["media_status"] == "remote_uncached"


class FakeResponse:
    def __init__(self, content_type: str, body: bytes) -> None:
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        self._stream = io.BytesIO(body)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, size: int = -1) -> bytes:
        return self._stream.read(size)


def test_download_remote_photo_success_and_failures(monkeypatch, tmp_path: Path, app_config: AppConfig) -> None:
    destination = tmp_path / "photo.jpg"
    config = replace(
        app_config,
        photo_remote_base_url="https://example.com/photos",
        photo_cache_dir=tmp_path,
    )

    monkeypatch.setattr("webapp.app.urlopen", lambda request, timeout: FakeResponse("image/jpeg", b"img-bytes"))
    _download_remote_photo("photo.jpg", destination, config)
    assert destination.read_bytes() == b"img-bytes"

    monkeypatch.setattr("webapp.app.urlopen", lambda request, timeout: FakeResponse("text/plain", b"oops"))
    with pytest.raises(HTTPException) as excinfo:
        _download_remote_photo("photo.jpg", destination, config)
    assert excinfo.value.status_code == 502

    monkeypatch.setattr(
        "webapp.app.urlopen",
        lambda request, timeout: FakeResponse("image/jpeg", b"version https://git-lfs.github.com/spec/v1\n"),
    )
    with pytest.raises(HTTPException) as excinfo:
        _download_remote_photo("photo.jpg", destination, config)
    assert excinfo.value.status_code == 502


def test_photo_description_and_disk_loading(app_config: AppConfig) -> None:
    desc = _photo_description_for_kml(
        {"filename": "a.jpg", "taken_at": "now", "notes": "line 1\nline 2"},
        "https://example.com/a.jpg",
    )
    assert "Open full photo" in desc
    assert "line 1<br/>line 2" in desc
    photos = _read_photos_from_disk(app_config.yaml_path)
    assert len(photos) == 2


def test_build_survey_kml_semantics(app_config: AppConfig) -> None:
    scope_request = type("Req", (), {"url_for": lambda self, name, filename: f"http://testserver/media/{filename}"})()
    kml_bytes = _build_survey_kml(
        scope_request,
        app_config,
        _read_photos_from_disk(app_config.yaml_path),
        _load_pins(AppCaches(), app_config),
        _load_track_profile(AppCaches(), app_config),
    )
    root = ET.fromstring(kml_bytes)
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    names = [el.text for el in root.findall(".//k:Folder/k:name", ns)]
    assert "Photo locations" in names
    assert "Ranger pins" in names
    assert root.find(".//k:LineString/k:coordinates", ns) is not None


def test_api_routes_and_static_asset_serving(client: TestClient) -> None:
    photos = client.get("/api/photos")
    assert photos.status_code == 200
    assert photos.json()[0]["media_status"] == "ok"
    assert client.get("/api/config").json() == {"notes_read_only": False}
    assert len(client.get("/api/track").json()["coordinates"]) == 3
    assert client.get("/api/track-profile").json()["total_distance_m"] > 0
    assert client.get("/api/pins").json()[0]["name"] == "Ranger note"
    assert client.get("/survey.kml").headers["content-type"].startswith("application/vnd.google-earth.kml+xml")
    assert client.get("/").status_code == 200
    static_js = client.get("/static/app.js")
    assert static_js.status_code == 200
    assert "initSurveyApp" in static_js.text


def test_put_photo_notes_updates_yaml_and_cache(client: TestClient, app_config: AppConfig) -> None:
    response = client.put("/api/photos/photo-1.jpg/notes", json={"notes": "updated"})
    assert response.status_code == 200
    data = yaml.safe_load(app_config.yaml_path.read_text(encoding="utf-8"))
    assert data["photos"][0]["notes"] == "updated"
    assert client.put("/api/photos/.bad/notes", json={"notes": "x"}).status_code == 400
    assert client.put("/api/photos/missing.jpg/notes", json={"notes": "x"}).status_code == 404


def test_put_photo_notes_respects_read_only(app_config: AppConfig) -> None:
    read_only_config = replace(app_config, notes_read_only=True)
    client = TestClient(create_app(read_only_config))
    response = client.put("/api/photos/photo-1.jpg/notes", json={"notes": "blocked"})
    assert response.status_code == 403


def test_media_route_local_cache_remote_and_errors(monkeypatch, app_config: AppConfig) -> None:
    client = TestClient(create_app(app_config))
    response = client.get("/media/photo-1.jpg")
    assert response.status_code == 200
    assert response.content == b"jpeg-bytes-1"

    app_config.photo_cache_dir.mkdir(parents=True, exist_ok=True)
    (app_config.photo_cache_dir / "photo-2.jpg").write_bytes(b"cache-bytes")
    response = client.get("/media/photo-2.jpg")
    assert response.status_code == 200
    assert response.content == b"cache-bytes"

    remote_config = replace(app_config, photo_remote_base_url="https://example.com/photos")
    remote_client = TestClient(create_app(remote_config))

    def fake_download(name: str, destination: Path, config: AppConfig) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"remote-bytes")

    monkeypatch.setattr("webapp.app._download_remote_photo", fake_download)
    response = remote_client.get("/media/remote.jpg")
    assert response.status_code == 200
    assert response.content == b"remote-bytes"

    assert client.get("/media/../bad.jpg").status_code == 404
    assert client.get("/media/missing.jpg").status_code == 404
    (app_config.photos_dir / "pointer.jpg").write_text("version https://git-lfs.github.com/spec/v1\n", encoding="utf-8")
    response = client.get("/media/pointer.jpg")
    assert response.status_code == 409
