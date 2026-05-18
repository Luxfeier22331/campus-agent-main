# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.official_web_projection_core_replay_suite_support import *


class OfficialWebProjectionCoreReplayTestPart02(unittest.TestCase):
    def test_replay_target_workset_uses_target_lineage_for_family_grouping_and_projection(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            stable_match = _target_match(
                consumer_family="stable_reference_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="official_web/stable_reference",
                target_id="official-web-stable-reference",
                review_policy="release_gate_required",
            )
            contact_match = _target_match(
                consumer_family="contact_directory_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/contact_directory",
                target_id="campus-services-contact-directory",
                target_label="中央民族大学信息化服务联系方式",
            )
            notice_match = _target_match(
                consumer_family="notice_news_candidate",
                materialization_policy="inventory_only",
                selected_write_target="",
                target_id="official-web-notice-news-inventory",
                retention_policy="inventory_only",
                review_policy="inventory_only",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_target_workset",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_target_stable",
                            raw_version_id="owver_target_stable",
                            normalized_canonical_url="https://www.example.edu/intro",
                            page_family="article_detail",
                            target_matches=[stable_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_target_contact",
                            raw_version_id="owver_target_contact",
                            normalized_canonical_url="https://www.example.edu/contact",
                            page_family="article_detail",
                            target_matches=[contact_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_target_notice",
                            raw_version_id="owver_target_notice",
                            normalized_canonical_url="https://www.example.edu/news/notice",
                            page_family="article_detail",
                            target_matches=[notice_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_target_stable",
                raw_version_id="owver_target_stable",
                normalized_canonical_url="https://www.example.edu/intro",
                page_title="学校简介",
                page_family="article_detail",
                target_matches=[stable_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_stable",
                        raw_version_id="owver_target_stable",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校简介",
                    ),
                    _block(
                        raw_asset_id="owasset_target_stable",
                        raw_version_id="owver_target_stable",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高水平大学。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_target_contact",
                raw_version_id="owver_target_contact",
                normalized_canonical_url="https://www.example.edu/contact",
                page_title="联系我们",
                page_family="article_detail",
                target_matches=[contact_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_contact",
                        raw_version_id="owver_target_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="联系我们",
                    ),
                    _block(
                        raw_asset_id="owasset_target_contact",
                        raw_version_id="owver_target_contact",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="办公地点：中慧楼二层，联系电话：010-68933381。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_target_notice",
                raw_version_id="owver_target_notice",
                normalized_canonical_url="https://www.example.edu/news/notice",
                page_title="关于近期活动安排的通知",
                page_family="article_detail",
                target_matches=[notice_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_notice",
                        raw_version_id="owver_target_notice",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="关于近期活动安排的通知",
                    ),
                    _block(
                        raw_asset_id="owasset_target_notice",
                        raw_version_id="owver_target_notice",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="活动安排以现场通知为准。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 1)
            self.assertEqual(report.counts["consumer_candidate_pages"], 2)
            self.assertEqual(
                report.target_family_counts,
                {
                    "stable_reference_candidate": 1,
                    "contact_directory_candidate": 1,
                    "notice_news_candidate": 1,
                },
            )
            self.assertEqual(
                report.target_materialization_policy_counts,
                {
                    "release_gate_required": 1,
                    "candidate_only": 1,
                    "inventory_only": 1,
                },
            )
            self.assertEqual(report.target_lineage_issues, [])
            self.assertEqual(
                report.documents[0]["target_consumer_family"],
                "stable_reference_candidate",
            )
            self.assertEqual(report.documents[0]["target_job_id"], "owtargetjob_test")
            self.assertEqual(report.documents[0]["target_id"], "official-web-stable-reference")
            self.assertEqual(report.documents[0]["materialization_policy"], "release_gate_required")
            candidates_by_family = {
                candidate["consumer_family"]: candidate
                for candidate in report.consumer_candidate_pages
            }
            self.assertEqual(
                candidates_by_family["contact_directory_candidate"]["target_id"],
                "campus-services-contact-directory",
            )
            self.assertEqual(
                candidates_by_family["notice_news_candidate"]["source_family"],
                "official_web_public_notice",
            )
            self.assertNotIn("public_notice_inventory", json.dumps(asdict(report)))

    def test_target_workset_rejects_snake_case_target_match_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            snake_case_match = {
                "target_job_id": "owtargetjob_snake",
                "target_candidate_id": "owtargetcandidate_snake",
                "target_id": "campus-services-contact-directory",
                "target_declaration_version": "muc_public_target_source_map_v2",
                "consumer_family": "contact_directory_candidate",
                "retention_policy": "retain_source_truth",
                "materialization_policy": "candidate_only",
                "selected_write_target": "campus_services/contact_directory",
                "review_policy": "selected_write_requires_review",
                "workset_reason": "target_source_map_match",
            }
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_target_snake",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        {
                            **_page_bundle_entry(
                                raw_asset_id="owasset_target_snake",
                                raw_version_id="owver_target_snake",
                                normalized_canonical_url="https://www.example.edu/contact",
                                page_family="article_detail",
                            ),
                            "targetMatches": [snake_case_match],
                        },
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_target_snake",
                raw_version_id="owver_target_snake",
                normalized_canonical_url="https://www.example.edu/contact",
                page_title="联系我们",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_snake",
                        raw_version_id="owver_target_snake",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="联系我们",
                    ),
                    _block(
                        raw_asset_id="owasset_target_snake",
                        raw_version_id="owver_target_snake",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="办公地点：中慧楼二层，联系电话：010-68933381。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 0)
            self.assertEqual(report.target_family_counts, {})
            self.assertEqual(report.target_materialization_policy_counts, {})
            self.assertEqual(
                {issue["code"] for issue in report.target_lineage_issues},
                {
                    "unsupported_target_consumer_family",
                    "unsupported_target_materialization_policy",
                },
            )

    def test_target_workset_regulation_candidate_stays_release_gated_and_targets_institutional_rules(
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
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_target_regulation",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_target_regulation",
                            raw_version_id="owver_target_regulation",
                            normalized_canonical_url="https://www.example.edu/rules/policy",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_target_regulation",
                raw_version_id="owver_target_regulation",
                normalized_canonical_url="https://www.example.edu/rules/policy",
                page_title="中央民族大学信息公开实施细则",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_regulation",
                        raw_version_id="owver_target_regulation",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开实施细则",
                    ),
                    _block(
                        raw_asset_id="owasset_target_regulation",
                        raw_version_id="owver_target_regulation",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为了推进学校信息公开工作，制定本实施细则。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 0)
            self.assertEqual(report.counts["consumer_candidate_pages"], 1)
            self.assertEqual(
                report.target_family_counts,
                {
                    "regulation_candidate": 1,
                },
            )
            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["consumer_family"], "regulation_candidate")
            self.assertEqual(candidate["materialization_policy"], "release_gate_required")
            self.assertEqual(candidate["selected_write_target"], "regulations/institutional_rules")
            self.assertEqual(candidate["target_corpus"], "regulations")
            self.assertEqual(candidate["target_collection"], "institutional_rules")
            self.assertEqual(
                candidate["typed_candidate_schema_version"],
                "official_web_regulation_candidate.v1",
            )
            self.assertEqual(candidate["quality_gate"]["decision"], "pass")
            self.assertEqual(
                candidate["typed_candidate"]["regulation_text"],
                "第一条 为了推进学校信息公开工作，制定本实施细则。",
            )

    def test_target_workset_regulation_candidate_allows_public_information_body_text(
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
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_disclosure",
                            raw_version_id="owver_info_disclosure",
                            normalized_canonical_url="https://www.example.edu/info/1005/1107.htm",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_info_disclosure",
                raw_version_id="owver_info_disclosure",
                normalized_canonical_url="https://www.example.edu/info/1005/1107.htm",
                page_title="中央民族大学信息公开实施细则",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_disclosure",
                        raw_version_id="owver_info_disclosure",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开实施细则",
                    ),
                    _block(
                        raw_asset_id="owasset_info_disclosure",
                        raw_version_id="owver_info_disclosure",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 学校应当主动公开规章制度、办事程序和服务事项。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["consumer_family"], "regulation_candidate")
            self.assertEqual(candidate["quality_gate"], {"decision": "pass", "reason_codes": []})
            self.assertEqual(
                candidate["typed_candidate"]["regulation_text"],
                "第一条 学校应当主动公开规章制度、办事程序和服务事项。",
            )

    def test_target_workset_regulation_candidate_derives_target_scope_from_selected_write_target(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            student_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
            )
            scoped_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/scoped_rules",
                target_id="official-web-scoped-rules",
                review_policy="release_gate_required",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_scope_derivation",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_student_rule",
                            raw_version_id="owver_student_rule",
                            normalized_canonical_url="https://www.example.edu/rules/student-award.htm",
                            page_family="article_detail",
                            target_matches=[student_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_scoped_rule",
                            raw_version_id="owver_scoped_rule",
                            normalized_canonical_url="https://www.example.edu/rules/summer-lab.htm",
                            page_family="article_detail",
                            target_matches=[scoped_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_student_rule",
                raw_version_id="owver_student_rule",
                normalized_canonical_url="https://www.example.edu/rules/student-award.htm",
                page_title="中央民族大学学生奖学金评定办法",
                page_family="article_detail",
                target_matches=[student_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_rule",
                        raw_version_id="owver_student_rule",
                        row_id="student-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学学生奖学金评定办法",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule",
                        raw_version_id="owver_student_rule",
                        row_id="student-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范学生奖学金评定工作，制定本办法。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_scoped_rule",
                raw_version_id="owver_scoped_rule",
                normalized_canonical_url="https://www.example.edu/rules/summer-lab.htm",
                page_title="中央民族大学暑期实验室安全管理规定",
                page_family="article_detail",
                target_matches=[scoped_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_scoped_rule",
                        raw_version_id="owver_scoped_rule",
                        row_id="scoped-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学暑期实验室安全管理规定",
                    ),
                    _block(
                        raw_asset_id="owasset_scoped_rule",
                        raw_version_id="owver_scoped_rule",
                        row_id="scoped-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范暑期实验室开放期间的安全管理，制定本规定。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            by_target_id = {
                candidate["target_id"]: candidate for candidate in report.consumer_candidate_pages
            }
            self.assertEqual(
                by_target_id["official-web-student-rules"]["target_collection"],
                "student_rules",
            )
            self.assertEqual(
                by_target_id["official-web-student-rules"]["typed_candidate"]["release_scope"],
                "regulations/student_rules",
            )
            self.assertEqual(
                by_target_id["official-web-scoped-rules"]["target_collection"],
                "scoped_rules",
            )
            self.assertEqual(
                by_target_id["official-web-scoped-rules"]["typed_candidate"]["release_scope"],
                "regulations/scoped_rules",
            )

    def test_target_workset_regulation_candidate_rejects_footer_only_body_text(
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
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_footer_only",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_footer_only_rule",
                            raw_version_id="owver_footer_only_rule",
                            normalized_canonical_url="https://www.example.edu/info/1005/1198.htm",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_footer_only_rule",
                raw_version_id="owver_footer_only_rule",
                normalized_canonical_url="https://www.example.edu/info/1005/1198.htm",
                page_title="中央民族大学学术委员会章程",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_footer_only_rule",
                        raw_version_id="owver_footer_only_rule",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学学术委员会章程",
                    ),
                    _block(
                        raw_asset_id="owasset_footer_only_rule",
                        raw_version_id="owver_footer_only_rule",
                        row_id="footer-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="Copyright@ 2018 -- 党委办公室 校长办公室 All Rights Reserved",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["consumer_family"], "regulation_candidate")
            self.assertEqual(candidate["quality_gate"]["decision"], "reject")
            self.assertIn(
                "missing_answer_bearing_regulation_body",
                candidate["quality_gate"]["reason_codes"],
            )


if __name__ == "__main__":
    unittest.main()
