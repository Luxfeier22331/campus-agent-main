# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.official_web_projection_core_replay_suite_support import *


class OfficialWebProjectionCoreReplayTestPart05(unittest.TestCase):
    def test_email_service_composition_merges_policy_entry_and_material_sources(
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
                target_id="campus-services-service-guide",
                target_job_id="owtarget_email_service_guide",
                target_candidate_id="owcand_email_service",
                target_label="中央民族大学校园电子邮件服务",
            )
            contact_match = _target_match(
                consumer_family="contact_directory_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/contact_directory",
                target_id="campus-services-contact-directory",
                target_job_id="owtarget_met_contact_directory",
                target_candidate_id="owcand_met_contact",
                target_label="中央民族大学信息化服务联系方式",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_email_bundle",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_policy",
                            raw_version_id="owver_email_policy",
                            normalized_canonical_url="https://met.example.edu/info/1024/1090.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-policy-1090",
                            composition_group="email_service",
                            composition_role="policy_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_entry",
                            raw_version_id="owver_email_entry",
                            normalized_canonical_url="https://met.example.edu/info/1046/1932.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-entry-1932",
                            composition_group="email_service",
                            composition_role="entry_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_material",
                            raw_version_id="owver_email_material",
                            normalized_canonical_url="https://met.example.edu/xzzq/sqbg/1.htm",
                            page_family="listing_page",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-material-forms",
                            composition_group="email_service",
                            composition_role="material_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_met_contact",
                            raw_version_id="owver_met_contact",
                            normalized_canonical_url="https://met.example.edu/contact/service.htm",
                            page_family="article_detail",
                            target_matches=[contact_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-met-service-contacts",
                            composition_group="email_service",
                            composition_role="contact_source",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_policy",
                raw_version_id="owver_email_policy",
                normalized_canonical_url="https://met.example.edu/info/1024/1090.htm",
                page_title="中央民族大学电子邮件管理办法",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-policy-1090",
                composition_group="email_service",
                composition_role="policy_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学电子邮件管理办法",
                    ),
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="校园网电子邮件由网络中心负责运行和维护。",
                    ),
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="校园网电子邮箱的服务对象包含学校各单位、全体教职工、全日制在校学生和2014级及之后的毕业生。",
                    ),
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="p-3",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="新邮箱的申请方法：填写《E-MAIL申请表》并递交网络中心批准。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_entry",
                raw_version_id="owver_email_entry",
                normalized_canonical_url="https://met.example.edu/info/1046/1932.htm",
                page_title="邮箱登陆",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-entry-1932",
                composition_group="email_service",
                composition_role="entry_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_entry",
                        raw_version_id="owver_email_entry",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="邮箱登陆",
                    ),
                    _block(
                        raw_asset_id="owasset_email_entry",
                        raw_version_id="owver_email_entry",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="邮箱登陆有三种方式：访问 mail.muc.edu.cn，输入账号和密码即可登陆；通过信息门户点击邮箱链接可直接登陆。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_material",
                raw_version_id="owver_email_material",
                normalized_canonical_url="https://met.example.edu/xzzq/sqbg/1.htm",
                page_title="申请表格",
                page_family="listing_page",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-material-forms",
                composition_group="email_service",
                composition_role="material_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_material",
                        raw_version_id="owver_email_material",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="申请表格",
                    ),
                    _block(
                        raw_asset_id="owasset_email_material",
                        raw_version_id="owver_email_material",
                        row_id="li-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="申请表格－中央民族大学教工电子邮件申请表",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_met_contact",
                raw_version_id="owver_met_contact",
                normalized_canonical_url="https://met.example.edu/contact/service.htm",
                page_title="信息化服务联系方式",
                page_family="article_detail",
                target_matches=[contact_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-met-service-contacts",
                composition_group="email_service",
                composition_role="contact_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_met_contact",
                        raw_version_id="owver_met_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="信息化服务联系方式",
                    ),
                    _block(
                        raw_asset_id="owasset_met_contact",
                        raw_version_id="owver_met_contact",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="网络中心，电话：010-68932559。",
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
            self.assertEqual(
                set(candidates_by_family.keys()),
                {"service_guide_candidate", "contact_directory_candidate"},
            )
            service_candidate = candidates_by_family["service_guide_candidate"]
            self.assertEqual(
                service_candidate["typed_candidate"]["service_name"],
                "中央民族大学校园电子邮件服务",
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["responsible_office"],
                ["网络中心"],
            )
            self.assertIn(
                "申请表格－中央民族大学教工电子邮件申请表",
                service_candidate["typed_candidate"]["materials"],
            )
            self.assertNotIn(
                "申请表格",
                service_candidate["typed_candidate"]["materials"],
            )
            self.assertIn(
                "mail.muc.edu.cn",
                service_candidate["typed_candidate"]["entry_points"],
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["field_source_urls"]["materials"],
                ["https://met.example.edu/xzzq/sqbg/1.htm"],
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["field_source_urls"]["entry_points"],
                ["https://met.example.edu/info/1046/1932.htm"],
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["field_source_urls"]["process_steps"],
                ["https://met.example.edu/info/1024/1090.htm"],
            )
            self.assertNotIn(
                "信息门户",
                service_candidate["typed_candidate"]["entry_points"],
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["contacts"]["phones"],
                ["010-68932559"],
            )
            self.assertEqual(service_candidate["quality_gate"]["decision"], "pass")
            contact_candidate = candidates_by_family["contact_directory_candidate"]
            self.assertEqual(
                contact_candidate["typed_candidate"]["display_name"],
                "中央民族大学信息化服务联系方式",
            )

    def test_information_disclosure_composition_fail_closes_when_multiple_procedure_sources_exist(
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
                    "crawlRunId": "owrun_info_disclosure_ambiguous_primary",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_procedure_a",
                            raw_version_id="owver_info_procedure_a",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1113.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-procedure-a",
                            composition_group="information_disclosure",
                            composition_role="procedure_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_procedure_b",
                            raw_version_id="owver_info_procedure_b",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1115.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-procedure-b",
                            composition_group="information_disclosure",
                            composition_role="procedure_source",
                        ),
                    ],
                },
            )
            for raw_asset_id, raw_version_id, url, title, text in [
                (
                    "owasset_info_procedure_a",
                    "owver_info_procedure_a",
                    "https://xxgk.example.edu/info/1007/1113.htm",
                    "中央民族大学信息公开依申请公开工作流程",
                    "申请人提出申请后，学校信息公开办公室负责初步审核。",
                ),
                (
                    "owasset_info_procedure_b",
                    "owver_info_procedure_b",
                    "https://xxgk.example.edu/info/1007/1115.htm",
                    "中央民族大学信息公开依申请公开补充说明",
                    "学校在15个工作日内作出答复。",
                ),
            ]:
                _write_output_page(
                    output_dir,
                    site_id="campus_public",
                    host="xxgk.example.edu",
                    raw_asset_id=raw_asset_id,
                    raw_version_id=raw_version_id,
                    normalized_canonical_url=url,
                    page_title=title,
                    page_family="article_detail",
                    target_matches=[service_match],
                    source_pack_id="tool-driven-first-slice.v1",
                    source_pack_entry_id=f"{raw_asset_id}-entry",
                    composition_group="information_disclosure",
                    composition_role="procedure_source",
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

    def test_email_service_composition_fail_closes_without_policy_source(self) -> None:
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
                    "crawlRunId": "owrun_email_missing_policy",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_entry",
                            raw_version_id="owver_email_entry",
                            normalized_canonical_url="https://met.example.edu/info/1046/1932.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-entry-1932",
                            composition_group="email_service",
                            composition_role="entry_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_material",
                            raw_version_id="owver_email_material",
                            normalized_canonical_url="https://met.example.edu/xzzq/sqbg/1.htm",
                            page_family="listing_page",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-material-forms",
                            composition_group="email_service",
                            composition_role="material_source",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_entry",
                raw_version_id="owver_email_entry",
                normalized_canonical_url="https://met.example.edu/info/1046/1932.htm",
                page_title="邮箱登陆",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-entry-1932",
                composition_group="email_service",
                composition_role="entry_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_entry",
                        raw_version_id="owver_email_entry",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="邮箱登陆",
                    ),
                    _block(
                        raw_asset_id="owasset_email_entry",
                        raw_version_id="owver_email_entry",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="访问 mail.muc.edu.cn，输入账号和密码即可登陆。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_material",
                raw_version_id="owver_email_material",
                normalized_canonical_url="https://met.example.edu/xzzq/sqbg/1.htm",
                page_title="申请表格",
                page_family="listing_page",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-material-forms",
                composition_group="email_service",
                composition_role="material_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_material",
                        raw_version_id="owver_email_material",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="申请表格",
                    ),
                    _block(
                        raw_asset_id="owasset_email_material",
                        raw_version_id="owver_email_material",
                        row_id="li-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="申请表格－中央民族大学教工电子邮件申请表",
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


if __name__ == "__main__":
    unittest.main()
