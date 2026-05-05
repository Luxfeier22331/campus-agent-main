from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.official_web_source_pack_no_promotion import (
    assert_source_pack_seam_report,
    build_collector_command,
    build_source_pack_seam_report,
    build_source_pack_seed_plan,
    load_source_pack_execution_plan,
    rebuild_source_pack_seam_report_from_output_root,
    write_source_pack_lineage_overrides,
)


class OfficialWebSourcePackNoPromotionScriptTest(unittest.TestCase):
    def test_script_module_supports_direct_execution_import_path_fix(self) -> None:
        path = Path("scripts/official_web_source_pack_no_promotion.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("if __package__ in {None, \"\"}:", path)
        self.assertIn("sys.path.insert(0, str(Path(__file__).resolve().parents[1]))", path)

    def test_load_source_pack_execution_plan_reads_manifest_plan(self) -> None:
        with TemporaryDirectory() as temp_dir, patch(
            "scripts.official_web_source_pack_no_promotion.run_json_command",
            return_value={
                "siteId": "muc_public",
                "sourcePackId": "tool-driven-first-slice.v1",
                "rows": [],
            },
        ) as run_json_command:
            plan = load_source_pack_execution_plan(
                Path.cwd(),
                site_id="muc_public",
                source_pack_id="tool-driven-first-slice.v1",
                output_root=Path(temp_dir),
            )

        self.assertEqual(plan["sourcePackId"], "tool-driven-first-slice.v1")
        command = run_json_command.call_args.args[1]
        self.assertEqual(command[:4], ("pnpm", "--dir", "apps/official-web-collector", "plan-source-pack"))

    def test_build_source_pack_seed_plan_expands_per_target_rows(self) -> None:
        source_pack_plan = {
            "siteId": "muc_public",
            "sourcePackId": "tool-driven-first-slice.v1",
            "rows": [
                {
                    "entryId": "owsp-school-profile-xxjj",
                    "url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    "host": "www.muc.edu.cn",
                    "compositionGroup": None,
                    "compositionRole": None,
                    "targetMatches": [
                        {
                            "sourcePackId": "tool-driven-first-slice.v1",
                            "sourcePackEntryId": "owsp-school-profile-xxjj",
                            "consumerFamily": "stable_reference_candidate",
                            "materializationPolicy": "release_gate_required",
                            "ownerSurface": "official_web/stable_reference",
                            "retentionPolicy": "retain_source_truth",
                            "reviewPolicy": "release_gate_required",
                            "selectedWriteTarget": "official_web/stable_reference",
                            "targetId": "official-web-stable-reference",
                            "targetJobId": "owtarget_muc_public_official_web_stable_reference",
                        },
                        {
                            "sourcePackId": "tool-driven-first-slice.v1",
                            "sourcePackEntryId": "owsp-school-profile-xxjj",
                            "consumerFamily": "contact_directory_candidate",
                            "materializationPolicy": "candidate_only",
                            "ownerSurface": "contact_directory_lookup",
                            "retentionPolicy": "retain_source_truth",
                            "reviewPolicy": "selected_write_requires_review",
                            "selectedWriteTarget": "campus_services/contact_directory",
                            "targetId": "campus-services-contact-directory",
                            "targetJobId": "owtarget_muc_public_campus_services_contact_directory",
                        },
                    ],
                },
                {
                    "entryId": "owsp-info-disclosure-procedure-1113",
                    "url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                    "host": "xxgk.muc.edu.cn",
                    "compositionGroup": "information_disclosure",
                    "compositionRole": "procedure_source",
                    "targetMatches": [
                        {
                            "sourcePackId": "tool-driven-first-slice.v1",
                            "sourcePackEntryId": "owsp-info-disclosure-procedure-1113",
                            "compositionGroup": "information_disclosure",
                            "compositionRole": "procedure_source",
                            "consumerFamily": "service_guide_candidate",
                            "materializationPolicy": "candidate_only",
                            "ownerSurface": "service_guide_lookup",
                            "retentionPolicy": "retain_source_truth",
                            "reviewPolicy": "selected_write_requires_review",
                            "selectedWriteTarget": "campus_services/service_guide",
                            "targetId": "campus-services-service-guide",
                            "targetJobId": "owtarget_muc_public_campus_services_service_guide",
                        }
                    ],
                },
            ],
        }

        seed_plan = build_source_pack_seed_plan(source_pack_plan)

        self.assertEqual(seed_plan["seededRowCount"], 3)
        rows = seed_plan["rows"]
        self.assertEqual(
            {row["targetId"] for row in rows},
            {
                "official-web-stable-reference",
                "campus-services-contact-directory",
                "campus-services-service-guide",
            },
        )
        procedure_row = next(
            row for row in rows if row["targetId"] == "campus-services-service-guide"
        )
        self.assertEqual(procedure_row["compositionGroup"], "information_disclosure")
        self.assertEqual(procedure_row["compositionRole"], "procedure_source")

    def test_build_collector_command_uses_single_batch_run_for_source_pack(self) -> None:
        with TemporaryDirectory() as temp_dir:
            args = type(
                "Args",
                (),
                {
                    "site_id": "muc_public",
                    "max_pages_per_host": 6,
                    "max_total_pages": 6,
                },
            )()
            target_seed = {
                "seededRows": [
                    {
                        "sourceHost": "www.muc.edu.cn",
                        "targetCandidateId": "owcand_school_profile_stable",
                        "targetUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    },
                    {
                        "sourceHost": "www.muc.edu.cn",
                        "targetCandidateId": "owcand_school_profile_contact",
                        "targetUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    },
                    {
                        "sourceHost": "xxgk.muc.edu.cn",
                        "targetCandidateId": "owcand_info_disclosure_procedure",
                        "targetUrl": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                    },
                ]
            }
            lineage_path = Path(temp_dir) / "lineage.json"

            command = build_collector_command(
                args=args,
                local_run_id="owrun_source_pack_live_test",
                output_root=Path(temp_dir),
                target_seed=target_seed,
                source_pack_lineage_path=lineage_path,
            )

        self.assertEqual(command.count("--host"), 2)
        self.assertEqual(command.count("--target-candidate-id"), 3)
        self.assertIn("--source-pack-lineage-path", command)
        self.assertEqual(
            command[command.index("--source-pack-lineage-path") + 1],
            str(lineage_path),
        )

    def test_script_uses_direct_wrangler_command_for_custom_app_api_port(self) -> None:
        path = Path("scripts/official_web_source_pack_no_promotion.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('"pnpm"', path)
        self.assertIn('"apps/app-api"', path)
        self.assertIn('"exec"', path)
        self.assertIn('"wrangler"', path)
        self.assertIn('"--port"', path)
        self.assertIn("str(args.app_api_port)", path)

    def test_write_source_pack_lineage_overrides_uses_seeded_rows(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            path = write_source_pack_lineage_overrides(
                output_root=output_root,
                target_seed={
                    "seededRows": [
                        {
                            "targetCandidateId": "owcand_info_disclosure_procedure",
                            "sourcePackId": "tool-driven-first-slice.v1",
                            "sourcePackEntryId": "owsp-info-disclosure-procedure-1113",
                            "compositionGroup": "information_disclosure",
                            "compositionRole": "procedure_source",
                        }
                    ]
                },
            )

            payload = path.read_text(encoding="utf-8")

        self.assertIn("owcand_info_disclosure_procedure", payload)
        self.assertIn('"compositionRole": "procedure_source"', payload)

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
