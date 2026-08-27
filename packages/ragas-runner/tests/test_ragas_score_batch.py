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
    main,
    run_ragas_score_batch,
)

warnings.filterwarnings("ignore", category=ResourceWarning)


def sample_payload(**item_overrides: object) -> dict[str, object]:
    item: dict[str, object] = {
        "case_id": "case-001",
        "user_input": "图书馆开放时间是什么？",
        "response": "图书馆开放时间为 08:00 到 22:00。",
        "retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
        "reference": "图书馆开放时间为 08:00-22:00。",
        "metadata": {"surface_key": "app-api.chat"},
    }
    item.update(item_overrides)
    return {
        "schema_version": "ragas_sample_batch.v3",
        "items": [item],
    }


class RagasRunnerScoreBatchTest(unittest.TestCase):
    def test_scores_native_sample_batch_without_trace_identity(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(json.dumps(sample_payload()), encoding="utf-8")
            captured: list[RagasProjection] = []

            def fake_scorer(projection: RagasProjection) -> tuple[RagasResult, ...]:
                captured.append(projection)
                return (RagasResult(metric_name="faithfulness", score=0.91),)

            output = run_ragas_score_batch(
                input_path=input_path,
                output_path=output_path,
                scorer_factory=lambda: fake_scorer,
            )

            self.assertEqual(output["schema_version"], "ragas_score_batch.v3")
            self.assertNotIn("run_id", output)
            self.assertEqual(captured[0].user_input, "图书馆开放时间是什么？")
            self.assertEqual(captured[0].retrieved_contexts, ("图书馆开放时间为 08:00-22:00。",))
            self.assertEqual(captured[0].metadata, {"surface_key": "app-api.chat"})
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], "ragas_score_batch.v3")
            self.assertEqual(payload["items"][0]["scores"]["ragas.faithfulness"], 0.91)
            self.assertNotIn("trace_id", payload["items"][0])
            self.assertNotIn("observation_id", payload["items"][0])

    def test_allows_empty_retrieval_contexts_as_an_evaluable_sample(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            input_path = Path(raw_dir) / "samples.json"
            input_path.write_text(
                json.dumps(sample_payload(retrieved_contexts=[])),
                encoding="utf-8",
            )

            captured: list[RagasProjection] = []

            def fake_scorer(projection: RagasProjection) -> tuple[RagasResult, ...]:
                captured.append(projection)
                return ()

            run_ragas_score_batch(input_path=input_path, scorer_factory=lambda: fake_scorer)
            self.assertEqual(captured[0].retrieved_contexts, ())

    def test_preserves_errors_and_omits_non_finite_scores(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            input_path = Path(raw_dir) / "samples.json"
            output_path = Path(raw_dir) / "scores.json"
            input_path.write_text(json.dumps(sample_payload()), encoding="utf-8")

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

    def test_rejects_old_sample_contract_and_trace_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            input_path = Path(raw_dir) / "samples.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_sample_batch.v2",
                        "items": [],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "ragas_sample_batch.v3"):
                run_ragas_score_batch(
                    input_path=input_path,
                    scorer_factory=lambda: lambda _projection: (),
                )

            forbidden_batch = sample_payload()
            forbidden_batch["run_id"] = "must-not-cross-boundary"
            input_path.write_text(json.dumps(forbidden_batch), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "run_id"):
                run_ragas_score_batch(
                    input_path=input_path,
                    scorer_factory=lambda: lambda _projection: (),
                )

            input_path.write_text(
                json.dumps(sample_payload(trace_id="must-not-cross-boundary")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "trace_id"):
                run_ragas_score_batch(
                    input_path=input_path,
                    scorer_factory=lambda: lambda _projection: (),
                )

    def test_stdout_is_the_structured_default_output(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            input_path = Path(raw_dir) / "samples.json"
            input_path.write_text(json.dumps(sample_payload()), encoding="utf-8")
            with (
                patch(
                    "campus_ragas_runner.score_batch.run_ragas_score_batch",
                    return_value={
                        "schema_version": "ragas_score_batch.v3",
                        "items": [],
                    },
                ),
                patch("builtins.print") as printer,
            ):
                self.assertEqual(
                    main(
                        [
                            "--input",
                            str(input_path),
                            "--provider-config",
                            str(input_path),
                        ]
                    ),
                    0,
                )
            printed = printer.call_args.args[0]
            self.assertEqual(json.loads(printed)["schema_version"], "ragas_score_batch.v3")

    def test_closes_async_clients_inside_each_scoring_event_loop(self) -> None:
        settings = RagasRunnerSettings(
            llm_api_key="sk-test",
            llm_model="gpt-4o-mini",
            llm_base_url=None,
            embedding_api_key="sk-test",
            embedding_model="text-embedding-3-small",
            embedding_base_url=None,
            timeout_seconds=180,
        )
        projection = RagasProjection(
            case_id="case-001",
            user_input="What are the library opening hours?",
            response="The library is open from 08:00 to 22:00.",
            retrieved_contexts=("The library opening hours are 08:00-22:00.",),
        )
        clients: list[object] = []

        class FakeOpenAI:
            def __init__(self, **_kwargs: object) -> None:
                self.closed = False
                self.kwargs = _kwargs
                clients.append(self)

            def __enter__(self) -> FakeOpenAI:
                return self

            def __exit__(self, *_args: object) -> None:
                self.closed = True

        class FakeAsyncOpenAI:
            def __init__(self, **_kwargs: object) -> None:
                self.closed = False
                self.kwargs = _kwargs
                clients.append(self)

            async def __aenter__(self) -> FakeAsyncOpenAI:
                return self

            async def __aexit__(self, *_args: object) -> None:
                self.closed = True

        async def fake_metrics(*_args: object, **_kwargs: object) -> tuple[RagasResult, ...]:
            return (RagasResult(metric_name="faithfulness", score=1.0),)

        with (
            patch("openai.OpenAI", FakeOpenAI),
            patch("openai.AsyncOpenAI", FakeAsyncOpenAI),
            patch("ragas.embeddings.base.embedding_factory", return_value=object()),
            patch(
                "campus_ragas_runner.score_batch._score_with_official_ragas_metrics",
                new=fake_metrics,
            ),
        ):
            scorer = build_ragas_scorer(settings)
            scorer(projection)
            scorer(projection)

        self.assertEqual(len(clients), 6)
        self.assertTrue(all(client.closed for client in clients))
        self.assertTrue(
            all(
                client.kwargs["default_headers"] == {"User-Agent": "campus-ragas-runner/0.1"}
                for client in clients
            )
        )

    def test_calls_official_metric_collection_ascore(self) -> None:
        projection = RagasProjection(
            case_id="case-001",
            user_input="What are the library opening hours?",
            response="The library is open from 08:00 to 22:00.",
            retrieved_contexts=("The library opening hours are 08:00-22:00.",),
            reference="The library is open from 08:00 to 22:00.",
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

    def test_reports_empty_context_and_skips_reference_metrics_without_reference(self) -> None:
        projection = RagasProjection(
            case_id="case-001",
            user_input="What are the library opening hours?",
            response="The library is open from 08:00 to 22:00.",
            retrieved_contexts=(),
        )
        calls: list[str] = []

        class FakeAnswerRelevancy:
            def __init__(self, *, llm: object, embeddings: object, strictness: int) -> None:
                del llm, embeddings, strictness

            async def ascore(self, *_args: object) -> float:
                calls.append("answer_relevancy")
                return 0.7

        class UnexpectedContextMetric:
            def __init__(self, **_kwargs: object) -> None:
                raise AssertionError("context metrics must not be constructed for empty contexts")

        with (
            patch("ragas.metrics.collections.Faithfulness", UnexpectedContextMetric),
            patch("ragas.metrics.collections.AnswerRelevancy", FakeAnswerRelevancy),
            patch("ragas.metrics.collections.ContextPrecision", UnexpectedContextMetric),
            patch("ragas.metrics.collections.ContextRecall", UnexpectedContextMetric),
        ):
            results = asyncio.run(
                _score_with_official_ragas_metrics(
                    projection,
                    metric_names=(
                        "faithfulness",
                        "answer_relevancy",
                        "context_precision",
                        "context_recall",
                    ),
                    llm=object(),
                    embeddings=object(),
                )
            )

        self.assertEqual(calls, ["answer_relevancy"])
        self.assertEqual(
            [result.metric_name for result in results],
            ["faithfulness", "answer_relevancy"],
        )
        self.assertIsNone(results[0].score)
        self.assertEqual(results[0].rationale, "retrieved_contexts is empty")

    def test_reports_empty_context_for_reference_metrics(self) -> None:
        projection = RagasProjection(
            case_id="case-001",
            user_input="What are the library opening hours?",
            response="The library is open from 08:00 to 22:00.",
            retrieved_contexts=(),
            reference="The library is open from 08:00 to 22:00.",
        )
        calls: list[str] = []

        class FakeAnswerRelevancy:
            def __init__(self, *, llm: object, embeddings: object, strictness: int) -> None:
                del llm, embeddings, strictness

            async def ascore(self, *_args: object) -> float:
                calls.append("answer_relevancy")
                return 0.7

        class UnexpectedContextMetric:
            def __init__(self, **_kwargs: object) -> None:
                raise AssertionError("context metrics must not be constructed for empty contexts")

        with (
            patch("ragas.metrics.collections.Faithfulness", UnexpectedContextMetric),
            patch("ragas.metrics.collections.AnswerRelevancy", FakeAnswerRelevancy),
            patch("ragas.metrics.collections.ContextPrecision", UnexpectedContextMetric),
            patch("ragas.metrics.collections.ContextRecall", UnexpectedContextMetric),
        ):
            results = asyncio.run(
                _score_with_official_ragas_metrics(
                    projection,
                    metric_names=(
                        "faithfulness",
                        "answer_relevancy",
                        "context_precision",
                        "context_recall",
                    ),
                    llm=object(),
                    embeddings=object(),
                )
            )

        self.assertEqual(calls, ["answer_relevancy"])
        self.assertEqual(
            [result.metric_name for result in results],
            ["faithfulness", "answer_relevancy", "context_precision", "context_recall"],
        )
        self.assertEqual(results[1].score, 0.7)
        self.assertEqual(
            [result.rationale for result in results if result.score is None],
            ["retrieved_contexts is empty"] * 3,
        )

    def test_empty_context_error_does_not_stop_later_batch_items(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            input_path = Path(raw_dir) / "samples.json"
            empty_item = sample_payload(retrieved_contexts=[])["items"][0]
            normal_item = sample_payload()["items"][0]
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_sample_batch.v3",
                        "items": [empty_item, {**normal_item, "case_id": "case-002"}],
                    }
                ),
                encoding="utf-8",
            )

            def fake_scorer(projection: RagasProjection) -> tuple[RagasResult, ...]:
                if not projection.retrieved_contexts:
                    return (
                        RagasResult(
                            metric_name="faithfulness", rationale="retrieved_contexts is empty"
                        ),
                    )
                return (RagasResult(metric_name="faithfulness", score=0.9),)

            output = run_ragas_score_batch(
                input_path=input_path,
                scorer_factory=lambda: fake_scorer,
            )

        items = output["items"]
        self.assertEqual([item["case_id"] for item in items], ["case-001", "case-002"])
        self.assertEqual(items[0]["scores"], {})
        self.assertEqual(items[0]["errors"][0]["reason"], "retrieved_contexts is empty")
        self.assertEqual(items[1]["scores"], {"ragas.faithfulness": 0.9})


if __name__ == "__main__":
    unittest.main()
