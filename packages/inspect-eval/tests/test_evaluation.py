import json
import tempfile
import unittest
from pathlib import Path

from campus_inspect_eval.dataset import read_cases, saved_dataset
from campus_inspect_eval.scorers import deterministic_checks, semantic_items


class DatasetTest(unittest.TestCase):
    def test_all_checked_in_cases_keep_setup_turns(self):
        cases = read_cases(str(Path(__file__).parents[1] / "assets/cases.v1.json"))
        self.assertEqual(len(cases), 16)
        case = next(c for c in cases if c["case_id"] == "routing-six-turn-context")
        self.assertEqual(len(case["turns"]), 7)

    def test_old_target_only_result_is_not_a_complete_conversation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            path.write_text(
                json.dumps(
                    {
                        "schema_version": "agent_product_eval_result.v3",
                        "items": [
                            {
                                "case": {
                                    "case_id": "one",
                                    "query": "今年呢",
                                    "setup_turns": ["去年呢"],
                                },
                                "answer": "回答",
                                "request_id": "r1",
                            }
                        ],
                    }
                )
            )
            sample = saved_dataset(str(path))[0]
            session = json.loads(sample.input)["session"]
            self.assertFalse(session["complete"])
            self.assertEqual(session["turns"][0]["turn_id"], "turn-02")
            self.assertNotIn("session", sample.metadata)

    def test_missing_semantic_inputs_are_not_scored(self):
        session = {
            "complete": False,
            "turns": [
                {
                    "turn_id": "t1",
                    "answer": "回答",
                    "user_prompt": "问题",
                    "stages": [{"step_id": "solve.initial"}],
                }
            ],
        }
        items = semantic_items({}, session)
        self.assertIsNone(items[0][2])
        self.assertIsNone(next(x[2] for x in items if x[1] == "stage.decision"))

    def test_successful_answer_does_not_hide_failed_attempt(self):
        turn = {
            "turn_id": "t1",
            "status": "completed",
            "answer": "答案",
            "stages": [
                {
                    "step_id": "task.step.1",
                    "status": "completed",
                    "attempts": [
                        {"attempt_id": "a1", "status": "failed"},
                        {"attempt_id": "a2", "status": "completed"},
                    ],
                }
            ],
        }
        checks = deterministic_checks({}, {"turns": [turn]})
        self.assertEqual(
            next(c for c in checks if c.get("attempt_id") == "a1")["status"], "scored_fail"
        )

    def test_counts_and_timing_require_case_expectations(self):
        turn = {
            "turn_id": "t",
            "status": "completed",
            "answer": "a",
            "tool_trajectory": {"tool_calls": [{"tool_name": "campus_search"}]},
            "timing": {},
        }
        plain = deterministic_checks({}, {"turns": [turn]})
        self.assertFalse(any(c["name"].startswith("tool.count") for c in plain))
        strict = deterministic_checks(
            {"expectations": {"max_tool_calls": {"campus_search": 0}, "max_total_ms": 100}},
            {"turns": [turn]},
        )
        self.assertEqual(
            next(c for c in strict if c["name"] == "latency.total")["status"],
            "unscored_missing_input",
        )
        self.assertEqual(
            next(c for c in strict if c["name"].startswith("tool.count"))["status"], "scored_fail"
        )
