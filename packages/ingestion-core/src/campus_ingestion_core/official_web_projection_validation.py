from __future__ import annotations

from pathlib import Path

from campus_ingestion_core.official_web_projection_shared import (
    OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
    OfficialWebProjectionValidationReport,
    _read_json,
    _read_jsonl,
    _require_text,
)

_CONSUMER_CANDIDATE_FAMILIES = frozenset(
    {
        "contact_directory_candidate",
        "service_guide_candidate",
        "notice_news_candidate",
    }
)
_CONSUMER_CANDIDATE_MATERIALIZATION_POLICIES = frozenset({"candidate_only", "inventory_only"})
_SELECTED_WRITE_CANDIDATE_FAMILIES = frozenset(
    {"contact_directory_candidate", "service_guide_candidate"}
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
    consumer_candidate_pages = report_payload.get("consumer_candidate_pages")
    if consumer_candidate_pages is None:
        consumer_candidate_pages = []
    if not isinstance(consumer_candidate_pages, list):
        issues.append(
            {
                "severity": "error",
                "code": "projection_report_consumer_candidate_pages_invalid",
                "message": "projection report consumer_candidate_pages must be an array",
            }
        )
        consumer_candidate_pages = []

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

    for candidate in consumer_candidate_pages:
        if not isinstance(candidate, dict):
            issues.append(
                {
                    "severity": "error",
                    "code": "consumer_candidate_invalid",
                    "message": "consumer candidate entry must be an object",
                }
            )
            continue
        _validate_consumer_candidate(candidate=candidate, issues=issues)

    errors = sum(1 for issue in issues if issue["severity"] == "error")
    warnings = sum(1 for issue in issues if issue["severity"] == "warning")
    return OfficialWebProjectionValidationReport(
        schema_version=OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=errors == 0,
        projection_output_dir=str(projection_output_dir.resolve()),
        issues=issues,
        counts={
            "documents": len(documents),
            "consumer_candidate_pages": len(consumer_candidate_pages),
            "errors": errors,
            "warnings": warnings,
        },
    )


def _validate_consumer_candidate(
    *,
    candidate: dict[str, object],
    issues: list[dict[str, object]],
) -> None:
    consumer_family = _optional_text(candidate.get("consumer_family"))
    materialization_policy = _optional_text(candidate.get("materialization_policy"))
    selected_write_target = _optional_text(candidate.get("selected_write_target"))
    matched_evidence = _string_list(candidate.get("matched_evidence"))

    if consumer_family not in _CONSUMER_CANDIDATE_FAMILIES:
        issues.append(
            {
                "severity": "error",
                "code": "unsupported_consumer_candidate_family",
                "message": f"unsupported consumer candidate family: {consumer_family or '<empty>'}",
            }
        )
    if materialization_policy not in _CONSUMER_CANDIDATE_MATERIALIZATION_POLICIES:
        issues.append(
            {
                "severity": "error",
                "code": "unsupported_consumer_candidate_materialization_policy",
                "message": (
                    "unsupported consumer candidate materialization policy: "
                    f"{materialization_policy or '<empty>'}"
                ),
            }
        )
    for field_name in (
        "target_corpus",
        "target_collection",
        "normalized_canonical_url",
        "raw_asset_id",
        "raw_version_id",
        "title",
        "review_policy",
    ):
        if _optional_text(candidate.get(field_name)) is None:
            issues.append(
                {
                    "severity": "error",
                    "code": "consumer_candidate_missing_required_field",
                    "message": f"consumer candidate missing required field: {field_name}",
                }
            )
    if not matched_evidence:
        issues.append(
            {
                "severity": "error",
                "code": "consumer_candidate_missing_matched_evidence",
                "message": "consumer candidate must include matched_evidence",
            }
        )
    if consumer_family in _SELECTED_WRITE_CANDIDATE_FAMILIES and selected_write_target is None:
        issues.append(
            {
                "severity": "error",
                "code": "consumer_candidate_missing_selected_write_target",
                "message": (
                    "contact/service consumer candidates must include selected_write_target"
                ),
            }
        )
    if consumer_family == "notice_news_candidate" and selected_write_target is not None:
        issues.append(
            {
                "severity": "error",
                "code": "notice_news_candidate_must_stay_inventory_only",
                "message": "notice/news consumer candidates must not define selected_write_target",
            }
        )


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, str) and item.strip()]
