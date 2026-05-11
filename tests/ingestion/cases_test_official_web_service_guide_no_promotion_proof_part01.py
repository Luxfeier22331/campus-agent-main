# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_official_web_service_guide_no_promotion_proof_support import *


class OfficialWebServiceGuideNoPromotionProofPart01Test(unittest.TestCase):
    def test_build_service_guide_release_tasks_from_execution_report_re_admits_current_tasks(
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

        task_payloads = build_service_guide_release_tasks_from_execution_report(execution_report)

        self.assertEqual(len(task_payloads), 1)
        self.assertTrue(str(task_payloads[0]["taskId"]).startswith("owrelease_selected_write_"))

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

    def test_resolve_service_guide_task_ids_rejects_snake_case_task_payloads(self) -> None:
        seam_report = {"consumer": {"release_tasks": {"taskIds": ["sw_service_1"]}}}
        release_store = SimpleNamespace(
            get_task=lambda task_id: SimpleNamespace(
                task_type="official_web_selected_write_service_guide",
                selected_write_target="campus_services/service_guide",
                to_payload=lambda: {
                    "task_id": task_id,
                    "inventory_id": "muc-it-vpn-service-guide",
                    "task_type": "official_web_selected_write_service_guide",
                    "selected_write_target": "campus_services/service_guide",
                },
            )
        )

        with self.assertRaisesRegex(ValueError, "taskId"):
            resolve_service_guide_task_ids_from_seam_report(
                seam_report,
                release_store=release_store,
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

        task_payloads = build_service_guide_release_tasks_from_execution_report(execution_report)

        self.assertEqual(len(task_payloads), 1)
        self.assertEqual(
            task_payloads[0]["selectedWriteTarget"],
            "campus_services/service_guide",
        )


if __name__ == "__main__":
    unittest.main()
