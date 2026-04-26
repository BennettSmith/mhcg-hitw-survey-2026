from __future__ import annotations

from pathlib import Path

import yaml

from scripts import extract_photo_exif_to_yaml as extract


class Ratio:
    def __init__(self, numerator: int, denominator: int) -> None:
        self.numerator = numerator
        self.denominator = denominator


class FakeExif(dict):
    def __init__(self, *args, gps=None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._gps = gps

    def get_ifd(self, _tag):
        return self._gps


class FakeImage:
    def __init__(self, exif: FakeExif) -> None:
        self._exif = exif

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def getexif(self) -> FakeExif:
        return self._exif


def test_scalar_to_float_handles_ratio_tuple_and_plain_number() -> None:
    assert extract._scalar_to_float(Ratio(3, 2)) == 1.5
    assert extract._scalar_to_float((3, 2)) == 1.5
    assert extract._scalar_to_float((3, 0)) == 0.0
    assert extract._scalar_to_float(4) == 4.0


def test_dms_to_decimal_and_datetime_helpers() -> None:
    assert extract.dms_to_decimal(((35, 1), (30, 1), (0, 1)), "N") == 35.5
    assert extract.dms_to_decimal(((115, 1), (0, 1), (0, 1)), b"W") == -115.0
    assert extract.exif_datetime_raw(None) is None
    exif = FakeExif({extract.Base.DateTimeDigitized: "2026:04:17 08:26:25"})
    assert extract.exif_datetime_raw(exif) == "2026:04:17 08:26:25"
    assert extract.exif_datetime_to_iso8601("2026:04:17 08:26:25", "America/Los_Angeles") == "2026-04-17T08:26:25-07:00"
    assert extract.exif_datetime_to_iso8601("bad", "America/Los_Angeles") is None


def test_exif_lat_lon_returns_none_on_bad_data() -> None:
    good = FakeExif(gps={1: "N", 2: ((35, 1), (30, 1), (0, 1)), 3: "W", 4: ((115, 1), (0, 1), (0, 1))})
    assert extract.exif_lat_lon(good) == (35.5, -115.0)
    assert extract.exif_lat_lon(FakeExif(gps={})) == (None, None)
    assert extract.exif_lat_lon(FakeExif(gps={1: "N"})) == (None, None)


def test_load_existing_notes_and_iter_image_paths(tmp_path: Path) -> None:
    yaml_path = tmp_path / "survey_photos.yaml"
    yaml_path.write_text(
        yaml.safe_dump(
            {
                "photos": [
                    {"filename": "a.jpg", "notes": "note a"},
                    {"filename": "b.jpg", "notes": None},
                    {"filename": "", "notes": "skip"},
                ]
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    assert extract.load_existing_notes_by_filename(yaml_path) == {"a.jpg": "note a", "b.jpg": ""}
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir()
    for name in ["b.JPG", "a.jpg", "A.HEIC", "note.txt"]:
        (photos_dir / name).write_bytes(b"x")
    assert [p.name for p in extract.iter_image_paths(photos_dir)] == ["A.HEIC", "a.jpg", "b.JPG"]


def test_main_requires_directory(monkeypatch, capsys, tmp_path: Path) -> None:
    missing_dir = tmp_path / "missing"
    monkeypatch.setattr("sys.argv", ["extract", "--photos", str(missing_dir)])
    assert extract.main() == 1
    assert "Not a directory" in capsys.readouterr().err


def test_main_writes_yaml_and_preserves_notes(monkeypatch, tmp_path: Path, capsys) -> None:
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir()
    out_path = tmp_path / "survey_photos.yaml"
    for name in ["good.jpg", "bad.jpg", "missing.jpg"]:
        (photos_dir / name).write_bytes(b"bytes")

    out_path.write_text(
        yaml.safe_dump({"photos": [{"filename": "good.jpg", "notes": "keep me"}]}, sort_keys=False),
        encoding="utf-8",
    )

    good_exif = FakeExif(
        {
            extract.Base.DateTimeOriginal: "2026:04:17 08:26:25",
        },
        gps={1: "N", 2: ((35, 1), (6, 1), (0, 1)), 3: "W", 4: ((115, 1), (24, 1), (0, 1))},
    )
    missing_exif = FakeExif({extract.Base.DateTimeOriginal: "2026:04:17 08:26:25"}, gps={})

    def fake_open(path: Path):
        if path.name == "good.jpg":
            return FakeImage(good_exif)
        if path.name == "missing.jpg":
            return FakeImage(missing_exif)
        raise OSError("cannot open")

    monkeypatch.setattr(extract.Image, "open", fake_open)
    monkeypatch.setattr(
        "sys.argv",
        ["extract", "--photos", str(photos_dir), "--out", str(out_path), "--tz", "America/Los_Angeles"],
    )
    assert extract.main() == 0
    data = yaml.safe_load(out_path.read_text(encoding="utf-8"))
    assert data == {
        "photos": [
            {
                "filename": "good.jpg",
                "taken_at": "2026-04-17T08:26:25-07:00",
                "latitude": 35.1,
                "longitude": -115.4,
                "notes": "keep me",
            }
        ]
    }
    captured = capsys.readouterr()
    assert "Wrote 1 records" in captured.out
    assert "Skipped 2 file(s):" in captured.err
    assert "bad.jpg: cannot open" in captured.err
    assert "missing.jpg: missing gps" in captured.err
