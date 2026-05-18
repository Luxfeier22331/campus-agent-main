# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_official_web_source_pack_no_promotion_script_support import *


class OfficialWebSourcePackNoPromotionScriptTestPart02(unittest.TestCase):
    def test_build_source_pack_seam_report_and_assertion(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            execution_report_path = output_root / "execution-report.json"
            execution_report_path.write_text("{}", encoding="utf-8")

            report = build_source_pack_seam_report(
                source_pack_plan={
                    "siteId": "muc_public",
                    "sourcePackId": "tool-driven-first-slice.v1",
                    "rows": [
                        {
                            "ownerSurfaces": [
                                "official_web/stable_reference",
                                "contact_directory_lookup",
                            ],
                            "releaseTargets": [
                                "official_web/stable_reference",
                                "campus_services/contact_directory",
                            ],
                        },
                        {
                            "ownerSurfaces": ["service_guide_lookup"],
                            "releaseTargets": ["campus_services/service_guide"],
                        },
                    ],
                },
                actual_run_id="owrun_current",
                collector_result={
                    "crawlRun": {
                        "status": "completed",
                        "counters": {
                            "consumerDenominator": {
                                "retainedSourceTruthPages": 3,
                                "rejectedPages": 0,
                            }
                        },
                    },
                    "uploadedArtifacts": [
                        {
                            "artifactType": "source_truth_bundle",
                            "objectKey": "official_web/muc_public/runs/owrun_current/source-truth-bundle.json",
                            "recordCount": 3,
                        }
                    ],
                },
                consumer_result={"counts": {"processed": 1}},
                db_run={
                    "ingestion_dispatch_status": "dispatched",
                    "ingestion_execution_status": "staged",
                    "ingestion_execution_error_code": None,
                    "target_attempt_count": 3,
                    "target_attempts": [
                        {
                            "candidateId": "owcand_school_profile_stable",
                            "jobId": "owtarget_stable",
                            "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        },
                        {
                            "candidateId": "owcand_school_profile_contact",
                            "jobId": "owtarget_contact",
                            "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        },
                        {
                            "candidateId": "owcand_info_disclosure_procedure",
                            "jobId": "owtarget_service",
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        },
                    ],
                    "target_job_ids": [
                        "owtarget_stable",
                        "owtarget_contact",
                        "owtarget_service",
                    ],
                    "target_jobs": [],
                },
                drain_result={"processed": 1},
                event_id="owevt_current",
                execution_report={
                    "status": "staged",
                    "promotion": {"decision": "staged"},
                    "import": None,
                    "error": None,
                    "coverage": {
                        "targetFamilyCounts": {
                            "stable_reference_candidate": 1,
                            "contact_directory_candidate": 1,
                            "service_guide_candidate": 1,
                        },
                        "targetMaterializationPolicyCounts": {
                            "release_gate_required": 1,
                            "candidate_only": 2,
                        },
                        "targetLineageIssues": [],
                    },
                    "consumerCandidateReview": {
                        "counts": {
                            "candidate_count": 2,
                            "selected_write_ready_count": 1,
                        },
                        "selectedWrite": {
                            "decision": "dry_run_ready",
                            "preview_records": [
                                {
                                    "field_status": {
                                        "organization_name": "present",
                                        "phone": "present",
                                    },
                                    "required_fields": ["organization_name", "phone"],
                                }
                            ],
                        },
                        "targetFieldReviews": [
                            {
                                "status": "ready_for_selected_write",
                                "summary": {
                                    "fieldStatus": {
                                        "organization_name": "present",
                                        "phone": "present",
                                    },
                                    "requiredFields": ["organization_name", "phone"],
                                },
                            }
                        ],
                    },
                    "releaseTasks": {
                        "enabled": True,
                        "reason": "selected_write_admitted",
                        "admittedCount": 1,
                        "taskIds": ["owrelease_selected_write_123"],
                    },
                },
                execution_report_path=execution_report_path,
                local_run_id="owrun_source_pack_live_20260503T000000Z",
                output_root=output_root,
                source_truth_bundle_payload={
                    "pages": [
                        {
                            "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                            "targetMatches": [
                                {
                                    "targetJobId": "owtarget_stable",
                                    "targetCandidateId": "owcand_school_profile_stable",
                                },
                                {
                                    "targetJobId": "owtarget_contact",
                                    "targetCandidateId": "owcand_school_profile_contact",
                                },
                            ],
                        },
                        {
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                            "targetMatches": [
                                {
                                    "targetJobId": "owtarget_service",
                                    "targetCandidateId": "owcand_info_disclosure_procedure",
                                }
                            ],
                        },
                    ]
                },
                target_seed={
                    "declarationVersion": "muc_public_target_source_map_v2",
                    "previewRequeuedFreshnessRows": 2,
                    "seededRows": [
                        {
                            "consumerFamily": "stable_reference_candidate",
                            "materializationPolicy": "release_gate_required",
                            "targetCandidateId": "owcand_school_profile_stable",
                            "targetJobId": "owtarget_stable",
                            "targetUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        },
                        {
                            "consumerFamily": "contact_directory_candidate",
                            "materializationPolicy": "candidate_only",
                            "targetCandidateId": "owcand_school_profile_contact",
                            "targetJobId": "owtarget_contact",
                            "targetUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        },
                        {
                            "consumerFamily": "service_guide_candidate",
                            "materializationPolicy": "candidate_only",
                            "targetCandidateId": "owcand_info_disclosure_procedure",
                            "targetJobId": "owtarget_service",
                            "targetUrl": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        },
                    ],
                    "targetJobIds": [
                        "owtarget_stable",
                        "owtarget_contact",
                        "owtarget_service",
                    ],
                    "uniqueHosts": ["www.muc.edu.cn", "xxgk.muc.edu.cn"],
                    "uniqueUrls": [
                        "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                    ],
                },
            )

            self.assertEqual(report["source_pack"]["entry_count"], 2)
            self.assertEqual(report["target_seed"]["seeded_row_count"], 3)
            self.assertEqual(
                report["consumer"]["target_family_counts"],
                {
                    "stable_reference_candidate": 1,
                    "contact_directory_candidate": 1,
                    "service_guide_candidate": 1,
                },
            )
            assert_source_pack_seam_report(report)

    def test_rebuild_source_pack_seam_report_from_output_root(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            (output_root / "collector-output").mkdir(parents=True)
            (output_root / "executions" / "owevt_current").mkdir(parents=True)

            (output_root / "source-pack-plan.log").write_text(
                'noise\n{"siteId":"muc_public","sourcePackId":"tool-driven-first-slice.v1","rows":[{"ownerSurfaces":["official_web/stable_reference","contact_directory_lookup"],"releaseTargets":["official_web/stable_reference","campus_services/contact_directory"]},{"ownerSurfaces":["service_guide_lookup"],"releaseTargets":["campus_services/service_guide"]}]}\n',
                encoding="utf-8",
            )
            (output_root / "target-seed.log").write_text(
                'noise\n{"declarationVersion":"muc_public_target_source_map_v2","previewRequeuedFreshnessRows":2,"seededRows":[{"consumerFamily":"stable_reference_candidate","materializationPolicy":"release_gate_required","targetCandidateId":"owcand_school_profile_stable","targetJobId":"owtarget_stable","targetUrl":"https://www.muc.edu.cn/xxgk1/xxjj.htm"},{"consumerFamily":"contact_directory_candidate","materializationPolicy":"candidate_only","targetCandidateId":"owcand_school_profile_contact","targetJobId":"owtarget_contact","targetUrl":"https://www.muc.edu.cn/xxgk1/xxjj.htm"},{"consumerFamily":"service_guide_candidate","materializationPolicy":"candidate_only","targetCandidateId":"owcand_info_disclosure_procedure","targetJobId":"owtarget_service","targetUrl":"https://xxgk.muc.edu.cn/info/1007/1113.htm"}],"targetJobIds":["owtarget_stable","owtarget_contact","owtarget_service"],"uniqueHosts":["www.muc.edu.cn","xxgk.muc.edu.cn"],"uniqueUrls":["https://www.muc.edu.cn/xxgk1/xxjj.htm","https://xxgk.muc.edu.cn/info/1007/1113.htm"]}\n',
                encoding="utf-8",
            )
            (output_root / "collector.log").write_text(
                'noise\n{"crawlRun":{"crawlRunId":"owrun_current","status":"completed","counters":{"consumerDenominator":{"retainedSourceTruthPages":3,"rejectedPages":0}}},"uploadedArtifacts":[{"artifactType":"source_truth_bundle","objectKey":"official_web/muc_public/runs/owrun_current/source-truth-bundle.json","recordCount":3}]}\n',
                encoding="utf-8",
            )
            (output_root / "drain.log").write_text(
                'noise\n{"processed":1}\n',
                encoding="utf-8",
            )
            (output_root / "consumer.log").write_text(
                'noise\n{"counts":{"processed":1}}\n',
                encoding="utf-8",
            )
            (output_root / "app-api-query.log").write_text(
                'noise\n{"ingestion_dispatch_status":"dispatched","ingestion_execution_status":"staged","ingestion_execution_error_code":null,"target_attempt_count":3,"target_attempts":[{"candidateId":"owcand_school_profile_stable","jobId":"owtarget_stable","normalizedCanonicalUrl":"https://www.muc.edu.cn/xxgk1/xxjj.htm"},{"candidateId":"owcand_school_profile_contact","jobId":"owtarget_contact","normalizedCanonicalUrl":"https://www.muc.edu.cn/xxgk1/xxjj.htm"},{"candidateId":"owcand_info_disclosure_procedure","jobId":"owtarget_service","normalizedCanonicalUrl":"https://xxgk.muc.edu.cn/info/1007/1113.htm"}],"target_job_ids":["owtarget_stable","owtarget_contact","owtarget_service"],"target_jobs":[]}\n',
                encoding="utf-8",
            )
            (output_root / "collector-output" / "source-truth-bundle.json").write_text(
                '{"pages":[{"normalizedCanonicalUrl":"https://www.muc.edu.cn/xxgk1/xxjj.htm","targetMatches":[{"targetJobId":"owtarget_stable","targetCandidateId":"owcand_school_profile_stable"},{"targetJobId":"owtarget_contact","targetCandidateId":"owcand_school_profile_contact"}]},{"normalizedCanonicalUrl":"https://xxgk.muc.edu.cn/info/1007/1113.htm","targetMatches":[{"targetJobId":"owtarget_service","targetCandidateId":"owcand_info_disclosure_procedure"}]}]}',
                encoding="utf-8",
            )
            (output_root / "executions" / "owevt_current" / "execution-report.json").write_text(
                '{"runId":"owrun_current","eventId":"owevt_current","status":"staged","promotion":{"decision":"staged"},"import":null,"error":null,"coverage":{"targetFamilyCounts":{"stable_reference_candidate":1,"contact_directory_candidate":1,"service_guide_candidate":1},"targetMaterializationPolicyCounts":{"release_gate_required":1,"candidate_only":2},"targetLineageIssues":[]},"consumerCandidateReview":{"counts":{"candidate_count":2,"selected_write_ready_count":1},"selectedWrite":{"decision":"dry_run_ready","preview_records":[{"field_status":{"organization_name":"present","phone":"present"},"required_fields":["organization_name","phone"]}]},"targetFieldReviews":[{"status":"ready_for_selected_write","summary":{"fieldStatus":{"organization_name":"present","phone":"present"},"requiredFields":["organization_name","phone"]}}]},"releaseTasks":{"enabled":true,"reason":"selected_write_admitted","admittedCount":1,"taskIds":["owrelease_selected_write_123"]}}',
                encoding="utf-8",
            )

            report = rebuild_source_pack_seam_report_from_output_root(
                repo_root=Path.cwd(),
                output_root=output_root,
            )

            self.assertEqual(report["actual_run_id"], "owrun_current")
            self.assertEqual(report["consumer"]["status"], "staged")
            assert_source_pack_seam_report(report)

    def test_assert_source_pack_seam_report_allows_deleted_seed_row_via_page_observation_lineage(
        self,
    ) -> None:
        report = {
            "collector": {
                "status": "completed",
                "retained_source_truth_pages": 1,
                "source_truth_target_matches": [],
                "page_observation_target_matches": [
                    {
                        "normalizedCanonicalUrl": "https://met.muc.edu.cn/info/1068/1832.htm",
                        "targetJobId": "owtarget_service",
                        "targetCandidateId": "owcand_deleted",
                        "disposition": "deleted",
                    }
                ],
            },
            "app_api": {
                "target_attempts": [
                    {
                        "normalizedCanonicalUrl": "https://met.muc.edu.cn/info/1068/1832.htm",
                    }
                ],
                "target_job_ids": ["owtarget_service"],
                "db_run": {
                    "ingestion_dispatch_status": "dispatched",
                    "ingestion_execution_status": "staged",
                    "ingestion_execution_error_code": None,
                },
            },
            "consumer": {
                "status": "staged",
                "promotion_decision": "staged",
                "import_is_null": True,
                "error_is_null": True,
                "target_lineage_issues": [],
                "target_family_counts": {
                    "service_guide_candidate": 0,
                },
                "target_materialization_policy_counts": {
                    "candidate_only": 0,
                },
                "selected_write": {"decision": "not_ready"},
                "target_field_reviews": [],
                "release_tasks": {},
            },
            "target_seed": {
                "seededRows": [
                    {
                        "consumerFamily": "service_guide_candidate",
                        "materializationPolicy": "candidate_only",
                        "targetCandidateId": "owcand_deleted",
                        "targetJobId": "owtarget_service",
                        "targetUrl": "https://met.muc.edu.cn/info/1068/1832.htm",
                    }
                ]
            },
        }

        assert_source_pack_seam_report(report)

    def test_assert_source_pack_seam_report_allows_expanded_consumer_counts_beyond_seed_rows(
        self,
    ) -> None:
        report = {
            "collector": {
                "status": "completed",
                "retained_source_truth_pages": 5,
                "source_truth_target_matches": [
                    {
                        "normalizedCanonicalUrl": "https://www.example.edu/rules/index.htm",
                        "targetJobId": "owtarget_reg_student",
                        "targetCandidateId": "owcand_reg_student",
                    }
                ],
            },
            "app_api": {
                "target_attempts": [
                    {
                        "normalizedCanonicalUrl": "https://www.example.edu/rules/index.htm",
                    },
                    {
                        "normalizedCanonicalUrl": "https://www.example.edu/rules/detail-a.htm",
                    },
                ],
                "target_job_ids": ["owtarget_reg_student"],
                "db_run": {
                    "ingestion_dispatch_status": "dispatched",
                    "ingestion_execution_status": "staged",
                    "ingestion_execution_error_code": None,
                },
            },
            "consumer": {
                "status": "staged",
                "promotion_decision": "staged",
                "import_is_null": True,
                "error_is_null": True,
                "target_lineage_issues": [],
                "target_family_counts": {
                    "regulation_candidate": 3,
                },
                "target_materialization_policy_counts": {
                    "release_gate_required": 3,
                },
                "selected_write": {"decision": "not_ready"},
                "target_field_reviews": [],
                "release_tasks": {},
            },
            "target_seed": {
                "seededRows": [
                    {
                        "consumerFamily": "regulation_candidate",
                        "materializationPolicy": "release_gate_required",
                        "targetCandidateId": "owcand_reg_student",
                        "targetJobId": "owtarget_reg_student",
                        "targetUrl": "https://www.example.edu/rules/index.htm",
                    }
                ]
            },
        }

        assert_source_pack_seam_report(report)


if __name__ == "__main__":
    unittest.main()
