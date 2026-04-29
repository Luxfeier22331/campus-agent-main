from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

import yaml
from campus_contracts import (
    ALLOWED_AGENT_TARGETS,
    ALLOWED_CONFIDENCE_LEVELS,
    ALLOWED_REQUESTED_CAPABILITIES,
    ALLOWED_SUPERVISOR_STATUSES,
)

OPENAPI_PATH = Path("docs/contracts/schemas/supervisor-execution.openapi.yaml")
AGENT_HANDOFF_SCHEMA_PATH = Path("packages/contracts/schemas/agent-handoff.v1.schema.json")
GENERATED_TS_PATH = Path(
    "apps/app-api/src/modules/integration/generated/supervisor-execution-contract.ts"
)
GENERATED_GO_PATH = Path("apps/supervisor-api/internal/contracts/supervisor_execution_contract.go")
GENERATED_PY_PATH = Path(
    "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated/"
    "supervisor_execution_contract.py"
)


def _load_openapi() -> dict[str, object]:
    return yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))


def _schema(name: str) -> dict[str, object]:
    openapi = _load_openapi()
    components = openapi["components"]
    assert isinstance(components, dict)
    schemas = components["schemas"]
    assert isinstance(schemas, dict)
    schema = schemas[name]
    assert isinstance(schema, dict)
    return schema


class CanonicalSupervisorExecutionSchemaTest(unittest.TestCase):
    def test_machine_readable_schema_sources_exist(self) -> None:
        self.assertTrue(OPENAPI_PATH.exists())
        self.assertTrue(AGENT_HANDOFF_SCHEMA_PATH.exists())

    def test_supervisor_execution_openapi_uses_31_json_schema_2020_12(self) -> None:
        openapi = _load_openapi()

        self.assertEqual(openapi["openapi"], "3.1.1")
        self.assertEqual(
            openapi["jsonSchemaDialect"], "https://json-schema.org/draft/2020-12/schema"
        )
        self.assertEqual(openapi["x-campus-contract"]["bridge_version"], "supervisor_bridge_v6")
        self.assertEqual(openapi["x-campus-contract"]["response_contract"], "agent_response")
        self.assertEqual(
            openapi["x-campus-contract"]["runtime_decisions_schema_version"],
            "supervisor-runtime-decisions-v1",
        )
        self.assertEqual(
            openapi["x-campus-contract"]["runtime_decision_summary_schema_version"],
            "runtime-decision-summary-v1",
        )
        self.assertEqual(
            openapi["x-campus-contract"]["workflow_trace_summary_version"],
            "workflow-trace-summary-v2",
        )

    def test_workflow_trace_summary_declares_workflow_mode_and_handoff_chain(self) -> None:
        schema = _schema("WorkflowTraceSummary")

        self.assertIn("workflow_mode", schema["required"])
        self.assertIn("handoff_chain", schema["required"])
        self.assertEqual(schema["properties"]["workflow_mode"]["type"], "string")
        self.assertEqual(schema["properties"]["handoff_chain"]["type"], "array")

    def test_contract_versioning_policy_is_declared_in_canonical_schema(self) -> None:
        openapi = _load_openapi()
        policy = openapi["x-campus-contract"]["versioning_policy"]

        self.assertEqual(
            set(policy),
            {
                "bridge_version",
                "response_contract",
                "runtime_decisions_schema_version",
                "runtime_decision_summary_schema_version",
                "workflow_trace_summary_version",
            },
        )
        self.assertIn("incompatible", policy["bridge_version"])
        self.assertIn("AgentResponse", policy["response_contract"])
        self.assertIn("runtime_decisions", policy["runtime_decisions_schema_version"])
        self.assertIn("summary", policy["runtime_decision_summary_schema_version"])
        self.assertIn("operator", policy["workflow_trace_summary_version"])

    def test_runtime_enums_match_python_contract_truth(self) -> None:
        supervisor_statuses = tuple(_schema("SupervisorStatus")["enum"])

        self.assertEqual(tuple(_schema("AgentTarget")["enum"]), ALLOWED_AGENT_TARGETS)
        self.assertEqual(
            tuple(_schema("RequestedCapability")["enum"]), ALLOWED_REQUESTED_CAPABILITIES
        )
        self.assertEqual(tuple(_schema("ConfidenceLevel")["enum"]), ALLOWED_CONFIDENCE_LEVELS)
        self.assertEqual(supervisor_statuses, (*ALLOWED_SUPERVISOR_STATUSES, "cancelled"))

    def test_terminal_supervisor_response_keeps_selected_target_nullable(self) -> None:
        selected_target_schema = _schema("SupervisorResponse")["properties"]["selected_target"]

        self.assertIn({"type": "null"}, selected_target_schema["oneOf"])
        self.assertIn("cancelled", _schema("SupervisorStatus")["enum"])

    def test_agent_handoff_schema_is_package_owned_without_runtime_wrapper_truth(self) -> None:
        schema = json.loads(AGENT_HANDOFF_SCHEMA_PATH.read_text(encoding="utf-8"))

        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertIn("AgentRequest", schema["$defs"])
        self.assertIn("AgentResponse", schema["$defs"])
        serialized = json.dumps(schema, ensure_ascii=True)
        self.assertNotIn("runtime_decisions", serialized)
        self.assertNotIn("supervisor_bridge_v6", serialized)

    def test_cross_language_generated_artifacts_are_present(self) -> None:
        for path, marker in (
            (GENERATED_TS_PATH, "AUTO-GENERATED FROM supervisor-execution.openapi.yaml"),
            (GENERATED_GO_PATH, "AUTO-GENERATED FROM supervisor-execution.openapi.yaml"),
            (GENERATED_PY_PATH, "AUTO-GENERATED FROM supervisor-execution.openapi.yaml"),
        ):
            with self.subTest(path=str(path)):
                self.assertTrue(path.exists())
                self.assertIn(marker, path.read_text(encoding="utf-8"))

    def test_cross_language_generated_artifacts_are_in_sync(self) -> None:
        completed = subprocess.run(
            [
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "scripts.generate_supervisor_execution_contracts",
                "--check",
            ],
            check=False,
            cwd=Path.cwd(),
            text=True,
            capture_output=True,
        )

        self.assertEqual(
            completed.returncode,
            0,
            completed.stdout + completed.stderr,
        )


if __name__ == "__main__":
    unittest.main()
