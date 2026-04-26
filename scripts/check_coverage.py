#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from pathlib import Path

MIN_LINE_COVERAGE = 85.0
EXPECTED_FILES = (
    "webapp/app.py",
    "scripts/extract_photo_exif_to_yaml.py",
    "scripts/check_coverage.py",
)


def load_coverage_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def coverage_percent_for_file(report: dict, file_path: str) -> float:
    files = report.get("files") or {}
    if file_path not in files:
        raise KeyError(file_path)
    summary = files[file_path].get("summary") or {}
    return float(summary.get("percent_covered", 0.0))


def check_report(report: dict, expected_files: tuple[str, ...] = EXPECTED_FILES) -> list[str]:
    failures: list[str] = []
    for file_path in expected_files:
        try:
            percent = coverage_percent_for_file(report, file_path)
        except KeyError:
            failures.append(f"FAIL {file_path}: missing from coverage report")
            continue

        status = "PASS" if percent >= MIN_LINE_COVERAGE else "FAIL"
        line = f"{status} {file_path}: {percent:.1f}% (required {MIN_LINE_COVERAGE:.1f}%)"
        print(line)
        if status == "FAIL":
            failures.append(line)
    return failures


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print("Usage: scripts/check_coverage.py <coverage.json>", file=sys.stderr)
        return 2

    report_path = Path(args[0])
    if not report_path.is_file():
        print(f"Coverage report not found: {report_path}", file=sys.stderr)
        return 2

    report = load_coverage_json(report_path)
    failures = check_report(report)
    if failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
