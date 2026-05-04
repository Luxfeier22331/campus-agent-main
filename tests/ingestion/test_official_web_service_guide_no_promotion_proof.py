from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    OfficialWebSelectedWritePreviewRuntimeCaseResult,
    OfficialWebSelectedWritePreviewRuntimeVerificationReport,
)

from scripts.official_web_service_guide_no_promotion_proof import (
    build_service_guide_quality_summary,
    build_service_guide_task_ids_from_execution_report,
    resolve_service_guide_task_ids_from_seam_report,
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
                ),
                "sw_contact_1": SimpleNamespace(
                    task_type="official_web_selected_write_contact_directory",
                    selected_write_target="campus_services/contact_directory",
                ),
                "sw_service_2": SimpleNamespace(
                    task_type="official_web_selected_write_service_guide",
                    selected_write_target="campus_services/service_guide",
                ),
            }.get(task_id)
        )

        task_ids = resolve_service_guide_task_ids_from_seam_report(
            seam_report,
            release_store=release_store,
        )

        self.assertEqual(task_ids, ["sw_service_1", "sw_service_2"])

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


if __name__ == "__main__":
    unittest.main()
