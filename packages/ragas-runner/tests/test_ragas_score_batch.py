from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
import warnings
from pathlib import Path
from unittest.mock import patch

from campus_ragas_runner.score_batch import (
    RagasProjection,
    RagasResult,
    RagasRunnerSettings,
    _score_with_official_ragas_metrics,
    build_ragas_scorer,
    run_ragas_score_batch,
)

warnings.filterwarnings(
    "ignore",
    category=ResourceWarning,
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

    def test_omits_missing_and_non_finite_scores_from_json_output(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_sample_batch.v1",
                        "eval_run_id": "ragas-non-finite-001",
                        "items": [
                            {
                                "case_id": "case-001",
                                "trace_id": "trace-001",
                                "question": "What are the library opening hours?",
                                "answer": "The library is open from 08:00 to 22:00.",
                                "contexts": ["The library opening hours are 08:00-22:00."],
                                "reference": "The library opening hours are 08:00-22:00.",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            def fake_scorer(_projection: RagasProjection) -> tuple[RagasResult, ...]:
                return (
                    RagasResult(metric_name="faithfulness"),
                    RagasResult(metric_name="answer_relevancy", score=float("nan")),
                    RagasResult(metric_name="context_precision", score=float("inf")),
                )

            run_ragas_score_batch(
                input_path=input_path,
                output_path=output_path,
                scorer_factory=lambda: fake_scorer,
            )

            raw_output = output_path.read_text(encoding="utf-8")
            payload = json.loads(raw_output)
            self.assertEqual(payload["items"][0]["scores"], {})
            self.assertEqual(
                [error["metric_name"] for error in payload["items"][0]["errors"]],
                [
                    "ragas.faithfulness",
                    "ragas.answer_relevancy",
                    "ragas.context_precision",
                ],
            )
            self.assertNotIn("NaN", raw_output)
            self.assertNotIn("Infinity", raw_output)

    def test_omits_reference_context_metrics_without_reference_answer(self) -> None:
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
                captured[0].metadata["metric_applicability"],
                {"context_precision": False, "context_recall": False},
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["items"][0]["errors"],
                [
                    {
                        "metric_name": "ragas.context_precision",
                        "reason": "missing reference answer for context_precision",
                    },
                    {
                        "metric_name": "ragas.context_recall",
                        "reason": "missing reference answer for context_recall",
                    },
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

    def test_closes_async_clients_inside_each_scoring_event_loop(self) -> None:
        settings = RagasRunnerSettings(
            llm_api_key="sk-test",
            llm_model="gpt-4o-mini",
            llm_base_url=None,
            embedding_api_key="sk-test",
            embedding_model="text-embedding-3-small",
            embedding_base_url=None,
            embedding_dimensions=None,
            timeout_seconds=180,
            max_workers=1,
        )
        projection = RagasProjection(
            case_id="case-001",
            user_input="What are the library opening hours?",
            response="The library is open from 08:00 to 22:00.",
            retrieved_contexts=("The library opening hours are 08:00-22:00.",),
            reference="The library opening hours are 08:00-22:00.",
        )
        clients: list[FakeAsyncOpenAI] = []

        class FakeAsyncOpenAI:
            def __init__(self, **_kwargs: object) -> None:
                self.closed = False
                clients.append(self)

            async def __aenter__(self) -> FakeAsyncOpenAI:
                return self

            async def __aexit__(self, *_args: object) -> None:
                self.closed = True

        async def fake_metrics(*_args: object, **_kwargs: object) -> tuple[RagasResult, ...]:
            return (RagasResult(metric_name="faithfulness", score=1.0),)

        with (
            patch("openai.AsyncOpenAI", FakeAsyncOpenAI),
            patch("ragas.llms.llm_factory", return_value=object()),
            patch("ragas.embeddings.base.embedding_factory", return_value=object()),
            patch(
                "campus_ragas_runner.score_batch._score_with_official_ragas_metrics",
                new=fake_metrics,
            ),
        ):
            scorer = build_ragas_scorer(settings)
            scorer(projection)
            scorer(projection)

        self.assertEqual(len(clients), 4)
        self.assertTrue(all(client.closed for client in clients))

    def test_calls_official_metric_collection_ascore(self) -> None:
        projection = RagasProjection(
            case_id="case-001",
            user_input="What are the library opening hours?",
            response="The library is open from 08:00 to 22:00.",
            retrieved_contexts=("The library opening hours are 08:00-22:00.",),
            reference="The library opening hours are 08:00-22:00.",
        )
        calls: list[tuple[object, ...]] = []

        class FakeFaithfulness:
            def __init__(self, *, llm: object) -> None:
                self.llm = llm

            async def ascore(self, *args: object) -> float:
                calls.append(args)
                return 0.75

        with patch("ragas.metrics.collections.Faithfulness", FakeFaithfulness):
            results = asyncio.run(
                _score_with_official_ragas_metrics(
                    projection,
                    metric_names=("faithfulness",),
                    llm=object(),
                    embeddings=object(),
                )
            )

        self.assertEqual(results[0].metric_name, "faithfulness")
        self.assertEqual(results[0].score, 0.75)
        self.assertEqual(
            calls,
            [
                (
                    projection.user_input,
                    projection.response,
                    list(projection.retrieved_contexts),
                )
            ],
        )


if __name__ == "__main__":
    unittest.main()
