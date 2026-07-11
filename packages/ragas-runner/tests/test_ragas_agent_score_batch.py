from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ragas_runner.agent_score_batch import (
    RagasAgentProjection,
    RagasAgentResult,
    run_ragas_agent_score_batch,
)
from campus_ragas_runner.agent_score_batch import (
    main as agent_main,
)


class RagasAgentScoreBatchTest(unittest.TestCase):
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

    def test_agent_cli_mode_writes_scores(self) -> None:
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

            exit_code = agent_main(["--input", str(input_path), "--output", str(output_path)])

            self.assertEqual(exit_code, 0)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["items"][0]["scores"]["ragas.tool_call_accuracy.name_only"], 1.0
            )


if __name__ == "__main__":
    unittest.main()
