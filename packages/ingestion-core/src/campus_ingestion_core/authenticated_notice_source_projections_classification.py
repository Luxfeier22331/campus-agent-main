from __future__ import annotations

import hashlib
import json
import re
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

from campus_ingestion_core.authenticated_notice_source_projections_shared import (
    _NORMALIZED_NOTICE_PROVIDER_SUFFIX,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MULTIMODAL_PROCESSING,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT,
    AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_OPERATIONAL_SCHEDULE_GUIDE_IMAGE,
    AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_SPATIAL_VISUAL_ASSET,
    AuthenticatedNoticeAttachmentClassificationResult,
    AuthenticatedNoticeProjectionObjectStore,
    AuthenticatedNoticeSourceProjectionsConfig,
    _find_processed_key,
    _load_json_payload,
    _normalize_extension,
    _normalize_optional_text,
    _parse_notice_document_id,
)
from campus_ingestion_core.authenticated_notice_source_projections_visual import (
    _looks_like_decorative_inline_fragment,
    _looks_like_machine_readable_code_asset,
    _looks_like_mobile_ui_screenshot,
    _looks_like_promotional_hero_image,
    _looks_like_spatial_visual_asset,
)
from campus_ingestion_core.file_asset_contract import (
    ExtractionOutcome,
    FileAssetExtractionRecord,
    serialize_file_asset_extraction_record,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.settings import ObjectStoreSettings

_HTML_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_HTML_ATTR_RE = re.compile(r'([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"')
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_ATTACHMENT_LABEL_PREFIX_RE = re.compile(
    r"^附件(?:(?:\s*[0-9一二三四五六七八九十]+)?\s*[:：/、.-]\s*|\s+)"
)
_UUIDISH_ATTACHMENT_STEM_RE = re.compile(
    r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_GENERIC_IMAGE_STEM_RE = re.compile(
    r"^(?:image|img|photo|picture|scan|screenshot)(?:[-_ ]?\d+)?$", re.IGNORECASE
)


def _classify_attachment_ref(
    *,
    attachment_ref: dict[str, Any],
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    attachment_context_by_ref_id: dict[str, str] | None = None,
) -> AuthenticatedNoticeAttachmentClassificationResult:
    if (
        _normalize_optional_text(attachment_ref.get("object_key")) is None
        or _normalize_optional_text(attachment_ref.get("content_sha256")) is None
        or _normalize_optional_text(attachment_ref.get("byte_size")) is None
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    storage_provider = _normalize_optional_text(attachment_ref.get("storage_provider"))
    ingest_status = _normalize_optional_text(attachment_ref.get("ingest_status"))
    if (
        storage_provider is not None
        and storage_provider.lower() in config.reference_only_storage_providers
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if ingest_status is not None and ingest_status.lower() in config.reference_only_ingest_statuses:
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    for url in (
        _normalize_optional_text(attachment_ref.get("source_url")),
        _normalize_optional_text(attachment_ref.get("normalized_source_url")),
        _normalize_optional_text(attachment_ref.get("final_url")),
    ):
        if url is None:
            continue
        lowered_url = url.lower()
        if any(token in lowered_url for token in config.reference_only_url_substrings):
            return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    mime_type = _normalize_optional_text(attachment_ref.get("mime_type"))
    extension = _normalize_extension(_guess_attachment_filename(attachment_ref))
    if extension is not None and extension in config.text_extractable_extensions:
        return AuthenticatedNoticeAttachmentClassificationResult("text_extractable")
    is_ocr_candidate = (
        mime_type is not None and mime_type.lower() in config.ocr_required_mime_types
    ) or (extension is not None and extension in config.ocr_required_extensions)
    if is_ocr_candidate:
        attachment_bytes = _load_attachment_bytes_for_classification(
            attachment_ref=attachment_ref,
            object_store=object_store,
            object_store_settings=object_store_settings,
        )
        inline_image_override = _classify_inline_image_override(
            attachment_ref=attachment_ref,
            attachment_bytes=attachment_bytes,
            attachment_context=_resolve_attachment_context(
                attachment_ref=attachment_ref,
                attachment_context_by_ref_id=attachment_context_by_ref_id,
            ),
        )
        if inline_image_override is not None:
            return inline_image_override
        review_reason = _classify_multimodal_processing_reason(
            attachment_ref=attachment_ref,
            attachment_bytes=attachment_bytes,
        )
        if review_reason is not None:
            return AuthenticatedNoticeAttachmentClassificationResult(
                classification="multimodal_processing_required",
                review_reason=review_reason,
            )
        return AuthenticatedNoticeAttachmentClassificationResult("ocr_required")
    return AuthenticatedNoticeAttachmentClassificationResult("unsupported_binary")


def _classify_multimodal_processing_reason(
    *,
    attachment_ref: dict[str, Any],
    attachment_bytes: bytes | None,
) -> str | None:
    resource_role = _normalize_optional_text(attachment_ref.get("resource_role"))
    if resource_role != "inline_image":
        return None
    if attachment_bytes is None:
        return None
    if _looks_like_spatial_visual_asset(attachment_bytes):
        return AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_SPATIAL_VISUAL_ASSET
    return None


def _classify_inline_image_override(
    *,
    attachment_ref: dict[str, Any],
    attachment_bytes: bytes | None,
    attachment_context: str | None,
) -> AuthenticatedNoticeAttachmentClassificationResult | None:
    resource_role = _normalize_optional_text(attachment_ref.get("resource_role"))
    if resource_role != "inline_image":
        return None
    if attachment_bytes is None:
        return None
    if _looks_like_machine_readable_code_asset(attachment_bytes):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if _looks_like_decorative_inline_fragment(attachment_bytes):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    return _classify_inline_image_context_override(
        attachment_bytes=attachment_bytes,
        attachment_context=attachment_context,
    )


def _classify_inline_image_context_override(
    *,
    attachment_bytes: bytes,
    attachment_context: str | None,
) -> AuthenticatedNoticeAttachmentClassificationResult | None:
    normalized_context = _normalize_attachment_context_text(attachment_context)
    if normalized_context is None:
        return None
    if any(token in normalized_context for token in ("二维码", "扫码")):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if "示例证书" in normalized_context:
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if any(token in normalized_context for token in ("社会实践活动", "知行中华")) and any(
        token in normalized_context for token in ("活动主题", "活动时间", "活动内容", "青春返乡行")
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if any(token in normalized_context for token in ("活动再次出发", "期待你的参加", "正式启动")):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if _looks_like_promotional_hero_image(attachment_bytes) and any(
        token in normalized_context
        for token in ("专场活动", "活动旨在", "故事大会", "期待你的参加", "正式启动")
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if _looks_like_promotional_hero_image(attachment_bytes) and any(
        token in normalized_context
        for token in ("社会实践活动", "活动主题", "活动时间", "活动内容", "青春返乡行")
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if _looks_like_mobile_ui_screenshot(attachment_bytes) and any(
        token in normalized_context
        for token in ("官方报名小程序", "报名小程序", "作品上传", "我的故事", "等待审核")
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if any(
        token in normalized_context
        for token in (
            "选课时间安排",
            "具体选课方式",
            "选课方式参考如下表格",
            "学习时间安排",
            "学习时间及考试安排",
            "选课操作流程",
        )
    ):
        return AuthenticatedNoticeAttachmentClassificationResult(
            "multimodal_processing_required",
            review_reason=AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_OPERATIONAL_SCHEDULE_GUIDE_IMAGE,
        )
    return None


def _load_attachment_bytes_for_classification(
    *,
    attachment_ref: dict[str, Any],
    object_store: AuthenticatedNoticeProjectionObjectStore | None,
    object_store_settings: ObjectStoreSettings | None,
) -> bytes | None:
    object_key = _normalize_optional_text(attachment_ref.get("object_key"))
    if object_key is None or object_store is None or object_store_settings is None:
        return None
    try:
        return object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=object_key,
        )
    except Exception:
        return None


def _build_attachment_context_by_ref_id(
    *,
    record: DocumentRegistryRecord,
    attachment_refs: tuple[dict[str, Any], ...],
    object_store: AuthenticatedNoticeProjectionObjectStore | None,
    object_store_settings: ObjectStoreSettings | None,
) -> dict[str, str]:
    if object_store is None or object_store_settings is None:
        return {}
    notice_key = _find_processed_key(record, _NORMALIZED_NOTICE_PROVIDER_SUFFIX)
    if notice_key is None:
        return {}
    try:
        payload = _load_json_payload(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source,
                key=notice_key,
            )
        )
    except Exception:
        return {}
    notice_content_html = _normalize_optional_text(payload.get("notice_content_html"))
    if notice_content_html is None:
        return {}
    ref_id_by_url: dict[str, str] = {}
    for attachment_ref in attachment_refs:
        attachment_ref_id = _normalize_optional_text(attachment_ref.get("attachment_ref_id"))
        if attachment_ref_id is None:
            continue
        for field_name in ("normalized_source_url", "final_url", "source_url"):
            normalized_url = _normalize_attachment_context_url(attachment_ref.get(field_name))
            if normalized_url is not None:
                ref_id_by_url.setdefault(normalized_url, attachment_ref_id)
    contexts: dict[str, str] = {}
    for match in _HTML_IMG_TAG_RE.finditer(notice_content_html):
        src = _normalize_attachment_context_url(_html_attribute_value(match.group(0), "src"))
        if src is None:
            continue
        attachment_ref_id = ref_id_by_url.get(src)
        if attachment_ref_id is None:
            continue
        before_text = _strip_html_context_text(notice_content_html[: match.start()])[-160:]
        after_text = _strip_html_context_text(notice_content_html[match.end() :])[:160]
        context_text = " ".join(item for item in (before_text, after_text) if item).strip()
        if not context_text:
            continue
        existing = contexts.get(attachment_ref_id)
        contexts[attachment_ref_id] = (
            f"{existing} {context_text}".strip() if existing is not None else context_text
        )
    return contexts


def _resolve_attachment_context(
    *,
    attachment_ref: dict[str, Any],
    attachment_context_by_ref_id: dict[str, str] | None,
) -> str | None:
    if not attachment_context_by_ref_id:
        return None
    attachment_ref_id = _normalize_optional_text(attachment_ref.get("attachment_ref_id"))
    if attachment_ref_id is None:
        return None
    return attachment_context_by_ref_id.get(attachment_ref_id)


def _normalize_attachment_context_text(value: str | None) -> str | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.lower()


def _normalize_attachment_context_url(value: object) -> str | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    parsed = urlparse(normalized)
    if not parsed.scheme or not parsed.netloc:
        return normalized
    scheme = parsed.scheme.lower()
    if scheme == "http":
        scheme = "https"
    netloc = parsed.netloc.lower()
    if netloc.endswith(":80"):
        netloc = netloc[:-3]
    return urlunparse((scheme, netloc, parsed.path, "", "", ""))


def _html_attribute_value(tag: str, attribute_name: str) -> str | None:
    target = attribute_name.lower()
    for match in _HTML_ATTR_RE.finditer(tag):
        if match.group(1).lower() == target:
            return unescape(match.group(2)).strip()
    return None


def _strip_html_context_text(value: str) -> str:
    text = _HTML_TAG_RE.sub(" ", value)
    text = unescape(text).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def build_authenticated_notice_attachment_projection_plans(
    *,
    parent_document_id: str,
    attachment_refs: tuple[dict[str, Any], ...],
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    parent_record: DocumentRegistryRecord | None = None,
) -> tuple[dict[str, str], ...]:
    return tuple(
        {
            key: value
            for key, value in item.items()
            if key
            in {
                "attachment_ref_id",
                "classification",
                "document_id",
                "materialization_policy",
                "attachment_content_sha256",
                "review_reason",
            }
        }
        for item in build_authenticated_notice_attachment_routing_records(
            parent_document_id=parent_document_id,
            attachment_refs=attachment_refs,
            config=config,
            object_store=object_store,
            object_store_settings=object_store_settings,
            parent_record=parent_record,
        )
        if "materialization_policy" in item
    )


def build_authenticated_notice_attachment_routing_records(
    *,
    parent_document_id: str,
    attachment_refs: tuple[dict[str, Any], ...],
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    parent_record: DocumentRegistryRecord | None = None,
) -> tuple[dict[str, str], ...]:
    site_id, notice_id = _parse_notice_document_id(parent_document_id)
    records: list[dict[str, str]] = []
    attachment_context_by_ref_id = (
        _build_attachment_context_by_ref_id(
            record=parent_record,
            attachment_refs=attachment_refs,
            object_store=object_store,
            object_store_settings=object_store_settings,
        )
        if parent_record is not None
        else {}
    )
    for attachment_ref in attachment_refs:
        classification_result = _classify_attachment_ref(
            attachment_ref=attachment_ref,
            config=config,
            object_store=object_store,
            object_store_settings=object_store_settings,
            attachment_context_by_ref_id=attachment_context_by_ref_id,
        )
        classification = classification_result.classification
        attachment_ref_id = str(attachment_ref.get("attachment_ref_id") or "").strip()
        if not attachment_ref_id:
            raise ValueError(f"{parent_document_id} attachment_ref_id is required")
        record = {
            "attachment_ref_id": attachment_ref_id,
            "classification": classification,
        }
        attachment_content_sha256 = _normalize_optional_text(attachment_ref.get("content_sha256"))
        if attachment_content_sha256 is not None:
            record["attachment_content_sha256"] = attachment_content_sha256
        if classification_result.review_reason is not None:
            record["review_reason"] = classification_result.review_reason
        if classification in {"reference_only", "unsupported_binary"}:
            record["terminal_outcome"] = classification
            attachment_object_key = _normalize_optional_text(attachment_ref.get("object_key"))
            if attachment_object_key is not None:
                record["attachment_object_key"] = attachment_object_key
            attachment_mime_type = _normalize_optional_text(attachment_ref.get("mime_type"))
            if attachment_mime_type is not None:
                record["attachment_mime_type"] = attachment_mime_type
            attachment_filename = _guess_attachment_filename(attachment_ref)
            if attachment_filename:
                record["attachment_filename"] = attachment_filename
            records.append(record)
            continue
        record["document_id"] = f"notice_attachment:{site_id}:{notice_id}:{attachment_ref_id}"
        record["materialization_policy"] = _materialization_policy_for_classification(
            classification
        )
        records.append(record)
    return tuple(records)


def _materialization_policy_for_classification(classification: str) -> str:
    if classification == "text_extractable":
        return AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT
    if classification == "ocr_required":
        return AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT
    if classification == "multimodal_processing_required":
        return AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MULTIMODAL_PROCESSING
    raise ValueError(f"unsupported materialization policy classification: {classification}")


def _resolve_attachment_kind(
    *,
    classification: str,
    config: AuthenticatedNoticeSourceProjectionsConfig,
) -> str:
    value = config.attachment_kind_map.get(classification)
    if value is None:
        raise ValueError(f"attachment_kind_map missing classification: {classification}")
    return value


def _resolve_attachment_role(
    *,
    attachment_ref: dict[str, Any],
    config: AuthenticatedNoticeSourceProjectionsConfig,
) -> str:
    resource_role = _normalize_optional_text(attachment_ref.get("resource_role")) or "attachment"
    return config.attachment_role_map.get(resource_role, "notice_attachment_document")


def _build_attachment_title(
    *,
    notice_title: str,
    attachment_ref: dict[str, Any],
    filename: str,
) -> str:
    ref_order = attachment_ref.get("ref_order")
    del notice_title
    prefix = "附件" if ref_order is None else f"附件 {ref_order}"
    for candidate in (
        _normalize_attachment_title_label(
            _normalize_optional_text(attachment_ref.get("anchor_text"))
        ),
        _normalize_attachment_title_label(filename),
        _normalize_attachment_title_label(
            _normalize_optional_text(attachment_ref.get("final_url"))
        ),
    ):
        if candidate:
            return f"{prefix} / {candidate}"
    return prefix


def _normalize_attachment_title_label(value: str | None) -> str | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    stripped = _ATTACHMENT_LABEL_PREFIX_RE.sub("", normalized).strip()
    if not stripped:
        return None
    if stripped.startswith(("http://", "https://")):
        return None
    candidate_name = Path(stripped.split("?", 1)[0]).name.strip() or stripped
    candidate_stem = Path(candidate_name).stem.strip()
    if not candidate_stem:
        return candidate_name
    if _UUIDISH_ATTACHMENT_STEM_RE.fullmatch(candidate_stem):
        return None
    if _GENERIC_IMAGE_STEM_RE.fullmatch(candidate_stem):
        return None
    return candidate_name


def _build_attachment_version_id(
    *,
    attachment_content_sha256: str,
    extraction_class: str,
    extraction_policy_version: str,
) -> str:
    version_payload = json.dumps(
        {
            "attachment_content_sha256": attachment_content_sha256,
            "extraction_class": extraction_class,
            "extraction_policy_version": extraction_policy_version,
        },
        ensure_ascii=False,
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(version_payload).hexdigest()}"


def _build_text_extractable_provider_payload(
    *,
    attachment_ref: dict[str, Any],
    extraction_policy_version: str,
    extraction_outcome: ExtractionOutcome,
) -> bytes:
    payload = serialize_file_asset_extraction_record(
        FileAssetExtractionRecord(
            outcome=extraction_outcome,
            metadata={
                "attachment_ref_id": attachment_ref.get("attachment_ref_id"),
                "extraction_class": "text_extractable",
                "extraction_policy_version": extraction_policy_version,
            },
        )
    )
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _guess_attachment_filename(attachment_ref: dict[str, Any]) -> str:
    fallback_candidate: str | None = None
    for field_name in (
        "original_filename",
        "final_url",
        "source_url",
        "normalized_source_url",
        "anchor_text",
        "object_key",
    ):
        value = _normalize_optional_text(attachment_ref.get(field_name))
        if value is None:
            continue
        candidate = Path(value.split("?", 1)[0]).name.strip()
        if candidate:
            suffix = Path(candidate).suffix.lower().strip()
            if suffix.startswith("."):
                suffix = suffix[1:]
            if suffix:
                return candidate
            if fallback_candidate is None:
                fallback_candidate = candidate
    if fallback_candidate is not None:
        return fallback_candidate
    attachment_ref_id = (
        _normalize_optional_text(attachment_ref.get("attachment_ref_id")) or "attachment"
    )
    return f"{attachment_ref_id}.bin"
