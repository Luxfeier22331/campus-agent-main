from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_evals.langfuse_adapter import derive_langfuse_trace_id

from scripts.eval_gate import main as eval_gate_main


class LangfuseEvalGateCliSuite(unittest.TestCase):
    def test_eval_gate_publishes_profile_report_to_langfuse_from_env(self) -> None:
        with TemporaryDirectory() as tmpdir:
            profile_report_path = Path(tmpdir) / "profile-report.json"
            profile_report_path.write_text(
                json.dumps(
                    _profile_report_payload(
                        {
                            "case_id": "case-001",
                            "passed": True,
                            "request_correlation": {
                                "request_id": "req_001",
                                "trace_id": "trace_001",
                                "sampled_at": "2026-06-18T10:00:00+00:00",
                            },
                        }
                    )
                ),
                encoding="utf-8",
            )

            with (
                patch.dict(
                    "os.environ",
                    {
                        "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                        "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                        "LANGFUSE_SECRET_KEY": "sk-lf-test",
                        "LANGFUSE_ENVIRONMENT": "staging",
                    },
                    clear=False,
                ),
                patch("scripts.eval_gate.publish_langfuse_profile_report_artifact") as publish,
                patch("builtins.print") as print_mock,
            ):
                publish.return_value = {"published": 1, "skipped": 0}

                exit_code = eval_gate_main(
                    [
                        "publish-langfuse-profile",
                        "--profile-report",
                        str(profile_report_path),
                        "--json",
                    ]
                )

        self.assertEqual(exit_code, 0)
        publish.assert_called_once()
        self.assertEqual(publish.call_args.kwargs["profile_report_path"], profile_report_path)
        settings = publish.call_args.kwargs["settings"]
        self.assertEqual(settings.base_url, "http://langfuse.internal:3000")
        self.assertEqual(settings.public_key, "pk-lf-test")
        self.assertEqual(settings.secret_key, "sk-lf-test")
        self.assertEqual(settings.environment, "staging")
        self.assertEqual(json.loads(print_mock.call_args.args[0]), {"published": 1, "skipped": 0})

    def test_eval_gate_builds_generic_score_report_from_profile_report(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            profile_report_path = root / "profile-report.json"
            score_report_path = root / "langfuse-score-report.json"
            profile_report_path.write_text(
                json.dumps(
                    _profile_report_payload(
                        {
                            "case_id": "case-001",
                            "passed": True,
                            "request_correlation": {
                                "request_id": "req_001",
                                "trace_id": "trace_001",
                                "sampled_at": "2026-06-18T10:00:00+00:00",
                            },
                        }
                    )
                ),
                encoding="utf-8",
            )

            with (
                patch.dict(
                    "os.environ",
                    {
                        "LANGFUSE_ENVIRONMENT": "staging",
                    },
                    clear=False,
                ),
                patch("builtins.print") as print_mock,
            ):
                exit_code = eval_gate_main(
                    [
                        "build-langfuse-score-report-from-profile",
                        "--profile-report",
                        str(profile_report_path),
                        "--output",
                        str(score_report_path),
                        "--json",
                    ]
                )

            score_report = json.loads(score_report_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(score_report["schema_version"], "langfuse_score_report.v1")
        self.assertEqual(score_report["environment"], "staging")
        self.assertEqual(score_report["expected_publish_denominator"], 1)
        printed = json.loads(print_mock.call_args.args[0])
        self.assertEqual(printed["score_report_path"], str(score_report_path))
        self.assertEqual(printed["expected_publish_denominator"], 1)

    def test_eval_gate_verifies_langfuse_trace_evidence_from_env(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                    "LANGFUSE_SECRET_KEY": "sk-lf-test",
                },
                clear=False,
            ),
            patch("scripts.eval_gate.verify_langfuse_online_trace_evidence_artifact") as verify,
            patch("builtins.print") as print_mock,
        ):
            verify.return_value = {
                "trace_id": "trace-online-001",
                "observation_count": 2,
            }

            exit_code = eval_gate_main(
                [
                    "verify-langfuse-trace",
                    "--trace-id",
                    "trace-online-001",
                    "--session-id",
                    "conv-online-001",
                    "--user-id",
                    "user-online-001",
                    "--release",
                    "release-2026-06-18",
                    "--tag",
                    "surface:execution-control",
                    "--tag",
                    "capability:knowledge",
                    "--request-id",
                    "req-online-001",
                    "--run-id",
                    "run-online-001",
                    "--workflow-id",
                    "campus-agent.chat.run-online-001",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        verify.assert_called_once()
        call = verify.call_args.kwargs
        self.assertEqual(call["trace_id"], "trace-online-001")
        self.assertEqual(call["expected_session_id"], "conv-online-001")
        self.assertEqual(call["expected_user_id"], "user-online-001")
        self.assertEqual(call["expected_release"], "release-2026-06-18")
        self.assertEqual(
            call["expected_tags"], ("surface:execution-control", "capability:knowledge")
        )
        self.assertEqual(call["expected_request_id"], "req-online-001")
        self.assertEqual(call["expected_run_id"], "run-online-001")
        self.assertEqual(call["expected_workflow_id"], "campus-agent.chat.run-online-001")
        settings = call["settings"]
        self.assertEqual(settings.base_url, "http://langfuse.internal:3000")
        self.assertEqual(settings.public_key, "pk-lf-test")
        self.assertEqual(settings.secret_key, "sk-lf-test")
        self.assertEqual(
            json.loads(print_mock.call_args.args[0]),
            {"trace_id": "trace-online-001", "observation_count": 2},
        )

    def test_eval_gate_verifies_langfuse_trace_by_product_trace_id(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                    "LANGFUSE_SECRET_KEY": "sk-lf-test",
                },
                clear=False,
            ),
            patch("scripts.eval_gate.verify_langfuse_online_trace_evidence_artifact") as verify,
            patch("builtins.print") as print_mock,
        ):
            verify.return_value = {
                "trace_id": derive_langfuse_trace_id("trace_001"),
                "observation_count": 2,
            }

            exit_code = eval_gate_main(
                [
                    "verify-langfuse-trace",
                    "--product-trace-id",
                    "trace_001",
                    "--session-id",
                    "conv-online-001",
                    "--user-id",
                    "user-online-001",
                    "--release",
                    "release-2026-06-18",
                    "--tag",
                    "surface:execution-control",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        verify.assert_called_once()
        self.assertEqual(verify.call_args.kwargs["trace_id"], derive_langfuse_trace_id("trace_001"))
        self.assertEqual(
            json.loads(print_mock.call_args.args[0]),
            {"trace_id": derive_langfuse_trace_id("trace_001"), "observation_count": 2},
        )

    def test_eval_gate_syncs_langfuse_score_configs_from_registry(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                    "LANGFUSE_SECRET_KEY": "sk-lf-test",
                    "LANGFUSE_ENVIRONMENT": "staging",
                },
                clear=False,
            ),
            patch("scripts.eval_gate_langfuse.sync_langfuse_score_configs_artifact") as sync,
            patch("builtins.print") as print_mock,
        ):
            sync.return_value = {"planned_create": 8, "created": 0}

            exit_code = eval_gate_main(
                [
                    "sync-langfuse-score-configs",
                    "--registry",
                    "packages/evals/fixtures/ops/langfuse_score_registry.v1.json",
                    "--dry-run",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            sync.call_args.kwargs["registry_path"],
            Path("packages/evals/fixtures/ops/langfuse_score_registry.v1.json"),
        )
        self.assertEqual(sync.call_args.kwargs["dry_run"], True)
        self.assertEqual(sync.call_args.kwargs["settings"].environment, "staging")
        self.assertEqual(
            json.loads(print_mock.call_args.args[0]), {"planned_create": 8, "created": 0}
        )

    def test_eval_gate_syncs_langfuse_datasets(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                    "LANGFUSE_SECRET_KEY": "sk-lf-test",
                },
                clear=False,
            ),
            patch("scripts.eval_gate_langfuse.sync_langfuse_datasets_artifact") as sync,
            patch("builtins.print") as print_mock,
        ):
            sync.return_value = {"planned_create": 1, "planned_archive": 0}

            exit_code = eval_gate_main(
                [
                    "sync-langfuse-datasets",
                    "--dataset-manifest",
                    "dataset-manifest.json",
                    "--dry-run",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(sync.call_args.kwargs["manifest_path"], Path("dataset-manifest.json"))
        self.assertEqual(sync.call_args.kwargs["dry_run"], True)
        self.assertEqual(json.loads(print_mock.call_args.args[0])["planned_create"], 1)

    def test_eval_gate_runs_langfuse_experiment(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                    "LANGFUSE_SECRET_KEY": "sk-lf-test",
                },
                clear=False,
            ),
            patch("scripts.eval_gate_langfuse.run_langfuse_experiment_artifact") as run,
            patch("builtins.print") as print_mock,
        ):
            run.return_value = {"experiment_run_id": "exp-001", "verdict": "pass"}

            exit_code = eval_gate_main(
                [
                    "run-langfuse-experiment",
                    "--experiment-manifest",
                    "experiment-manifest.json",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(run.call_args.kwargs["manifest_path"], Path("experiment-manifest.json"))
        self.assertEqual(json.loads(print_mock.call_args.args[0])["verdict"], "pass")

    def test_eval_gate_runs_rag_first_stage_parameter_sweep(self) -> None:
        with (
            patch("scripts.eval_gate_langfuse.run_rag_first_stage_parameter_sweep_artifact") as run,
            patch("builtins.print") as print_mock,
        ):
            run.return_value = {"schema_version": "rag_first_stage_parameter_sweep.v1"}

            exit_code = eval_gate_main(
                [
                    "run-rag-first-stage-parameter-sweep",
                    "--qrels",
                    "qrels-a.json",
                    "--qrels",
                    "qrels-b.json",
                    "--candidate-result",
                    "candidate-a.json",
                    "--output-dir",
                    ".tmp/rag-sweep",
                    "--environment",
                    "staging",
                    "--release",
                    "release-2026-06-19",
                    "--source-git-head",
                    "abc123",
                    "--dataset-run-id",
                    "dataset-run-001",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            run.call_args.kwargs["qrels_paths"], (Path("qrels-a.json"), Path("qrels-b.json"))
        )
        self.assertEqual(run.call_args.kwargs["candidate_paths"], (Path("candidate-a.json"),))
        self.assertEqual(run.call_args.kwargs["output_dir"], Path(".tmp/rag-sweep"))
        self.assertEqual(
            json.loads(print_mock.call_args.args[0])["schema_version"],
            "rag_first_stage_parameter_sweep.v1",
        )

    def test_eval_gate_syncs_langfuse_annotation_queue(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                    "LANGFUSE_SECRET_KEY": "sk-lf-test",
                },
                clear=False,
            ),
            patch("scripts.eval_gate_langfuse.sync_langfuse_annotation_queue_artifact") as sync,
            patch("builtins.print") as print_mock,
        ):
            sync.return_value = {"planned_enqueue": 2}

            exit_code = eval_gate_main(
                [
                    "sync-langfuse-annotation-queue",
                    "--review-manifest",
                    "review-manifest.json",
                    "--dry-run",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(sync.call_args.kwargs["manifest_path"], Path("review-manifest.json"))
        self.assertEqual(sync.call_args.kwargs["dry_run"], True)
        self.assertEqual(json.loads(print_mock.call_args.args[0])["planned_enqueue"], 2)

    def test_eval_gate_exports_langfuse_review_results(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                    "LANGFUSE_SECRET_KEY": "sk-lf-test",
                },
                clear=False,
            ),
            patch("scripts.eval_gate_langfuse.export_langfuse_review_results_artifact") as export,
            patch("builtins.print") as print_mock,
        ):
            export.return_value = {"queue_id": "queue-001", "items": []}

            exit_code = eval_gate_main(
                [
                    "export-langfuse-review-results",
                    "--review-manifest",
                    "review-manifest.json",
                    "--output",
                    "review-export.json",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(export.call_args.kwargs["manifest_path"], Path("review-manifest.json"))
        self.assertEqual(export.call_args.kwargs["output_path"], Path("review-export.json"))
        self.assertEqual(json.loads(print_mock.call_args.args[0])["queue_id"], "queue-001")


def _profile_report_payload(result: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": "eval_profile_gate.v1",
        "profile_id": "online-answer-path",
        "case_family": "online_answer_path.v1",
        "passed": bool(result.get("passed")),
        "summary": {"total": 1, "passed": int(bool(result.get("passed"))), "failed": 0},
        "version_summary": {
            "runtime_version": "eval_profile_gate.v1",
            "git_head": "abc123",
        },
        "sanitized_results": [result],
    }


if __name__ == "__main__":
    unittest.main()
