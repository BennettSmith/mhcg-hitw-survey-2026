#!/usr/bin/env python3
"""
Read EXIF from trail photos and write a YAML manifest (filename, timestamp, lat/lon).

Usage (from repo root, after `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`):

  .venv/bin/python3 scripts/extract_photo_exif_to_yaml.py
  .venv/bin/python3 scripts/extract_photo_exif_to_yaml.py --photos photos --out survey_photos.yaml
  .venv/bin/python3 scripts/extract_photo_exif_to_yaml.py --tz America/Los_Angeles
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml
from PIL import Image
from PIL.ExifTags import Base


def _scalar_to_float(x: object) -> float:
    if hasattr(x, "numerator") and hasattr(x, "denominator"):
        d = int(x.denominator)
        if d == 0:
            return 0.0
        return float(x.numerator) / float(d)
    if isinstance(x, tuple) and len(x) == 2:
        num, den = x
        if float(den) == 0:
            return 0.0
        return float(num) / float(den)
    return float(x)


def dms_to_decimal(dms: tuple, ref: str | bytes) -> float:
    d, m, s = dms
    dec = _scalar_to_float(d) + _scalar_to_float(m) / 60.0 + _scalar_to_float(s) / 3600.0
    r = ref.decode() if isinstance(ref, bytes) else str(ref)
    if r in ("S", "W"):
        dec = -dec
    return dec


def exif_datetime_raw(exif) -> str | None:
    if exif is None:
        return None
    for key in (Base.DateTimeOriginal, Base.DateTimeDigitized, Base.DateTime):
        v = exif.get(key)
        if v:
            return str(v).strip()
    return None


def exif_datetime_to_iso8601(raw: str, tz_name: str) -> str | None:
    """
    EXIF date/time is a local wall-clock string (no offset). Interpret it in tz_name
    and return ISO-8601 with numeric offset (e.g. PDT -> -07:00).
    """
    s = raw.strip()
    tz = ZoneInfo(tz_name)
    naive: datetime | None = None
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            naive = datetime.strptime(s, fmt)
            break
        except ValueError:
            continue
    if naive is None:
        return None
    return naive.replace(tzinfo=tz).isoformat(timespec="seconds")


def exif_lat_lon(exif) -> tuple[float | None, float | None]:
    if exif is None:
        return None, None
    gps = exif.get_ifd(Base.GPSInfo)
    if not gps:
        return None, None
    try:
        lat = dms_to_decimal(gps[2], gps[1])
        lon = dms_to_decimal(gps[4], gps[3])
        return lat, lon
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None, None


def iter_image_paths(photos_dir: Path) -> list[Path]:
    paths: list[Path] = []
    for pattern in ("*.jpg", "*.jpeg", "*.JPG", "*.JPEG", "*.heic", "*.HEIC"):
        paths.extend(photos_dir.glob(pattern))
    return sorted(set(paths), key=lambda p: p.name.lower())


def main() -> int:
    ap = argparse.ArgumentParser(description="Build YAML from photo EXIF (time + GPS).")
    ap.add_argument(
        "--photos",
        type=Path,
        default=Path("photos"),
        help="Directory containing images (default: ./photos)",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("survey_photos.yaml"),
        help="Output YAML path (default: ./survey_photos.yaml)",
    )
    ap.add_argument(
        "--tz",
        default="America/Los_Angeles",
        metavar="IANA",
        help="IANA timezone for EXIF wall-clock times (default: America/Los_Angeles)",
    )
    args = ap.parse_args()
    photos_dir = args.photos.resolve()
    if not photos_dir.is_dir():
        print(f"Not a directory: {photos_dir}", file=sys.stderr)
        return 1

    records: list[dict] = []
    skipped: list[str] = []

    for path in iter_image_paths(photos_dir):
        try:
            with Image.open(path) as img:
                exif = img.getexif()
        except OSError as e:
            skipped.append(f"{path.name}: {e}")
            continue

        taken_raw = exif_datetime_raw(exif)
        taken_iso = exif_datetime_to_iso8601(taken_raw, args.tz) if taken_raw else None
        lat, lon = exif_lat_lon(exif)
        missing_parts: list[str] = []
        if taken_raw is None:
            missing_parts.append("datetime")
        elif taken_iso is None:
            missing_parts.append("datetime_parse")
        if lat is None or lon is None:
            missing_parts.append("gps")
        if missing_parts:
            skipped.append(f"{path.name}: missing {'/'.join(missing_parts)}")
            continue

        records.append(
            {
                "filename": path.name,
                "taken_at": taken_iso,
                "latitude": round(lat, 7),
                "longitude": round(lon, 7),
            }
        )

    out_path = args.out.resolve()
    out_path.write_text(
        yaml.safe_dump(
            {"photos": records},
            sort_keys=False,
            allow_unicode=True,
            default_flow_style=False,
        ),
        encoding="utf-8",
    )

    print(f"Wrote {len(records)} records to {out_path}")
    if skipped:
        print(f"Skipped {len(skipped)} file(s):", file=sys.stderr)
        for line in skipped[:20]:
            print(f"  {line}", file=sys.stderr)
        if len(skipped) > 20:
            print(f"  ... and {len(skipped) - 20} more", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
