from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_evals.public_chat_entry_e2e import (
    PublicChatEntryObservation,
    evaluate_public_chat_entry_cases,
    load_public_chat_entry_cases,
    run_public_chat_entry_e2e_profile,
)


class PublicChatEntryE2ESuite(unittest.TestCase):
    def test_public_entry_evaluator_requires_source_url_and_cards_when_expected(self) -> None:
        case_set = load_public_chat_entry_cases()
        case = case_set.cases[0]

        report = evaluate_public_chat_entry_cases(
            case_set.cases,
            {
                case.case_id: PublicChatEntryObservation(
                    case_id=case.case_id,
                    request_id="req_1",
                    trace_id="trace_1",
                    terminal_outcome=case.expected_terminal_outcome,
                    response_contract={"answer_text_present": True},
                    request_path="/api/chat/requests",
                )
            },
        )

        result = report.results[0]
        self.assertFalse(result.passed)
        self.assertEqual(result.failure_class, "response_contract_mismatch")

    def test_profile_writes_public_entry_artifact_from_observations(self) -> None:
        case_set = load_public_chat_entry_cases()
        observations = {
            case.case_id: {
                "request_id": f"req_{case.case_id}",
                "trace_id": f"trace_{case.case_id}",
                "terminal_outcome": case.expected_terminal_outcome,
                "response_contract": case.expected_response_contract,
                "request_path": "/api/chat/requests",
            }
            for case in case_set.cases
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "observations.json"
            observations_path.write_text(
                json.dumps({"observations": observations}, ensure_ascii=False),
                encoding="utf-8",
            )
            report = run_public_chat_entry_e2e_profile(
                output_dir=root / "out",
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["profile_id"], "public_chat_entry_e2e")
        self.assertEqual(payload["summary"]["failed"], 0)


if __name__ == "__main__":
    unittest.main()
