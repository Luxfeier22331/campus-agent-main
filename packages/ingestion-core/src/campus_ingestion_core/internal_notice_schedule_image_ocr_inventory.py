from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from pathlib import Path

from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrEvidence,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_scalars import (
    _attachment_ref_id,
    _int,
    _required_text,
    _text,
)


def load_schedule_image_ocr_evidence_inventory(
    path: Path,
) -> tuple[ScheduleImageOcrEvidence, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("schedule image OCR inventory must be a JSON list")
    return build_schedule_image_ocr_evidence_inventory_from_rows(
        raw for raw in payload if isinstance(raw, Mapping)
    )


def build_schedule_image_ocr_evidence_inventory_from_rows(
    rows: Iterable[Mapping[str, object]],
) -> tuple[ScheduleImageOcrEvidence, ...]:
    entries: list[ScheduleImageOcrEvidence] = []
    for raw in rows:
        object_key = _text(raw.get("object_key"))
        sha256 = _text(raw.get("sha256"))
        if not object_key or not bool(raw.get("object_exists")) or not sha256:
            continue
        entries.append(
            ScheduleImageOcrEvidence(
                notice_id=_required_text(raw, "notice_id"),
                notice_title=_text(raw.get("notice_title")),
                release_time=_text(raw.get("release_time")),
                organization=_text(raw.get("organization")),
                image_index=_int(raw.get("image_index"), default=0),
                attachment_ref_id=_attachment_ref_id(raw),
                filename=_text(raw.get("filename")),
                mime_type=_text(raw.get("mime_type")) or "application/octet-stream",
                byte_size=_int(raw.get("byte_size"), default=0),
                sha256=sha256,
                object_key=object_key,
                image_use=_text(raw.get("image_use")) or "schedule_image_candidate",
                reason_codes=tuple(
                    _text(item) for item in (raw.get("reason_codes") or ()) if _text(item)
                ),
                context_before=_text(raw.get("context_before")),
                context_after=_text(raw.get("context_after")),
            )
        )
    return tuple(entries)
