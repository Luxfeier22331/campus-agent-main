from __future__ import annotations

import json

import unittest

from campus_ingestion_core.models import DocumentRegistryRecord

from campus_ingestion_core.object_store import build_processed_artifact_key

from campus_ingestion_core.process import build_indexable_chunks_from_jsonl

from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_CATEGORY_REGISTRY_VERSION,
    ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
)

from campus_shared.regulation_semantic_registry import load_regulation_discovery_config

from tests.ingestion._handbook_chunking_test_support import (
    build_hermetic_handbook_v3_chunk_profile,
)


def _institutional_registry_record(document_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=f"owregver:{document_id}",
        source_uri=f"https://www.muc.edu.cn/{document_id}.htm",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        status="active",
        ingestion_timestamp="2026-05-07T00:00:00+00:00",
        parser_version="official-web-regulation-source-truth-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="official_web",
        import_source="official_web_regulation_source_truth_materialization",
        document_units_object_key=build_processed_artifact_key(
            corpus="regulations",
            collection="institutional_rules",
            document_id=document_id,
            revision_track="current-effective",
            version_id=f"owregver:{document_id}",
            title=None,
            year=None,
            filename="document-units.jsonl",
        ),
        processed_object_keys=(),
    )


def _structured_row(
    *,
    doc_id: str,
    version_id: str,
    unit_type: str,
    clean_text: str,
    root_unit_id: str,
    anchor: dict[str, object] | None = None,
    metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": root_unit_id,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "clean_text": clean_text,
        "anchor": anchor or {"page_start": 1, "page_end": 1},
        "metadata": metadata or {},
        "acl": {"level": "restricted", "allow_groups": ["campus_members"]},
    }


class InstitutionalRegulationSemanticRegressionsTestBase(unittest.TestCase):
    def _build_chunks(
        self,
        *,
        document_id: str,
        rows: tuple[dict[str, object], ...],
    ):
        record = _institutional_registry_record(document_id)
        structured_payload = (
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        ).encode("utf-8")
        return build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

    def _row(
        self,
        *,
        document_id: str,
        root_unit_id: str,
        clean_text: str,
        section_path: tuple[str, ...],
        title: str,
        article_label: str = "",
        provision_label: str = "",
        promotion_class: str = "",
    ) -> dict[str, object]:
        record = _institutional_registry_record(document_id)
        anchor: dict[str, object] = {"section_path": list(section_path)}
        if article_label:
            anchor["article_label"] = article_label
        if provision_label:
            anchor["provision_label"] = provision_label
        metadata: dict[str, object] = {
            "title": title,
            "content_role": "regulation_body",
        }
        if promotion_class:
            metadata["promotion_class"] = promotion_class
        return _structured_row(
            doc_id=record.document_id,
            version_id=record.version_id,
            unit_type="regulation_body",
            root_unit_id=root_unit_id,
            clean_text=clean_text,
            anchor=anchor,
            metadata=metadata,
        )


__all__ = [name for name in globals() if not name.startswith("__")]
