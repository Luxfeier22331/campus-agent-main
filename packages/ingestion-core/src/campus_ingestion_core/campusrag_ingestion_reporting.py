from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ImportReport:
    import_mode: str
    success_count: int
    skipped_count: int
    failed_count: int
    raw_uploaded_count: int
    raw_reused_count: int
    document_ids: tuple[str, ...]
    unresolved_source_pdfs: tuple[str, ...]
    errors: tuple[str, ...]
    report_path: str
    created_document_ids: tuple[str, ...] = ()
    updated_document_ids: tuple[str, ...] = ()
    skipped_document_ids: tuple[str, ...] = ()


def write_import_report(
    *,
    import_mode: str,
    report_dir: Path,
    report_prefix: str,
    success_count: int,
    skipped_count: int,
    failed_count: int,
    raw_uploaded_count: int,
    raw_reused_count: int,
    document_ids: tuple[str, ...],
    unresolved_source_pdfs: tuple[str, ...],
    errors: tuple[str, ...],
    timestamp: str,
    created_document_ids: tuple[str, ...] = (),
    updated_document_ids: tuple[str, ...] = (),
    skipped_document_ids: tuple[str, ...] = (),
) -> ImportReport:
    report_dir.mkdir(parents=True, exist_ok=True)
    safe_timestamp = timestamp.replace(":", "").replace("+", "_plus_")
    report_path = report_dir / f"{report_prefix}-{safe_timestamp}.json"
    payload = {
        "import_mode": import_mode,
        "success_count": success_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "raw_uploaded_count": raw_uploaded_count,
        "raw_reused_count": raw_reused_count,
        "document_ids": list(document_ids),
        "created_document_ids": list(created_document_ids),
        "updated_document_ids": list(updated_document_ids),
        "skipped_document_ids": list(skipped_document_ids),
        "unresolved_source_pdfs": list(unresolved_source_pdfs),
        "errors": list(errors),
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return ImportReport(
        import_mode=import_mode,
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=document_ids,
        unresolved_source_pdfs=unresolved_source_pdfs,
        errors=errors,
        report_path=str(report_path),
        created_document_ids=created_document_ids,
        updated_document_ids=updated_document_ids,
        skipped_document_ids=skipped_document_ids,
    )


def utc_now() -> str:
    return datetime.now(UTC).isoformat()
