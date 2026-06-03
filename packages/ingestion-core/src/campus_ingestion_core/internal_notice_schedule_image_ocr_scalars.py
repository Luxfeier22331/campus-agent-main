from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrEvidence,
)


def _required_text(raw: Mapping[str, Any], key: str) -> str:
    value = _text(raw.get(key))
    if not value:
        raise ValueError(f"schedule image OCR inventory row missing {key}")
    return value


def _text(value: object) -> str:
    return str(value or "").strip()


def _int(value: object, *, default: int) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _attachment_ref_id(raw: Mapping[str, Any]) -> str:
    value = _text(raw.get("attachment_ref_id"))
    if value:
        return normalize_schedule_image_ocr_attachment_ref_id(value)
    attachment_id = _text(raw.get("attachment_id"))
    if attachment_id:
        return normalize_schedule_image_ocr_attachment_ref_id(f"attachment-{attachment_id}")
    return f"image-{_int(raw.get('image_index'), default=0)}"


def normalize_schedule_image_ocr_attachment_ref_id(value: object) -> str:
    text = _text(value)
    match = re.fullmatch(r"attachment-(\d+)", text)
    if match is None:
        return text
    return f"attachment-{int(match.group(1)):04d}"


def _verify_sha256(*, evidence: ScheduleImageOcrEvidence, image_bytes: bytes) -> None:
    digest = hashlib.sha256(image_bytes).hexdigest()
    if digest != evidence.sha256:
        raise ValueError(
            "schedule image OCR source sha256 mismatch: "
            f"notice_id={evidence.notice_id} image_index={evidence.image_index}"
        )


def _clean_context_line(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _compact(value: str) -> str:
    return "".join(str(value or "").split())
