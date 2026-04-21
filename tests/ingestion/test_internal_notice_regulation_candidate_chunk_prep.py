from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.internal_notice_regulation_candidate_chunk_prep import (
    load_internal_notice_regulation_candidate_documents,
    prepare_internal_notice_regulation_candidate_chunks,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationCandidateArtifactDocument,
)


def _candidate_document() -> InternalNoticeRegulationCandidateArtifactDocument:
    return InternalNoticeRegulationCandidateArtifactDocument(
        candidate_id="0425aed278c86fda",
        source_document_id="notice:muc_internal_portal:187233",
        notice_id="187233",
        site_id="muc_internal_portal",
        source_kind="parent_notice",
        input_lane="notice_body",
        revision_track="source-faithful",
        version_id="sha256:28f8bcec3c1c38b9cec0304beb4de9c6c63424be4b3990c577a1c7ea5dcd7719",
        promotion_class="formal_regulation",
        document_nature="institutional_regulation",
        semantic_owner_kind="notice_body",
        target_corpus="regulations",
        target_collection="institutional_regulations",
        regulation_title_normalized="中央民族大学采购工作管理办法",
        issuing_org="中央民族大学",
        effective_date="2021年3月1日",
        revision_signal="修订",
        source_notice_release_time="2021-02-28 16:09",
        source_parent_document_id="notice:muc_internal_portal:187233",
        source_attachment_ref_id=None,
        source_attachment_sha256=None,
        source_uri="https://portal.example.edu/notices/187233",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        embedding_model="Qwen3-Embedding-4B",
        is_current=True,
        quality_gates_passed=(
            "canonical_text_available",
            "duplicate_check_passed",
            "provenance_complete",
            "standalone_body_quality_passed",
            "wrapper_semantics_removed",
        ),
        reasons=(),
        promotion_body=(
            "一、主要修订内容\n\n"
            "（一）、校内集中采购限额标准及范围调整\n\n"
            "工程、货物（不含进口货物）、服务校内集中采购限额标准，统一调整到20万元（含）以上。"
            "校内集中采购范围还包括纳入政府集中采购目录的采购项目、进口货物采购项目以及校内定点供应商的遴选项目。\n\n"
            "（二）、新增信息化建设管理处为采购归口管理部门。\n\n"
            "二、采购注意事项\n\n"
            "（一）采购意向公示要求\n\n"
            "1.为进一步提高政府采购透明度，优化政府采购营商环境，根据《关于开展政府采购意向公开工作的通知》要求，"
            "我校的政府采购货物、工程、服务项目必须在项目采购活动开始前35日将采购意向公开文件发送至指定邮箱。\n\n"
            "2.请各项目单位务必高度重视，加强采购活动的计划性，及时、全面公开采购意向，做到不遗漏、不延误。\n\n"
            "（二）校内集中采购项目采购流程\n\n"
            "1.采购意向公示：政府采购限额以上的项目提前35日向资产管理处（招标采购中心）提交采购意向公示书；\n\n"
            "2.填报采购申请：校内集中采购项目在服务门户的采购申请模块中填报采购需求；\n\n"
            "3.采购申请受理：资产管理处（招标采购中心）受理采购申请，组织采购。"
        ),
        artifact_markdown_path="candidates/中央民族大学采购工作管理办法--0425aed278c86fda/canonical.md",
        artifact_body_sha256="ba2650d0594638552323b13693d065765ac9746a4229cf4ca47b959c61843ef4",
    )


class InternalNoticeRegulationCandidateChunkPrepTest(unittest.TestCase):
    def test_prepare_candidate_chunks_emits_local_only_target_artifacts_and_validation(
        self,
    ) -> None:
        candidate = _candidate_document()
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            report = prepare_internal_notice_regulation_candidate_chunks(
                documents=(candidate,),
                output_dir=output_dir,
            )

            self.assertTrue(report.passed)
            self.assertEqual(report.prepared_candidate_count, 1)
            self.assertGreater(report.total_unit_count, 1)
            self.assertGreater(report.total_chunk_count, 1)

            manifest = json.loads(Path(report.manifest_path).read_text(encoding="utf-8"))
            self.assertEqual(manifest["target_collection"], "institutional_regulations")
            self.assertEqual(manifest["prepared_candidate_count"], 1)

            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertTrue(validation["passed"])
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
            self.assertEqual(document_report["missing_title_chunk_count"], 0)
            self.assertEqual(document_report["missing_projection_metadata_count"], 0)
            self.assertEqual(document_report["short_body_chunk_count"], 0)

            units_path = output_dir / document_report["document_units_path"]
            rows = [
                json.loads(line)
                for line in units_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(rows[0]["metadata"]["content_role"], "regulation_title")
            self.assertEqual(rows[0]["metadata"]["source_notice_ids"], ["187233"])
            self.assertEqual(
                rows[0]["metadata"]["source_notice_document_id"],
                "notice:muc_internal_portal:187233",
            )
            self.assertEqual(
                rows[0]["metadata"]["semantic_owner_document_id"],
                "notice:muc_internal_portal:187233",
            )

            chunks_path = output_dir / document_report["chunk_catalog_path"]
            chunks = [
                json.loads(line)
                for line in chunks_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertLess(len(chunks), len(rows))
            self.assertTrue(
                any(chunk["metadata"].get("content_role") == "regulation_title" for chunk in chunks)
            )
            self.assertTrue(
                all(chunk["collection"] == "institutional_regulations" for chunk in chunks)
            )
            self.assertTrue(all("特此通知" not in chunk["text"] for chunk in chunks))
            self.assertTrue(
                any(
                    chunk["metadata"].get("aggregation_mode") == "adjacent_short_textual_units"
                    for chunk in chunks
                )
            )
            self.assertTrue(
                any(
                    chunk["anchor"].get("section_path")
                    == ["二、采购注意事项", "（一）采购意向公示要求"]
                    and "2.请各项目单位务必高度重视" in chunk["text"]
                    for chunk in chunks
                )
            )

    def test_load_candidate_documents_normalizes_tuple_fields_from_jsonl(self) -> None:
        candidate = _candidate_document()
        with TemporaryDirectory() as temp_dir:
            jsonl_path = Path(temp_dir) / "candidate-documents.jsonl"
            jsonl_path.write_text(
                json.dumps(
                    {
                        **asdict(candidate),
                        "entitlement_groups": list(candidate.entitlement_groups),
                        "quality_gates_passed": list(candidate.quality_gates_passed),
                        "reasons": list(candidate.reasons),
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            loaded = load_internal_notice_regulation_candidate_documents(jsonl_path)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0].entitlement_groups, ("campus_members",))
            self.assertEqual(loaded[0].quality_gates_passed[0], "canonical_text_available")

    def test_prepare_candidate_chunks_allows_missing_source_notice_release_time(self) -> None:
        candidate = _candidate_document()
        candidate = InternalNoticeRegulationCandidateArtifactDocument(
            **{
                **asdict(candidate),
                "source_notice_release_time": None,
            }
        )
        with TemporaryDirectory() as temp_dir:
            report = prepare_internal_notice_regulation_candidate_chunks(
                documents=(candidate,),
                output_dir=Path(temp_dir),
            )
            self.assertTrue(report.passed)
            validation = json.loads(
                Path(report.validation_summary_path).read_text(encoding="utf-8")
            )
            self.assertEqual(validation["missing_projection_metadata_count"], 0)
            self.assertEqual(validation["failed_candidate_ids"], [])


if __name__ == "__main__":
    unittest.main()
