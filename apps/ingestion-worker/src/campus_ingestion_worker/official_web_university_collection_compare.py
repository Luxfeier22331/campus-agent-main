from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_worker.official_web_university_collection_constants import (
    UNIVERSITY_COLLECTION_COMPARE_SCHEMA_VERSION,
)
from campus_ingestion_worker.official_web_university_collection_io import (
    _non_empty_text,
    _normalize_text,
    _read_required_json,
    _utc_now_iso,
    _write_json,
)


def compare_official_web_university_collection_runs(
    *,
    current_run_report_path: Path | str,
    previous_run_report_path: Path | str,
    drop_threshold_ratio: float = 0.7,
    output_path: Path | str | None = None,
) -> dict[str, Any]:
    current_report_path = Path(current_run_report_path).resolve()
    previous_report_path = Path(previous_run_report_path).resolve()
    current_report = _read_required_json(current_report_path, name="current run report")
    previous_report = _read_required_json(previous_report_path, name="previous run report")

    current_projection = Path(
        _non_empty_text(
            current_report.get("projection_output_dir"), field="current projection_output_dir"
        )
    )
    previous_projection = Path(
        _non_empty_text(
            previous_report.get("projection_output_dir"), field="previous projection_output_dir"
        )
    )
    current_documents = _load_projection_documents(current_projection)
    previous_documents = _load_projection_documents(previous_projection)

    current_urls = _canonical_urls(current_documents)
    previous_urls = _canonical_urls(previous_documents)
    current_set = set(current_urls)
    previous_set = set(previous_urls)
    missing_urls = sorted(previous_set - current_set)
    new_urls = sorted(current_set - previous_set)
    current_duplicates = sorted([url for url, count in Counter(current_urls).items() if count > 1])

    previous_count = len(previous_documents)
    current_count = len(current_documents)
    drop_ratio = round(current_count / previous_count, 4) if previous_count > 0 else None
    drop_alert = bool(drop_ratio is not None and drop_ratio < drop_threshold_ratio)

    status = "succeeded"
    reasons: list[str] = []
    if current_duplicates:
        status = "failed"
        reasons.append("duplicate_canonical_url_detected")
    if drop_alert:
        status = "failed"
        reasons.append("document_count_drop_exceeded_threshold")

    report = {
        "schema_version": UNIVERSITY_COLLECTION_COMPARE_SCHEMA_VERSION,
        "status": status,
        "current_run_report_path": str(current_report_path),
        "previous_run_report_path": str(previous_report_path),
        "current_projection_output_dir": str(current_projection),
        "previous_projection_output_dir": str(previous_projection),
        "drop_threshold_ratio": drop_threshold_ratio,
        "counts": {
            "previous_documents": previous_count,
            "current_documents": current_count,
            "missing_url_count": len(missing_urls),
            "new_url_count": len(new_urls),
            "duplicate_canonical_url_count": len(current_duplicates),
        },
        "drop_ratio": drop_ratio,
        "drop_alert": drop_alert,
        "failure_reasons": reasons,
        "missing_urls_sample": missing_urls[:50],
        "new_urls_sample": new_urls[:50],
        "duplicate_canonical_urls": current_duplicates[:50],
        "generated_at": _utc_now_iso(),
    }
    if output_path is not None:
        _write_json(Path(output_path).resolve(), report)
    return report


def _load_projection_documents(projection_output_dir: Path) -> list[dict[str, Any]]:
    projection_report = _read_required_json(
        projection_output_dir / "projection-report.json",
        name=f"projection report under {projection_output_dir}",
    )
    documents = projection_report.get("documents")
    if not isinstance(documents, list):
        raise ValueError("projection report documents must be an array")
    resolved: list[dict[str, Any]] = []
    for document in documents:
        if isinstance(document, dict):
            resolved.append(document)
    return resolved


def _canonical_urls(documents: Sequence[Mapping[str, Any]]) -> list[str]:
    urls: list[str] = []
    for document in documents:
        url = _normalize_text(document.get("normalized_canonical_url"))
        if url:
            urls.append(url)
    return urls
