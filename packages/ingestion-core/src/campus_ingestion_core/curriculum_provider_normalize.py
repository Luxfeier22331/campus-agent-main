from __future__ import annotations

import json

from campus_ingestion_core.readable_text_normalization import normalize_readable_text
from campus_ingestion_core.source_truth_common import serialize_layout_rows

from .curriculum_provider_normalize_relationships import _enrich_source_truth_rows
from .curriculum_provider_normalize_shared import (
    _normalize_page_payload,
    _slugify_filename,
)
from .curriculum_source_truth_validation import validate_curriculum_source_truth_rows


def normalize_curriculum_provider_result(
    *,
    provider_jsonl_bytes: bytes,
    source_pdf: str,
    ocr_provider: str,
    ocr_model: str,
) -> bytes:
    raw_lines = [
        line.strip() for line in provider_jsonl_bytes.decode("utf-8").splitlines() if line.strip()
    ]
    if not raw_lines:
        raise ValueError("curriculum provider result is empty")

    source_slug = _slugify_filename(source_pdf)
    rows: list[dict[str, object]] = []
    page_index = 0
    row_index = 0

    for line_number, line in enumerate(raw_lines, start=1):
        try:
            provider_payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"curriculum provider result line {line_number} is not valid JSON"
            ) from exc
        if not isinstance(provider_payload, dict):
            raise ValueError(f"curriculum provider result line {line_number} must be a JSON object")

        result_payload = provider_payload.get("result")
        if not isinstance(result_payload, dict):
            raise ValueError(
                f"curriculum provider result line {line_number} missing result payload"
            )
        layout_results = result_payload.get("layoutParsingResults")
        if not isinstance(layout_results, list) or not layout_results:
            raise ValueError(
                f"curriculum provider result line {line_number} missing layoutParsingResults"
            )

        log_id = str(provider_payload.get("logId") or f"line-{line_number}")
        for page_offset, page_payload in enumerate(layout_results, start=1):
            if not isinstance(page_payload, dict):
                raise ValueError(
                    f"curriculum provider page payload {line_number}:{page_offset} must be an object"
                )
            page_index += 1
            parsed_rows = _normalize_page_payload(
                page_payload=page_payload,
                source_pdf=source_pdf,
                source_slug=source_slug,
                ocr_provider=ocr_provider,
                ocr_model=ocr_model,
                provider_log_id=log_id,
                provider_page_id=page_index,
                row_index_start=row_index,
            )
            row_index += len(parsed_rows)
            rows.extend(parsed_rows)

    if not rows:
        raise ValueError("curriculum provider normalization produced no rows")

    _enrich_source_truth_rows(rows)
    _enrich_readable_text(rows)
    validate_curriculum_source_truth_rows(rows)
    return serialize_layout_rows(rows)


def _enrich_readable_text(rows: list[dict[str, object]]) -> None:
    for row in rows:
        text = str(row.get("clean_text") or row.get("text_normalized") or "").strip()
        if text:
            row["text_readable"] = normalize_readable_text(text)
        html = str(row.get("html") or "").strip()
        if html:
            row["html_readable"] = normalize_readable_text(html)
