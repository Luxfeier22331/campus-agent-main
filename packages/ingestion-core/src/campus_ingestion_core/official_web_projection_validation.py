from __future__ import annotations

from pathlib import Path

from campus_ingestion_core.official_web_projection_shared import (
    OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
    OfficialWebProjectionValidationReport,
    _read_json,
    _read_jsonl,
    _require_text,
)


def validate_official_web_projection_output(
    projection_output_dir: Path,
) -> OfficialWebProjectionValidationReport:
    issues: list[dict[str, object]] = []
    report_path = projection_output_dir / "projection-report.json"
    if not report_path.exists():
        return OfficialWebProjectionValidationReport(
            schema_version=OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
            valid=False,
            projection_output_dir=str(projection_output_dir.resolve()),
            issues=[
                {
                    "severity": "error",
                    "code": "missing_projection_report",
                    "message": "missing projection-report.json",
                }
            ],
            counts={"documents": 0, "errors": 1, "warnings": 0},
        )

    try:
        report_payload = _read_json(report_path)
    except ValueError as exc:
        return OfficialWebProjectionValidationReport(
            schema_version=OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
            valid=False,
            projection_output_dir=str(projection_output_dir.resolve()),
            issues=[
                {
                    "severity": "error",
                    "code": "projection_report_parse_failed",
                    "message": str(exc),
                }
            ],
            counts={"documents": 0, "errors": 1, "warnings": 0},
        )

    documents = report_payload.get("documents")
    if not isinstance(documents, list):
        issues.append(
            {
                "severity": "error",
                "code": "projection_report_documents_invalid",
                "message": "projection report documents must be an array",
            }
        )
        documents = []

    seen_document_ids: set[str] = set()
    for document in documents:
        if not isinstance(document, dict):
            issues.append(
                {
                    "severity": "error",
                    "code": "projection_report_document_invalid",
                    "message": "projection report document entry must be an object",
                }
            )
            continue
        document_id = _require_text(document.get("document_id"), "document_id")
        version_id = _require_text(document.get("version_id"), "version_id")
        if document_id in seen_document_ids:
            issues.append(
                {
                    "severity": "error",
                    "code": "duplicate_document_id",
                    "message": f"duplicate projected document_id: {document_id}",
                }
            )
        seen_document_ids.add(document_id)

        canonical_path = Path(
            _require_text(document.get("canonical_markdown_path"), "canonical_markdown_path")
        )
        if not canonical_path.exists():
            issues.append(
                {
                    "severity": "error",
                    "code": "missing_canonical_markdown",
                    "message": f"missing canonical markdown for {document_id}",
                }
            )
        else:
            canonical_body = canonical_path.read_text(encoding="utf-8").strip()
            if (
                not canonical_body
                or canonical_body == f"# {_require_text(document.get('title'), 'title')}"
            ):
                issues.append(
                    {
                        "severity": "error",
                        "code": "empty_canonical_markdown",
                        "message": f"empty canonical markdown body for {document_id}",
                    }
                )

        document_units_path = Path(
            _require_text(document.get("document_units_path"), "document_units_path")
        )
        if not document_units_path.exists():
            issues.append(
                {
                    "severity": "error",
                    "code": "missing_document_units",
                    "message": f"missing document-units.jsonl for {document_id}",
                }
            )
            continue
        try:
            rows = _read_jsonl(document_units_path)
        except ValueError as exc:
            issues.append(
                {
                    "severity": "error",
                    "code": "document_units_parse_failed",
                    "message": f"{document_id}: {exc}",
                }
            )
            continue
        if not rows:
            issues.append(
                {
                    "severity": "error",
                    "code": "empty_document_units",
                    "message": f"document-units.jsonl is empty for {document_id}",
                }
            )
            continue
        for row in rows:
            if str(row.get("doc_id") or "").strip() != document_id:
                issues.append(
                    {
                        "severity": "error",
                        "code": "document_identity_mismatch",
                        "message": f"document-units doc_id mismatch for {document_id}",
                    }
                )
                break
            if str(row.get("version_id") or "").strip() != version_id:
                issues.append(
                    {
                        "severity": "error",
                        "code": "document_identity_mismatch",
                        "message": f"document-units version_id mismatch for {document_id}",
                    }
                )
                break

    errors = sum(1 for issue in issues if issue["severity"] == "error")
    warnings = sum(1 for issue in issues if issue["severity"] == "warning")
    return OfficialWebProjectionValidationReport(
        schema_version=OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=errors == 0,
        projection_output_dir=str(projection_output_dir.resolve()),
        issues=issues,
        counts={
            "documents": len(documents),
            "errors": errors,
            "warnings": warnings,
        },
    )
