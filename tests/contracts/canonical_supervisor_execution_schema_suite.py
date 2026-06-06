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
GENERATED_GO_PATH = Path(
    "apps/execution-gateway/internal/contracts/supervisor_execution_contract.go"
)
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
            "workflow-trace-summary-v4",
        )

    def test_workflow_trace_summary_declares_workflow_mode_and_handoff_chain(self) -> None:
        schema = _schema("WorkflowTraceSummary")

        self.assertIn("workflow_mode", schema["required"])
        self.assertIn("handoff_chain", schema["required"])
        self.assertIn("context_projections", schema["required"])
        self.assertIn("answer_artifact_projection_ids", schema["required"])
        self.assertIn("answer_artifact_kinds", schema["required"])
        self.assertEqual(
            schema["properties"]["workflow_mode"],
            {"$ref": "#/components/schemas/WorkflowMode"},
        )
        self.assertEqual(schema["properties"]["handoff_chain"]["type"], "array")
        self.assertEqual(
            schema["properties"]["context_projections"]["items"],
            {"$ref": "#/components/schemas/WorkflowContextProjection"},
        )
        self.assertEqual(schema["properties"]["answer_artifact_projection_ids"]["type"], "array")
        self.assertEqual(schema["properties"]["answer_artifact_kinds"]["type"], "array")

    def test_step_output_projection_schema_is_canonical(self) -> None:
        projection = _schema("StepOutputProjection")
        context_projection = _schema("WorkflowContextProjection")

        self.assertEqual(
            _schema("StepOutputProjectionKind")["enum"],
            [
                "notice_context",
                "notice_change_set",
                "schedule_baseline",
                "service_guide_facts",
                "place_context",
                "evidence_bundle",
                "grounding_verdict",
            ],
        )
        self.assertIn("projection_id", projection["required"])
        self.assertIn("projection_kind", projection["required"])
        self.assertIn("content_hash", projection["required"])
        self.assertIn("safety", projection["required"])
        self.assertEqual(
            projection["properties"]["projection_kind"],
            {"$ref": "#/components/schemas/StepOutputProjectionKind"},
        )
        self.assertEqual(
            context_projection["properties"]["projection_kind"],
            {"$ref": "#/components/schemas/StepOutputProjectionKind"},
        )

    def test_agent_request_declares_workflow_context_projection_envelope(self) -> None:
        agent_request = _schema("AgentRequest")
        workflow_context = _schema("WorkflowAgentContext")

        self.assertEqual(
            agent_request["properties"]["workflow_context"],
            {"$ref": "#/components/schemas/WorkflowAgentContext"},
        )
        self.assertIn("schema_version", workflow_context["required"])
        self.assertIn("visibility", workflow_context["required"])
        self.assertIn("workflow_run_ref", workflow_context["required"])
        self.assertIn("step_id", workflow_context["required"])
        self.assertIn("agent_id", workflow_context["required"])
        self.assertIn("expected_output_artifacts", workflow_context["required"])
        self.assertIn("projection_refs", workflow_context["required"])
        self.assertEqual(
            workflow_context["properties"]["workflow_run_ref"],
            {"type": "string"},
        )
        self.assertEqual(
            workflow_context["properties"]["step_id"],
            {"type": "string"},
        )
        self.assertEqual(
            workflow_context["properties"]["agent_id"],
            {"$ref": "#/components/schemas/AgentTarget"},
        )
        self.assertEqual(
            workflow_context["properties"]["expected_output_artifacts"]["items"],
            {"$ref": "#/components/schemas/StepOutputProjectionKind"},
        )
        self.assertEqual(
            workflow_context["properties"]["projection_refs"]["items"],
            {"$ref": "#/components/schemas/WorkflowContextProjection"},
        )

    def test_workflow_mode_is_canonical_cross_language_enum(self) -> None:
        workflow_modes = tuple(_schema("WorkflowMode")["enum"])

        self.assertEqual(
            workflow_modes,
            ("terminal", "direct_runtime", "single_handoff", "multi_step"),
        )

    def test_runtime_decisions_declares_canonical_workflow_plan_projection(self) -> None:
        runtime_decisions = _schema("RuntimeDecisions")
        workflow_plan = _schema("WorkflowPlan")

        self.assertEqual(
            runtime_decisions["properties"]["workflow_plan"],
            {"$ref": "#/components/schemas/WorkflowPlan"},
        )
        self.assertEqual(workflow_plan["properties"]["schema_version"]["const"], "workflow-plan-v1")
        self.assertEqual(
            workflow_plan["properties"]["workflow_mode"],
            {"$ref": "#/components/schemas/WorkflowMode"},
        )
        self.assertIn("allowed_agents", workflow_plan["required"])
        self.assertIn("steps", workflow_plan["required"])
        self.assertIn("semantic_retry_policy", workflow_plan["required"])
        self.assertEqual(
            workflow_plan["properties"]["allowed_agents"]["items"],
            {"$ref": "#/components/schemas/AgentTarget"},
        )
        edge = _schema("WorkflowPlanEdge")
        self.assertEqual(
            edge["properties"]["required_projection_kind"],
            {"$ref": "#/components/schemas/StepOutputProjectionKind"},
        )

    def test_workflow_trace_summary_declares_agent_invocation_graph(self) -> None:
        schema = _schema("WorkflowTraceSummary")

        self.assertIn("agent_invocations", schema["required"])
        self.assertEqual(
            schema["properties"]["agent_invocations"]["items"],
            {"$ref": "#/components/schemas/AgentInvocation"},
        )

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

    def test_workflow_trace_summary_is_generated_as_typed_wire_in_all_languages(self) -> None:
        ts_contract = GENERATED_TS_PATH.read_text(encoding="utf-8")
        go_contract = GENERATED_GO_PATH.read_text(encoding="utf-8")
        py_contract = GENERATED_PY_PATH.read_text(encoding="utf-8")

        self.assertIn("interface SupervisorExecutionWorkflowTraceSummaryWire", ts_contract)
        self.assertIn("export type WorkflowMode = (typeof WORKFLOW_MODES)[number];", ts_contract)
        self.assertIn("workflow_mode: WorkflowMode;", ts_contract)
        self.assertIn(
            "workflow_trace_summary?: SupervisorExecutionWorkflowTraceSummaryWire | null",
            ts_contract,
        )
        self.assertIn("type WorkflowMode string", go_contract)
        self.assertRegex(
            go_contract,
            r"WorkflowMode\s+WorkflowMode\s+`json:\"workflow_mode\"`",
        )
        self.assertIn("type WorkflowTraceSummaryWire struct", go_contract)
        self.assertIn(
            'WorkflowTraceSummary *WorkflowTraceSummaryWire `json:"workflow_trace_summary,omitempty"`',
            go_contract,
        )
        self.assertIn("WorkflowMode = Literal[", py_contract)
        self.assertIn("workflow_mode: WorkflowMode", py_contract)
        self.assertIn("class WorkflowTraceSummaryWire(BaseModel):", py_contract)
        self.assertIn(
            "workflow_trace_summary: WorkflowTraceSummaryWire | None = None",
            py_contract,
        )

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
