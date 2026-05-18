from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.official_web_projection import replay_official_web_source_truth_local

from .official_web_projection_test_support import (
    _block,
    _declarations_payload,
    _page_bundle_entry,
    _target_match,
    _write_json,
    _write_output_page,
)


class OfficialWebProjectionSourcePackRegulationTest(unittest.TestCase):
    def test_replay_recovers_formal_regulation_title_and_preserves_regulation_lines(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="student_regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
                workset_reason="source_pack_preview_seed",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_student_rule_title_recovery",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_student_rule_4871",
                            raw_version_id="owver_student_rule_4871",
                            normalized_canonical_url="https://xxgk.muc.edu.cn/info/1247/4871.htm",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                            source_pack_id="official-web-public-regulation-closeout.v1",
                            source_pack_entry_id="owsp-closeout-student-rules-jwgl-listing",
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_student_rule_4871",
                raw_version_id="owver_student_rule_4871",
                normalized_canonical_url="https://xxgk.muc.edu.cn/info/1247/4871.htm",
                page_title="成人高等教育学籍管理",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="成人高等教育学籍管理",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="学生工作",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="paragraph-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text=(
                            "中央民族大学成人高等学历教育学生学籍管理规定 "
                            "第一章 总则第一条 为加强我校成人高等学历教育学生的学籍管理，制定本规定。"
                            "第二条 本规定适用于我校成人高等学历教育学生。"
                        ),
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 1)
            candidate = report.consumer_candidate_pages[0]
            typed_candidate = candidate["typed_candidate"]
            self.assertEqual(
                typed_candidate["reference_title"],
                "中央民族大学成人高等学历教育学生学籍管理规定",
            )
            self.assertIn("regulation_lines", typed_candidate)
            self.assertEqual(
                typed_candidate["regulation_lines"][0],
                "学生工作",
            )
            self.assertIn(
                "中央民族大学成人高等学历教育学生学籍管理规定",
                typed_candidate["regulation_lines"][1],
            )

    def test_replay_normalizes_single_spaces_inside_cjk_rule_titles(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="student_regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
                workset_reason="source_pack_preview_seed",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_student_rule_title_spacing",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_student_rule_spacing_1",
                            raw_version_id="owver_student_rule_spacing_1",
                            normalized_canonical_url="https://xxgk.muc.edu.cn/info/1264/5301.htm",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_student_rule_spacing_2",
                            raw_version_id="owver_student_rule_spacing_2",
                            normalized_canonical_url="https://xxgk.muc.edu.cn/info/1265/5311.htm",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_student_rule_spacing_1",
                raw_version_id="owver_student_rule_spacing_1",
                normalized_canonical_url="https://xxgk.muc.edu.cn/info/1264/5301.htm",
                page_title="中央民族大学外国留学生本科生 学籍管理规定",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_rule_spacing_1",
                        raw_version_id="owver_student_rule_spacing_1",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学外国留学生本科生 学籍管理规定",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule_spacing_1",
                        raw_version_id="owver_student_rule_spacing_1",
                        row_id="paragraph-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范外国留学生本科生学籍管理，制定本规定。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_student_rule_spacing_2",
                raw_version_id="owver_student_rule_spacing_2",
                normalized_canonical_url="https://xxgk.muc.edu.cn/info/1265/5311.htm",
                page_title="中央民族大学 优秀毕业研究生评选办法",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_rule_spacing_2",
                        raw_version_id="owver_student_rule_spacing_2",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学 优秀毕业研究生评选办法",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule_spacing_2",
                        raw_version_id="owver_student_rule_spacing_2",
                        row_id="paragraph-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范优秀毕业研究生评选，制定本办法。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 2)
            by_url = {
                candidate["normalized_canonical_url"]: candidate["typed_candidate"]
                for candidate in report.consumer_candidate_pages
            }
            self.assertEqual(
                by_url["https://xxgk.muc.edu.cn/info/1264/5301.htm"]["reference_title"],
                "中央民族大学外国留学生本科生学籍管理规定",
            )
            self.assertEqual(
                by_url["https://xxgk.muc.edu.cn/info/1265/5311.htm"]["reference_title"],
                "中央民族大学优秀毕业研究生评选办法",
            )

    def test_replay_skips_non_answer_bearing_source_pack_preview_directory_seed_candidates(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"].insert(
                3,
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                },
            )
            _write_json(declarations_path, payload)
            regulation_match = _target_match(
                consumer_family="student_regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
                workset_reason="source_pack_preview_seed",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_source_pack_directory_seed",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_source_pack_directory_seed",
                            raw_version_id="owver_source_pack_directory_seed",
                            normalized_canonical_url="https://www.example.edu/xsgz/jwgl/",
                            page_family="directory_page",
                            target_matches=[regulation_match],
                            source_pack_id="official-web-regulation-expansion.v1",
                            source_pack_entry_id="owsp-student-rules-jwgl-listing",
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_source_pack_directory_seed",
                raw_version_id="owver_source_pack_directory_seed",
                normalized_canonical_url="https://www.example.edu/xsgz/jwgl/",
                page_title="教务管理",
                page_family="directory_page",
                target_matches=[regulation_match],
                source_pack_id="official-web-regulation-expansion.v1",
                source_pack_entry_id="owsp-student-rules-jwgl-listing",
                blocks=[
                    _block(
                        raw_asset_id="owasset_source_pack_directory_seed",
                        raw_version_id="owver_source_pack_directory_seed",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="教务管理",
                    ),
                    _block(
                        raw_asset_id="owasset_source_pack_directory_seed",
                        raw_version_id="owver_source_pack_directory_seed",
                        row_id="link-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="学生奖学金评定办法",
                        is_main_content=True,
                    ),
                    _block(
                        raw_asset_id="owasset_source_pack_directory_seed",
                        raw_version_id="owver_source_pack_directory_seed",
                        row_id="link-2",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="学生违纪处分规定",
                        is_main_content=True,
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 0)
            self.assertEqual(report.counts["emitted_documents"], 0)
            self.assertEqual(report.counts["manual_review_pages"], 0)
            self.assertEqual(
                report.target_family_counts,
                {
                    "student_regulation_candidate": 1,
                },
            )

    def test_replay_skips_source_pack_preview_listing_page_regulation_candidates(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="student_regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
                workset_reason="source_pack_preview_seed",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_source_pack_listing_seed",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_source_pack_listing_seed",
                            raw_version_id="owver_source_pack_listing_seed",
                            normalized_canonical_url="https://www.example.edu/xsgz/jlycf.htm",
                            page_family="listing_page",
                            target_matches=[regulation_match],
                            source_pack_id="official-web-regulation-expansion.v1",
                            source_pack_entry_id="owsp-student-rules-jlycf-listing",
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_source_pack_listing_seed",
                raw_version_id="owver_source_pack_listing_seed",
                normalized_canonical_url="https://www.example.edu/xsgz/jlycf.htm",
                page_title="奖励与处分",
                page_family="listing_page",
                target_matches=[regulation_match],
                source_pack_id="official-web-regulation-expansion.v1",
                source_pack_entry_id="owsp-student-rules-jlycf-listing",
                blocks=[
                    _block(
                        raw_asset_id="owasset_source_pack_listing_seed",
                        raw_version_id="owver_source_pack_listing_seed",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="奖励与处分",
                    ),
                    _block(
                        raw_asset_id="owasset_source_pack_listing_seed",
                        raw_version_id="owver_source_pack_listing_seed",
                        row_id="link-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="中央民族大学学生违纪处分实施办法",
                        is_main_content=True,
                    ),
                    _block(
                        raw_asset_id="owasset_source_pack_listing_seed",
                        raw_version_id="owver_source_pack_listing_seed",
                        row_id="link-2",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="中央民族大学本科生先进班级体评选办法（修订）",
                        is_main_content=True,
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 0)
            self.assertEqual(
                report.target_family_counts,
                {
                    "student_regulation_candidate": 1,
                },
            )

    def test_replay_skips_attachment_only_source_pack_preview_regulation_detail(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/institutional_rules",
                target_id="official-web-institutional-rules",
                review_policy="release_gate_required",
                workset_reason="source_pack_preview_seed",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_source_pack_attachment_only_rule",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_source_pack_attachment_only_rule",
                            raw_version_id="owver_source_pack_attachment_only_rule",
                            normalized_canonical_url="https://www.example.edu/info/1290/5661.htm",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                            source_pack_id="official-web-regulation-expansion.v1",
                            source_pack_entry_id="owsp-institutional-rules-rszd-listing",
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_source_pack_attachment_only_rule",
                raw_version_id="owver_source_pack_attachment_only_rule",
                normalized_canonical_url="https://www.example.edu/info/1290/5661.htm",
                page_title="中央民族大学关于登记备案人员因私出国（境）管理办法",
                page_family="article_detail",
                target_matches=[regulation_match],
                source_pack_id="official-web-regulation-expansion.v1",
                source_pack_entry_id="owsp-institutional-rules-rszd-listing",
                blocks=[
                    _block(
                        raw_asset_id="owasset_source_pack_attachment_only_rule",
                        raw_version_id="owver_source_pack_attachment_only_rule",
                        row_id="heading-1",
                        row_index=0,
                        block_order=0,
                        block_role="heading",
                        text="中央民族大学关于登记备案人员因私出国（境）管理办法",
                    ),
                    _block(
                        raw_asset_id="owasset_source_pack_attachment_only_rule",
                        raw_version_id="owver_source_pack_attachment_only_rule",
                        row_id="attachment-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="中央民族大学关于登记备案人员因私出国（境）管理办法",
                        is_main_content=True,
                        link_target="https://www.example.edu/__local/rule.doc",
                    ),
                    _block(
                        raw_asset_id="owasset_source_pack_attachment_only_rule",
                        raw_version_id="owver_source_pack_attachment_only_rule",
                        row_id="meta-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="作者：admin 来源：未知 点击数： 更新时间：14-10-14 13:00",
                        is_main_content=True,
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 0)
            self.assertEqual(report.counts["emitted_documents"], 0)
            self.assertEqual(
                report.target_family_counts,
                {
                    "regulation_candidate": 1,
                },
            )

    def test_replay_skips_non_rule_material_fragment_under_regulation_target(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/institutional_rules",
                target_id="official-web-institutional-rules",
                review_policy="release_gate_required",
                workset_reason="source_pack_preview_seed",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_source_pack_material_fragment",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_source_pack_material_fragment",
                            raw_version_id="owver_source_pack_material_fragment",
                            normalized_canonical_url="https://www.example.edu/info/1290/5771.htm",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                            source_pack_id="official-web-regulation-expansion.v1",
                            source_pack_entry_id="owsp-institutional-rules-rszd-listing",
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_source_pack_material_fragment",
                raw_version_id="owver_source_pack_material_fragment",
                normalized_canonical_url="https://www.example.edu/info/1290/5771.htm",
                page_title="引进高端人才需提交材料",
                page_family="article_detail",
                target_matches=[regulation_match],
                source_pack_id="official-web-regulation-expansion.v1",
                source_pack_entry_id="owsp-institutional-rules-rszd-listing",
                blocks=[
                    _block(
                        raw_asset_id="owasset_source_pack_material_fragment",
                        raw_version_id="owver_source_pack_material_fragment",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="引进高端人才需提交材料",
                    ),
                    _block(
                        raw_asset_id="owasset_source_pack_material_fragment",
                        raw_version_id="owver_source_pack_material_fragment",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 申请人需提交身份证、学历学位证明及代表性成果材料。",
                        is_main_content=True,
                    ),
                    _block(
                        raw_asset_id="owasset_source_pack_material_fragment",
                        raw_version_id="owver_source_pack_material_fragment",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="第二条 相关材料由人事处审核。",
                        is_main_content=True,
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 0)
            self.assertEqual(report.counts["emitted_documents"], 0)
            self.assertEqual(
                report.target_family_counts,
                {
                    "regulation_candidate": 1,
                },
            )


if __name__ == "__main__":
    unittest.main()
