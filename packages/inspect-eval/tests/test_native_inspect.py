"""Run the real Inspect engine with a mock product transport, never a provider."""

import json
import tempfile
import unittest
from pathlib import Path

from campus_inspect_eval import tasks
from campus_inspect_eval.reports import report_log
from campus_inspect_eval.scorers import process_contract
from inspect_ai import eval as inspect_eval
from inspect_ai import score
from inspect_ai.log import read_eval_log


class NativeInspectTest(unittest.TestCase):
    def test_saved_log_can_be_rescored_without_product(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "saved.json"
            path.write_text(
                json.dumps(
                    {
                        "schema_version": "agent_eval_sessions.v1",
                        "items": [
                            {
                                "case": {
                                    "case_id": "saved",
                                    "turns": [{"turn_id": "t1", "prompt": "问题"}],
                                },
                                "session": {
                                    "complete": True,
                                    "expected_turns": 1,
                                    "turns": [
                                        {
                                            "turn_id": "t1",
                                            "user_prompt": "问题",
                                            "answer": "答案",
                                            "status": "completed",
                                            "stages": [
                                                {
                                                    "step_id": "solve.initial",
                                                    "status": "completed",
                                                    "attempts": [
                                                        {"attempt_id": "a1", "status": "failed"},
                                                        {"attempt_id": "a2", "status": "completed"},
                                                    ],
                                                }
                                            ],
                                        }
                                    ],
                                },
                            }
                        ],
                    }
                )
            )
            logs = inspect_eval(
                f"{tasks.__file__}@offline",
                task_args={"input": str(path)},
                model="mockllm/model",
                log_dir=directory,
                display="none",
            )
            self.assertEqual(logs[0].status, "success", logs[0].error)
            log = read_eval_log(logs[0].location)
            self.assertIsNone(log.samples[0].error)
            self.assertEqual(log.samples[0].store["session"]["turns"][0]["answer"], "答案")
            rescored = score(log, process_contract(), display="none")
            self.assertEqual(rescored.samples[0].scores["process_contract"].value, "I")
            report = report_log(logs[0].location)
            self.assertEqual(report["by_dimension"]["attempt.completed"]["pass_rate"], 0.5)
            self.assertTrue(
                any(
                    c.get("attempt_id") == "a1" and c["status"] == "scored_fail"
                    for c in report["samples"][0]["findings"]
                )
            )
