from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    OfficialWebSelectedWritePreviewRuntimeCaseResult,
    OfficialWebSelectedWritePreviewRuntimeVerificationReport,
)

from scripts.official_web_service_guide_no_promotion_proof import (
    build_service_guide_quality_summary,
    build_service_guide_release_tasks_from_execution_report,
    build_service_guide_task_ids_from_execution_report,
    _rewrite_preview_report_with_replay_full_impact_baseline,
    resolve_service_guide_tasks_from_seam_report,
    resolve_service_guide_task_ids_from_seam_report,
)
from campus_ingestion_worker.release_official_web_selected_write import (
    preview_official_web_selected_write,
)


class OfficialWebServiceGuideNoPromotionProofTest(unittest.TestCase):
    def test_build_service_guide_task_ids_from_execution_report_re_admits_current_tasks(self) -> None:
        execution_report = {
            "runId": "owrun_info_disclosure",
            "bundleObjectKey": "official_web/muc_public/runs/owrun_info_disclosure/source-truth-bundle.json",
            "consumerCandidateReview": {
                "selectedWrite": {"decision": "partial_dry_run_ready"},
                "candidates": [
                    {
                        "candidate_key": "owcand_information_disclosure_composed",
                        "field_status": {
                            "process_steps": "present",
                            "required_materials": "present",
                            "service_name": "present",
                            "service_process": "present",
                            "service_material": "present",
                            "source_url": "present",
                            "source_version_evidence": "present",
                        },
                        "inventory_id": "muc-information-disclosure-application-process",
                        "matched_evidence": ["service_process", "service_material"],
                        "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        "ready_for_selected_write": True,
                        "optional_evidence": ["service_material"],
                        "optional_fields": ["required_materials", "service_material"],
                        "required_evidence": ["service_process"],
                        "required_fields": [
                            "service_name",
                            "process_steps",
                            "source_url",
                            "source_version_evidence",
                            "service_process",
                        ],
                        "review_verdict": "pending_review",
                        "selected_write_target": "campus_services/service_guide",
                        "source_ref": {
                            "raw_asset_id": "owasset_info_procedure",
                            "raw_version_id": "owver_info_procedure",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        },
                        "source_refs": [
                            {
                                "raw_asset_id": "owasset_info_procedure",
                                "raw_version_id": "owver_info_procedure",
                                "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                            },
                            {
                                "raw_asset_id": "owasset_info_material",
                                "raw_version_id": "owver_info_material",
                                "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                            },
                        ],
                        "target_job_id": "owtarget_muc_public_campus_services_service_guide",
                        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
                    }
                ],
            },
        }

        task_payloads = build_service_guide_task_ids_from_execution_report(execution_report)

        self.assertEqual(len(task_payloads), 1)
        self.assertTrue(
            str(task_payloads[0]["taskId"]).startswith("owrelease_selected_write_")
        )

    def test_resolve_service_guide_task_ids_from_seam_report_filters_non_service_guide_tasks(
        self,
    ) -> None:
        seam_report = {
            "consumer": {
                "release_tasks": {
                    "taskIds": [
                        "sw_service_1",
                        "sw_contact_1",
                        "sw_service_2",
                    ]
                }
            }
        }
        release_store = SimpleNamespace(
            get_task=lambda task_id: {
                "sw_service_1": SimpleNamespace(
                    task_type="official_web_selected_write_service_guide",
                    selected_write_target="campus_services/service_guide",
                    to_payload=lambda: {
                        "taskId": "sw_service_1",
                        "inventoryId": "muc-it-vpn-service-guide",
                        "taskType": "official_web_selected_write_service_guide",
                        "selectedWriteTarget": "campus_services/service_guide",
                    },
                ),
                "sw_contact_1": SimpleNamespace(
                    task_type="official_web_selected_write_contact_directory",
                    selected_write_target="campus_services/contact_directory",
                    to_payload=lambda: {"taskId": "sw_contact_1"},
                ),
                "sw_service_2": SimpleNamespace(
                    task_type="official_web_selected_write_service_guide",
                    selected_write_target="campus_services/service_guide",
                    to_payload=lambda: {
                        "taskId": "sw_service_2",
                        "inventoryId": "muc-it-email-service-guide",
                        "taskType": "official_web_selected_write_service_guide",
                        "selectedWriteTarget": "campus_services/service_guide",
                    },
                ),
            }.get(task_id)
        )

        task_ids = resolve_service_guide_task_ids_from_seam_report(
            seam_report,
            release_store=release_store,
        )

        self.assertEqual(task_ids, ["sw_service_1", "sw_service_2"])

    def test_resolve_service_guide_tasks_from_seam_report_returns_task_payloads(self) -> None:
        seam_report = {
            "consumer": {
                "release_tasks": {
                    "taskIds": [
                        "sw_service_1",
                        "sw_contact_1",
                    ]
                }
            }
        }
        release_store = SimpleNamespace(
            get_task=lambda task_id: {
                "sw_service_1": SimpleNamespace(
                    task_type="official_web_selected_write_service_guide",
                    selected_write_target="campus_services/service_guide",
                    to_payload=lambda: {
                        "taskId": "sw_service_1",
                        "inventoryId": "muc-it-vpn-service-guide",
                        "taskType": "official_web_selected_write_service_guide",
                        "selectedWriteTarget": "campus_services/service_guide",
                    },
                ),
                "sw_contact_1": SimpleNamespace(
                    task_type="official_web_selected_write_contact_directory",
                    selected_write_target="campus_services/contact_directory",
                    to_payload=lambda: {
                        "taskId": "sw_contact_1",
                    },
                ),
            }.get(task_id)
        )

        tasks = resolve_service_guide_tasks_from_seam_report(
            seam_report,
            release_store=release_store,
        )

        self.assertEqual(
            tasks,
            [
                {
                    "taskId": "sw_service_1",
                    "inventoryId": "muc-it-vpn-service-guide",
                    "taskType": "official_web_selected_write_service_guide",
                    "selectedWriteTarget": "campus_services/service_guide",
                }
            ],
        )

    def test_build_service_guide_release_tasks_from_execution_report_returns_payloads(
        self,
    ) -> None:
        execution_report = {
            "runId": "owrun_info_disclosure",
            "bundleObjectKey": "official_web/muc_public/runs/owrun_info_disclosure/source-truth-bundle.json",
            "consumerCandidateReview": {
                "selectedWrite": {"decision": "partial_dry_run_ready"},
                "candidates": [
                    {
                        "candidate_key": "owcand_information_disclosure_composed",
                        "field_status": {
                            "process_steps": "present",
                            "required_materials": "present",
                            "service_name": "present",
                            "service_process": "present",
                            "service_material": "present",
                            "source_url": "present",
                            "source_version_evidence": "present",
                        },
                        "inventory_id": "muc-information-disclosure-application-process",
                        "matched_evidence": ["service_process", "service_material"],
                        "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        "ready_for_selected_write": True,
                        "optional_evidence": ["service_material"],
                        "optional_fields": ["required_materials", "service_material"],
                        "required_evidence": ["service_process"],
                        "required_fields": [
                            "service_name",
                            "process_steps",
                            "source_url",
                            "source_version_evidence",
                            "service_process",
                        ],
                        "review_verdict": "pending_review",
                        "selected_write_target": "campus_services/service_guide",
                        "source_ref": {
                            "raw_asset_id": "owasset_info_procedure",
                            "raw_version_id": "owver_info_procedure",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        },
                        "source_refs": [
                            {
                                "raw_asset_id": "owasset_info_procedure",
                                "raw_version_id": "owver_info_procedure",
                                "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                            },
                            {
                                "raw_asset_id": "owasset_info_material",
                                "raw_version_id": "owver_info_material",
                                "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                            },
                        ],
                        "target_job_id": "owtarget_muc_public_campus_services_service_guide",
                        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
                    }
                ],
            },
        }

        task_payloads = build_service_guide_release_tasks_from_execution_report(
            execution_report
        )

        self.assertEqual(len(task_payloads), 1)
        self.assertEqual(
            task_payloads[0]["selectedWriteTarget"],
            "campus_services/service_guide",
        )

    def test_build_service_guide_quality_summary_aggregates_full_impact_services(self) -> None:
        preview_report = {
            "results": [
                {
                    "selected_write_id": "sw_service_1",
                    "collection": "service_guide",
                    "inventory_id": "muc-information-disclosure-application-process",
                    "record_count": 1,
                    "full_record_count": 2,
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学信息公开依申请公开工作流程",
                                "source_refs": [
                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                                    "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                                ],
                                "procedure_groups": [
                                    {
                                        "group_id": "disclosure-procedure",
                                        "source_refs": [
                                            "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                        ],
                                        "steps": [
                                            {
                                                "content": "提交申请",
                                                "source_refs": [
                                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                                ],
                                            }
                                        ],
                                    }
                                ],
                                "materials": [
                                    {
                                        "label": "申请表格",
                                        "source_refs": [
                                            "https://xxgk.muc.edu.cn/info/1007/1114.htm"
                                        ],
                                    }
                                ],
                                "entry_refs": [],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "service_entry": "source_not_provided",
                                    "required_materials": "present",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                            }
                        ]
                    },
                    "full_bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学信息公开依申请公开工作流程",
                                "source_refs": [
                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                                    "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                                ],
                                "procedure_groups": [
                                    {
                                        "group_id": "disclosure-procedure",
                                        "source_refs": [
                                            "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                        ],
                                        "steps": [
                                            {
                                                "content": "提交申请",
                                                "source_refs": [
                                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                                ],
                                            }
                                        ],
                                    }
                                ],
                                "materials": [
                                    {
                                        "label": "申请表格",
                                        "source_refs": [
                                            "https://xxgk.muc.edu.cn/info/1007/1114.htm"
                                        ],
                                    }
                                ],
                                "entry_refs": [],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "service_entry": "source_not_provided",
                                    "required_materials": "present",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                            },
                            {
                                "display_name": "中央民族大学 VPN 使用说明",
                                "source_refs": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                                "procedure_groups": [
                                    {
                                        "group_id": "vpn-client-install",
                                        "source_refs": [
                                            "https://met.muc.edu.cn/info/1046/1674.htm"
                                        ],
                                        "steps": [
                                            {
                                                "content": "下载客户端",
                                                "source_refs": [
                                                    "https://met.muc.edu.cn/info/1046/1674.htm"
                                                ],
                                            },
                                            {
                                                "content": "安装并登录",
                                                "source_refs": [
                                                    "https://met.muc.edu.cn/info/1046/1674.htm"
                                                ],
                                            },
                                        ],
                                    }
                                ],
                                "materials": [{"label": "申请表格", "source_refs": []}],
                                "entry_refs": [
                                    {
                                        "label": "中央民族大学VPN系统",
                                        "url": "https://vpn.muc.edu.cn",
                                        "source_refs": [
                                            "https://met.muc.edu.cn/info/1046/1674.htm"
                                        ],
                                    }
                                ],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "service_entry": "present",
                                    "required_materials": "source_not_provided",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                            },
                        ]
                    },
                }
            ]
        }
        with TemporaryDirectory() as temp_dir:
            target_inventory_path = Path(temp_dir) / "target-inventory.json"
            target_inventory_path.write_text(
                """
{
  "entries": [
    {
      "inventory_id": "muc-information-disclosure-application-process",
      "selected_write_target": "campus_services/service_guide",
      "target_label": "中央民族大学信息公开依申请公开工作流程",
      "source_urls": [
        "https://xxgk.muc.edu.cn/info/1007/1113.htm",
        "https://xxgk.muc.edu.cn/info/1007/1114.htm"
      ]
    },
    {
      "inventory_id": "muc-it-vpn-service-guide",
      "selected_write_target": "campus_services/service_guide",
      "target_label": "中央民族大学 VPN 使用说明",
      "source_urls": ["https://met.muc.edu.cn/info/1046/1674.htm"]
    }
  ]
}
                """.strip(),
                encoding="utf-8",
            )
            task_scope_runtime = OfficialWebSelectedWritePreviewRuntimeVerificationReport(
                passed=True,
                output_path=Path(temp_dir) / "task-scope.json",
                summary={"failed_case_ids": []},
                case_results=(
                    OfficialWebSelectedWritePreviewRuntimeCaseResult(
                        case_id="service-guide-information-disclosure-procedure",
                        collection="service_guide",
                        inventory_id="muc-information-disclosure-application-process",
                        selected_write_id="sw_service_1",
                        passed=True,
                        failures=(),
                        observed={
                            "guide_focus": "procedure",
                            "selected_section_ids": ["disclosure-procedure"],
                            "omitted_section_ids": [],
                            "omitted_section_reasons": {},
                        },
                    ),
                ),
            )
            full_impact_runtime = OfficialWebSelectedWritePreviewRuntimeVerificationReport(
                passed=True,
                output_path=Path(temp_dir) / "full-impact.json",
                summary={"failed_case_ids": []},
                case_results=(
                    OfficialWebSelectedWritePreviewRuntimeCaseResult(
                        case_id="service-guide-vpn-client-install",
                        collection="service_guide",
                        inventory_id="muc-it-vpn-service-guide",
                        selected_write_id="sw_service_1",
                        passed=True,
                        failures=(),
                        observed={
                            "guide_focus": "procedure",
                            "selected_section_ids": ["vpn-client-install"],
                            "omitted_section_ids": ["vpn-direct-login"],
                            "omitted_section_reasons": {
                                "vpn-direct-login": "focus_mismatch"
                            },
                        },
                    ),
                ),
            )

            summary = build_service_guide_quality_summary(
                preview_report=preview_report,
                task_scope_runtime_report=task_scope_runtime,
                full_impact_runtime_report=full_impact_runtime,
                target_inventory_path=target_inventory_path,
            )

        self.assertEqual(summary["service_count"], 2)
        by_inventory = {
            item["inventory_id"]: item for item in summary["service_guide_targets"]
        }
        vpn = by_inventory["muc-it-vpn-service-guide"]
        self.assertEqual(vpn["procedure_group_count"], 1)
        self.assertEqual(vpn["step_count_by_group"]["vpn-client-install"], 2)
        self.assertEqual(vpn["material_noise_count"], 1)
        self.assertEqual(vpn["entry_url_coverage"]["status"], "present")
        self.assertEqual(
            vpn["runtime_cases"][0]["selected_section_ids"],
            ["vpn-client-install"],
        )
        disclosure = by_inventory["muc-information-disclosure-application-process"]
        self.assertEqual(
            disclosure["field_source_coverage"]["source_not_provided_fields"],
            ["service_entry"],
        )

    def test_rewrite_preview_report_with_replay_full_impact_baseline_prefers_grouped_candidates(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            preview_task_dir = root / "selected-write-preview" / "owrelease_selected_write_test"
            projection_output_dir = preview_task_dir / "projection-output"
            projection_output_dir.mkdir(parents=True, exist_ok=True)
            preview_output_dir = preview_task_dir / "preview-output"
            preview_output_dir.mkdir(parents=True, exist_ok=True)

            projection_report = {
                "consumer_candidate_pages": [
                    {
                        "consumer_family": "service_guide_candidate",
                        "selected_write_target": "campus_services/service_guide",
                        "normalized_canonical_url": "https://met.muc.edu.cn/info/1046/1674.htm",
                        "quality_gate": {"decision": "pass"},
                        "raw_version_id": "owver_vpn_new",
                        "typed_candidate": {
                            "service_name": "中央民族大学 VPN 使用说明",
                            "source_title": "中央民族大学VPN系统使用说明",
                            "source_url": "https://met.muc.edu.cn/info/1046/1674.htm",
                            "process_steps": [
                                "下载客户端",
                                "安装并登录",
                            ],
                            "procedure_groups": [
                                {
                                    "group_id": "service:official_web:vpn:procedure_group:client_install",
                                    "title": "客户端安装",
                                    "focus_tags": ["procedure"],
                                    "steps": [
                                        {
                                            "step_id": "service:official_web:vpn:procedure_group:client_install:step:1",
                                            "content": "下载客户端",
                                            "source_refs": [
                                                "https://met.muc.edu.cn/info/1046/1674.htm"
                                            ],
                                        }
                                    ],
                                    "source_refs": [
                                        "https://met.muc.edu.cn/info/1046/1674.htm"
                                    ],
                                }
                            ],
                            "materials": [],
                            "entry_points": ["https://vpn.muc.edu.cn"],
                            "responsible_office": [],
                            "contacts": {
                                "phones": [],
                                "emails": [],
                                "locations": [],
                                "office_hours": [],
                            },
                            "field_source_urls": {
                                "process_steps": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                                "procedure_groups": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                                "entry_points": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                                "contacts": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                            },
                            "supporting_source_urls": [
                                "https://met.muc.edu.cn/info/1046/1674.htm"
                            ],
                        },
                    }
                ]
            }
            (projection_output_dir / "projection-report.json").write_text(
                json.dumps(projection_report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

            bundle_path = preview_output_dir / "projection-bundle.json"
            bundle_path.write_text("{}", encoding="utf-8")
            preview_report = {
                "results": [
                    {
                        "selected_write_id": "owrelease_selected_write_test",
                        "collection": "service_guide",
                        "inventory_id": "muc-information-disclosure-application-process",
                        "bundle_path": str(bundle_path.resolve()),
                        "full_bundle": {
                            "service_guide_records": [
                                {
                                    "display_name": "中央民族大学 VPN 使用说明",
                                    "effective_from": "2026-05-03T00:00:00+00:00",
                                    "effective_until": "9999-12-31T23:59:59+00:00",
                                    "release_record_state": "carried_forward",
                                    "source_refs": [
                                        "official_web:muc-it-vpn-service-guide:owver_old"
                                    ],
                                    "guide_sections": [
                                        {
                                            "section_id": "service:official_web:legacy:section:procedure",
                                            "section_type": "procedure",
                                            "title": "中央民族大学 VPN 使用说明",
                                            "content": "1. Install EasyConnect.pkg",
                                            "source_refs": [
                                                "official_web:muc-it-vpn-service-guide:owver_old"
                                            ],
                                        }
                                    ],
                                    "procedure_groups": [],
                                    "materials": [],
                                    "entry_refs": [],
                                    "office_hours": [],
                                    "contact_refs": [],
                                    "field_status": {
                                        "service_name": "present",
                                        "process_steps": "present",
                                        "service_entry": "present",
                                        "source_url": "present",
                                        "source_version_evidence": "present",
                                        "service_process": "present",
                                    },
                                    "required_fields": [
                                        "service_name",
                                        "process_steps",
                                        "source_url",
                                        "source_version_evidence",
                                        "service_process",
                                    ],
                                    "optional_fields": ["service_entry"],
                                }
                            ]
                        },
                    }
                ]
            }
            target_inventory_path = root / "target-inventory.json"
            target_inventory_path.write_text(
                json.dumps(
                    {
                        "entries": [
                            {
                                "inventory_id": "muc-it-vpn-service-guide",
                                "selected_write_target": "campus_services/service_guide",
                                "target_label": "中央民族大学 VPN 使用说明",
                                "source_urls": ["https://met.muc.edu.cn/info/1046/1674.htm"],
                            }
                        ]
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            rewritten = _rewrite_preview_report_with_replay_full_impact_baseline(
                preview_report=preview_report,
                target_inventory_path=target_inventory_path,
                baseline_output_path=root / "service-guide-full-impact-baseline.json",
            )

        record = rewritten["results"][0]["full_bundle"]["service_guide_records"][0]
        self.assertEqual(
            record["procedure_groups"][0]["group_id"],
            "service:official_web:vpn:procedure_group:client_install",
        )
        self.assertEqual(record["release_record_state"], "carried_forward")
        self.assertIn("https://vpn.muc.edu.cn", record["entry_refs"][0]["url"])

    def test_single_service_guide_candidate_preview_keeps_supporting_source_urls(self) -> None:
        from tests.ingestion.test_release_official_web_selected_write import _FakeObjectStore

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
                    ): (
                        '{"pages":[],"runId":"owrun_contact","siteId":"muc_public"}'
                    ).encode("utf-8")
                }
            )
            release_task = {
                "taskId": "owrelease_selected_write_test",
                "taskType": "official_web_selected_write_service_guide",
                "status": "claimed",
                "inventoryId": "muc-information-disclosure-application-process",
                "jobId": "owtarget_muc_public_campus_services_service_guide",
                "runId": "owrun_contact",
                "createdAt": "2026-05-02T08:00:00+00:00",
                "updatedAt": "2026-05-02T08:00:00+00:00",
                "selectedWriteTarget": "campus_services/service_guide",
                "inputRef": {
                    "policyVersion": "official_web_selected_write_release_task_admission.v4",
                    "sourceObjectKeys": [
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
                    ],
                    "sourceUrls": [
                        "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                        "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                    ],
                    "fieldStatus": {
                        "service_name": "present",
                        "process_steps": "present",
                        "source_url": "present",
                        "source_version_evidence": "present",
                        "service_process": "present",
                        "required_materials": "source_not_provided",
                        "responsible_office": "present",
                        "phone": "present",
                        "location": "source_not_provided",
                        "office_hours": "source_not_provided",
                        "service_material": "source_not_provided",
                        "service_entry": "source_not_provided",
                    },
                    "requiredFields": [
                        "service_name",
                        "process_steps",
                        "source_url",
                        "source_version_evidence",
                        "service_process",
                    ],
                    "optionalFields": [
                        "service_entry",
                        "required_materials",
                        "responsible_office",
                        "phone",
                        "location",
                        "office_hours",
                        "service_material",
                    ],
                },
            }

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_info_procedure",
                            "raw_version_id": "owver_info_procedure",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_muc_public_campus_services_service_guide",
                            "typed_candidate": {
                                "service_name": "中央民族大学信息公开依申请公开工作流程",
                                "process_steps": ["提交申请"],
                                "materials": ["中央民族大学信息公开申请表"],
                                "responsible_office": ["学校信息公开办公室"],
                                "entry_points": [],
                                "contacts": {"phones": ["010-68932551"]},
                                "source_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                                "source_title": "中央民族大学信息公开依申请公开工作流程",
                                "supporting_source_urls": [
                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                                    "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                                    "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                                ],
                                "field_source_urls": {
                                    "process_steps": ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
                                    "materials": ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
                                    "responsible_office": [
                                        "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                    ],
                                    "contacts": ["https://xxgk.muc.edu.cn/xxgk/lxfs.htm"],
                                },
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
                preview = preview_official_web_selected_write(
                    release_task=release_task,
                    object_store=object_store,
                    work_dir=root / "preview",
                    source_bucket="campus-rag-source",
                )

        record = preview.bundle["service_guide_records"][0]
        self.assertIn(
            "official_web:muc-information-disclosure-application-process:owver_info_procedure",
            record["source_refs"],
        )
        self.assertEqual(
            set(record["source_refs"]),
            {
                "official_web:muc-information-disclosure-application-process:owver_info_procedure",
                "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
            },
        )


if __name__ == "__main__":
    unittest.main()
