from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

import yaml
from campus_contracts import (
    ALLOWED_CAPABILITY_IDS,
    ALLOWED_CONFIDENCE_LEVELS,
    ALLOWED_EXECUTION_STATUSES,
    ALLOWED_REQUESTED_CAPABILITIES,
)

OPENAPI_PATH = Path("docs/contracts/schemas/capability-execution.openapi.yaml")
CAPABILITY_HANDOFF_SCHEMA_PATH = Path(
    "packages/contracts/schemas/capability-handoff.v1.schema.json"
)
GENERATED_TS_PATH = Path(
    "apps/app-api/src/modules/integration/generated/capability-execution-contract.ts"
)
GENERATED_GO_PATH = Path(
    "apps/execution-control/internal/contracts/capability_execution_contract.go"
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


class CanonicalCapabilityExecutionSchemaTest(unittest.TestCase):
    def test_machine_readable_schema_sources_exist(self) -> None:
        self.assertTrue(OPENAPI_PATH.exists())
        self.assertTrue(CAPABILITY_HANDOFF_SCHEMA_PATH.exists())

    def test_capability_execution_openapi_uses_31_json_schema_2020_12(self) -> None:
        openapi = _load_openapi()

        self.assertEqual(openapi["openapi"], "3.1.1")
        self.assertEqual(
            openapi["jsonSchemaDialect"], "https://json-schema.org/draft/2020-12/schema"
        )
        self.assertEqual(
            openapi["x-campus-contract"]["execution_contract_version"],
            "capability_execution_v1",
        )
        self.assertEqual(
            openapi["x-campus-contract"]["response_contract"],
            "execution_finalization_response_v1",
        )
        self.assertEqual(
            openapi["x-campus-contract"]["runtime_decisions_schema_version"],
            "capability-execution-runtime-decisions-v1",
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
        agent_request = _schema("CapabilityRequest")
        workflow_context = _schema("WorkflowCapabilityContext")

        self.assertEqual(
            agent_request["properties"]["workflow_context"],
            {"$ref": "#/components/schemas/WorkflowCapabilityContext"},
        )
        self.assertIn("schema_version", workflow_context["required"])
        self.assertIn("visibility", workflow_context["required"])
        self.assertIn("workflow_run_ref", workflow_context["required"])
        self.assertIn("step_id", workflow_context["required"])
        self.assertIn("capability_id", workflow_context["required"])
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
            workflow_context["properties"]["capability_id"],
            {"$ref": "#/components/schemas/CapabilityID"},
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
            ("terminal", "single_step", "multi_step"),
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
        self.assertIn("allowed_capabilities", workflow_plan["required"])
        self.assertIn("steps", workflow_plan["required"])
        self.assertIn("semantic_retry_policy", workflow_plan["required"])
        self.assertEqual(
            workflow_plan["properties"]["allowed_capabilities"]["items"],
            {"$ref": "#/components/schemas/CapabilityID"},
        )
        edge = _schema("WorkflowPlanEdge")
        self.assertEqual(
            edge["properties"]["required_projection_kind"],
            {"$ref": "#/components/schemas/StepOutputProjectionKind"},
        )

    def test_active_request_does_not_require_runtime_decisions_or_profile_memory(self) -> None:
        request = _schema("CapabilityExecutionRequest")
        context = _schema("ExecutionRequestContext")

        self.assertNotIn("runtime_decisions", request["required"])
        self.assertEqual(
            request["properties"]["runtime_decisions"]["deprecated"],
            True,
        )
        self.assertEqual(context["not"], {"required": ["profile_memory"]})

    def test_workflow_trace_summary_declares_capability_invocation_graph(self) -> None:
        schema = _schema("WorkflowTraceSummary")

        self.assertIn("capability_invocations", schema["required"])
        self.assertEqual(
            schema["properties"]["capability_invocations"]["items"],
            {"$ref": "#/components/schemas/CapabilityInvocation"},
        )

    def test_contract_versioning_policy_is_declared_in_canonical_schema(self) -> None:
        openapi = _load_openapi()
        policy = openapi["x-campus-contract"]["versioning_policy"]

        self.assertEqual(
            set(policy),
            {
                "execution_contract_version",
                "response_contract",
                "runtime_decisions_schema_version",
                "runtime_decision_summary_schema_version",
                "workflow_trace_summary_version",
            },
        )
        self.assertIn("incompatible", policy["execution_contract_version"])
        self.assertIn("ExecutionFinalizationResponse", policy["response_contract"])
        self.assertIn("runtime_decisions", policy["runtime_decisions_schema_version"])
        self.assertIn("summary", policy["runtime_decision_summary_schema_version"])
        self.assertIn("operator", policy["workflow_trace_summary_version"])

    def test_runtime_enums_match_python_contract_truth(self) -> None:
        execution_statuses = tuple(_schema("ExecutionStatus")["enum"])

        self.assertEqual(tuple(_schema("CapabilityID")["enum"]), ALLOWED_CAPABILITY_IDS)
        self.assertEqual(
            tuple(_schema("RequestedCapability")["enum"]), ALLOWED_REQUESTED_CAPABILITIES
        )
        self.assertEqual(tuple(_schema("ConfidenceLevel")["enum"]), ALLOWED_CONFIDENCE_LEVELS)
        self.assertEqual(execution_statuses, (*ALLOWED_EXECUTION_STATUSES, "cancelled"))

    def test_terminal_execution_response_keeps_selected_capability_nullable(self) -> None:
        selected_capability_schema = _schema("ExecutionFinalizationResponse")["properties"][
            "selected_capability"
        ]

        self.assertIn({"type": "null"}, selected_capability_schema["oneOf"])
        self.assertIn("cancelled", _schema("ExecutionStatus")["enum"])

    def test_capability_handoff_schema_is_package_owned_without_runtime_wrapper_truth(self) -> None:
        schema = json.loads(CAPABILITY_HANDOFF_SCHEMA_PATH.read_text(encoding="utf-8"))

        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertIn("CapabilityRequest", schema["$defs"])
        self.assertIn("CapabilityResponse", schema["$defs"])
        serialized = json.dumps(schema, ensure_ascii=True)
        self.assertNotIn("runtime_decisions", serialized)
        self.assertNotIn("capability_execution_v1", serialized)

    def test_cross_language_generated_artifacts_are_present(self) -> None:
        for path, marker in (
            (GENERATED_TS_PATH, "AUTO-GENERATED FROM capability-execution.openapi.yaml"),
            (GENERATED_GO_PATH, "AUTO-GENERATED FROM capability-execution.openapi.yaml"),
        ):
            with self.subTest(path=str(path)):
                self.assertTrue(path.exists())
                self.assertIn(marker, path.read_text(encoding="utf-8"))

    def test_workflow_trace_summary_is_generated_as_typed_wire_in_active_artifacts(self) -> None:
        ts_contract = GENERATED_TS_PATH.read_text(encoding="utf-8")
        go_contract = GENERATED_GO_PATH.read_text(encoding="utf-8")

        self.assertIn("interface CapabilityExecutionWorkflowTraceSummaryWire", ts_contract)
        self.assertIn("export type WorkflowMode = (typeof WORKFLOW_MODES)[number];", ts_contract)
        self.assertIn("workflow_mode: WorkflowMode;", ts_contract)
        self.assertIn(
            "workflow_trace_summary?: CapabilityExecutionWorkflowTraceSummaryWire | null",
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

    def test_cross_language_generated_artifacts_are_in_sync(self) -> None:
        completed = subprocess.run(
            [
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "scripts.generate_capability_execution_contracts",
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
