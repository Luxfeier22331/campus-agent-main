# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_release_official_web_selected_write_support import *


class ReleaseOfficialWebSelectedWriteTestPart05(unittest.TestCase):
    def test_release_selected_write_service_guide_publishes_grouped_procedures_to_pg_bundle(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(selected_write_target="campus_services/service_guide"),
                "inventoryId": "muc-it-vpn-service-guide",
                "jobId": "owtarget_vpn",
                "inputRef": {
                    **dict(
                        _selected_write_task(selected_write_target="campus_services/service_guide")[
                            "inputRef"
                        ]
                    ),
                    "sourceUrls": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                    "targetLabel": "中央民族大学 VPN 使用说明",
                },
            }
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
                    ): json.dumps(
                        {"pages": [], "runId": "owrun_contact", "siteId": "muc_public"}
                    ).encode("utf-8")
                }
            )
            publisher = _FakeStructuredProjectionPublisher()

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://met.muc.edu.cn/info/1046/1674.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_vpn",
                            "raw_version_id": "owver_vpn",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_vpn",
                            "typed_candidate": {
                                "contacts": {
                                    "emails": [],
                                    "locations": [],
                                    "office_hours": [],
                                    "phones": [],
                                },
                                "entry_points": ["https://vpn.muc.edu.cn"],
                                "field_source_urls": {
                                    "entry_points": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                                    "process_steps": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                                    "procedure_groups": [
                                        "https://met.muc.edu.cn/info/1046/1674.htm"
                                    ],
                                },
                                "materials": [],
                                "process_steps": [
                                    "1、访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
                                    "2、输入统一身份认证账号和密码登录。",
                                    "3、首次使用请根据系统提示下载客户端。",
                                ],
                                "procedure_groups": [
                                    {
                                        "group_id": "service:official_web:vpn:procedure_group:direct_login",
                                        "title": "直接登录",
                                        "focus_tags": ["entry", "direct_login"],
                                        "steps": [
                                            {
                                                "step_id": "service:official_web:vpn:procedure_group:direct_login:step:1",
                                                "content": "访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
                                                "source_refs": [
                                                    "https://met.muc.edu.cn/info/1046/1674.htm"
                                                ],
                                            }
                                        ],
                                        "source_refs": [
                                            "https://met.muc.edu.cn/info/1046/1674.htm"
                                        ],
                                    },
                                    {
                                        "group_id": "service:official_web:vpn:procedure_group:client_install",
                                        "title": "客户端安装",
                                        "focus_tags": ["procedure", "install", "client"],
                                        "steps": [
                                            {
                                                "step_id": "service:official_web:vpn:procedure_group:client_install:step:1",
                                                "content": "首次使用请根据系统提示下载客户端。",
                                                "source_refs": [
                                                    "https://met.muc.edu.cn/info/1046/1674.htm"
                                                ],
                                            }
                                        ],
                                        "source_refs": [
                                            "https://met.muc.edu.cn/info/1046/1674.htm"
                                        ],
                                    },
                                ],
                                "responsible_office": [],
                                "service_name": "中央民族大学 VPN 使用说明",
                                "source_title": "中央民族大学VPN系统使用说明",
                                "source_url": "https://met.muc.edu.cn/info/1046/1674.htm",
                            },
                            "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
                        }
                    ]
                }

            with (
                patch(
                    "campus_ingestion_worker.release_official_web_selected_write.materialize_replay_input"
                ),
                patch(
                    "campus_ingestion_worker.release_official_web_selected_write.replay_official_web_source_truth_local",
                    side_effect=fake_replay,
                ),
            ):
                result = release_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    derived_object_store=object_store,
                    structured_projection_publisher=publisher,
                    work_dir=root / "selected-write",
                    derived_bucket="campus-rag-derived",
                )

            self.assertEqual(result.status, "published")
            published_bundle = publisher.published[0]["bundle"]
            record = published_bundle["service_guide_records"][0]
            self.assertEqual(len(record["procedure_groups"]), 2)
            self.assertEqual(
                record["procedure_groups"][1]["group_id"],
                "service:official_web:vpn:procedure_group:client_install",
            )
            self.assertEqual(
                record["procedure_groups"][1]["steps"][0]["source_refs"],
                ["https://met.muc.edu.cn/info/1046/1674.htm"],
            )
            self.assertEqual(record["field_status"]["service_process"], "present")
            self.assertEqual(record["field_status"]["service_entry"], "source_not_provided")

    def test_preview_selected_write_contact_directory_adds_source_faithful_aliases(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(selected_write_target="campus_services/contact_directory"),
                "inventoryId": "muc-it-service-contacts",
                "jobId": "owtarget_it_contacts",
                "inputRef": {
                    **dict(
                        _selected_write_task(
                            selected_write_target="campus_services/contact_directory"
                        )["inputRef"]
                    ),
                    "sourceUrls": ["https://met.muc.edu.cn/info/1008/1847.htm"],
                    "targetLabel": "中央民族大学信息化服务联系方式",
                },
            }
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
                    ): json.dumps(
                        {"pages": [], "runId": "owrun_contact", "siteId": "muc_public"}
                    ).encode("utf-8")
                }
            )

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "contact_directory_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://met.muc.edu.cn/info/1008/1847.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_it_contact",
                            "raw_version_id": "owver_it_contact",
                            "selected_write_target": "campus_services/contact_directory",
                            "target_job_id": "owtarget_it_contacts",
                            "typed_candidate": {
                                "contact_points": [
                                    {"label": "网络服务", "phone": "010-68932559"},
                                ],
                                "display_name": "中央民族大学信息化服务联系方式",
                                "emails": [],
                                "locations": ["北京市海淀区中关村南大街27号"],
                                "phones": ["010-68932559"],
                                "source_title": "信息化服务联系方式",
                                "source_url": "https://met.muc.edu.cn/info/1008/1847.htm",
                            },
                            "typed_candidate_schema_version": (
                                "official_web_contact_directory_candidate.v1"
                            ),
                        }
                    ]
                }

            with (
                patch(
                    "campus_ingestion_worker.release_official_web_selected_write.materialize_replay_input"
                ),
                patch(
                    "campus_ingestion_worker.release_official_web_selected_write.replay_official_web_source_truth_local",
                    side_effect=fake_replay,
                ),
            ):
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["contact_records"][0]
            self.assertEqual(record["display_name"], "中央民族大学信息化服务联系方式")
            self.assertEqual(
                record["aliases"],
                ["中央民族大学信息化服务联系方式", "信息化服务联系方式", "信息化办"],
            )


if __name__ == "__main__":
    unittest.main()
