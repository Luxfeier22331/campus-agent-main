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

        self.assertEqual(envelope.request.request_id, "req-go-fixture-001")
        self.assertIsNotNone(envelope.agent_request)
        assert envelope.agent_request is not None
        self.assertEqual(envelope.agent_request.target, "rag-agent")
        self.assertIsNotNone(envelope.routing_frame)
        assert envelope.routing_frame is not None
        self.assertEqual(envelope.routing_frame["classifier_version"], "go-runtime-policy-v2")


if __name__ == "__main__":
    unittest.main()
