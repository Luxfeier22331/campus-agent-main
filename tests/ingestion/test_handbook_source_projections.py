from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.handbook_source_projections import (
    build_declared_projection_processed_keys,
    build_handbook_projection_import_documents,
    load_handbook_source_projections_config,
    validate_handbook_source_projection_coverage,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.split_manifest import SplitManifestDocument

from .handbook_cleanup_test_support import _source_row


class HandbookSourceProjectionsTest(unittest.TestCase):
    def test_tracked_source_projection_coverage_declares_consumed_and_deferred_families(
        self,
    ) -> None:
        report = validate_handbook_source_projection_coverage(
            Path("configs/ingestion/regulations/student_rules/source-projections.v1.json")
        )

        self.assertTrue(report["valid"], report["issues"])
        self.assertEqual(
            report["covered_projection_names"],
            [
                "handbook_form_template_documents",
                "handbook_navigation_leaf_documents",
                "handbook_navigation_service_catalog",
                "handbook_phone_directory",
                "handbook_tabular_appendix_documents",
            ],
        )
        self.assertEqual(report["deferred_projection_names"], ["handbook_appendix_documents"])

    def test_source_projection_coverage_rejects_undeclared_wildcard_gap(self) -> None:
        payload = _projection_config_payload()
        payload["attachment_projection_families"] = [
            {
                "projection_name": "handbook_appendix_documents",
                "target_corpus": "regulations",
                "target_collection": "student_rules",
                "projection_family": "derived_documents",
                "derived_from": "source_truth",
                "derived_from_document_id": "*",
                "parent_document_id": "*",
                "attachment_kind": "narrative_appendix",
                "attachment_role": "standalone_appendix_document",
            }
        ]
        with TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "source-projections.v1.json"
            config_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            report = validate_handbook_source_projection_coverage(config_path)

        self.assertFalse(report["valid"])
        self.assertIn(
            {
                "projection_name": "handbook_appendix_documents",
                "reason": "wildcard_family_without_selector_or_deferred_status",
            },
            report["issues"],
        )

    def test_attachment_projection_selectors_are_executable_without_consuming_wildcard_family(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "source-projections.v1.json"
            config_path.write_text(
                json.dumps(_projection_config_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            config = load_handbook_source_projections_config(config_path)

        self.assertEqual(
            [projection.projection_name for projection in config.projections],
            ["student_rules_primary_documents", "handbook_form_template_documents"],
        )
        form_projection = config.projections[1]
        self.assertEqual(form_projection.attachment_kind, "form_template")
        self.assertEqual(form_projection.attachment_role, "standalone_form_document")
        self.assertEqual(form_projection.parent_document_id, _STUDENT_CARD_PARENT_DOCUMENT_ID)

    def test_same_scope_attachment_selector_materializes_derived_form_document(self) -> None:
        with TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "source-projections.v1.json"
            config_path.write_text(
                json.dumps(_projection_config_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            config = load_handbook_source_projections_config(config_path)

            keys = build_declared_projection_processed_keys(
                config=config,
                source_pdf="学生手册_2018.pdf",
            )
            documents = build_handbook_projection_import_documents(
                source={"HANDBOOK_SOURCE_PROJECTIONS_PATH": str(config_path)},
                config_path=config_path,
                raw_asset_record=_raw_asset_record(),
                provider_response_key="official_pdf/student-handbook/provider-response.jsonl",
                layout_elements_key="official_pdf/student-handbook/layout-elements.jsonl",
                structured_rows=[
                    _source_row(
                        165,
                        "heading",
                        "中央民族大学补办学生证申请表",
                        block_role="title",
                        title_candidate_score=1.0,
                    ),
                    _source_row(
                        165,
                        "table",
                        "<table><tr><td>姓名</td><td></td></tr></table>",
                        block_role="table",
                        html="<table><tr><td>姓名</td><td></td></tr></table>",
                        table_cells=[["姓名", ""]],
                    ),
                ],
                split_manifest_documents=(
                    SplitManifestDocument(
                        document_id=_STUDENT_CARD_PARENT_DOCUMENT_ID,
                        title="中央民族大学本科(预科)学生证管理办法",
                        page_start=163,
                        page_end=165,
                        source_uri=(
                            "campus-agent://regulations/student_rules/docs/"
                            f"{_STUDENT_CARD_PARENT_DOCUMENT_ID}"
                        ),
                        handbook_section="中央民族大学学生日常管理规定",
                    ),
                ),
            )

        self.assertEqual(len(documents), 1)
        document = documents[0]
        self.assertEqual(document.corpus, "regulations")
        self.assertEqual(document.collection, "student_rules")
        self.assertTrue(
            str(document.metadata["document_id"]).startswith("regulations:student_rules:")
        )
        self.assertEqual(document.metadata["projection_name"], "handbook_form_template_documents")
        self.assertEqual(document.metadata["attachment_kind"], "form_template")
        self.assertEqual(document.metadata["attachment_role"], "standalone_form_document")
        self.assertEqual(document.metadata["parent_document_id"], _STUDENT_CARD_PARENT_DOCUMENT_ID)
        self.assertIn("中央民族大学补办学生证申请表", document.canonical_markdown_bytes.decode())
        self.assertTrue(
            any(
                "regulations/documents/student_rules/" in key
                and "/canonical.md" in key
                and "campus_services" not in key
                for key in keys
            )
        )


_STUDENT_CARD_PARENT_DOCUMENT_ID = "handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"


def _projection_config_payload() -> dict[str, object]:
    return {
        "schema_version": "student_rules_source_projections_v1",
        "source_corpus": "regulations",
        "source_collection": "student_rules",
        "raw_asset_id": "asset:student-handbook-pdf",
        "projections": [
            {
                "projection_name": "student_rules_primary_documents",
                "target_corpus": "regulations",
                "target_collection": "student_rules",
                "projection_family": "primary_documents",
                "replay_from_source_truth": True,
                "derived_from": "source_truth",
                "derived_from_document_id": None,
                "parent_document_id": None,
                "attachment_kind": None,
                "attachment_role": None,
            }
        ],
        "attachment_projection_selectors": [
            {
                "projection_name": "handbook_form_template_documents",
                "target_corpus": "regulations",
                "target_collection": "student_rules",
                "projection_family": "derived_documents",
                "replay_from_source_truth": True,
                "derived_from": "source_truth",
                "derived_from_document_id": None,
                "parent_document_id": _STUDENT_CARD_PARENT_DOCUMENT_ID,
                "source_title": "中央民族大学补办学生证申请表",
                "source_handbook_section": "中央民族大学学生日常管理规定",
                "source_page_start": 165,
                "source_page_end": 165,
                "attachment_kind": "form_template",
                "attachment_role": "standalone_form_document",
                "target_title": "中央民族大学补办学生证申请表",
                "migration_reason": "handbook_form_template_projection",
            }
        ],
        "attachment_projection_families": [
            {
                "projection_name": "handbook_form_template_documents",
                "target_corpus": "regulations",
                "target_collection": "student_rules",
                "projection_family": "derived_documents",
                "derived_from": "source_truth",
                "derived_from_document_id": "*",
                "parent_document_id": "*",
                "attachment_kind": "form_template",
                "attachment_role": "standalone_form_document",
            }
        ],
    }


def _raw_asset_record() -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:student-handbook-pdf",
        raw_version_id="sha256:student-handbook-test",
        corpus="regulations",
        collection="student_rules",
        raw_source_uri="s3://campus-rag-source/student-handbook.pdf",
        content_hash="student-handbook-test",
        source_filename="学生手册_2018.pdf",
        object_key="official_pdf/student-handbook/2018/source.pdf",
        ingestion_timestamp="2026-04-25T10:00:00+08:00",
        import_source="provider_response_replay",
        content_type="application/pdf",
        file_extension=".pdf",
    )


if __name__ == "__main__":
    unittest.main()
