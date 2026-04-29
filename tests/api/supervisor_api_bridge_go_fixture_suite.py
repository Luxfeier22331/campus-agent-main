from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_supervisor_agent_worker.bridge_v6_parser import parse_bridge_supervisor_envelope


class SupervisorApiBridgeGoFixtureTest(unittest.TestCase):
    def test_bridge_v6_parser_accepts_go_runtime_handoff_fixture(self) -> None:
        fixture_path = Path("tests/fixtures/supervisor_bridge_v6_go_handoff.json")
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))

        envelope = parse_bridge_supervisor_envelope(payload)

        runtime_decisions = payload["runtime_decisions"]
        self.assertEqual(runtime_decisions["schema_version"], "supervisor-runtime-decisions-v1")
        self.assertEqual(
            runtime_decisions["runtime_decision_summary"]["schema_version"],
            "runtime-decision-summary-v1",
        )
        self.assertEqual(envelope.request.request_id, "req-go-fixture-001")
        self.assertIsNotNone(envelope.agent_request)
        assert envelope.agent_request is not None
        self.assertEqual(envelope.agent_request.target, "rag-agent")
        self.assertIsNotNone(envelope.routing_frame)
        assert envelope.routing_frame is not None
        self.assertEqual(envelope.routing_frame["classifier_version"], "go-runtime-policy-v2")

    def test_bridge_v6_parser_rejects_runtime_decisions_without_schema_version(self) -> None:
        fixture_path = Path("tests/fixtures/supervisor_bridge_v6_go_handoff.json")
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        payload["runtime_decisions"].pop("schema_version", None)

        with self.assertRaisesRegex(ValueError, "runtime_decisions.schema_version"):
            parse_bridge_supervisor_envelope(payload)


if __name__ == "__main__":
    unittest.main()
