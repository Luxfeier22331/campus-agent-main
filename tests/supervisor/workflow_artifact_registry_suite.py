from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_REGISTRY_PATH = ROOT / "configs/runtime/workflow-artifacts.v1.json"
AGENT_SPEC_PATH = ROOT / "configs/runtime/agents.v1.json"
GO_EXECUTION_PROJECTION_PATH = (
    ROOT / "apps/supervisor-api/internal/execution/step_output_projection.go"
)
OPENAPI_CONTRACT_PATH = ROOT / "docs/contracts/schemas/supervisor-execution.openapi.yaml"

EXPECTED_ARTIFACT_KINDS = (
    "notice_context",
    "notice_change_set",
    "schedule_baseline",
    "service_status_facts",
    "service_guide_facts",
    "contact_directory_facts",
    "academic_calendar_facts",
    "place_context",
    "evidence_bundle",
    "grounding_verdict",
)
SUPPORTED_GO_RUNTIME_KINDS = (
    "notice_context",
    "notice_change_set",
    "schedule_baseline",
    "evidence_bundle",
    "grounding_verdict",
)
CONTRACT_ONLY_KINDS = ("service_guide_facts", "place_context")
PLANNED_CONTRACT_GAP_KINDS = (
    "service_status_facts",
    "contact_directory_facts",
    "academic_calendar_facts",
)
BASELINE_FORBIDDEN_RAW_TOKENS = (
    "raw_prompt",
    "raw_transcript",
    "provider_raw_response",
    "raw_response",
    "raw_sql",
    "object_locator",
    "retrieval_backend_dump",
)


class WorkflowArtifactRegistrySuite(unittest.TestCase):
    def test_artifact_registry_freezes_initial_ontology(self) -> None:
        registry = _load_registry()
        artifacts = registry["artifacts"]

        self.assertEqual(registry["schema_version"], "workflow-artifact-registry-v1")
        self.assertEqual(tuple(item["kind"] for item in artifacts), EXPECTED_ARTIFACT_KINDS)
        self.assertEqual(
            {
                item["kind"]
                for item in artifacts
                if item["current_projection_support"] == "supported_go_runtime"
            },
            set(SUPPORTED_GO_RUNTIME_KINDS),
        )
        self.assertEqual(
            {
                item["kind"]
                for item in artifacts
                if item["current_projection_support"] == "contract_only"
            },
            set(CONTRACT_ONLY_KINDS),
        )
        self.assertEqual(
            {
                item["kind"]
                for item in artifacts
                if item["current_projection_support"] == "planned_contract_gap"
            },
            set(PLANNED_CONTRACT_GAP_KINDS),
        )

    def test_supported_runtime_artifacts_match_go_projection_kinds(self) -> None:
        go_text = GO_EXECUTION_PROJECTION_PATH.read_text(encoding="utf-8")
        go_kinds = set(
            re.findall(r'ProjectionKind[A-Za-z]+\s+ProjectionKind\s+=\s+"([^"]+)"', go_text)
        )

        self.assertEqual(go_kinds, set(SUPPORTED_GO_RUNTIME_KINDS))

    def test_contract_only_artifacts_are_shared_contract_enum_but_not_runtime_supported(
        self,
    ) -> None:
        contract_text = OPENAPI_CONTRACT_PATH.read_text(encoding="utf-8")
        runtime_kinds = set(SUPPORTED_GO_RUNTIME_KINDS)

        for kind in CONTRACT_ONLY_KINDS:
            with self.subTest(kind=kind):
                self.assertIn(f"- {kind}", contract_text)
                self.assertNotIn(kind, runtime_kinds)

    def test_planned_gap_artifacts_are_not_silently_in_contract_or_runtime(self) -> None:
        contract_text = OPENAPI_CONTRACT_PATH.read_text(encoding="utf-8")
        go_text = GO_EXECUTION_PROJECTION_PATH.read_text(encoding="utf-8")

        for kind in PLANNED_CONTRACT_GAP_KINDS:
            with self.subTest(kind=kind):
                self.assertNotIn(f"- {kind}", contract_text)
                self.assertNotIn(f'"{kind}"', go_text)

    def test_agent_spec_context_projection_kinds_are_registered_or_explicit_aliases(self) -> None:
        registry = _load_registry()
        artifacts = registry["artifacts"]
        artifact_kinds = {item["kind"] for item in artifacts}
        aliases = {alias for item in artifacts for alias in item.get("known_aliases", [])}
        agent_spec = json.loads(AGENT_SPEC_PATH.read_text(encoding="utf-8"))

        observed = {
            kind
            for agent in agent_spec["agents"]
            for kind in agent.get("context_projection_kinds", [])
        }

        self.assertTrue(observed)
        self.assertEqual(observed - artifact_kinds - aliases, set())
        self.assertIn("calendar_fact", aliases)

    def test_registry_forbids_raw_payload_key_families(self) -> None:
        registry = _load_registry()
        global_tokens = set(registry["forbidden_raw_key_tokens"])

        for token in BASELINE_FORBIDDEN_RAW_TOKENS:
            self.assertIn(token, global_tokens)
        for artifact in registry["artifacts"]:
            with self.subTest(kind=artifact["kind"]):
                artifact_tokens = set(artifact["forbidden_raw_payload_keys"])
                self.assertTrue(artifact_tokens <= global_tokens)
                self.assertNotIn("raw_response", artifact["kind"])

    def test_grounding_verdict_is_not_answer_bearing_evidence(self) -> None:
        artifacts = {item["kind"]: item for item in _load_registry()["artifacts"]}

        self.assertFalse(artifacts["grounding_verdict"]["answer_eligible"])
        self.assertTrue(artifacts["evidence_bundle"]["answer_eligible"])
        self.assertTrue(artifacts["notice_context"]["requires_grounding"])


def _load_registry() -> dict[str, object]:
    payload = json.loads(ARTIFACT_REGISTRY_PATH.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


if __name__ == "__main__":
    unittest.main()
