# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.official_web_projection_core_replay_suite_support import *


class OfficialWebProjectionCoreReplayTestPart06(unittest.TestCase):
    def test_email_service_composition_fail_closes_when_multiple_policy_sources_exist(self) -> None:
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
                target_job_id="owtarget_email_service_guide",
                target_candidate_id="owcand_email_service",
                target_label="中央民族大学校园电子邮件服务",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_email_ambiguous_policy",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_policy_a",
                            raw_version_id="owver_email_policy_a",
                            normalized_canonical_url="https://met.example.edu/info/1024/1090.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-policy-1090",
                            composition_group="email_service",
                            composition_role="policy_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_policy_b",
                            raw_version_id="owver_email_policy_b",
                            normalized_canonical_url="https://met.example.edu/info/1024/1091.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-policy-1091",
                            composition_group="email_service",
                            composition_role="policy_source",
                        ),
                    ],
                },
            )
            for raw_asset_id, raw_version_id, url, title, text in [
                (
                    "owasset_email_policy_a",
                    "owver_email_policy_a",
                    "https://met.example.edu/info/1024/1090.htm",
                    "电子邮件服务说明",
                    "校园电子邮件由网络中心负责受理。",
                ),
                (
                    "owasset_email_policy_b",
                    "owver_email_policy_b",
                    "https://met.example.edu/info/1024/1091.htm",
                    "电子邮件服务补充说明",
                    "访问 mail.muc.edu.cn 后按提示办理。",
                ),
            ]:
                _write_output_page(
                    output_dir,
                    site_id="campus_public",
                    host="met.example.edu",
                    raw_asset_id=raw_asset_id,
                    raw_version_id=raw_version_id,
                    normalized_canonical_url=url,
                    page_title=title,
                    page_family="article_detail",
                    target_matches=[service_match],
                    source_pack_id="tool-driven-first-slice.v1",
                    source_pack_entry_id=f"{raw_asset_id}-entry",
                    composition_group="email_service",
                    composition_role="policy_source",
                    blocks=[
                        _block(
                            raw_asset_id=raw_asset_id,
                            raw_version_id=raw_version_id,
                            row_id="title-1",
                            row_index=0,
                            block_order=0,
                            block_role="title",
                            text=title,
                        ),
                        _block(
                            raw_asset_id=raw_asset_id,
                            raw_version_id=raw_version_id,
                            row_id="p-1",
                            row_index=1,
                            block_order=1,
                            block_role="paragraph",
                            text=text,
                        ),
                    ],
                )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(
                [
                    candidate["consumer_family"]
                    for candidate in report.consumer_candidate_pages
                    if candidate["consumer_family"] == "service_guide_candidate"
                ],
                [],
            )

    def test_information_disclosure_composition_fail_closes_unknown_service_role_page(self) -> None:
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
                target_job_id="owtarget_service_guide",
                target_candidate_id="owcand_info_disclosure_service",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_info_disclosure_unknown_role",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_procedure",
                            raw_version_id="owver_info_procedure",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1113.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-procedure-1113",
                            composition_group="information_disclosure",
                            composition_role="procedure_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_unknown",
                            raw_version_id="owver_info_unknown",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1116.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-unknown-1116",
                            composition_group="information_disclosure",
                            composition_role="faq_source",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_info_procedure",
                raw_version_id="owver_info_procedure",
                normalized_canonical_url="https://xxgk.example.edu/info/1007/1113.htm",
                page_title="中央民族大学信息公开依申请公开工作流程",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-info-disclosure-procedure-1113",
                composition_group="information_disclosure",
                composition_role="procedure_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_procedure",
                        raw_version_id="owver_info_procedure",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开依申请公开工作流程",
                    ),
                    _block(
                        raw_asset_id="owasset_info_procedure",
                        raw_version_id="owver_info_procedure",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="申请人提出申请后，学校信息公开办公室负责初步审核。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_info_unknown",
                raw_version_id="owver_info_unknown",
                normalized_canonical_url="https://xxgk.example.edu/info/1007/1116.htm",
                page_title="信息公开常见问题",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-info-disclosure-unknown-1116",
                composition_group="information_disclosure",
                composition_role="faq_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_unknown",
                        raw_version_id="owver_info_unknown",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="信息公开常见问题",
                    ),
                    _block(
                        raw_asset_id="owasset_info_unknown",
                        raw_version_id="owver_info_unknown",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="这里是补充说明。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(
                [
                    candidate["consumer_family"]
                    for candidate in report.consumer_candidate_pages
                    if candidate["consumer_family"] == "service_guide_candidate"
                ],
                [],
            )

    def test_service_guide_candidate_extracts_network_auth_host_entry(self) -> None:
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
                target_id="muc-it-network-auth-service-guide",
                target_label="中央民族大学校园网认证及使用说明",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schema_version": "official_web_source_truth_bundle.v1",
                    "crawlRunId": "owrun_network_auth_entry",
                    "site_id": "campus_public",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_network_auth",
                            raw_version_id="owver_network_auth",
                            normalized_canonical_url="https://met.example.edu/info/1046/2001.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-network-auth-2001",
                            composition_group="network_auth_service",
                            composition_role="primary",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_network_auth",
                raw_version_id="owver_network_auth",
                normalized_canonical_url="https://met.example.edu/info/1046/2001.htm",
                page_title="中央民族大学校园网新版认证系统上网使用说明",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-network-auth-2001",
                composition_group="network_auth_service",
                composition_role="primary",
                blocks=[
                    _block(
                        raw_asset_id="owasset_network_auth",
                        raw_version_id="owver_network_auth",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学校园网新版认证系统上网使用说明",
                    ),
                    _block(
                        raw_asset_id="owasset_network_auth",
                        raw_version_id="owver_network_auth",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="步骤三：如果系统未自动弹出认证页面，请在浏览器地址栏中直接输入rz.muc.edu.cn，打开中央民族大学校园网认证平台。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidates_by_family = {
                candidate["consumer_family"]: candidate
                for candidate in report.consumer_candidate_pages
            }
            service_candidate = candidates_by_family["service_guide_candidate"]
            self.assertIn(
                "rz.muc.edu.cn",
                service_candidate["typed_candidate"]["entry_points"],
            )
            self.assertNotIn(
                "中央民族大学校园网新版认证系统",
                service_candidate["typed_candidate"]["entry_points"],
            )

    def test_service_guide_candidate_extracts_vpn_ordered_steps_and_deduplicates_entries(
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
                target_id="muc-it-vpn-service-guide",
                target_label="中央民族大学 VPN 使用说明",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schema_version": "official_web_source_truth_bundle.v1",
                    "crawlRunId": "owrun_vpn_steps",
                    "site_id": "campus_public",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_vpn",
                            raw_version_id="owver_vpn",
                            normalized_canonical_url="https://met.example.edu/info/1046/1674.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-vpn-1674",
                            composition_group="vpn_service",
                            composition_role="primary",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_vpn",
                raw_version_id="owver_vpn",
                normalized_canonical_url="https://met.example.edu/info/1046/1674.htm",
                page_title="中央民族大学VPN系统使用说明",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-vpn-1674",
                composition_group="vpn_service",
                composition_role="primary",
                blocks=[
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学VPN系统使用说明",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="1、访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="2、输入统一身份认证账号和密码登录。",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-3",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="3、首次使用请根据系统提示下载客户端。",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-4",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="4、双击Install EasyConnect.pkg，根据提示完成安装。",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-5",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="也可直接访问 vpn.muc.edu.cn 使用。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            service_candidate = next(
                candidate
                for candidate in report.consumer_candidate_pages
                if candidate["consumer_family"] == "service_guide_candidate"
            )
            typed_candidate = service_candidate["typed_candidate"]
            self.assertEqual(
                typed_candidate["process_steps"],
                [
                    "1、访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
                    "2、输入统一身份认证账号和密码登录。",
                    "3、首次使用请根据系统提示下载客户端。",
                    "4、双击Install EasyConnect.pkg，根据提示完成安装。",
                ],
            )
            self.assertIn(
                "https://vpn.muc.edu.cn",
                typed_candidate["entry_points"],
            )
            self.assertNotIn("vpn.muc.edu.cn", typed_candidate["entry_points"])
            self.assertNotIn("APP", typed_candidate["entry_points"])
            self.assertEqual(
                [group["group_id"] for group in typed_candidate["procedure_groups"]],
                [
                    "service:official_web:vpn:procedure_group:direct_login",
                    "service:official_web:vpn:procedure_group:client_install",
                ],
            )
            self.assertEqual(
                typed_candidate["procedure_groups"][0]["steps"][0]["content"],
                "访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
            )
            self.assertEqual(
                typed_candidate["procedure_groups"][1]["steps"][1]["content"],
                "双击Install EasyConnect.pkg，根据提示完成安装。",
            )
            self.assertEqual(
                typed_candidate["field_source_urls"]["procedure_groups"],
                ["https://met.example.edu/info/1046/1674.htm"],
            )

    def test_contact_candidate_extracts_labeled_contact_points(self) -> None:
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
                    "crawlRunId": "owrun_met_contact_points",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_met_contacts",
                            raw_version_id="owver_met_contacts",
                            normalized_canonical_url="https://met.example.edu/service-contacts",
                            page_family="article_detail",
                            target_matches=[contact_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_met_contacts",
                raw_version_id="owver_met_contacts",
                normalized_canonical_url="https://met.example.edu/service-contacts",
                page_title="信息化服务联系方式",
                page_family="article_detail",
                target_matches=[contact_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_met_contacts",
                        raw_version_id="owver_met_contacts",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="信息化服务联系方式",
                    ),
                    _block(
                        raw_asset_id="owasset_met_contacts",
                        raw_version_id="owver_met_contacts",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="网络服务电话：010-68932559；一卡通服务电话：010-68933381；多媒体教室服务电话：010-68932625。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["consumer_family"], "contact_directory_candidate")
            self.assertEqual(
                candidate["typed_candidate"]["display_name"],
                "中央民族大学信息化服务联系方式",
            )
            self.assertEqual(
                candidate["typed_candidate"]["contact_points"],
                [
                    {"label": "网络服务", "phone": "010-68932559"},
                    {"label": "一卡通服务", "phone": "010-68933381"},
                    {"label": "多媒体教室服务", "phone": "010-68932625"},
                ],
            )


if __name__ == "__main__":
    unittest.main()
