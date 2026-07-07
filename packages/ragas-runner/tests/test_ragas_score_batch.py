from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ragas_runner.score_batch import (
    RagasProjection,
    RagasResult,
    RagasRunnerSettings,
    _build_metrics,
    _load_public_id_metric_builders,
    build_ragas_scorer,
    run_ragas_score_batch,
)


class RagasRunnerScoreBatchTest(unittest.TestCase):
    def test_scores_safe_sample_batch_with_injected_scorer(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_sample_batch.v1",
                        "eval_run_id": "ragas-smoke-001",
                        "items": [
                            {
                                "case_id": "case-001",
                                "trace_id": "trace-001",
                                "observation_id": "obs-001",
                                "question": "图书馆开放时间是什么？",
                                "answer": "图书馆开放时间为 08:00 到 22:00。",
                                "contexts": ["图书馆开放时间为 08:00-22:00。"],
                                "reference": "图书馆开放时间为 08:00-22:00。",
                                "metadata": {"surface_key": "app-api.chat"},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            captured: list[RagasProjection] = []

            def fake_scorer(projection: RagasProjection) -> tuple[RagasResult, ...]:
                captured.append(projection)
                return (
                    RagasResult(metric_name="faithfulness", score=0.91),
                    RagasResult(
                        metric_name="context_recall",
                        rationale="missing reference contexts",
                    ),
                )

            summary = run_ragas_score_batch(
                input_path=input_path,
                output_path=output_path,
                scorer_factory=lambda: fake_scorer,
            )

            self.assertEqual(summary, {"items": 1, "output_path": str(output_path)})
            self.assertEqual(captured[0].user_input, "图书馆开放时间是什么？")
            self.assertEqual(captured[0].retrieved_contexts, ("图书馆开放时间为 08:00-22:00。",))
            self.assertEqual(captured[0].metadata["trace_id"], "trace-001")
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], "ragas_score_batch.v1")
            self.assertEqual(payload["items"][0]["scores"]["ragas.faithfulness"], 0.91)
            self.assertEqual(
                payload["items"][0]["errors"][0]["metric_name"], "ragas.context_recall"
            )

    def test_omits_context_recall_without_reference(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_sample_batch.v1",
                        "eval_run_id": "ragas-smoke-001",
                        "items": [
                            {
                                "case_id": "case-001",
                                "trace_id": "trace-001",
                                "question": "What are the library opening hours?",
                                "answer": "The library is open from 08:00 to 22:00.",
                                "contexts": ["The library opening hours are 08:00-22:00."],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            captured: list[RagasProjection] = []

            def fake_scorer(projection: RagasProjection) -> tuple[RagasResult, ...]:
                captured.append(projection)
                return (RagasResult(metric_name="faithfulness", score=0.91),)

            run_ragas_score_batch(
                input_path=input_path,
                output_path=output_path,
                scorer_factory=lambda: fake_scorer,
            )

            self.assertEqual(
                captured[0].metadata["metric_applicability"], {"context_recall": False}
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["items"][0]["errors"],
                [
                    {
                        "metric_name": "ragas.context_recall",
                        "reason": "missing reference for context_recall",
                    }
                ],
            )

    def test_rejects_forbidden_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_sample_batch.v1",
                        "eval_run_id": "ragas-smoke-001",
                        "items": [
                            {
                                "case_id": "case-001",
                                "trace_id": "trace-001",
                                "question": "What are the library opening hours?",
                                "answer": "The library is open from 08:00 to 22:00.",
                                "contexts": ["The library opening hours are 08:00-22:00."],
                                "raw_prompt": "do not accept sink payloads here",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "case-001.raw_prompt is forbidden"):
                run_ragas_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    scorer_factory=lambda: lambda _projection: (),
                )

    def test_rejects_multimodal_resource_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_sample_batch.v1",
                        "eval_run_id": "ragas-smoke-001",
                        "items": [
                            {
                                "case_id": "case-001",
                                "trace_id": "trace-001",
                                "question": "What are the library opening hours?",
                                "answer": "The library is open from 08:00 to 22:00.",
                                "contexts": ["The library opening hours are 08:00-22:00."],
                                "image_url": "https://example.test/proof.png",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "case-001.image_url is forbidden"):
                run_ragas_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    scorer_factory=lambda: lambda _projection: (),
                )

    def test_rejects_url_or_file_references_in_text_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_sample_batch.v1",
                        "eval_run_id": "ragas-smoke-001",
                        "items": [
                            {
                                "case_id": "case-001",
                                "trace_id": "trace-001",
                                "question": "What are the library opening hours?",
                                "answer": "The library is open from 08:00 to 22:00.",
                                "contexts": ["file:///tmp/proof.txt"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ValueError, "case-001.contexts\\[0\\] must not be a URL or file reference"
            ):
                run_ragas_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    scorer_factory=lambda: lambda _projection: (),
                )

    def test_rejects_embedding_dimensions_until_supported_by_ragas_provider(self) -> None:
        settings = RagasRunnerSettings(
            llm_api_key="sk-test",
            llm_model="gpt-4o-mini",
            llm_base_url=None,
            embedding_api_key="sk-test",
            embedding_model="text-embedding-3-small",
            embedding_base_url=None,
            embedding_dimensions=1536,
            timeout_seconds=180,
            max_workers=1,
        )

        with self.assertRaisesRegex(ValueError, "embedding_dimensions is not supported"):
            build_ragas_scorer(settings)

    def test_uses_official_no_reference_context_precision_metric(self) -> None:
        from openai import OpenAI
        from ragas.embeddings.base import embedding_factory
        from ragas.llms import llm_factory

        client = OpenAI(api_key="sk-test", max_retries=0)
        llm = llm_factory("gpt-4o-mini", client=client, temperature=0)
        embeddings = embedding_factory(
            provider="openai",
            model="text-embedding-3-small",
            client=client,
            interface="modern",
        )
        projection = RagasProjection(
            case_id="case-001",
            user_input="What are the library opening hours?",
            response="The library is open from 08:00 to 22:00.",
            retrieved_contexts=("The library opening hours are 08:00-22:00.",),
            reference="",
        )

        metrics = _build_metrics(
            metric_names=("context_precision",),
            llm=llm,
            embeddings=embeddings,
            projection=projection,
        )

        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0][0], "context_precision")
        self.assertEqual(type(metrics[0][1]).__name__, "ContextPrecisionWithoutReference")

    def test_public_id_metrics_do_not_import_ragas_private_modules(self) -> None:
        precision, recall = _load_public_id_metric_builders()

        self.assertIsNone(precision)
        self.assertIsNone(recall)


if __name__ == "__main__":
    unittest.main()
