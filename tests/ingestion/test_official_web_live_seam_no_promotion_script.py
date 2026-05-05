from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.official_web_live_seam_no_promotion import (
    assert_seam_report,
    build_app_api_dev_command,
    build_collector_command,
    build_collector_env,
    build_parser,
    build_seam_report,
    extract_last_json_object,
    handoff_path_for_run,
    resolve_inventory_target_args,
    seed_target_workset,
    write_json,
)


class OfficialWebLiveSeamNoPromotionScriptTest(unittest.TestCase):
    def test_resolve_inventory_target_args_uses_target_inventory(self) -> None:
        args = build_parser().parse_args(
            [
                "--site-id",
                "muc_public",
                "--inventory-id",
                "muc-information-disclosure-application-process",
            ]
        )

        resolved = resolve_inventory_target_args(Path.cwd(), args)

        self.assertEqual(resolved.target_id, "campus-services-service-guide")
        self.assertEqual(resolved.target_url, "https://xxgk.muc.edu.cn/info/1007/1113.htm")
        self.assertEqual(resolved.host, "xxgk.muc.edu.cn")

    def test_extract_last_json_object_prefers_trailing_top_level_object(self) -> None:
        output = """
INFO CheerioCrawler: Queue head still returned requests {"requests":[{"id":"abc"}]}
{
  "outputDir": "/tmp/run",
  "crawlRun": {
    "crawlRunId": "owrun_001",
    "status": "completed"
  },
  "uploadedArtifacts": [
    {
      "artifactType": "page_observations",
      "recordCount": 4
    }
  ]
}
""".strip()

        payload = extract_last_json_object(output)

        self.assertEqual(payload["crawlRun"]["crawlRunId"], "owrun_001")
        self.assertEqual(payload["uploadedArtifacts"][0]["artifactType"], "page_observations")

    def test_handoff_path_for_run_selects_current_run_when_inbox_has_backlog(self) -> None:
        with TemporaryDirectory() as temp_dir:
            inbox_dir = Path(temp_dir)
            write_json(
                inbox_dir / "owevt_completed_old.json",
                {"eventId": "old", "payload": {"runId": "owrun_old"}},
            )
            current_path = inbox_dir / "owevt_completed_current.json"
            write_json(
                current_path,
                {"eventId": "current", "payload": {"runId": "owrun_current"}},
            )

            self.assertEqual(handoff_path_for_run(inbox_dir, "owrun_current"), current_path)

    def test_seed_target_workset_requeues_exact_candidate_freshness_for_preview(self) -> None:
        args = build_parser().parse_args(
            [
                "--site-id",
                "muc_public",
                "--target-id",
                "campus-services-service-guide",
                "--target-url",
                "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                "--host",
                "xxgk.muc.edu.cn",
            ]
        )

        with (
            TemporaryDirectory() as temp_dir,
            patch(
                "scripts.official_web_live_seam_no_promotion.run_json_command",
                return_value={"targetCandidateId": "owcand_test"},
            ) as run_json_command,
        ):
            seed_target_workset(Path.cwd(), args, output_root=Path(temp_dir))

        command = run_json_command.call_args.args[1]
        node_code = command[command.index("-e") + 1]
        self.assertIn("update official_web.page_freshness", node_code)
        self.assertIn("next_eligible_fetch_at = $", node_code)
        self.assertIn("manual_live_seam_preview_requeue", node_code)
        self.assertIn("2147483647, $9, $9", node_code)
        self.assertIn("where site_id = $1", node_code)
        self.assertIn("normalized_canonical_url = $2", node_code)

    def test_build_collector_command_locks_seeded_target_candidate(self) -> None:
        args = build_parser().parse_args(
            [
                "--site-id",
                "muc_public",
                "--target-id",
                "campus-services-contact-directory",
                "--target-url",
                "https://www.muc.edu.cn/",
                "--host",
                "www.muc.edu.cn",
            ]
        )

        command = build_collector_command(
            args=args,
            local_run_id="owrun_consumer_live_test",
            output_root=Path("/tmp/owrun"),
            target_seed={"targetCandidateId": "owcand_exact"},
        )

        self.assertIn("--target-candidate-id", command)
        self.assertEqual(command[command.index("--target-candidate-id") + 1], "owcand_exact")

    def test_build_app_api_dev_command_uses_explicit_custom_port(self) -> None:
        command = build_app_api_dev_command(27123)

        self.assertEqual(command[:6], ("pnpm", "--dir", "apps/app-api", "exec", "wrangler", "dev"))
        self.assertIn("--port", command)
        self.assertEqual(command[command.index("--port") + 1], "27123")

    def test_build_collector_env_uses_custom_app_api_port(self) -> None:
        env = build_collector_env(
            Path.cwd(),
            app_api_port=27123,
        )

        self.assertEqual(env["OFFICIAL_WEB_APP_API_BASE_URL"], "http://127.0.0.1:27123")

    def test_build_seam_report_includes_target_first_proof_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            execution_report_path = output_root / "execution-report.json"
            execution_report_path.write_text("{}", encoding="utf-8")

            report = build_seam_report(
                actual_run_id="owrun_current",
                collector_result={
                    "crawlRun": {
                        "status": "completed",
                        "counters": {
                            "consumerDenominator": {
                                "retainedSourceTruthPages": 1,
                                "rejectedPages": 0,
                            }
                        },
                    },
                    "uploadedArtifacts": [
                        {
                            "artifactType": "source_truth_bundle",
                            "objectKey": "official_web/muc_public/runs/owrun_current/source-truth-bundle.json",
                            "recordCount": 1,
                        },
                        {
                            "artifactType": "page_observations",
                            "objectKey": "official_web/muc_public/runs/owrun_current/page-observations.jsonl",
                            "recordCount": 1,
                        },
                    ],
                },
                consumer_result={"counts": {"processed": 1}},
                db_run={
                    "ingestion_dispatch_status": "dispatched",
                    "ingestion_execution_error_code": None,
                    "ingestion_execution_status": "staged",
                    "target_attempt_count": 1,
                    "target_attempts": [
                        {
                            "candidateId": "owcand_contact_home",
                            "jobId": "owtarget_muc_public_contact_directory",
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/index.htm",
                        }
                    ],
                    "target_job_ids": ["owtarget_muc_public_contact_directory"],
                },
                drain_result={"processed": 1},
                event_id="owevt_current",
                execution_report={
                    "consumerCandidateReview": {
                        "counts": {
                            "candidate_count": 1,
                            "selected_write_ready_count": 1,
                        },
                        "selectedWrite": {
                            "decision": "dry_run_ready",
                            "reason": "machine_field_review_passed",
                            "ready_record_count": 1,
                            "blocked_record_count": 0,
                            "pending_record_count": 0,
                            "rejected_record_count": 0,
                            "preview_records": [
                                {
                                    "candidate_key": "owcand_contact_home",
                                    "field_status": {
                                        "organization_name": "present",
                                        "phone": "present",
                                        "source_url": "present",
                                        "source_version_evidence": "present",
                                        "email": "source_not_provided",
                                    },
                                    "optional_fields": ["email"],
                                    "required_fields": [
                                        "organization_name",
                                        "phone",
                                        "source_url",
                                        "source_version_evidence",
                                    ],
                                    "source_ref": {
                                        "raw_asset_id": "owasset_contact",
                                        "raw_version_id": "owver_contact",
                                    },
                                    "target_collection": "contact_directory",
                                    "target_corpus": "campus_services",
                                }
                            ],
                        },
                        "targetFieldReviews": [
                            {
                                "status": "ready_for_selected_write",
                                "summary": {
                                    "candidateKey": "owcand_contact_home",
                                    "fieldStatus": {
                                        "organization_name": "present",
                                        "phone": "present",
                                        "source_url": "present",
                                        "source_version_evidence": "present",
                                        "email": "source_not_provided",
                                    },
                                    "readyForSelectedWrite": True,
                                    "requiredFields": [
                                        "organization_name",
                                        "phone",
                                        "source_url",
                                        "source_version_evidence",
                                    ],
                                    "selectedWriteTarget": "campus_services/contact_directory",
                                },
                            }
                        ],
                    },
                    "coverage": {
                        "targetFamilyCounts": {"contact_directory_candidate": 1},
                        "targetLineageIssues": [],
                        "targetMaterializationPolicyCounts": {"candidate_only": 1},
                    },
                    "error": None,
                    "import": None,
                    "promotion": {"decision": "staged"},
                    "replay": {
                        "target_family_counts": {"contact_directory_candidate": 1},
                        "target_lineage_issues": [],
                        "target_materialization_policy_counts": {"candidate_only": 1},
                    },
                    "status": "staged",
                    "releaseTasks": {
                        "admittedCount": 0,
                        "enabled": False,
                        "reason": "release_task_store_not_configured",
                        "taskIds": [],
                    },
                },
                execution_report_path=execution_report_path,
                local_run_id="owrun_consumer_live_20260501T000000Z",
                output_root=output_root,
                target_seed={
                    "targetCandidateId": "owcand_contact_home",
                    "targetId": "campus-services-contact-directory",
                    "targetJobId": "owtarget_muc_public_contact_directory",
                    "targetUrl": "https://xxgk.muc.edu.cn/index.htm",
                },
            )

            self.assertEqual(
                report["target_seed"]["targetJobId"],
                "owtarget_muc_public_contact_directory",
            )
            self.assertEqual(
                report["collector"]["uploaded_object_refs"],
                [
                    {
                        "artifact_type": "source_truth_bundle",
                        "object_key": "official_web/muc_public/runs/owrun_current/source-truth-bundle.json",
                        "record_count": 1,
                    },
                    {
                        "artifact_type": "page_observations",
                        "object_key": "official_web/muc_public/runs/owrun_current/page-observations.jsonl",
                        "record_count": 1,
                    },
                ],
            )
            self.assertEqual(
                report["consumer"]["target_family_counts"],
                {"contact_directory_candidate": 1},
            )
            self.assertEqual(
                report["consumer"]["target_materialization_policy_counts"],
                {"candidate_only": 1},
            )
            self.assertEqual(report["consumer"]["target_lineage_issues"], [])
            self.assertEqual(
                report["consumer"]["selected_write"]["decision"],
                "dry_run_ready",
            )
            self.assertEqual(report["consumer"]["selected_write_ready_count"], 1)
            self.assertEqual(
                report["consumer"]["target_field_reviews"][0]["status"],
                "ready_for_selected_write",
            )
            self.assertEqual(
                report["consumer"]["release_tasks"]["reason"],
                "release_task_store_not_configured",
            )
            self.assertEqual(report["app_api"]["target_attempt_count"], 1)
            self.assertEqual(
                report["app_api"]["target_job_ids"],
                ["owtarget_muc_public_contact_directory"],
            )
            assert_seam_report(report)

    def test_assert_seam_report_requires_target_attempt_and_lineage_proof(self) -> None:
        report = {
            "app_api": {
                "db_run": {
                    "ingestion_dispatch_status": "dispatched",
                    "ingestion_execution_error_code": None,
                    "ingestion_execution_status": "staged",
                },
                "target_attempt_count": 0,
                "target_job_ids": [],
            },
            "collector": {
                "retained_source_truth_pages": 1,
                "status": "completed",
            },
            "consumer": {
                "error_is_null": True,
                "import_is_null": True,
                "promotion_decision": "staged",
                "status": "staged",
                "target_family_counts": {},
                "target_lineage_issues": [],
                "target_materialization_policy_counts": {},
            },
        }

        with self.assertRaisesRegex(RuntimeError, "target attempts"):
            assert_seam_report(report)

    def test_assert_seam_report_requires_machine_selected_write_field_review(self) -> None:
        report = {
            "app_api": {
                "db_run": {
                    "ingestion_dispatch_status": "dispatched",
                    "ingestion_execution_error_code": None,
                    "ingestion_execution_status": "staged",
                },
                "target_attempt_count": 1,
                "target_attempt_ids": ["attempt-1"],
                "target_attempts": [
                    {
                        "candidateId": "owcand_contact_home",
                        "jobId": "owtarget_contact",
                        "normalizedCanonicalUrl": "https://www.muc.edu.cn/",
                    }
                ],
                "target_job_ids": ["owtarget_contact"],
            },
            "collector": {
                "retained_source_truth_pages": 1,
                "status": "completed",
            },
            "consumer": {
                "error_is_null": True,
                "import_is_null": True,
                "promotion_decision": "staged",
                "selected_write": {
                    "decision": "dry_run_ready",
                    "preview_records": [],
                    "ready_record_count": 1,
                },
                "selected_write_ready_count": 1,
                "release_tasks": {
                    "admittedCount": 0,
                    "enabled": False,
                    "reason": "release_task_store_not_configured",
                    "taskIds": [],
                },
                "status": "staged",
                "target_family_counts": {"contact_directory_candidate": 1},
                "target_field_reviews": [],
                "target_lineage_issues": [],
                "target_materialization_policy_counts": {"candidate_only": 1},
            },
        }

        with self.assertRaisesRegex(RuntimeError, "target field reviews"):
            assert_seam_report(report)


if __name__ == "__main__":
    unittest.main()
