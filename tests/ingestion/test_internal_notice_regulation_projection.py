from __future__ import annotations

import json
import unittest

from campus_ingestion_core.internal_notice_regulation_projection import (
    build_internal_notice_regulation_projected_document,
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


class InternalNoticeRegulationProjectionTest(unittest.TestCase):
    def test_projected_document_units_preserve_regulation_structure_in_anchor(self) -> None:
        projected = build_internal_notice_regulation_projected_document(
            candidate_document=_candidate_document()
        )
        rows = [
            json.loads(line)
            for line in projected.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

        self.assertEqual(rows[0]["anchor"], {})
        self.assertEqual(rows[1]["anchor"]["section_path"], ["一、主要修订内容"])
        self.assertEqual(
            rows[2]["anchor"]["section_path"],
            ["一、主要修订内容", "（一）、校内集中采购限额标准及范围调整"],
        )
        self.assertEqual(
            rows[3]["anchor"]["section_path"],
            ["一、主要修订内容", "（一）、校内集中采购限额标准及范围调整"],
        )
        self.assertEqual(
            rows[6]["anchor"]["section_path"],
            ["二、采购注意事项", "（一）采购意向公示要求"],
        )
        self.assertEqual(
            rows[7]["anchor"]["section_path"],
            ["二、采购注意事项", "（一）采购意向公示要求"],
        )
        self.assertEqual(rows[7]["anchor"]["provision_label"], "1.")


if __name__ == "__main__":
    unittest.main()
