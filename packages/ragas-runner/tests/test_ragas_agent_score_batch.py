from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ragas_runner.__main__ import main as package_main
from campus_ragas_runner.agent_score_batch import (
    RagasAgentProjection,
    RagasAgentResult,
    RagasAgentRunnerSettings,
    build_ragas_agent_scorer,
    run_ragas_agent_score_batch,
)
from campus_ragas_runner.agent_score_batch import (
    main as agent_main,
)


class RagasAgentScoreBatchTest(unittest.TestCase):
    def test_package_cli_dispatches_rag_and_agent_modes(self) -> None:
        with (
            patch("campus_ragas_runner.__main__.agent_main", return_value=0) as agent,
            patch("campus_ragas_runner.__main__.rag_main", return_value=0) as rag,
        ):
            self.assertEqual(package_main(["agent", "--input", "agent.json"]), 0)
            self.assertEqual(package_main(["rag", "--input", "rag.json"]), 0)

        agent.assert_called_once_with(["--input", "agent.json"])
        rag.assert_called_once_with(["--input", "rag.json"])

    def test_scores_name_only_tool_calls_with_injected_scorer(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_agent_sample_batch.v1",
                        "eval_run_id": "agent-eval-001",
                        "items": [
                            {
                                "case_id": "transport-route",
                                "trace_id": "trace-001",
                                "dataset_item_id": "dataset-item-001",
                                "dataset_run_id": "dataset-run-001",
                                "query": "校车现在能到海淀校区吗？",
                                "answer": "我查询一下校车班次。",
                                "tool_calls": [
                                    {
                                        "name": "transport_schedule_lookup",
                                        "args": {},
                                    }
                                ],
                                "reference_tool_calls": [
                                    {
                                        "name": "transport_schedule_lookup",
                                        "args": {},
                                    }
                                ],
                                "argument_mode": "name_only",
                                "metadata": {"surface_key": "app-api.chat"},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            captured: list[RagasAgentProjection] = []

            def fake_scorer(projection: RagasAgentProjection) -> tuple[RagasAgentResult, ...]:
                captured.append(projection)
                return (
                    RagasAgentResult(metric_name="tool_call_accuracy.name_only", score=1.0),
                    RagasAgentResult(metric_name="tool_call_f1.name_only", score=1.0),
                )

            summary = run_ragas_agent_score_batch(
                input_path=input_path,
                output_path=output_path,
                scorer_factory=lambda: fake_scorer,
            )

            self.assertEqual(summary, {"items": 1, "output_path": str(output_path)})
            self.assertEqual(captured[0].case_id, "transport-route")
            self.assertEqual(captured[0].tool_calls[0]["name"], "transport_schedule_lookup")
            self.assertEqual(
                captured[0].reference_tool_calls[0]["name"], "transport_schedule_lookup"
            )
            self.assertEqual(captured[0].argument_mode, "name_only")
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], "ragas_agent_score_batch.v1")
            self.assertEqual(payload["eval_run_id"], "agent-eval-001")
            self.assertEqual(
                payload["items"][0]["scores"],
                {
                    "ragas.tool_call_accuracy.name_only": 1.0,
                    "ragas.tool_call_f1.name_only": 1.0,
                },
            )

    def test_omits_missing_and_non_finite_agent_scores_from_json_output(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_agent_sample_batch.v1",
                        "eval_run_id": "agent-non-finite-001",
                        "items": [
                            {
                                "case_id": "direct",
                                "trace_id": "trace-001",
                                "query": "你好",
                                "answer": "你好",
                                "tool_calls": [],
                                "reference_tool_calls": [],
                                "argument_mode": "name_only",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            def fake_scorer(
                _projection: RagasAgentProjection,
            ) -> tuple[RagasAgentResult, ...]:
                return (
                    RagasAgentResult(metric_name="tool_call_accuracy.name_only"),
                    RagasAgentResult(metric_name="tool_call_f1.name_only", score=float("nan")),
                    RagasAgentResult(
                        metric_name="agent_goal_accuracy.with_reference", score=float("inf")
                    ),
                )

            run_ragas_agent_score_batch(
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
                    "ragas.tool_call_accuracy.name_only",
                    "ragas.tool_call_f1.name_only",
                    "ragas.agent_goal_accuracy.with_reference",
                ],
            )
            self.assertNotIn("NaN", raw_output)
            self.assertNotIn("Infinity", raw_output)

    def test_rejects_args_mode_without_eval_safe_args(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_agent_sample_batch.v1",
                        "eval_run_id": "agent-eval-001",
                        "items": [
                            {
                                "case_id": "transport-route",
                                "trace_id": "trace-001",
                                "query": "校车现在能到海淀校区吗？",
                                "answer": "我查询一下校车班次。",
                                "tool_calls": [
                                    {
                                        "name": "transport_schedule_lookup",
                                        "args": {},
                                    }
                                ],
                                "reference_tool_calls": [
                                    {
                                        "name": "transport_schedule_lookup",
                                        "args": {"route": "海淀"},
                                    }
                                ],
                                "argument_mode": "eval_safe_args",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "eval_safe_args requires non-empty tool args"):
                run_ragas_agent_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    scorer_factory=lambda: lambda _projection: (),
                )

    def test_rejects_forbidden_raw_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_agent_sample_batch.v1",
                        "eval_run_id": "agent-eval-001",
                        "items": [
                            {
                                "case_id": "bad-raw",
                                "trace_id": "trace-001",
                                "query": "你好",
                                "answer": "你好",
                                "tool_calls": [],
                                "reference_tool_calls": [],
                                "argument_mode": "name_only",
                                "raw_transcript": "must not be accepted",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "bad-raw.raw_transcript is forbidden"):
                run_ragas_agent_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    scorer_factory=lambda: lambda _projection: (),
                )

    def test_closes_agent_llm_client_inside_each_scoring_event_loop(self) -> None:
        settings = RagasAgentRunnerSettings(
            llm_api_key="sk-test",
            llm_model="gpt-4o-mini",
            llm_base_url=None,
            timeout_seconds=180,
            metric_names=("agent_goal_accuracy_with_reference",),
        )
        projection = RagasAgentProjection(
            case_id="case-001",
            query="What are the library opening hours?",
            answer="The library is open from 08:00 to 22:00.",
            tool_calls=(),
            reference_tool_calls=(),
            argument_mode="name_only",
            reference="The library is open from 08:00 to 22:00.",
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

        async def fake_metrics(*_args: object, **_kwargs: object) -> tuple[RagasAgentResult, ...]:
            return (RagasAgentResult(metric_name="agent_goal_accuracy.with_reference", score=1),)

        with (
            patch("openai.AsyncOpenAI", FakeAsyncOpenAI),
            patch("ragas.llms.llm_factory", return_value=object()),
            patch(
                "campus_ragas_runner.agent_score_batch._score_with_official_ragas_metrics",
                new=fake_metrics,
            ),
        ):
            scorer = build_ragas_agent_scorer(settings)
            scorer(projection)
            scorer(projection)

        self.assertEqual(len(clients), 2)
        self.assertTrue(all(client.closed for client in clients))

    def test_agent_cli_mode_writes_scores(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            runtime_config_path = work_dir / "runtime-config.json"
            runtime_config_path.write_text(
                json.dumps({"schema_version": "ragas_runner_config.v1"}),
                encoding="utf-8",
            )
            runtime_config_path.chmod(0o600)
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_agent_sample_batch.v1",
                        "eval_run_id": "agent-eval-001",
                        "items": [
                            {
                                "case_id": "direct",
                                "trace_id": "trace-001",
                                "query": "你好",
                                "answer": "你好",
                                "tool_calls": [],
                                "reference_tool_calls": [],
                                "argument_mode": "name_only",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            exit_code = agent_main(
                [
                    "--input",
                    str(input_path),
                    "--output",
                    str(output_path),
                    "--runtime-config",
                    str(runtime_config_path),
                ]
            )

            self.assertEqual(exit_code, 0)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["items"][0]["scores"]["ragas.tool_call_accuracy.name_only"], 1.0
            )


if __name__ == "__main__":
    unittest.main()
