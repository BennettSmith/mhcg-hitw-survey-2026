from __future__ import annotations

import json
from pathlib import Path

from scripts import check_coverage


def test_coverage_percent_for_file_reads_summary() -> None:
    report = {"files": {"webapp/app.py": {"summary": {"percent_covered": 91.5}}}}
    assert check_coverage.coverage_percent_for_file(report, "webapp/app.py") == 91.5


def test_check_report_passes_expected_files(capsys) -> None:
    report = {
        "files": {
            "webapp/app.py": {"summary": {"percent_covered": 90.0}},
            "scripts/extract_photo_exif_to_yaml.py": {"summary": {"percent_covered": 88.0}},
            "scripts/check_coverage.py": {"summary": {"percent_covered": 100.0}},
        }
    }
    assert check_coverage.check_report(report) == []
    out = capsys.readouterr().out
    assert "PASS webapp/app.py: 90.0%" in out


def test_check_report_fails_for_low_coverage_and_missing_file(capsys) -> None:
    report = {
        "files": {
            "webapp/app.py": {"summary": {"percent_covered": 84.9}},
            "scripts/extract_photo_exif_to_yaml.py": {"summary": {"percent_covered": 90.0}},
        }
    }
    failures = check_coverage.check_report(report)
    out = capsys.readouterr().out
    assert "FAIL webapp/app.py: 84.9% (required 85.0%)" in failures
    assert "missing from coverage report" in failures[1]
    assert "FAIL webapp/app.py: 84.9%" in out


def test_main_handles_usage_errors(tmp_path: Path, capsys) -> None:
    assert check_coverage.main([]) == 2
    assert "Usage:" in capsys.readouterr().err
    missing = tmp_path / "missing.json"
    assert check_coverage.main([str(missing)]) == 2
    assert "Coverage report not found" in capsys.readouterr().err


def test_main_reads_report_file(tmp_path: Path) -> None:
    path = tmp_path / "coverage.json"
    path.write_text(
        json.dumps(
            {
                "files": {
                    "webapp/app.py": {"summary": {"percent_covered": 100.0}},
                    "scripts/extract_photo_exif_to_yaml.py": {"summary": {"percent_covered": 100.0}},
                    "scripts/check_coverage.py": {"summary": {"percent_covered": 100.0}},
                }
            }
        ),
        encoding="utf-8",
    )
    assert check_coverage.main([str(path)]) == 0
