from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_supervisor_agent_worker.agent_spec_registry import load_agent_spec_registry
from campus_supervisor_agent_worker.tool_spec_registry import load_tool_spec_registry
from campus_supervisor_agent_worker.workflow_artifact_registry import (
    WorkflowArtifactRegistryError,
    load_workflow_artifact_registry,
    validate_agent_projection_kinds_against_artifacts,
    validate_capability_bindings,
    validate_tool_producers_against_artifacts,
)


class WorkflowArtifactRegistryLoaderSuite(unittest.TestCase):
    def test_loads_default_registry_and_calendar_alias(self) -> None:
        registry = load_workflow_artifact_registry()

        self.assertEqual(registry.schema_version, "workflow-artifact-registry-v1")
        self.assertIsNotNone(registry.artifact_by_kind("academic_calendar_facts"))
        alias = registry.artifact_by_kind("calendar_fact")
        self.assertIsNotNone(alias)
        assert alias is not None
        self.assertEqual(alias.kind, "academic_calendar_facts")
        grounding = registry.artifact_by_kind("grounding_verdict")
        self.assertIsNotNone(grounding)
        assert grounding is not None
        self.assertFalse(grounding.answer_eligible)

    def test_agent_spec_projection_kinds_are_registered_artifacts(self) -> None:
        validate_agent_projection_kinds_against_artifacts(
            load_agent_spec_registry(),
            load_workflow_artifact_registry(),
        )

    def test_tool_spec_producer_tools_are_registered_artifacts(self) -> None:
        validate_tool_producers_against_artifacts(
            load_tool_spec_registry(),
            load_workflow_artifact_registry(),
        )

    def test_capability_bindings_validate_against_runtime_registries(self) -> None:
        validate_capability_bindings(
            load_agent_spec_registry(),
            load_tool_spec_registry(),
            load_workflow_artifact_registry(),
        )

    def test_rejects_unknown_artifact_alias(self) -> None:
        payload = _minimal_registry()
        payload["artifacts"].append({**payload["artifacts"][0], "kind": "other_artifact"})
        payload["artifacts"][1]["known_aliases"] = ["calendar_fact"]
        payload["artifacts"][0]["known_aliases"] = ["calendar_fact"]

        with self.assertRaisesRegex(WorkflowArtifactRegistryError, "alias calendar_fact"):
            load_workflow_artifact_registry(_write_registry(payload))

    def test_rejects_artifact_raw_key_outside_global_guard(self) -> None:
        payload = _minimal_registry()
        payload["artifacts"][0]["forbidden_raw_payload_keys"] = ["raw_database_dump"]

        with self.assertRaisesRegex(WorkflowArtifactRegistryError, "outside global tokens"):
            load_workflow_artifact_registry(_write_registry(payload))

    def test_rejects_open_binding_without_registered_tool(self) -> None:
        payload = _minimal_registry()
        payload["bindings"] = [
            {
                "binding_id": "sample.open.without.tool",
                "owner_agent": "rag-agent",
                "tool_name": "",
                "produces": ["sample_artifact"],
                "consumes": [],
                "required_inputs": ["request:user_query"],
                "state_changing": False,
                "opening_gate": "open",
                "eval_denominator": ["workflow_trace"],
                "priority": 1,
                "notes": "fixture",
            }
        ]

        with self.assertRaisesRegex(
            WorkflowArtifactRegistryError, "open binding must declare tool_name"
        ):
            validate_capability_bindings(
                load_agent_spec_registry(),
                load_tool_spec_registry(),
                load_workflow_artifact_registry(_write_registry(payload)),
            )

    def test_rejects_ambiguous_open_bindings_without_distinct_priority(self) -> None:
        payload = _minimal_registry()
        payload["bindings"] = [
            {
                "binding_id": "sample.binding.a",
                "owner_agent": "rag-agent",
                "tool_name": "retrieval.query",
                "produces": ["sample_artifact"],
                "consumes": [],
                "required_inputs": ["request:user_query"],
                "state_changing": False,
                "opening_gate": "open",
                "eval_denominator": ["workflow_trace"],
                "priority": 1,
                "notes": "fixture",
            },
            {
                "binding_id": "sample.binding.b",
                "owner_agent": "rag-agent",
                "tool_name": "retrieval.query",
                "produces": ["sample_artifact"],
                "consumes": [],
                "required_inputs": ["request:user_query"],
                "state_changing": False,
                "opening_gate": "open",
                "eval_denominator": ["workflow_trace"],
                "priority": 1,
                "notes": "fixture",
            },
        ]

        with self.assertRaisesRegex(
            WorkflowArtifactRegistryError, "ambiguous open producer bindings"
        ):
            validate_capability_bindings(
                load_agent_spec_registry(),
                load_tool_spec_registry(),
                load_workflow_artifact_registry(_write_registry(payload)),
            )


def _minimal_registry() -> dict[str, object]:
    return {
        "schema_version": "workflow-artifact-registry-v1",
        "registry_version": "test",
        "visibility_values": ["agent_private"],
        "support_status_values": ["planned_contract_gap"],
        "forbidden_raw_key_tokens": ["raw_response"],
        "artifacts": [
            {
                "kind": "sample_artifact",
                "display_name": "SampleArtifact",
                "owner_agent": "rag-agent",
                "producer_tools": [],
                "source_truth_owner": "test",
                "visibility": "agent_private",
                "current_projection_support": "planned_contract_gap",
                "answer_eligible": True,
                "requires_grounding": False,
                "freshness_policy": "test",
                "allowed_consumers": ["supervisor-api-finalizer"],
                "known_aliases": [],
                "forbidden_raw_payload_keys": ["raw_response"],
                "notes": "fixture",
            }
        ],
        "bindings": [
            {
                "binding_id": "sample.binding.closed",
                "owner_agent": "rag-agent",
                "tool_name": "",
                "produces": ["sample_artifact"],
                "consumes": [],
                "required_inputs": ["request:user_query"],
                "state_changing": False,
                "opening_gate": "closed",
                "eval_denominator": ["workflow_trace"],
                "priority": 1,
                "notes": "fixture",
            }
        ],
    }


def _write_registry(payload: dict[str, object]) -> Path:
    temp_dir = Path(tempfile.mkdtemp(prefix="workflow-artifacts-"))
    path = temp_dir / "workflow-artifacts.v1.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


if __name__ == "__main__":
    unittest.main()
