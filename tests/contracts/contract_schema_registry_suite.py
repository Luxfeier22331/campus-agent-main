from __future__ import annotations

import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

from scripts import check_contract_schemas


class ContractSchemaRegistryTest(unittest.TestCase):
    def test_contract_schema_registry_check_passes(self) -> None:
        check_contract_schemas.main([])

    def test_campus_services_result_fixture_matrix_has_positive_and_negative_cases(
        self,
    ) -> None:
        fixture_dir = Path("packages/contracts/fixtures/campus_services_tool_result")

        self.assertGreaterEqual(len(tuple(fixture_dir.glob("*.valid.json"))), 2)
        self.assertGreaterEqual(len(tuple(fixture_dir.glob("*.invalid.json"))), 5)

    def test_registry_covers_runtime_and_ingestion_artifacts(self) -> None:
        registry = json.loads(
            Path("packages/contracts/schemas/contract-schema-registry.v1.json").read_text(
                encoding="utf-8"
            )
        )
        entries = {entry["id"]: entry for entry in registry["entries"]}

        expected_validates = {
            "runtime-tools.v4": ["configs/runtime/tools.v4.json"],
            "execution-control-runtime-profile.v1": [
                "configs/runtime/execution-control/runtime-profile.local.json",
                "configs/runtime/execution-control/runtime-profile.local-real-provider.json",
                "configs/runtime/execution-control/runtime-profile.staging.json",
            ],
            "query-serving-scopes.v1": ["configs/runtime/query-serving-scopes.v1.json"],
            "intent-policy.v1": ["configs/runtime/intent-policy.v1.json"],
            "intent-drift-thresholds.v1": ["configs/runtime/intent-drift-thresholds.v1.json"],
            "provider-pricing.v1": ["configs/runtime/provider-pricing.v1.json"],
            "env-surface-policy.v1": ["configs/runtime/env-surface-policy.v1.json"],
        }
        for entry_id, validates in expected_validates.items():
            with self.subTest(entry_id=entry_id):
                self.assertIn(entry_id, entries)
                self.assertEqual(entries[entry_id].get("validates"), validates)

        for entry_id in ("ingestion-task-envelope.v1", "ingestion-task-registry.v1"):
            with self.subTest(entry_id=entry_id):
                self.assertIn(entry_id, entries)
                self.assertTrue(entries[entry_id].get("fixture_groups"))

    def test_registry_covers_structured_tool_contract_fixtures(self) -> None:
        registry = json.loads(
            Path("packages/contracts/schemas/contract-schema-registry.v1.json").read_text(
                encoding="utf-8"
            )
        )
        entries = {entry["id"]: entry for entry in registry["entries"]}

        for entry_id, fixture_path in (
            (
                "campus-services-tool-contracts.v1",
                "packages/contracts/fixtures/campus_services_tool_contracts",
            ),
            ("notice-tool-contracts.v1", "packages/contracts/fixtures/notice_tool_contracts"),
        ):
            with self.subTest(entry_id=entry_id):
                self.assertIn(entry_id, entries)
                self.assertEqual(
                    entries[entry_id].get("fixture_groups"),
                    [
                        {
                            "path": fixture_path,
                            "valid_glob": "*.valid.json",
                            "invalid_glob": "*.invalid.json",
                        }
                    ],
                )

    def test_runtime_tool_schema_refs_resolve_to_registered_json_schema_defs(self) -> None:
        registry = json.loads(
            Path("packages/contracts/schemas/contract-schema-registry.v1.json").read_text(
                encoding="utf-8"
            )
        )
        schema_docs: dict[str, dict[str, object]] = {}
        for entry in registry["entries"]:
            if entry["kind"] != "json_artifact":
                continue
            schema_path = Path(entry["path"])
            schema = json.loads(schema_path.read_text(encoding="utf-8"))
            schema_docs[str(schema["$id"])] = schema

        for config_path in (Path("configs/runtime/tools.v4.json"),):
            config = json.loads(config_path.read_text(encoding="utf-8"))
            for tool in config["tools"]:
                for field_name in ("payload_schema_ref", "result_schema_ref"):
                    with self.subTest(
                        config_path=str(config_path),
                        tool=tool["name"],
                        field_name=field_name,
                    ):
                        ref = tool[field_name]
                        self.assertNotIn("campus_contracts.", ref)
                        schema_id, separator, fragment = ref.partition("#")
                        self.assertEqual(separator, "#")
                        self.assertIn(schema_id, schema_docs)
                        self.assertTrue(fragment.startswith("/$defs/"))
                        definition_name = fragment.removeprefix("/$defs/")
                        self.assertIn(definition_name, schema_docs[schema_id].get("$defs", {}))

    def test_knowledge_tool_contracts_accept_only_public_knowledge_query_tool(self) -> None:
        schema = json.loads(
            Path("packages/contracts/schemas/knowledge-tool-contracts.v1.schema.json").read_text(
                encoding="utf-8"
            )
        )
        validator = Draft202012Validator(schema)

        valid_cases = (
            {
                "schema_version": "knowledge_tool_contracts.v1",
                "tool_name": "knowledge_query",
                "packet_kind": "payload",
                "payload": {"query_text": "图书馆开放到几点？", "intent": "answer_question"},
            },
            {
                "schema_version": "knowledge_tool_contracts.v1",
                "tool_name": "knowledge_query",
                "packet_kind": "result",
                "result": {"workflow_signal": "knowledge_query"},
            },
        )

        for instance in valid_cases:
            with self.subTest(tool_name=instance["tool_name"], packet_kind=instance["packet_kind"]):
                self.assertEqual(list(validator.iter_errors(instance)), [])

        invalid_cases = (
            {
                "schema_version": "knowledge_tool_contracts.v1",
                "tool_name": "retrieval.query",
                "packet_kind": "payload",
                "payload": {"unexpected": True},
            },
            {
                "schema_version": "knowledge_tool_contracts.v1",
                "tool_name": "retrieve_evidence",
                "packet_kind": "result",
                "result": {"diagnostics": None},
            },
        )

        for instance in invalid_cases:
            with self.subTest(tool_name=instance["tool_name"], packet_kind=instance["packet_kind"]):
                self.assertTrue(list(validator.iter_errors(instance)))

    def test_tool_execution_openapi_covers_step_projection_route(self) -> None:
        import yaml

        openapi = yaml.safe_load(
            Path("docs/contracts/schemas/tool-execution.openapi.yaml").read_text(encoding="utf-8")
        )
        paths = openapi["paths"]
        schemas = openapi["components"]["schemas"]

        self.assertIn("/internal/execution/runs/{runId}/steps", paths)
        self.assertEqual(
            paths["/internal/execution/runs/{runId}/steps"]["get"]["responses"]["200"]["content"][
                "application/json"
            ]["schema"]["$ref"],
            "#/components/schemas/ExecutionRunStepTrajectory",
        )
        for schema_name in (
            "ExecutionRunStepTrajectory",
            "ExecutionRunStep",
            "ExecutionRunStepAttempt",
            "ExecutionRunStepResult",
        ):
            with self.subTest(schema_name=schema_name):
                self.assertIn(schema_name, schemas)

    def test_runtime_schema_rejects_bad_instances(self) -> None:
        cases = (
            (
                "packages/contracts/schemas/runtime-tools.v4.schema.json",
                {
                    "schema_version": "tool-registry-v4",
                    "registry_version": "bad",
                    "tools": [
                        {
                            "name": "bad_tool",
                            "description": "Bad tool.",
                            "exposure": "model_visible",
                            "read_only": True,
                            "requires_approval": False,
                            "payload_schema_ref": (
                                "https://muc.wiki/campus-agent/schemas/"
                                "campus-services-tool-contracts.v1.schema.json"
                                "#/$defs/TransportScheduleLookupPayload"
                            ),
                            "result_schema_ref": (
                                "https://muc.wiki/campus-agent/schemas/"
                                "campus-services-tool-contracts.v1.schema.json"
                                "#/$defs/TransportScheduleLookupResult"
                            ),
                            "handler": {
                                "type": "execution_control_internal_query",
                                "endpoint": "/public/not-allowed",
                            },
                            "timeout_ms": 1000,
                            "result_projection_policy": "bounded_json",
                        }
                    ],
                },
            ),
            (
                "packages/contracts/schemas/execution-control-runtime-profile.v1.schema.json",
                {
                    "schema_version": "campus_execution_control_runtime_profile.v1",
                    "max_concurrent_answers": 1,
                },
            ),
            (
                "packages/contracts/schemas/provider-pricing.v1.schema.json",
                {
                    "schema_version": "provider-pricing-v1",
                    "currency": "USD",
                    "models": [
                        {
                            "provider": "openai",
                            "model": "bad",
                            "input_microusd_per_1k_tokens": -1,
                            "cached_input_microusd_per_1k_tokens": 0,
                            "output_microusd_per_1k_tokens": 1,
                        }
                    ],
                },
            ),
        )

        for schema_path, instance in cases:
            with self.subTest(schema_path=schema_path):
                schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
                errors = list(Draft202012Validator(schema).iter_errors(instance))
                self.assertTrue(errors)


if __name__ == "__main__":
    unittest.main()
