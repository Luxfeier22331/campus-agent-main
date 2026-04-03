from __future__ import annotations

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Literal, Sequence

from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
    load_metadata_from_bytes,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.split_manifest import SplitManifestDocument


_REPO_ROOT = Path(__file__).resolve().parents[4]
_CONFIG_PATH = (
    _REPO_ROOT
    / "configs"
    / "ingestion"
    / "curriculum"
    / "program_family_facts"
    / "family-governance.json"
)


@dataclass(frozen=True, slots=True)
class _ProgramFamilyConfig:
    canonical_program_family_id: str
    canonical_program_family_title: str
    match_aliases: tuple[str, ...]
    mode: Literal["direct_answer_family", "clarify_first_family"]
    source_title: str = ""
    member_program_ids: tuple[str, ...] = ()
    member_program_titles: tuple[str, ...] = ()
    answer_snippet: str = ""
    clarification_options: tuple[str, ...] = ()


def build_curriculum_program_family_facts_scope_refresh_documents(
    *,
    raw_asset_record: RawAssetRecord,
    source_pdf: str,
    split_manifest_documents: Sequence[SplitManifestDocument],
    corpus: str = "curriculum",
    collection: str = "program_family_facts",
    import_source: str = "provider_response_replay",
) -> list[DocumentImportInput]:
    active_documents = {
        document.document_id: document
        for document in split_manifest_documents
        if document.status == "active"
    }
    documents: list[DocumentImportInput] = []
    for family in _load_program_family_configs():
        if family.mode != "direct_answer_family":
            continue
        member_documents = [
            active_documents[document_id]
            for document_id in family.member_program_ids
            if document_id in active_documents
        ]
        if not member_documents:
            continue
        document_id = _build_document_id(family.canonical_program_family_id)
        version_id = _build_version_id(
            raw_version_id=raw_asset_record.raw_version_id,
            canonical_program_family_id=family.canonical_program_family_id,
        )
        document_units_bytes = _serialize_projection_row(
            document_id=document_id,
            version_id=version_id,
            source_pdf=source_pdf,
            family=family,
            member_documents=member_documents,
        )
        metadata = load_metadata_from_bytes(document_units_bytes)
        metadata["title"] = family.source_title
        metadata["canonical_program_family_id"] = family.canonical_program_family_id
        metadata["canonical_program_family_title"] = family.canonical_program_family_title
        metadata["program_family_mode"] = family.mode
        metadata["member_program_ids"] = list(family.member_program_ids)
        metadata["member_program_titles"] = list(family.member_program_titles)
        metadata["source_doc_ids"] = [document.document_id for document in member_documents]
        apply_authorization_projection_metadata(
            metadata,
            entitlement_groups=_resolved_entitlement_groups(member_documents),
            visibility_scope=_resolved_visibility_scope(member_documents),
            visibility_level=_resolved_visibility_level(member_documents),
        )
        metadata["status"] = "active"
        documents.append(
            DocumentImportInput(
                source_label=f"{raw_asset_record.object_key}#{document_id}",
                document_units_bytes=document_units_bytes,
                provider_response_bytes=None,
                canonical_markdown_bytes=None,
                metadata=metadata,
                import_source=import_source,
                revision_track="source-faithful",
                source_channel="manual_curated",
                is_current=False,
                corpus=corpus,
                collection=collection,
                visibility_scope=_resolved_visibility_scope(member_documents),
                status="active",
                raw_path=None,
                raw_source_uri=raw_asset_record.raw_source_uri,
                raw_asset_id=raw_asset_record.raw_asset_id,
                raw_version_id=raw_asset_record.raw_version_id,
                provider_response_object_key=None,
                additional_processed_object_keys=(),
                title=family.source_title,
                year=None,
            )
        )
    return documents


def _load_program_family_configs() -> tuple[_ProgramFamilyConfig, ...]:
    payload = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    results: list[_ProgramFamilyConfig] = []
    for item in payload.get("families", ()):
        if not isinstance(item, dict):
            continue
        canonical_program_family_id = str(item.get("canonical_program_family_id", "")).strip()
        canonical_program_family_title = str(item.get("canonical_program_family_title", "")).strip()
        mode = str(item.get("mode", "")).strip()
        if not canonical_program_family_id or not canonical_program_family_title or not mode:
            continue
        if mode not in {"direct_answer_family", "clarify_first_family"}:
            continue
        results.append(
            _ProgramFamilyConfig(
                canonical_program_family_id=canonical_program_family_id,
                canonical_program_family_title=canonical_program_family_title,
                match_aliases=tuple(
                    value.strip()
                    for value in item.get("match_aliases", ())
                    if isinstance(value, str) and value.strip()
                ),
                mode=mode,
                source_title=str(item.get("source_title", "")).strip(),
                member_program_ids=tuple(
                    value.strip()
                    for value in item.get("member_program_ids", ())
                    if isinstance(value, str) and value.strip()
                ),
                member_program_titles=tuple(
                    value.strip()
                    for value in item.get("member_program_titles", ())
                    if isinstance(value, str) and value.strip()
                ),
                answer_snippet=str(item.get("answer_snippet", "")).strip(),
                clarification_options=tuple(
                    value.strip()
                    for value in item.get("clarification_options", ())
                    if isinstance(value, str) and value.strip()
                ),
            )
        )
    return tuple(results)


def _build_document_id(canonical_program_family_id: str) -> str:
    suffix = canonical_program_family_id.removeprefix("program_family:")
    return f"program_family_facts:{suffix}:membership"


def _build_version_id(*, raw_version_id: str, canonical_program_family_id: str) -> str:
    digest = hashlib.sha256(f"{raw_version_id}|{canonical_program_family_id}".encode("utf-8")).hexdigest()[:12]
    return f"{raw_version_id}:program-family:{digest}"


def _serialize_projection_row(
    *,
    document_id: str,
    version_id: str,
    source_pdf: str,
    family: _ProgramFamilyConfig,
    member_documents: Sequence[SplitManifestDocument],
) -> bytes:
    page_start = min(document.page_start for document in member_documents)
    page_end = max(document.page_end for document in member_documents)
    payload = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": f"{document_id}:row-0001",
        "clean_text": family.answer_snippet,
        "source_pdf": source_pdf,
        "source_url": f"campusrag://rag-data/canonical/curriculum_plan/program-family/{family.canonical_program_family_title}.md",
        "source": {
            "id": f"campusrag://rag-data/canonical/curriculum_plan/program-family/{family.canonical_program_family_title}.md"
        },
        "page_start": page_start,
        "page_end": page_end,
        "entitlement_groups": list(_resolved_entitlement_groups(member_documents)),
        "visibility_scope": _resolved_visibility_scope(member_documents),
        "visibility_level": _resolved_visibility_level(member_documents),
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "anchor": {
            "fact_type": "family_membership",
            "section_path": [family.canonical_program_family_title],
            "detail_label": "成员专业",
        },
        "structured_path": [family.canonical_program_family_title],
        "detail_label": "成员专业",
        "content_kind": "program_family_fact",
        "content_role": "family_membership",
        "is_answer_bearing": True,
        "canonical_program_family_id": family.canonical_program_family_id,
        "canonical_program_family_title": family.canonical_program_family_title,
        "program_family_mode": family.mode,
        "member_program_ids": list(family.member_program_ids),
        "member_program_titles": list(family.member_program_titles),
        "source_doc_ids": [document.document_id for document in member_documents],
        "title": family.source_title,
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _resolved_entitlement_groups(documents: Sequence[SplitManifestDocument]) -> tuple[str, ...]:
    groups: list[str] = []
    for document in documents:
        for group in document.entitlement_groups:
            if group not in groups:
                groups.append(group)
    return tuple(groups)


def _resolved_visibility_scope(documents: Sequence[SplitManifestDocument]) -> str | None:
    for document in documents:
        scope = document.visibility_scope
        if scope is not None:
            return scope
    return None


def _resolved_visibility_level(documents: Sequence[SplitManifestDocument]) -> str:
    for document in documents:
        level = document.visibility_level
        if level:
            return level
    return "public"
