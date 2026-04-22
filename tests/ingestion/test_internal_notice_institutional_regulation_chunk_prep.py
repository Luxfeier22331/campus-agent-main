from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.internal_notice_institutional_regulation_chunk_prep import (
    prepare_institutional_regulation_chunks,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    InternalNoticeRegulationProjectedDocument,
    build_internal_notice_regulation_projected_document,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationCandidateArtifactDocument,
)
from campus_ingestion_core.models import DocumentRegistryRecord


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


def _candidate_document() -> InternalNoticeRegulationCandidateArtifactDocument:
    return InternalNoticeRegulationCandidateArtifactDocument(
        candidate_id="candidate-355282",
        source_document_id="notice_attachment:muc_internal_portal:355282:attachment-0001",
        notice_id="355282",
        site_id="muc_internal_portal",
        source_kind="attachment_document",
        input_lane="attachment_text_extractable",
        revision_track="source-faithful",
        version_id="sha256:355282:source-faithful",
        promotion_class="formal_regulation",
        document_nature="institutional_regulation",
        semantic_owner_kind="attachment_document",
        target_corpus="regulations",
        target_collection="institutional_rules",
        regulation_title_normalized="中央民族大学关于学生使用人工智能的指导意见（2026版）",
        regulation_work_title="中央民族大学关于学生使用人工智能的指导意见",
        regulation_edition_label="2026版",
        regulation_display_title="中央民族大学关于学生使用人工智能的指导意见 / 2026版",
        source_title_literal="中央民族大学关于学生使用人工智能的指导意见（2026版）",
        issuing_org="中央民族大学",
        effective_date=None,
        revision_signal=None,
        source_notice_release_time="2026-03-27 15:15",
        source_parent_document_id="notice:muc_internal_portal:355282",
        source_notice_document_id="notice:muc_internal_portal:355282",
        semantic_owner_document_id="notice_attachment:muc_internal_portal:355282:attachment-0001",
        source_attachment_document_id="notice_attachment:muc_internal_portal:355282:attachment-0001",
        source_attachment_ref_id="attachment-0001",
        source_attachment_sha256="sha256:attachment-355282",
        source_uri="https://portal.example.edu/files/355282.docx",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        embedding_model="Qwen3-Embedding-4B",
        is_current=True,
        quality_gates_passed=("canonical_text_available", "provenance_complete"),
        reasons=(),
        promotion_body=(
            "第一条 为规范学生使用人工智能，制定本指导意见。\n\n"
            "第二条 本指导意见适用于全体在校学生。"
        ),
        artifact_markdown_path="candidates/中央民族大学关于学生使用人工智能的指导意见--candidate-355282/canonical.md",
        artifact_body_sha256="sha256:body-355282",
    )


def _projected_document() -> InternalNoticeRegulationProjectedDocument:
    return build_internal_notice_regulation_projected_document(
        candidate_document=_candidate_document()
    )


def _record(
    *, projected: InternalNoticeRegulationProjectedDocument, units_key: str
) -> DocumentRegistryRecord:
    runtime_profile = load_runtime_profile("regulations", "institutional_rules")
    return DocumentRegistryRecord(
        document_id=projected.document_id,
        revision_track="current-effective",
        version_id=projected.version_id,
        source_uri=projected.source_uri,
        content_hash=projected.semantic_content_hash,
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-19T09:00:00+00:00",
        parser_version="internal_notice_regulation_materialization_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        processed_object_keys=(units_key,),
        import_source="internal_notice_regulation_materialization",
        published_date=projected.published_date,
    )


def _override_first_row_metadata(
    payload: bytes,
    *,
    updates: dict[str, object],
) -> bytes:
    rows = [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]
    rows[0]["metadata"] = {
        **dict(rows[0]["metadata"]),
        **updates,
    }
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


class InstitutionalRegulationChunkPrepTest(unittest.TestCase):
    def test_prepare_institutional_regulation_chunks_emits_target_scope_artifacts_and_validation(
        self,
    ) -> None:
        projected = _projected_document()
        record = _record(
            projected=projected,
            units_key=(
                "regulations/documents/institutional_rules/guidance-2026/document-units.jsonl"
            ),
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    record.document_units_object_key or "",
                ): projected.document_units_bytes,
            }
        )

        with TemporaryDirectory() as temp_dir:
            report = prepare_institutional_regulation_chunks(
                records=(record,),
                object_store=object_store,
                output_dir=Path(temp_dir),
            )

            self.assertTrue(report.passed)
            self.assertEqual(report.prepared_document_count, 1)

            manifest = json.loads(Path(report.manifest_path).read_text(encoding="utf-8"))
            self.assertEqual(manifest["target_collection"], "institutional_rules")

            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertTrue(validation["passed"])
            self.assertEqual(validation["missing_identity_metadata_count"], 0)
            self.assertEqual(validation["invalid_semantic_owner_lineage_count"], 0)
            self.assertEqual(validation["wrapper_notice_leak_chunk_count"], 0)
            self.assertEqual(validation["front_matter_leak_chunk_count"], 0)

            document_reports = [
                json.loads(line)
                for line in Path(report.document_reports_path)
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            self.assertEqual(len(document_reports), 1)
            document_report = document_reports[0]
            self.assertTrue(document_report["passed"])
            self.assertEqual(document_report["missing_identity_metadata_count"], 0)
            self.assertEqual(document_report["invalid_semantic_owner_lineage_count"], 0)
            self.assertEqual(document_report["short_body_chunk_count"], 0)

            chunks_path = Path(temp_dir) / document_report["chunk_catalog_path"]
            chunks = [
                json.loads(line)
                for line in chunks_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(all(chunk["collection"] == "institutional_rules" for chunk in chunks))
            self.assertTrue(
                any(
                    chunk["metadata"].get("regulation_display_title")
                    == "中央民族大学关于学生使用人工智能的指导意见 / 2026版"
                    for chunk in chunks
                )
            )
            self.assertTrue(
                all(
                    chunk["metadata"].get("strategy_name") == "institutional_rules_formal_v1"
                    for chunk in chunks
                )
            )

    def test_prepare_institutional_regulation_chunks_flags_invalid_attachment_owner_lineage(
        self,
    ) -> None:
        projected = _projected_document()
        payload = _override_first_row_metadata(
            projected.document_units_bytes,
            updates={
                "semantic_owner_document_id": "notice:muc_internal_portal:355282",
                "semantic_owner_document_ids": ["notice:muc_internal_portal:355282"],
                "source_attachment_document_id": "",
                "source_attachment_document_ids": [],
            },
        )
        record = _record(
            projected=projected,
            units_key=(
                "regulations/documents/institutional_rules/"
                "guidance-2026-invalid-owner/document-units.jsonl"
            ),
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", record.document_units_object_key or ""): payload,
            }
        )

        with TemporaryDirectory() as temp_dir:
            report = prepare_institutional_regulation_chunks(
                records=(record,),
                object_store=object_store,
                output_dir=Path(temp_dir),
            )

            self.assertFalse(report.passed)
            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertFalse(validation["passed"])
            self.assertEqual(validation["invalid_semantic_owner_lineage_count"], 1)
            self.assertEqual(validation["failed_document_ids"], [record.document_id])


if __name__ == "__main__":
    unittest.main()
