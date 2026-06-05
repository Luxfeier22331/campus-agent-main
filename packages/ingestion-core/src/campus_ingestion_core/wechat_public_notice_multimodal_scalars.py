from __future__ import annotations

import hashlib
import json
import mimetypes
import re
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import urlparse

from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    WeChatPublicNoticeImageStatus,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeMultimodalObjectStore,
)


def _load_media_rows(payload: bytes) -> tuple[dict[str, object], ...]:
    rows: list[dict[str, object]] = []
    for index, line in enumerate(payload.decode("utf-8").splitlines(), start=1):
        normalized = line.strip()
        if not normalized:
            continue
        parsed = json.loads(normalized)
        if not isinstance(parsed, dict):
            raise ValueError(f"media_refs line {index} must be a JSON object")
        rows.append(dict(parsed))
    return tuple(rows)


def _load_json_if_present(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    key: str,
) -> dict[str, object] | None:
    try:
        payload = object_store.get_bytes(bucket=bucket, key=key)
    except Exception:
        return None
    parsed = json.loads(payload.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError(f"{key} must decode to a JSON object")
    return dict(parsed)


def _required_text(value: object, *, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{label} is required")
    return text


def _resolve_notice_title(entry) -> str:
    metadata = dict(entry.role_metadata or {})
    return (
        str(metadata.get("notice_title") or "").strip()
        or str(metadata.get("title") or "").strip()
        or str(metadata.get("title_normalized") or "").strip()
        or entry.source_notice_id
    )


def _slugify_segment(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", str(value or "").strip()).strip("-").lower()
    if normalized:
        return normalized[:96]
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()[:16]


def _infer_image_extension(*, content_type: str, source_url: str) -> str:
    guessed = mimetypes.guess_extension(content_type, strict=False) or ""
    if guessed:
        return guessed
    path = urlparse(source_url).path
    if "." in path.rsplit("/", 1)[-1]:
        suffix = "." + path.rsplit(".", 1)[-1].lower()
        if len(suffix) <= 8:
            return suffix
    return ".bin"


def _publish_year(value: str) -> str:
    text = str(value or "").strip()
    match = re.search(r"(19|20)\d{2}", text)
    if match:
        return match.group(0)
    return "undated"


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _model_slug(*, provider: str, model: str) -> str:
    return _slugify_segment(f"{provider}-{model}")


def _layout_elements_jsonl(elements: Sequence[Mapping[str, Any]]) -> str:
    return "".join(json.dumps(dict(item), ensure_ascii=False) + "\n" for item in elements)


def _document_units_jsonl(units: Sequence[Mapping[str, Any]]) -> str:
    return "".join(json.dumps(dict(item), ensure_ascii=False) + "\n" for item in units)


def _coerce_outcome_status(value: object) -> WeChatPublicNoticeImageStatus:
    text = str(value or "").strip()
    if text not in {"pending", "admitted", "no_extractable_text", "fetch_failed", "ocr_failed"}:
        raise ValueError(f"unsupported wechat inline image outcome status: {text}")
    return text  # type: ignore[return-value]
