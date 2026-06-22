from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_evals.context_followup_score_batch import run_context_followup_score_batch


class ContextFollowupScoreBatchTest(unittest.TestCase):
    def test_scores_prd_required_context_and_followup_dimensions(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "context_followup_sample_batch.v1",
                        "eval_run_id": "context-followup-2026-06-22",
                        "dataset_version": "context-followup-fixtures.v1",
                        "variant_id": "baseline-context-envelope-v1",
                        "source_git_head": "abc123",
                        "items": [
                            {
                                "case_id": "pronoun-transfer-major",
                                "trace_id": "trace-ctx-001",
                                "observation_id": "obs-ctx-001",
                                "dataset_item_id": "dsitem-pronoun-transfer-major",
                                "dataset_run_id": "dsrun-context-followup-001",
                                "question": "那大一能不能申请？",
                                "answer": "大一是否可申请需要看转专业办法的年级条件。",
                                "expected_reference_ids": ["ev_transfer_rule_01"],
                                "observed_reference_ids": ["ev_transfer_rule_01"],
                                "expected_followup_reference_type": "previous_evidence",
                                "observed_followup_reference_type": "previous_evidence",
                                "resolution_state": "resolved",
                                "grounded": True,
                                "hallucination_detected": False,
                                "context_pollution_detected": False,
                                "turn_order_preserved": True,
                                "latency_ms": 812,
                                "input_tokens": 680,
                                "output_tokens": 120,
                                "token_budget": 1200,
                                "metadata": {"surface_key": "app-api.chat"},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            summary = run_context_followup_score_batch(
                input_path=input_path,
                output_path=output_path,
            )

            self.assertEqual(summary, {"items": 1, "output_path": str(output_path)})
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], "context_followup_score_batch.v1")
            self.assertEqual(payload["dataset_version"], "context-followup-fixtures.v1")
            self.assertEqual(payload["variant_id"], "baseline-context-envelope-v1")
            item = payload["items"][0]
            self.assertEqual(item["scores"]["context.pronoun_resolution"], 1)
            self.assertEqual(item["scores"]["context.previous_evidence_reuse"], 1)
            self.assertEqual(item["scores"]["context.rag_followup_recall"], 1)
            self.assertEqual(item["scores"]["context.rag_followup_precision"], 1)
            self.assertEqual(item["scores"]["context.groundedness"], 1)
            self.assertEqual(item["scores"]["context.hallucination_free"], 1)
            self.assertEqual(item["scores"]["context.pollution_free"], 1)
            self.assertEqual(item["scores"]["context.concurrent_turn_order"], 1)
            self.assertEqual(item["scores"]["context.latency_ms"], 812)
            self.assertEqual(item["scores"]["context.token_cost"], 800)

    def test_rejects_forbidden_raw_payload_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            work_dir = Path(raw_dir)
            input_path = work_dir / "samples.json"
            output_path = work_dir / "scores.json"
            input_path.write_text(
                json.dumps(
                    {
                        "schema_version": "context_followup_sample_batch.v1",
                        "eval_run_id": "context-followup-2026-06-22",
                        "dataset_version": "context-followup-fixtures.v1",
                        "variant_id": "baseline-context-envelope-v1",
                        "source_git_head": "abc123",
                        "items": [
                            {
                                "case_id": "raw-prompt-forbidden",
                                "trace_id": "trace-ctx-001",
                                "question": "这个呢？",
                                "answer": "answer",
                                "metadata": {"raw_prompt": "secret"},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "metadata.raw_prompt is forbidden"):
                run_context_followup_score_batch(
                    input_path=input_path,
                    output_path=output_path,
                )


if __name__ == "__main__":
    unittest.main()
