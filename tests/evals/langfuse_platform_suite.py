from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from campus_evals.langfuse_adapter import LangfuseAdapterSettings


class LangfusePlatformSuite(unittest.TestCase):
    def test_score_config_sync_dry_run_plans_missing_registry_configs(self) -> None:
        from campus_evals.langfuse_platform import sync_langfuse_score_configs

        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            self.assertEqual(request.method, "GET")
            self.assertEqual(request.url.path, "/api/public/score-configs")
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "cfg-existing",
                            "name": "online-answer-path.profile",
                            "dataType": "BOOLEAN",
                            "isArchived": False,
                        }
                    ],
                    "meta": {"page": 1, "limit": 50, "totalPages": 1},
                },
            )

        report = sync_langfuse_score_configs(
            registry_path=_repo_root()
            / "packages/evals/fixtures/ops/langfuse_score_registry.v1.json",
            settings=_settings(),
            dry_run=True,
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )

        self.assertEqual(report["schema_version"], "langfuse_score_config_sync_report.v1")
        self.assertEqual(report["dry_run"], True)
        self.assertGreater(report["planned_create"], 0)
        self.assertEqual(report["created"], 0)
        self.assertEqual(report["failed"], 0)
        self.assertIn("retrieval.doc_hit_at_1", report["planned_score_names"])
        self.assertEqual([request.method for request in requests], ["GET"])

    def test_dataset_sync_dry_run_uses_stable_item_ids_and_archives_removed_cases(self) -> None:
        from campus_evals.langfuse_platform import sync_langfuse_datasets

        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            fixture_path = root / "retrieval_qrels.json"
            fixture_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "case-one",
                                "split": "release_gate",
                                "query": "学生证丢了怎么办",
                                "expected_sources": [{"doc_id": "doc-1", "grade": 2}],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path = root / "dataset-manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "langfuse_dataset_manifest.v1",
                        "source_git_head": "abc123",
                        "datasets": [
                            {
                                "name": "campus/rag/student_rules/qrels",
                                "slug": "rag.student_rules.qrels",
                                "kind": "rag_qrels",
                                "surface_key": "regulations/student_rules",
                                "fixture_path": str(fixture_path),
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            requests: list[httpx.Request] = []

            def handler(request: httpx.Request) -> httpx.Response:
                requests.append(request)
                if request.method == "GET" and request.url.path == "/api/public/v2/datasets":
                    return httpx.Response(200, json={"data": [], "meta": {"totalPages": 1}})
                if request.method == "GET" and request.url.path == "/api/public/dataset-items":
                    return httpx.Response(
                        200,
                        json={
                            "data": [
                                {
                                    "id": "campus:old:removed-case",
                                    "metadata": {
                                        "dataset_slug": "rag.student_rules.qrels",
                                        "case_id": "removed-case",
                                        "source_fixture_path": str(fixture_path),
                                        "fixture_hash": "old",
                                    },
                                    "status": "ACTIVE",
                                }
                            ],
                            "meta": {"totalPages": 1},
                        },
                    )
                raise AssertionError(f"unexpected request {request.method} {request.url}")

            report = sync_langfuse_datasets(
                manifest_path=manifest_path,
                settings=_settings(),
                dry_run=True,
                client=httpx.Client(transport=httpx.MockTransport(handler)),
            )

        self.assertEqual(report["schema_version"], "langfuse_dataset_sync_report.v1")
        self.assertEqual(report["dry_run"], True)
        self.assertEqual(report["created"], 0)
        self.assertEqual(report["updated"], 0)
        self.assertEqual(report["archived"], 0)
        self.assertEqual(report["planned_create"], 1)
        self.assertEqual(report["planned_archive"], 1)
        desired_id = report["datasets"][0]["desired_items"][0]["id"]
        self.assertTrue(desired_id.startswith("campus:"))
        self.assertIn(":case-one", desired_id)
        self.assertNotIn(report["datasets"][0]["fixture_hash"][:8], desired_id)
        self.assertEqual([request.method for request in requests], ["GET", "GET"])

    def test_dataset_sync_supports_release_online_answer_and_known_gap_fixtures(self) -> None:
        from campus_evals.langfuse_platform import sync_langfuse_datasets

        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            release_fixture = root / "release_acceptance.json"
            release_fixture.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "cases": [
                            {
                                "case_id": "release-case-one",
                                "split": "release_gate",
                                "query": "degree article ten",
                                "expected_document_ids": ["doc-1"],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            online_fixture = root / "online_answer_path.json"
            online_fixture.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "case_family": "online_answer_path.v1",
                        "cases": [
                            {
                                "case_id": "online-case-one",
                                "split": "smoke",
                                "user_goal": "campus card lost",
                                "expected": {
                                    "selected_capability": "campus_services",
                                    "terminal_outcome": "completed",
                                    "response_contract": {"answer_text_present": True},
                                },
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            known_gap_fixture = root / "known_gap_cases.json"
            known_gap_fixture.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "case_family": "rag_known_gap_cases.v1",
                        "cases": [
                            {
                                "case_id": "known-gap-one",
                                "gap_id": "missing-rule-one",
                                "split": "known_gap",
                                "surface_key": "regulations/student_rules",
                                "query": "missing canonical title",
                                "status": "pending_authenticated_collection",
                                "required_behavior": ["must_identify_missing_canonical_document"],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path = root / "dataset-manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "langfuse_dataset_manifest.v1",
                        "source_git_head": "abc123",
                        "datasets": [
                            {
                                "name": "campus/rag/student_rules/release-acceptance",
                                "slug": "rag.student_rules.release_acceptance",
                                "kind": "release_acceptance",
                                "surface_key": "regulations/student_rules",
                                "fixture_path": str(release_fixture),
                            },
                            {
                                "name": "campus/online-answer-path/product",
                                "slug": "online_answer_path.product",
                                "kind": "online_answer_path",
                                "surface_key": "app-api.chat",
                                "fixture_path": str(online_fixture),
                            },
                            {
                                "name": "campus/rag/known-gap-review",
                                "slug": "rag.known_gap_review",
                                "kind": "known_gap_review_seed",
                                "surface_key": "regulations/student_rules",
                                "fixture_path": str(known_gap_fixture),
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )

            def handler(request: httpx.Request) -> httpx.Response:
                if request.method == "GET" and request.url.path == "/api/public/v2/datasets":
                    return httpx.Response(200, json={"data": [], "meta": {"totalPages": 1}})
                if request.method == "GET" and request.url.path == "/api/public/dataset-items":
                    return httpx.Response(200, json={"data": [], "meta": {"totalPages": 1}})
                raise AssertionError(f"unexpected request {request.method} {request.url}")

            report = sync_langfuse_datasets(
                manifest_path=manifest_path,
                settings=_settings(),
                dry_run=True,
                client=httpx.Client(transport=httpx.MockTransport(handler)),
            )

        self.assertEqual(report["planned_create"], 3)
        desired_inputs = [
            item["input"] for dataset in report["datasets"] for item in dataset["desired_items"]
        ]
        self.assertEqual(
            {tuple(sorted(input_payload.keys())) for input_payload in desired_inputs},
            {
                ("case_id", "query_sha256", "surface_key"),
                ("case_id", "surface_key", "user_goal_sha256"),
            },
        )
        self.assertNotIn("degree article ten", json.dumps(report, ensure_ascii=False))
        self.assertNotIn("campus card lost", json.dumps(report, ensure_ascii=False))
        self.assertNotIn("missing canonical title", json.dumps(report, ensure_ascii=False))

    def test_experiment_runner_writes_dataset_run_items_and_generic_score_report(self) -> None:
        from campus_evals.langfuse_platform import run_langfuse_experiment
        from campus_evals.langfuse_score_report import validate_langfuse_score_report

        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manifest_path = root / "experiment-manifest.json"
            artifact_path = root / "experiment-result.json"
            score_report_path = root / "langfuse-score-report.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "langfuse_experiment_manifest.v1",
                        "experiment_run_id": "exp-run-001",
                        "experiment_kind": "answer_quality",
                        "dataset_source": "langfuse",
                        "dataset_name": "campus/rag/student_rules/answer-quality",
                        "dataset_version": "2026-06-19T00:00:00Z",
                        "run_name": "answer-quality@candidate-a",
                        "variant_id": "candidate-a",
                        "surface_key": "regulations/student_rules",
                        "environment": "staging",
                        "release": "release-2026-06-19",
                        "source_git_head": "abc123",
                        "artifact_path": str(artifact_path),
                        "score_report_path": str(score_report_path),
                        "item_results": [
                            {
                                "dataset_item_id": "item-001",
                                "case_id": "case-one",
                                "status": "passed",
                                "trace_id": "trace-001",
                                "scores": [
                                    {
                                        "name": "quality.groundedness",
                                        "data_type": "NUMERIC",
                                        "value": 1.0,
                                    }
                                ],
                            }
                        ],
                        "aggregate_scores": [
                            {
                                "name": "quality.groundedness",
                                "data_type": "NUMERIC",
                                "value": 1.0,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            posted: list[dict[str, object]] = []

            def handler(request: httpx.Request) -> httpx.Response:
                self.assertEqual(request.method, "POST")
                self.assertEqual(request.url.path, "/api/public/dataset-run-items")
                posted.append(json.loads(request.content.decode("utf-8")))
                return httpx.Response(
                    200,
                    json={
                        "id": "run-item-001",
                        "datasetRunId": "dataset-run-001",
                        "datasetRunName": "answer-quality@candidate-a",
                        "datasetItemId": "item-001",
                        "traceId": "trace-001",
                    },
                )

            report = run_langfuse_experiment(
                manifest_path=manifest_path,
                settings=_settings(),
                client=httpx.Client(transport=httpx.MockTransport(handler)),
            )

            artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
            score_report = json.loads(score_report_path.read_text(encoding="utf-8"))

        self.assertEqual(report["schema_version"], "langfuse_experiment_result.v1")
        self.assertEqual(report["dataset_run_id"], "dataset-run-001")
        self.assertEqual(report["score_report_path"], str(score_report_path))
        self.assertEqual(posted[0]["datasetVersion"], "2026-06-19T00:00:00Z")
        self.assertEqual(artifact["verdict"], "pass")
        self.assertEqual(artifact["item_results"][0]["dataset_run_item_id"], "run-item-001")
        self.assertEqual(score_report["eval_kind"], "answer_quality")
        self.assertEqual(score_report["expected_publish_denominator"], 2)
        self.assertEqual(validate_langfuse_score_report(score_report)["score_count"], 2)

    def test_local_fixture_experiment_uses_trace_scores_and_omits_aggregate_without_dataset_run(
        self,
    ) -> None:
        from campus_evals.langfuse_platform import run_langfuse_experiment
        from campus_evals.langfuse_score_report import validate_langfuse_score_report

        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            baseline_path = root / "baseline-experiment-result.json"
            artifact_path = root / "experiment-result.json"
            score_report_path = root / "langfuse-score-report.json"
            manifest_path = root / "experiment-manifest.json"
            baseline_path.write_text(
                json.dumps(
                    {
                        "schema_version": "langfuse_experiment_result.v1",
                        "experiment_run_id": "baseline-run",
                        "aggregate_scores": [
                            {
                                "name": "quality.groundedness",
                                "data_type": "NUMERIC",
                                "value": 0.75,
                            }
                        ],
                        "verdict": "pass",
                    }
                ),
                encoding="utf-8",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "langfuse_experiment_manifest.v1",
                        "experiment_run_id": "local-exp-run-001",
                        "experiment_kind": "answer_quality",
                        "dataset_source": "local",
                        "dataset_name": "local/answer-quality",
                        "variant_id": "candidate-a",
                        "baseline_id": "accepted",
                        "baseline_artifact_path": str(baseline_path),
                        "surface_key": "service_guide_lookup",
                        "environment": "staging",
                        "release": "release-2026-06-19",
                        "source_git_head": "abc123",
                        "artifact_path": str(artifact_path),
                        "score_report_path": str(score_report_path),
                        "item_results": [
                            {
                                "dataset_item_id": "local-item-001",
                                "case_id": "case-one",
                                "status": "passed",
                                "trace_id": "trace-local-001",
                                "scores": [
                                    {
                                        "name": "quality.groundedness",
                                        "data_type": "NUMERIC",
                                        "value": 0.9,
                                    }
                                ],
                            }
                        ],
                        "aggregate_scores": [
                            {
                                "name": "quality.groundedness",
                                "data_type": "NUMERIC",
                                "value": 0.9,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            def handler(request: httpx.Request) -> httpx.Response:
                raise AssertionError(f"local experiment must not call Langfuse: {request.url}")

            report = run_langfuse_experiment(
                manifest_path=manifest_path,
                settings=_settings(),
                client=httpx.Client(transport=httpx.MockTransport(handler)),
            )

            artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
            score_report = json.loads(score_report_path.read_text(encoding="utf-8"))

        self.assertIsNone(report["dataset_run_id"])
        self.assertIsNone(artifact["dataset_run_id"])
        self.assertEqual(score_report["expected_publish_denominator"], 1)
        self.assertEqual(score_report["source_result_denominator"], 2)
        self.assertEqual(score_report["score_items"][0]["trace_id"], "trace-local-001")
        self.assertIsNone(score_report["score_items"][0]["dataset_run_id"])
        self.assertEqual(
            score_report["omitted_items"][0]["reason"],
            "missing_dataset_run_for_aggregate_score",
        )
        comparison = artifact["baseline_comparison"]
        self.assertEqual(comparison["baseline_id"], "accepted")
        self.assertEqual(comparison["aggregate_score_deltas"][0]["delta"], 0.15)
        self.assertEqual(validate_langfuse_score_report(score_report)["score_count"], 1)

    def test_annotation_queue_sync_prefills_scores_as_annotation_source(self) -> None:
        from campus_evals.langfuse_platform import sync_langfuse_annotation_queue

        with TemporaryDirectory() as tmpdir:
            manifest_path = Path(tmpdir) / "review-manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "langfuse_review_manifest.v1",
                        "queue_name": "campus/rag/badcase-review",
                        "queue_id": "queue-001",
                        "score_configs": [
                            {"name": "quality.groundedness", "config_id": "cfg-quality"}
                        ],
                        "items": [
                            {
                                "case_id": "case-one",
                                "object_id": "trace-001",
                                "object_type": "TRACE",
                                "prefill_scores": [
                                    {
                                        "name": "quality.groundedness",
                                        "value": 0.25,
                                        "data_type": "NUMERIC",
                                        "comment": "needs reviewer verification",
                                    }
                                ],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            requests: list[tuple[str, str, dict[str, object]]] = []

            def handler(request: httpx.Request) -> httpx.Response:
                payload = json.loads(request.content.decode("utf-8")) if request.content else {}
                requests.append((request.method, request.url.path, payload))
                if request.url.path == "/api/public/annotation-queues/queue-001/items":
                    return httpx.Response(200, json={"id": "queue-item-001"})
                if request.url.path == "/api/public/scores":
                    return httpx.Response(200, json={"id": "score-001"})
                raise AssertionError(f"unexpected request {request.method} {request.url}")

            report = sync_langfuse_annotation_queue(
                manifest_path=manifest_path,
                settings=_settings(),
                dry_run=False,
                client=httpx.Client(transport=httpx.MockTransport(handler)),
            )

        self.assertEqual(report["schema_version"], "langfuse_review_queue_sync_report.v1")
        self.assertEqual(report["enqueued"], 1)
        self.assertEqual(report["prefilled_scores"], 1)
        score_payload = requests[1][2]
        self.assertEqual(score_payload["source"], "ANNOTATION")
        self.assertEqual(score_payload["configId"], "cfg-quality")
        self.assertNotEqual(score_payload["source"], "EVAL")

    def test_review_export_includes_case_score_config_and_reviewer_summary(self) -> None:
        from campus_evals.langfuse_platform import export_langfuse_review_results

        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manifest_path = root / "review-manifest.json"
            output_path = root / "review-export.json"
            manifest_path.write_text(json.dumps({"queue_id": "queue-001"}), encoding="utf-8")

            def handler(request: httpx.Request) -> httpx.Response:
                self.assertEqual(request.method, "GET")
                self.assertEqual(request.url.path, "/api/public/annotation-queues/queue-001/items")
                return httpx.Response(
                    200,
                    json={
                        "data": [
                            {
                                "id": "queue-item-001",
                                "objectId": "trace-001",
                                "objectType": "TRACE",
                                "comment": "needs fix",
                                "metadata": {"case_id": "case-one"},
                                "scores": [
                                    {
                                        "scoreConfigId": "cfg-quality",
                                        "name": "quality.groundedness",
                                        "value": 0.4,
                                    }
                                ],
                            }
                        ],
                        "meta": {"totalPages": 1},
                    },
                )

            report = export_langfuse_review_results(
                manifest_path=manifest_path,
                output_path=output_path,
                settings=_settings(),
                client=httpx.Client(transport=httpx.MockTransport(handler)),
            )
            persisted = json.loads(output_path.read_text(encoding="utf-8"))

        exported_item = report["items"][0]
        self.assertEqual(exported_item["case_id"], "case-one")
        self.assertEqual(exported_item["score_config_ids"], ["cfg-quality"])
        self.assertEqual(
            exported_item["reviewer_score_summary"],
            [
                {
                    "score_config_id": "cfg-quality",
                    "score_name": "quality.groundedness",
                    "value": 0.4,
                }
            ],
        )
        self.assertEqual(persisted["items"][0]["case_id"], "case-one")


def _settings() -> LangfuseAdapterSettings:
    return LangfuseAdapterSettings(
        base_url="http://langfuse.internal:3000",
        public_key="pk-lf-test",
        secret_key="sk-lf-test",
        environment="staging",
    )


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


if __name__ == "__main__":
    unittest.main()
