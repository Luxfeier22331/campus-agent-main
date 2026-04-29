from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_supervisor_agent_worker.bridge_v6_parser import parse_bridge_supervisor_envelope
from campus_supervisor_agent_worker.generated.supervisor_execution_contract import (
    BridgeV6RequestWire,
    SupervisorResponseWire,
)

FIXTURE_DIR = Path("tests/fixtures/supervisor_execution_contract")


def load_fixture(name: str) -> dict[str, object]:
    payload = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{name} must contain a JSON object")
    return payload


class SupervisorExecutionFixtureMatrixTest(unittest.TestCase):
    def test_python_bridge_accepts_canonical_delegate_fixture(self) -> None:
        payload = load_fixture("bridge_v6_delegate.valid.json")

        wire = BridgeV6RequestWire.model_validate(payload)
        envelope = parse_bridge_supervisor_envelope(payload)

        self.assertEqual(wire.bridge_version, "supervisor_bridge_v6")
        self.assertEqual(wire.runtime_decisions.schema_version, "supervisor-runtime-decisions-v1")
        self.assertEqual(envelope.request.request_id, "req-contract-001")
        self.assertIsNotNone(envelope.agent_request)
        assert envelope.agent_request is not None
        self.assertEqual(envelope.agent_request.target, "rag-agent")

    def test_python_bridge_rejects_invalid_bridge_fixtures(self) -> None:
        for fixture_name in (
            "bridge_v6_extra_field.invalid.json",
            "bridge_v6_invalid_enum.invalid.json",
            "bridge_v6_invalid_version.invalid.json",
        ):
            with self.subTest(fixture_name=fixture_name), self.assertRaises(ValueError):
                parse_bridge_supervisor_envelope(load_fixture(fixture_name))

    def test_python_response_model_accepts_terminal_state_fixtures(self) -> None:
        expected_status_by_fixture = {
            "response_cancelled_null_target.valid.json": "cancelled",
            "response_completed_delegate.valid.json": "completed",
            "response_error_bridge_unavailable.valid.json": "error",
            "response_timeout.valid.json": "error",
        }

        for fixture_name, expected_status in expected_status_by_fixture.items():
            with self.subTest(fixture_name=fixture_name):
                response = SupervisorResponseWire.model_validate(load_fixture(fixture_name))

                self.assertEqual(response.status, expected_status)
                self.assertTrue(response.trace_id.startswith("trace-contract-"))

    def test_python_response_model_rejects_non_canonical_response_fixtures(self) -> None:
        for fixture_name in (
            "response_camel_case.invalid.json",
            "response_extra_field.invalid.json",
        ):
            with self.subTest(fixture_name=fixture_name), self.assertRaises(ValueError):
                SupervisorResponseWire.model_validate(load_fixture(fixture_name))


if __name__ == "__main__":
    unittest.main()
