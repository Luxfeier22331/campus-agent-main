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


def sample_payload(**item_overrides: object) -> dict[str, object]:
    item: dict[str, object] = {
        "answer": "我会查询相关规定。",
        "argument_mode": "name_only",
        "case_id": "case-001",
        "query": "学生转专业需要什么条件？",
        "reference": "应依据当前规定回答。",
        "reference_tool_calls": [],
        "tool_calls": [],
        "metadata": {"surface_key": "app-api.chat"},
    }
    item.update(item_overrides)
    return {
        "items": [item],
        "run_id": "agent-eval-001",
        "schema_version": "ragas_agent_sample_batch.v2",
    }


def provider_config(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "profiles": {
                    "eval_judge_llm": {
                        "api_key": "judge-key",
                        "base_url": "https://provider.example/v1",
                        "model": "judge-model",
                        "timeout_ms": 120000,
                    }
                },
            }
        ),
        encoding="utf-8",
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

    def test_scores_native_agent_batch_without_platform_identity(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            config_path = work_dir / "provider-config.json"
            input_path.write_text(json.dumps(sample_payload()), encoding="utf-8")
            provider_config(config_path)

            captured: list[RagasAgentProjection] = []

            def fake_scorer(projection: RagasAgentProjection) -> tuple[RagasAgentResult, ...]:
                captured.append(projection)
                return (
                    RagasAgentResult(metric_name="tool_call_accuracy.name_only", score=1.0),
                    RagasAgentResult(metric_name="tool_call_f1.name_only", score=1.0),
                )

            with patch(
                "campus_ragas_runner.agent_score_batch.build_ragas_agent_scorer",
                return_value=fake_scorer,
            ):
                summary = run_ragas_agent_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    provider_config_path=config_path,
                )

            self.assertEqual(summary["items"], 1)
            self.assertEqual(captured[0].case_id, "case-001")
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], "ragas_agent_score_batch.v2")
            self.assertEqual(payload["run_id"], "agent-eval-001")
            self.assertEqual(payload["items"][0]["scores"]["ragas.tool_call_f1.name_only"], 1.0)
            self.assertNotIn("trace_id", payload["items"][0])
            self.assertNotIn("dataset_run_id", payload["items"][0])

    def test_omits_missing_and_non_finite_scores_from_json_output(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            config_path = work_dir / "provider-config.json"
            input_path.write_text(json.dumps(sample_payload()), encoding="utf-8")
            provider_config(config_path)

            def fake_scorer(_projection: RagasAgentProjection) -> tuple[RagasAgentResult, ...]:
                return (
                    RagasAgentResult(metric_name="tool_call_accuracy.name_only"),
                    RagasAgentResult(metric_name="tool_call_f1.name_only", score=float("nan")),
                )

            with patch(
                "campus_ragas_runner.agent_score_batch.build_ragas_agent_scorer",
                return_value=fake_scorer,
            ):
                run_ragas_agent_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    provider_config_path=config_path,
                )

            raw_output = output_path.read_text(encoding="utf-8")
            payload = json.loads(raw_output)
            self.assertEqual(payload["items"][0]["scores"], {})
            self.assertEqual(
                [error["metric_name"] for error in payload["items"][0]["errors"]],
                ["ragas.tool_call_accuracy.name_only", "ragas.tool_call_f1.name_only"],
            )
            self.assertNotIn("NaN", raw_output)

    def test_rejects_retired_schema_and_forbidden_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            config_path = work_dir / "provider-config.json"
            provider_config(config_path)

            legacy = sample_payload()
            legacy["schema_version"] = "ragas_agent_sample_batch.v1"
            input_path.write_text(json.dumps(legacy), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "ragas_agent_sample_batch.v2"):
                run_ragas_agent_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    provider_config_path=config_path,
                )

            forbidden = sample_payload()
            item = forbidden["items"][0]
            assert isinstance(item, dict)
            item["trace_id"] = "must-not-cross-boundary"
            input_path.write_text(json.dumps(forbidden), encoding="utf-8")
            with (
                patch(
                    "campus_ragas_runner.agent_score_batch.build_ragas_agent_scorer",
                    return_value=lambda _projection: (),
                ),
                self.assertRaisesRegex(ValueError, "trace_id"),
            ):
                run_ragas_agent_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    provider_config_path=config_path,
                )

    def test_rejects_args_mode_without_safe_arguments(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            config_path = work_dir / "provider-config.json"
            provider_config(config_path)
            input_path.write_text(
                json.dumps(
                    sample_payload(
                        argument_mode="eval_safe_args",
                        tool_calls=[{"args": {}, "name": "personal_memory_recall"}],
                        reference_tool_calls=[
                            {"args": {"topic": "转专业"}, "name": "personal_memory_recall"}
                        ],
                    )
                ),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ragas_runner.agent_score_batch.build_ragas_agent_scorer",
                    return_value=lambda _projection: (),
                ),
                self.assertRaisesRegex(ValueError, "eval_safe_args requires non-empty tool args"),
            ):
                run_ragas_agent_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                    provider_config_path=config_path,
                )

    def test_closes_agent_llm_client_for_each_scoring_call(self) -> None:
        settings = RagasAgentRunnerSettings(
            llm_api_key="sk-test",
            llm_model="gpt-test",
            llm_base_url=None,
            timeout_seconds=180,
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

    def test_agent_cli_mode_uses_provider_config(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "agent-samples.json"
            output_path = work_dir / "agent-scores.json"
            config_path = work_dir / "provider-config.json"
            input_path.write_text(json.dumps(sample_payload()), encoding="utf-8")
            provider_config(config_path)

            with patch(
                "campus_ragas_runner.agent_score_batch.build_ragas_agent_scorer",
                return_value=lambda _projection: (
                    RagasAgentResult(metric_name="tool_call_accuracy.name_only", score=1.0),
                ),
            ):
                exit_code = agent_main(
                    [
                        "--input",
                        str(input_path),
                        "--output",
                        str(output_path),
                        "--provider-config",
                        str(config_path),
                    ]
                )

            self.assertEqual(exit_code, 0)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["items"][0]["scores"]["ragas.tool_call_accuracy.name_only"], 1.0
            )


if __name__ == "__main__":
    unittest.main()
