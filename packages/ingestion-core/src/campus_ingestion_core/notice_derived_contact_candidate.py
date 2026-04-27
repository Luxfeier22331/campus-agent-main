from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.registry import DocumentRegistry

NOTICE_DERIVED_CONTACT_CANDIDATE_SCHEMA_VERSION = "notice_derived_contact_candidate_bundle.v1"
NOTICE_DERIVED_CONTACT_SOURCE_FAMILY = "authenticated_notice_contact_candidate_projection_v1"

_CONTACT_LINE_RE = re.compile(
    r"(?P<name>[\u4e00-\u9fa5A-Za-z0-9（）()·、\-/\s]{2,40})[:：\s]+"
    r"(?P<number>(?:0\d{2,3}-?)?\d{7,8})"
)
_TEMPORARY_ACTIVITY_KEYWORDS = (
    "讲座",
    "论坛",
    "沙龙",
    "招聘",
    "宣讲",
    "比赛",
    "活动",
    "工作坊",
    "报名",
)
_CONTACT_CONTEXT_KEYWORDS = ("联系电话", "电话", "联系人", "咨询")


class NoticeDerivedContactCandidateObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class NoticeDerivedContactCandidateBuildResult:
    bundle: dict[str, object]
    candidate_count: int
    rejected_count: int
    manual_review_count: int


def build_notice_derived_contact_candidate_bundle(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: DocumentRegistry,
    object_store: NoticeDerivedContactCandidateObjectStore,
    derived_bucket: str,
    generated_at: str,
) -> NoticeDerivedContactCandidateBuildResult:
    _parse_generated_at(generated_at)
    candidate_records: list[dict[str, object]] = []
    rejected_records: list[dict[str, object]] = []
    manual_review_sources: list[dict[str, object]] = []
    dedupe_keys: set[tuple[str, str]] = set()
    for entry in projection_entries:
        if not _is_ready_stable_contact_candidate(entry):
            continue
        text = _read_source_notice_text(
            entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket=derived_bucket,
        )
        source_ref = _source_ref(entry)
        title = str(entry.role_metadata.get("notice_title") or "").strip()
        if _looks_like_temporary_activity_contact(title=title, body=text):
            rejected_records.append(
                {
                    "notice_id": entry.source_notice_id,
                    "source_ref": source_ref,
                    "reason_code": "temporary_activity_or_recruitment_contact",
                    "notice_title": title,
                }
            )
            continue
        parsed_contacts = _extract_phone_contacts(text)
        if not parsed_contacts:
            manual_review_sources.append(
                {
                    "notice_id": entry.source_notice_id,
                    "source_ref": source_ref,
                    "reason_code": "no_parseable_stable_contact_point",
                }
            )
            continue
        for contact_index, (display_name, phone_number) in enumerate(parsed_contacts, start=1):
            dedupe_key = (display_name, phone_number)
            if dedupe_key in dedupe_keys:
                continue
            dedupe_keys.add(dedupe_key)
            candidate_records.append(
                {
                    "candidate_id": (f"contact_candidate:{entry.source_notice_id}:{contact_index}"),
                    "notice_id": entry.source_notice_id,
                    "source_notice_document_id": entry.source_notice_document_id,
                    "display_name": display_name,
                    "phone_number": phone_number,
                    "candidate_kind": "stable_contact_phone",
                    "confidence": 0.7,
                    "source_refs": [source_ref],
                    "extraction_status": "candidate_ready",
                }
            )
    bundle: dict[str, object] = {
        "schema_version": NOTICE_DERIVED_CONTACT_CANDIDATE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [NOTICE_DERIVED_CONTACT_SOURCE_FAMILY],
        "candidate_records": candidate_records,
        "rejected_records": rejected_records,
        "manual_review_sources": manual_review_sources,
    }
    return NoticeDerivedContactCandidateBuildResult(
        bundle=bundle,
        candidate_count=len(candidate_records),
        rejected_count=len(rejected_records),
        manual_review_count=len(manual_review_sources),
    )


def _is_ready_stable_contact_candidate(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        entry.target_surface == NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    )


def _read_source_notice_text(
    *,
    entry: NoticeConsumptionProjectionEntry,
    registry: DocumentRegistry,
    object_store: NoticeDerivedContactCandidateObjectStore,
    derived_bucket: str,
) -> str:
    record = _resolve_registry_record(
        registry=registry,
        document_id=entry.source_notice_document_id,
    )
    if record is None:
        return ""
    object_key = str(record.canonical_markdown_object_key or "").strip()
    if not object_key:
        return ""
    return object_store.get_bytes(bucket=derived_bucket, key=object_key).decode("utf-8")


def _resolve_registry_record(
    *,
    registry: DocumentRegistry,
    document_id: str,
) -> DocumentRegistryRecord | None:
    current = registry.current_version(
        document_id,
        preferred_revision_tracks=("source-faithful", "semantic-enriched"),
    )
    if current is not None:
        return current
    versions = registry.list_versions(document_id, revision_track="source-faithful")
    if versions:
        return versions[0]
    versions = registry.list_versions(document_id)
    return versions[0] if versions else None


def _parse_generated_at(generated_at: str) -> None:
    try:
        datetime.fromisoformat(str(generated_at).strip())
    except ValueError as exc:
        raise ValueError("generated_at must be RFC3339/ISO datetime") from exc


def _source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    site_id = str(entry.role_metadata.get("site_id") or "muc_internal_portal").strip()
    return f"notice:{site_id}:{entry.source_notice_id}"


def _looks_like_temporary_activity_contact(*, title: str, body: str) -> bool:
    text = "".join(f"{title}\n{body}".split())
    if not text:
        return False
    return any(keyword in text for keyword in _TEMPORARY_ACTIVITY_KEYWORDS) and any(
        keyword in text for keyword in _CONTACT_CONTEXT_KEYWORDS
    )


def _extract_phone_contacts(text: str) -> tuple[tuple[str, str], ...]:
    rows = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    contacts: list[tuple[str, str]] = []
    for row in rows:
        match = _CONTACT_LINE_RE.search(row)
        if match is None:
            continue
        display_name = " ".join(str(match.group("name") or "").split())
        phone_number = str(match.group("number") or "").replace(" ", "")
        if not display_name or not phone_number:
            continue
        contacts.append((display_name, phone_number))
    return tuple(contacts)


__all__ = [
    "NOTICE_DERIVED_CONTACT_CANDIDATE_SCHEMA_VERSION",
    "NOTICE_DERIVED_CONTACT_SOURCE_FAMILY",
    "NoticeDerivedContactCandidateBuildResult",
    "build_notice_derived_contact_candidate_bundle",
]
