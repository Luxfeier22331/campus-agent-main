# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.official_web_projection_core_replay_suite_support import *


class OfficialWebProjectionCoreReplayTestPart03(unittest.TestCase):
    def test_target_workset_regulation_candidate_rejects_notice_like_page_title(
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
                    "crawlRunId": "owrun_projection_notice_like_regulation",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_notice_like_rule",
                            raw_version_id="owver_notice_like_rule",
                            normalized_canonical_url="https://www.example.edu/info/1005/1199.htm",
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
                raw_asset_id="owasset_notice_like_rule",
                raw_version_id="owver_notice_like_rule",
                normalized_canonical_url="https://www.example.edu/info/1005/1199.htm",
                page_title="中央民族大学家具采购项目比选公告",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_notice_like_rule",
                        raw_version_id="owver_notice_like_rule",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学家具采购项目比选公告",
                    ),
                    _block(
                        raw_asset_id="owasset_notice_like_rule",
                        raw_version_id="owver_notice_like_rule",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 本公告仅用于采购项目比选，不是学校现行规章制度。",
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
                "selected_write_suppressed_page_type",
                candidate["quality_gate"]["reason_codes"],
            )

    def test_target_workset_regulation_candidate_normalizes_display_title_and_preserves_raw_title(
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
                    "crawlRunId": "owrun_projection_regulation_title_normalization",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_spaced_card_rule",
                            raw_version_id="owver_spaced_card_rule",
                            normalized_canonical_url="https://www.example.edu/info/1024/1086.htm",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_latest_network_rule",
                            raw_version_id="owver_latest_network_rule",
                            normalized_canonical_url="https://www.example.edu/info/1024/1188.htm",
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
                raw_asset_id="owasset_spaced_card_rule",
                raw_version_id="owver_spaced_card_rule",
                normalized_canonical_url="https://www.example.edu/info/1024/1086.htm",
                page_title="校 园 一 卡 通 管 理 规 定",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_spaced_card_rule",
                        raw_version_id="owver_spaced_card_rule",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校 园 一 卡 通 管 理 规 定",
                    ),
                    _block(
                        raw_asset_id="owasset_spaced_card_rule",
                        raw_version_id="owver_spaced_card_rule",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范校园一卡通管理，制定本规定。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_latest_network_rule",
                raw_version_id="owver_latest_network_rule",
                normalized_canonical_url="https://www.example.edu/info/1024/1188.htm",
                page_title="中央民族大学网络与信息安全管理办法（最新）",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_latest_network_rule",
                        raw_version_id="owver_latest_network_rule",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学网络与信息安全管理办法（最新）",
                    ),
                    _block(
                        raw_asset_id="owasset_latest_network_rule",
                        raw_version_id="owver_latest_network_rule",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为加强网络与信息安全管理，制定本办法。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidates_by_url = {
                candidate["normalized_canonical_url"]: candidate
                for candidate in report.consumer_candidate_pages
            }
            card = candidates_by_url["https://www.example.edu/info/1024/1086.htm"]
            network = candidates_by_url["https://www.example.edu/info/1024/1188.htm"]
            self.assertEqual(card["title"], "校园一卡通管理规定")
            self.assertEqual(card["title_raw"], "校 园 一 卡 通 管 理 规 定")
            self.assertEqual(card["typed_candidate"]["reference_title"], "校园一卡通管理规定")
            self.assertEqual(card["typed_candidate"]["source_title"], "校园一卡通管理规定")
            self.assertEqual(
                card["typed_candidate"]["source_title_raw"],
                "校 园 一 卡 通 管 理 规 定",
            )
            self.assertEqual(network["title"], "中央民族大学网络与信息安全管理办法")
            self.assertEqual(network["title_source_marker"], "最新")
            self.assertEqual(
                network["typed_candidate"]["title_base"],
                "中央民族大学网络与信息安全管理办法",
            )

    def test_target_workset_contact_candidate_uses_footer_contact_facts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            contact_match = _target_match(
                consumer_family="contact_directory_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/contact_directory",
                target_id="campus-services-contact-directory",
                target_label="中央民族大学信息化服务联系方式",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_footer_contact",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_footer_contact",
                            raw_version_id="owver_footer_contact",
                            normalized_canonical_url="https://www.example.edu/",
                            page_family="generic_content_page",
                            target_matches=[contact_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_footer_contact",
                raw_version_id="owver_footer_contact",
                normalized_canonical_url="https://www.example.edu/",
                page_title="中央民族大学",
                page_family="generic_content_page",
                target_matches=[contact_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_footer_contact",
                        raw_version_id="owver_footer_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学",
                    ),
                    _block(
                        raw_asset_id="owasset_footer_contact",
                        raw_version_id="owver_footer_contact",
                        row_id="nav-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="通知公告",
                        is_main_content=False,
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_footer_contact",
                        raw_version_id="owver_footer_contact",
                        row_id="footer-address",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="海淀校区：北京市海淀区中关村南大街27号 丰台校区：北京市丰台区魏各庄路27号",
                        is_main_content=False,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_footer_contact",
                        raw_version_id="owver_footer_contact",
                        row_id="footer-phone",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="电话：010-68932442",
                        is_main_content=False,
                        is_boilerplate=True,
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
            self.assertEqual(candidate["typed_candidate"]["phones"], ["010-68932442"])
            self.assertIn(
                "海淀校区：北京市海淀区中关村南大街27号",
                candidate["typed_candidate"]["locations"],
            )
            self.assertIn(
                "丰台校区：北京市丰台区魏各庄路27号",
                candidate["typed_candidate"]["locations"],
            )
            self.assertEqual(candidate["quality_gate"], {"decision": "pass", "reason_codes": []})

    def test_service_guide_candidate_extracts_responsible_offices(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            service_match = _target_match(
                consumer_family="service_guide_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/service_guide",
                target_id="campus-services-service-guide",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_service_office",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_service_office",
                            raw_version_id="owver_service_office",
                            normalized_canonical_url="https://www.example.edu/info/1007/1113.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_service_office",
                raw_version_id="owver_service_office",
                normalized_canonical_url="https://www.example.edu/info/1007/1113.htm",
                page_title="中央民族大学信息公开依申请公开工作流程",
                page_family="article_detail",
                target_matches=[service_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_service_office",
                        raw_version_id="owver_service_office",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开依申请公开工作流程",
                    ),
                    _block(
                        raw_asset_id="owasset_service_office",
                        raw_version_id="owver_service_office",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校信息公开办公室负责初步审核，并由具体承办部门负责审核申请人提出的学校信息公开申请。",
                    ),
                    _block(
                        raw_asset_id="owasset_service_office",
                        raw_version_id="owver_service_office",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="申请人应提交申请材料，学校在15个工作日内作出答复。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(
                candidate["typed_candidate"]["responsible_office"],
                ["学校信息公开办公室", "具体承办部门"],
            )
            self.assertEqual(candidate["quality_gate"], {"decision": "pass", "reason_codes": []})

    def test_service_guide_candidate_keeps_process_text_out_of_materials_and_entry_refs(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            service_match = _target_match(
                consumer_family="service_guide_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/service_guide",
                target_id="muc-it-student-campus-card-service-guide",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_campus_card_service",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_campus_card",
                            raw_version_id="owver_campus_card",
                            normalized_canonical_url="https://met.example.edu/card-service",
                            page_family="article_detail",
                            target_matches=[service_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_campus_card",
                raw_version_id="owver_campus_card",
                normalized_canonical_url="https://met.example.edu/card-service",
                page_title="学生校园卡服务",
                page_family="article_detail",
                target_matches=[service_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学生校园卡服务",
                    ),
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="服务说明：校园卡丢失后，请立即通过圈存机或民大通APP挂失，也可携带身份证到校园卡管理中心前台现场办理。",
                    ),
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="服务说明：校园卡损坏或丢失后，可通过自助补卡机补办新卡。",
                    ),
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="p-3",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="系统会同步相关个人信息到校园卡系统。",
                    ),
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="p-4",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="咨询电话：010-68933381、010-83878225。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            typed_candidate = candidate["typed_candidate"]
            self.assertEqual(typed_candidate["materials"], [])
            self.assertEqual(
                typed_candidate["entry_points"],
                ["圈存机", "民大通APP", "校园卡管理中心前台", "自助补卡机"],
            )
            self.assertTrue(
                any("服务说明：校园卡丢失后" in step for step in typed_candidate["process_steps"])
            )
            self.assertEqual(
                typed_candidate["contacts"]["phones"],
                ["010-68933381", "010-83878225"],
            )
            self.assertEqual(candidate["quality_gate"], {"decision": "pass", "reason_codes": []})

    def test_service_guide_download_page_does_not_satisfy_process_evidence(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            service_match = _target_match(
                consumer_family="service_guide_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/service_guide",
                target_id="muc-information-disclosure-application-form-download",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_form_download",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_form_download",
                            raw_version_id="owver_form_download",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1114.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_form_download",
                raw_version_id="owver_form_download",
                normalized_canonical_url="https://xxgk.example.edu/info/1007/1114.htm",
                page_title="中央民族大学依申请公开信息申请表、审批表下载",
                page_family="article_detail",
                target_matches=[service_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_form_download",
                        raw_version_id="owver_form_download",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学依申请公开信息申请表、审批表下载",
                    ),
                    _block(
                        raw_asset_id="owasset_form_download",
                        raw_version_id="owver_form_download",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学依申请公开信息审批表",
                    ),
                    _block(
                        raw_asset_id="owasset_form_download",
                        raw_version_id="owver_form_download",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="中央民族大学信息公开申请表",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["typed_candidate"]["process_steps"], [])
            self.assertEqual(
                candidate["typed_candidate"]["materials"],
                ["中央民族大学依申请公开信息审批表", "中央民族大学信息公开申请表"],
            )
            self.assertEqual(
                candidate["quality_gate"],
                {"decision": "reject", "reason_codes": ["missing_required_evidence"]},
            )


if __name__ == "__main__":
    unittest.main()
