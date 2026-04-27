from __future__ import annotations

import importlib
import io
import json
import sys
import unittest
from unittest.mock import patch

runner = importlib.import_module("campus_ingestion_worker.on_demand_batch_runner")


class OnDemandBatchRunnerTest(unittest.TestCase):
    def test_run_step_records_resource_profile_and_parses_json_stdout(self) -> None:
        step = runner.IngestionBatchStep(
            name="probe",
            module="probe.module",
            args=("--flag", "value"),
        )

        with patch(
            "campus_ingestion_worker.on_demand_batch_runner._run_subprocess",
            return_value=runner.SubprocessResult(
                exit_code=0,
                stdout='{"processed_count": 2, "failed_count": 0}',
                stderr="",
            ),
        ) as run_subprocess:
            result = runner.run_batch_step(step, child_rss_delta_kb=lambda before: 1234)

        run_subprocess.assert_called_once()
        command = run_subprocess.call_args.args[0]
        self.assertEqual(
            command,
            (
                sys.executable,
                "-m",
                "probe.module",
                "--flag",
                "value",
            ),
        )
        self.assertEqual(result["name"], "probe")
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(result["peak_rss_kb"], 1234)
        self.assertEqual(result["stdout_json"]["processed_count"], 2)
        self.assertGreaterEqual(result["elapsed_seconds"], 0)

    def test_parse_timed_stderr_extracts_peak_rss_marker_without_losing_stderr(self) -> None:
        stderr, peak_rss_kb = runner._parse_timed_stderr(
            f"warning before\n{runner._TIME_PEAK_RSS_MARKER}2048\nwarning after\n"
        )

        self.assertEqual(stderr, "warning before\nwarning after")
        self.assertEqual(peak_rss_kb, 2048)

    def test_official_web_handoff_batch_builds_existing_consumer_step(self) -> None:
        with patch(
            "campus_ingestion_worker.on_demand_batch_runner.run_batch_step",
            return_value={"name": "consume_handoffs", "status": "succeeded"},
        ) as run_step:
            report = runner.run_official_web_handoff_batch(
                event_id="evt-1",
                limit=7,
                force=True,
                promote=True,
            )

        step = run_step.call_args.args[0]
        self.assertEqual(step.name, "consume_handoffs")
        self.assertEqual(step.module, "campus_ingestion_worker.official_web_handoff_consumer")
        self.assertEqual(
            step.args,
            ("--event-id", "evt-1", "--limit", "7", "--force", "--promote"),
        )
        self.assertEqual(report["status"], "succeeded")
        self.assertEqual(report["batch_kind"], "official_web_handoffs")

    def test_authenticated_notice_closeout_batch_can_plan_run_validate_and_promote(self) -> None:
        with patch(
            "campus_ingestion_worker.on_demand_batch_runner.run_batch_step",
            side_effect=[
                {"name": "plan_closeout", "status": "succeeded"},
                {"name": "run_closeout_workers", "status": "succeeded"},
                {"name": "validate_chunking", "status": "succeeded"},
                {"name": "promote_closeout", "status": "succeeded"},
            ],
        ) as run_step:
            report = runner.run_authenticated_notice_closeout_batch(
                run_id="notice-20260427",
                bundle_path="/data/export/bundle.json",
                manifest_path="/data/export/manifest.json",
                site_id="muc_internal_portal",
                source_home_url="https://portal.example.edu/home",
                parallel_workers=2,
                worker_id="worker",
                shard_size=10,
                batch_size=4,
                max_concurrency=1,
                notice_concurrency=2,
                object_store_concurrency=4,
                lease_seconds=120,
                validate_chunking=True,
                promote=True,
            )

        steps = [call.args[0] for call in run_step.call_args_list]
        self.assertEqual(
            [step.name for step in steps],
            [
                "plan_closeout",
                "run_closeout_workers",
                "validate_chunking",
                "promote_closeout",
            ],
        )
        self.assertEqual(
            steps[0].args,
            (
                "--bundle-path",
                "/data/export/bundle.json",
                "--manifest-path",
                "/data/export/manifest.json",
                "--site-id",
                "muc_internal_portal",
                "--source-home-url",
                "https://portal.example.edu/home",
                "--run-id",
                "notice-20260427",
                "--shard-size",
                "10",
                "--batch-size",
                "4",
                "--max-concurrency",
                "1",
                "--notice-concurrency",
                "2",
                "--object-store-concurrency",
                "4",
                "--lease-seconds",
                "120",
            ),
        )
        self.assertEqual(
            steps[1].args,
            (
                "--run-id",
                "notice-20260427",
                "--parallel-workers",
                "2",
                "--worker-id-prefix",
                "worker",
            ),
        )
        self.assertEqual(steps[2].args, ("--closeout-run-id", "notice-20260427"))
        self.assertEqual(steps[3].args, ("--run-id", "notice-20260427"))
        self.assertEqual(report["status"], "succeeded")

    def test_internal_notice_batch_passes_consumer_admission_manifest_path(self) -> None:
        with patch(
            "campus_ingestion_worker.on_demand_batch_runner.run_batch_step",
            return_value={"name": "drain_multimodal_pending", "status": "succeeded"},
        ) as run_step:
            report = runner.run_internal_notice_multimodal_drain_batch(
                limit=1,
                batch_size=1,
                max_attempts=1,
                skip_read_model_rebuild=True,
                consumer_admission_manifest_path="/tmp/admission-manifest.json",
            )

        step = run_step.call_args.args[0]
        self.assertEqual(step.name, "drain_multimodal_pending")
        self.assertIn("--consumer-admission-manifest-path", step.args)
        self.assertIn("/tmp/admission-manifest.json", step.args)
        self.assertEqual(report["batch_kind"], "internal_notice_multimodal_drain")
        self.assertEqual(report["status"], "succeeded")

    def test_authenticated_notice_closeout_batch_stops_after_failed_step(self) -> None:
        with patch(
            "campus_ingestion_worker.on_demand_batch_runner.run_batch_step",
            side_effect=[
                {"name": "run_closeout_workers", "status": "failed", "exit_code": 1},
                {"name": "promote_closeout", "status": "succeeded"},
            ],
        ) as run_step:
            report = runner.run_authenticated_notice_closeout_batch(
                run_id="notice-20260427",
                parallel_workers=1,
                worker_id="worker-a",
                promote=True,
            )

        self.assertEqual(run_step.call_count, 1)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["steps"][0]["name"], "run_closeout_workers")

    def test_wechat_batch_builds_project_step(self) -> None:
        with patch(
            "campus_ingestion_worker.on_demand_batch_runner.run_batch_step",
            return_value={"name": "project_wechat_public_notices", "status": "succeeded"},
        ) as run_step:
            report = runner.run_wechat_public_notice_batch(
                selection_path="/tmp/selection.json",
                article_manifest_keys=(
                    "wechat_official_account/muc/source-truth/article-manifest.json",
                ),
                source_bucket="source",
                latest_completed_capture_run=True,
                capture_account_slug="muc",
                dry_run=True,
                emit_read_model_evidence=True,
            )

        step = run_step.call_args.args[0]
        self.assertEqual(step.name, "project_wechat_public_notices")
        self.assertEqual(step.module, "campus_ingestion_worker.project_wechat_public_notices")
        self.assertIn("--selection-path", step.args)
        self.assertIn("--article-manifest-key", step.args)
        self.assertIn("--latest-completed-capture-run", step.args)
        self.assertIn("--dry-run", step.args)
        self.assertEqual(report["batch_kind"], "wechat_public_notices")
        self.assertEqual(report["status"], "succeeded")

    def test_wechat_multimodal_drain_batch_builds_pending_drain_step(self) -> None:
        with patch(
            "campus_ingestion_worker.on_demand_batch_runner.run_batch_step",
            return_value={
                "name": "drain_wechat_public_notice_pending_multimodal",
                "status": "succeeded",
            },
        ) as run_step:
            report = runner.run_wechat_public_notice_multimodal_drain_batch(
                limit=12,
                batch_size=4,
                max_attempts=2,
                skip_read_model_rebuild=True,
            )

        step = run_step.call_args.args[0]
        self.assertEqual(step.name, "drain_wechat_public_notice_pending_multimodal")
        self.assertEqual(
            step.module,
            "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal",
        )
        self.assertEqual(
            step.args,
            (
                "--limit",
                "12",
                "--batch-size",
                "4",
                "--max-attempts",
                "2",
                "--skip-read-model-rebuild",
            ),
        )
        self.assertEqual(report["batch_kind"], "wechat_public_notice_multimodal_drain")
        self.assertEqual(report["status"], "succeeded")

    def test_run_steps_includes_policy_and_budget_summary(self) -> None:
        policy = runner.OnDemandBatchPolicy(
            max_batch_items=50,
            max_attachment_bytes=1024,
            max_ocr_input_bytes=1024,
            max_ocr_cache_entries=1,
            max_ocr_cache_total_bytes=512,
            peak_rss_warn_kb=100,
            peak_rss_hard_kb=200,
        )
        with patch(
            "campus_ingestion_worker.on_demand_batch_runner.run_batch_step",
            return_value={"name": "step-1", "status": "succeeded", "peak_rss_kb": 120},
        ):
            report = runner._run_steps(
                batch_kind="internal_notice_multimodal_drain",
                policy=policy,
                steps=(runner.IngestionBatchStep(name="step-1", module="probe"),),
            )

        self.assertEqual(report["policy"]["max_batch_items"], 50)
        self.assertEqual(report["resource_budget"]["max_step_peak_rss_kb"], 120)
        self.assertEqual(report["resource_budget"]["status"], "warn_exceeded")

    def test_cli_prints_report_and_exits_nonzero_on_failure(self) -> None:
        with (
            patch("campus_ingestion_worker.on_demand_batch_runner.load_worker_env"),
            patch(
                "campus_ingestion_worker.on_demand_batch_runner.run_official_web_handoff_batch",
                return_value={
                    "schema_version": runner.ON_DEMAND_BATCH_REPORT_SCHEMA_VERSION,
                    "batch_kind": "official_web_handoffs",
                    "status": "failed",
                    "steps": [],
                },
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
            self.assertRaises(SystemExit) as raised,
        ):
            runner.main(["official-web-handoffs", "--limit", "1"])

        self.assertEqual(raised.exception.code, 1)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["status"], "failed")

    def test_cli_requires_consumer_admission_manifest_for_internal_notice_drain(self) -> None:
        with (
            patch("campus_ingestion_worker.on_demand_batch_runner.load_worker_env"),
            self.assertRaises(SystemExit) as raised,
        ):
            runner.main(["internal-notice-multimodal-drain", "--limit", "1"])

        self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
