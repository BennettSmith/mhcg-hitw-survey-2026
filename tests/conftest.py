from __future__ import annotations

from pathlib import Path
import sys

import pytest
import yaml
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from webapp.app import AppConfig, STATIC_DIR, create_app


TRACK_GPX_TEXT = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="pytest" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Survey</name>
    <trkseg>
      <trkpt lat="35.1000" lon="-115.4000">
        <ele>1000</ele>
      </trkpt>
      <trkpt lat="35.1005" lon="-115.4005">
        <ele>1010</ele>
      </trkpt>
      <trkpt lat="35.1010" lon="-115.4010">
        <ele>1020</ele>
      </trkpt>
    </trkseg>
  </trk>
</gpx>
"""

PINS_GPX_TEXT = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="pytest" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="35.1004" lon="-115.4004">
    <name>Ranger note</name>
    <time>2026-04-17T09:00:00Z</time>
    <ele>1008</ele>
  </wpt>
  <wpt lat="35.1011" lon="-115.4011">
    <name></name>
  </wpt>
</gpx>
"""


def write_manifest(path: Path, photos: list[dict]) -> None:
    path.write_text(
        yaml.safe_dump(
            {"photos": photos},
            sort_keys=False,
            allow_unicode=True,
            default_flow_style=False,
        ),
        encoding="utf-8",
    )


@pytest.fixture
def app_config(tmp_path: Path) -> AppConfig:
    photos_dir = tmp_path / "photos"
    track_dir = tmp_path / "track"
    cache_dir = tmp_path / "cache"
    photos_dir.mkdir()
    track_dir.mkdir()
    (track_dir / "MHCG-HITW-SURVEY.gpx").write_text(TRACK_GPX_TEXT, encoding="utf-8")
    (track_dir / "MHCG-HITW-PINS.gpx").write_text(PINS_GPX_TEXT, encoding="utf-8")
    (photos_dir / "photo-1.jpg").write_bytes(b"jpeg-bytes-1")
    write_manifest(
        tmp_path / "survey_photos.yaml",
        [
            {
                "filename": "photo-1.jpg",
                "taken_at": "2026-04-17T08:26:25-07:00",
                "latitude": 35.1001,
                "longitude": -115.4001,
                "notes": "first note",
            },
            {
                "filename": "photo-2.jpg",
                "taken_at": "2026-04-17T08:30:00-07:00",
                "latitude": 35.1006,
                "longitude": -115.4006,
                "notes": "",
            },
        ],
    )
    return AppConfig(
        photos_dir=photos_dir.resolve(),
        track_dir=track_dir.resolve(),
        gpx_path=(track_dir / "MHCG-HITW-SURVEY.gpx").resolve(),
        pins_gpx_path=(track_dir / "MHCG-HITW-PINS.gpx").resolve(),
        yaml_path=(tmp_path / "survey_photos.yaml").resolve(),
        static_dir=STATIC_DIR.resolve(),
        photo_remote_base_url="",
        photo_cache_dir=cache_dir.resolve(),
        photo_download_timeout_seconds=3,
        notes_read_only=False,
    )


@pytest.fixture
def client(app_config: AppConfig) -> TestClient:
    return TestClient(create_app(app_config))
