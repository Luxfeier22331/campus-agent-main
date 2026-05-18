# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_release_official_web_selected_write_support import *


class ReleaseOfficialWebSelectedWriteTestPart04(unittest.TestCase):
    def test_preview_selected_write_contact_directory_prefers_target_label_for_generic_shell_title(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(),
                "inventoryId": "muc-information-disclosure-contact",
                "inputRef": {
                    **dict(_selected_write_task()["inputRef"]),
                    "sourceUrls": ["https://xxgk.muc.edu.cn/xxgk/lxfs.htm"],
                    "targetLabel": "中央民族大学信息公开联系方式",
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
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_contact",
                            "raw_version_id": "owver_contact",
                            "selected_write_target": "campus_services/contact_directory",
                            "target_job_id": "owtarget_contact",
                            "typed_candidate": {
                                "contact_points": [],
                                "display_name": "联系方式",
                                "phones": ["010-68932551"],
                                "emails": [],
                                "locations": [],
                                "source_title": "联系方式",
                                "source_url": "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
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
            self.assertEqual(record["display_name"], "中央民族大学信息公开联系方式")
            self.assertEqual(
                record["aliases"],
                ["中央民族大学信息公开联系方式", "联系方式", "信息公开"],
            )

    def test_preview_selected_write_service_guide_prefers_target_label_for_policy_shell_title(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(selected_write_target="campus_services/service_guide"),
                "inventoryId": "muc-it-email-service-guide",
                "jobId": "owtarget_email",
                "inputRef": {
                    **dict(
                        _selected_write_task(selected_write_target="campus_services/service_guide")[
                            "inputRef"
                        ]
                    ),
                    "sourceUrls": ["https://met.muc.edu.cn/info/1024/1090.htm"],
                    "targetLabel": "中央民族大学校园电子邮件服务",
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
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://met.muc.edu.cn/info/1024/1090.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_email",
                            "raw_version_id": "owver_email",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_email",
                            "typed_candidate": {
                                "contacts": {
                                    "emails": [],
                                    "locations": [],
                                    "office_hours": [],
                                    "phones": ["010-68932559"],
                                },
                                "entry_points": [],
                                "materials": ["E-MAIL申请表"],
                                "process_steps": ["填写申请表", "递交网络中心审批"],
                                "responsible_office": ["网络中心"],
                                "service_name": "中央民族大学电子邮件管理办法",
                                "source_title": "中央民族大学电子邮件管理办法",
                                "source_url": "https://met.muc.edu.cn/info/1024/1090.htm",
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["service_guide_records"][0]
            self.assertEqual(record["display_name"], "中央民族大学校园电子邮件服务")
            self.assertEqual(
                record["aliases"],
                ["中央民族大学校园电子邮件服务", "中央民族大学电子邮件管理办法", "校园邮箱"],
            )
            self.assertEqual(record["effective_from"], "2026-05-01T00:00:00+00:00")

    def test_preview_selected_write_service_guide_normalizes_host_entry_urls(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(selected_write_target="campus_services/service_guide"),
                "inventoryId": "muc-it-network-auth-service-guide",
                "jobId": "owtarget_network_auth",
                "inputRef": {
                    **dict(
                        _selected_write_task(selected_write_target="campus_services/service_guide")[
                            "inputRef"
                        ]
                    ),
                    "sourceUrls": ["https://met.muc.edu.cn/info/1008/1846.htm"],
                    "targetLabel": "中央民族大学校园网认证及使用说明",
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
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://met.muc.edu.cn/info/1008/1846.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_network_auth",
                            "raw_version_id": "owver_network_auth",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_network_auth",
                            "typed_candidate": {
                                "contacts": {
                                    "emails": [],
                                    "locations": [],
                                    "office_hours": [],
                                    "phones": [],
                                },
                                "entry_points": ["rz.muc.edu.cn"],
                                "materials": [],
                                "process_steps": ["浏览器地址栏输入 rz.muc.edu.cn。"],
                                "responsible_office": [],
                                "service_name": "中央民族大学校园网认证及使用说明",
                                "source_title": "中央民族大学校园网新版认证系统上网使用说明",
                                "source_url": "https://met.muc.edu.cn/info/1008/1846.htm",
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["service_guide_records"][0]
            self.assertEqual(record["entry_refs"][0]["label"], "rz.muc.edu.cn")
            self.assertEqual(record["entry_refs"][0]["entry_type"], "online_url")
            self.assertEqual(record["entry_refs"][0]["url"], "https://rz.muc.edu.cn")

    def test_preview_selected_write_service_guide_keeps_academic_calendar_public_entry_url(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(selected_write_target="campus_services/service_guide"),
                "inventoryId": "muc-it-academic-calendar-guide",
                "jobId": "owtarget_academic_calendar",
                "inputRef": {
                    **dict(
                        _selected_write_task(selected_write_target="campus_services/service_guide")[
                            "inputRef"
                        ]
                    ),
                    "sourceUrls": ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
                    "targetLabel": "中央民族大学校历查看方式",
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
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://www.muc.edu.cn/ggfw/mdxl.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_calendar",
                            "raw_version_id": "owver_calendar",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_academic_calendar",
                            "typed_candidate": {
                                "contacts": {
                                    "emails": [],
                                    "locations": [],
                                    "office_hours": [],
                                    "phones": [],
                                },
                                "entry_points": ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
                                "field_source_urls": {
                                    "entry_points": ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
                                    "process_steps": ["https://met.muc.edu.cn/info/1068/1832.htm"],
                                },
                                "materials": [],
                                "process_steps": ["访问公开校历页面查看当学年校历。"],
                                "responsible_office": [],
                                "service_name": "中央民族大学校历查看方式",
                                "source_title": "中央民族大学校历查看方式",
                                "source_url": "https://met.muc.edu.cn/info/1068/1832.htm",
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["service_guide_records"][0]
            self.assertEqual(record["entry_refs"][0]["url"], "https://www.muc.edu.cn/ggfw/mdxl.htm")
            self.assertEqual(
                record["entry_refs"][0]["source_refs"], ["https://www.muc.edu.cn/ggfw/mdxl.htm"]
            )

    def test_preview_selected_write_service_guide_publishes_grouped_vpn_procedures(self) -> None:
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
                                "materials": [],
                                "process_steps": [
                                    "1、访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
                                    "2、输入统一身份认证账号和密码登录。",
                                    "3、首次使用请根据系统提示下载客户端。",
                                    "4、双击Install EasyConnect.pkg，根据提示完成安装。",
                                    "5、移动端可在企业应用中心打开 EasyConnect。",
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
                                            },
                                            {
                                                "step_id": "service:official_web:vpn:procedure_group:direct_login:step:2",
                                                "content": "输入统一身份认证账号和密码登录。",
                                                "source_refs": [
                                                    "https://met.muc.edu.cn/info/1046/1674.htm"
                                                ],
                                            },
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
                                            },
                                            {
                                                "step_id": "service:official_web:vpn:procedure_group:client_install:step:2",
                                                "content": "双击Install EasyConnect.pkg，根据提示完成安装。",
                                                "source_refs": [
                                                    "https://met.muc.edu.cn/info/1046/1674.htm"
                                                ],
                                            },
                                        ],
                                        "source_refs": [
                                            "https://met.muc.edu.cn/info/1046/1674.htm"
                                        ],
                                    },
                                    {
                                        "group_id": "service:official_web:vpn:procedure_group:mobile_usage",
                                        "title": "移动端使用",
                                        "focus_tags": ["procedure", "mobile"],
                                        "steps": [
                                            {
                                                "step_id": "service:official_web:vpn:procedure_group:mobile_usage:step:1",
                                                "content": "移动端可在企业应用中心打开 EasyConnect。",
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
                                "field_source_urls": {
                                    "entry_points": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                                    "process_steps": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                                    "procedure_groups": [
                                        "https://met.muc.edu.cn/info/1046/1674.htm"
                                    ],
                                },
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["service_guide_records"][0]
            self.assertEqual(len(record["procedure_groups"]), 3)
            self.assertEqual(
                record["procedure_groups"][1]["group_id"],
                "service:official_web:vpn:procedure_group:client_install",
            )
            self.assertEqual(
                record["procedure_groups"][1]["steps"][0]["content"],
                "首次使用请根据系统提示下载客户端。",
            )
            self.assertEqual(
                record["procedure_groups"][1]["source_refs"],
                ["https://met.muc.edu.cn/info/1046/1674.htm"],
            )
            self.assertEqual(
                record["procedure_groups"][1]["steps"][0]["source_refs"],
                ["https://met.muc.edu.cn/info/1046/1674.htm"],
            )


if __name__ == "__main__":
    unittest.main()
