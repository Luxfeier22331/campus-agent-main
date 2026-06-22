from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_evals.models import SupplementalResult
from campus_evals.ragas_adapter_projection import RagasProjection
from campus_evals.ragas_score_batch import run_ragas_score_batch


class RagasScoreBatchTest(unittest.TestCase):
    def test_run_ragas_score_batch_scores_cookbook_shaped_samples(self) -> None:
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

            def fake_scorer(projection: RagasProjection) -> tuple[SupplementalResult, ...]:
                captured.append(projection)
                return (
                    SupplementalResult(
                        adapter_id="ragas",
                        metric_name="faithfulness",
                        score=0.91,
                        metadata={"ragas_metric_name": "faithfulness"},
                    ),
                    SupplementalResult(
                        adapter_id="ragas",
                        metric_name="context_recall",
                        verdict="failed",
                        rationale="missing reference contexts",
                    ),
                )

            summary = run_ragas_score_batch(
                input_path=input_path,
                output_path=output_path,
                scorer_factory=lambda: fake_scorer,
            )

            self.assertEqual(summary, {"items": 1, "output_path": str(output_path)})
            self.assertEqual(len(captured), 1)
            self.assertEqual(captured[0].user_input, "图书馆开放时间是什么？")
            self.assertEqual(captured[0].retrieved_contexts, ("图书馆开放时间为 08:00-22:00。",))
            self.assertEqual(captured[0].metadata["trace_id"], "trace-001")

            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], "ragas_score_batch.v1")
            self.assertEqual(payload["eval_run_id"], "ragas-smoke-001")
            self.assertEqual(payload["items"][0]["scores"]["ragas.faithfulness"], 0.91)
            self.assertEqual(
                payload["items"][0]["errors"][0]["metric_name"], "ragas.context_recall"
            )

    def test_run_ragas_score_batch_omits_context_recall_without_reference(self) -> None:
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

            def fake_scorer(projection: RagasProjection) -> tuple[SupplementalResult, ...]:
                captured.append(projection)
                return (
                    SupplementalResult(
                        adapter_id="ragas",
                        metric_name="faithfulness",
                        score=0.91,
                    ),
                )

            run_ragas_score_batch(
                input_path=input_path,
                output_path=output_path,
                scorer_factory=lambda: fake_scorer,
            )

            self.assertEqual(
                captured[0].metadata["metric_applicability"], {"context_recall": False}
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["items"][0]["scores"]["ragas.faithfulness"], 0.91)
            self.assertEqual(
                payload["items"][0]["errors"],
                [
                    {
                        "metric_name": "ragas.context_recall",
                        "reason": "missing reference for context_recall",
                    }
                ],
            )

    def test_run_ragas_score_batch_rejects_raw_trace_fields(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
