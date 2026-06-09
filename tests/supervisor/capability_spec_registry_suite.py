from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_contracts import ALLOWED_CAPABILITY_IDS
from campus_supervisor_agent_worker.capability_delegates import _build_capability_delegates
from campus_supervisor_agent_worker.capability_spec_registry import (
    CapabilitySpecRegistryError,
    load_capability_spec_registry,
)
from campus_supervisor_agent_worker.tool_spec_registry import load_tool_spec_registry


class CapabilitySpecRegistryTest(unittest.TestCase):
    def test_loads_default_registry_for_current_capability_inventory(self) -> None:
        registry = load_capability_spec_registry()
        tool_registry = load_tool_spec_registry()

        self.assertEqual(registry.schema_version, "capability-spec-registry-v1")
        self.assertEqual(registry.known_capability_ids(), ALLOWED_CAPABILITY_IDS)
        self.assertEqual(
            registry.active_capability_ids(),
            ("knowledge", "campus_services", "notice"),
        )
        self.assertEqual(
            tool_registry.payload_kinds_for_capability("campus_services"),
            (
                "service_status_lookup",
                "service_guide_lookup",
                "transport_schedule_lookup",
                "contact_directory_lookup",
                "academic_calendar_lookup",
            ),
        )

    def test_notice_capability_keeps_internal_notice_get_outside_structured_handoff_surface(
        self,
    ) -> None:
        capability_registry = load_capability_spec_registry()
        tool_registry = load_tool_spec_registry()
        notice_capability = capability_registry.capability_by_id("notice")

        self.assertIsNotNone(notice_capability)
        assert notice_capability is not None
        self.assertEqual(
            notice_capability.allowed_structured_handoff_tools,
            ("campus_notice_discover", "campus_notice_change_set_lookup"),
        )
        self.assertEqual(
            tool_registry.payload_kinds_for_capability("notice"),
            (
                "campus_notice_change_set_lookup",
                "campus_notice_discover",
                "campus_notice_get",
            ),
        )
        self.assertEqual(
            set(tool_registry.capability_facing_tool_names_for_capability("notice")),
            set(notice_capability.allowed_structured_handoff_tools),
        )

    def test_delegate_map_matches_capability_spec_registry(self) -> None:
        registry = load_capability_spec_registry()
        delegates = _build_capability_delegates(
            settings=_fake_settings(),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            notice_query_service=None,
        )

        self.assertEqual(tuple(sorted(delegates)), tuple(sorted(registry.known_capability_ids())))

    def test_rejects_duplicate_capability_ids(self) -> None:
        path = _capability_registry_fixture(
            {
                "schema_version": "capability-spec-registry-v1",
                "registry_version": "test",
                "capabilities": [
                    _capability("knowledge", active=True, opening_gate="open"),
                    _capability("knowledge", active=True, opening_gate="open"),
                ],
            }
        )

        with self.assertRaisesRegex(CapabilitySpecRegistryError, "duplicate CapabilitySpec id"):
            load_capability_spec_registry(path)

    def test_rejects_unknown_capability_id(self) -> None:
        path = _capability_registry_fixture(
            {
                "schema_version": "capability-spec-registry-v1",
                "registry_version": "test",
                "capabilities": [
                    {
                        **_capability("knowledge", active=True, opening_gate="open"),
                        "id": "external_capability",
                    }
                ],
            }
        )

        with self.assertRaisesRegex(CapabilitySpecRegistryError, "unsupported CapabilitySpec id"):
            load_capability_spec_registry(path)

    def test_rejects_closed_capability_marked_active(self) -> None:
        path = _capability_registry_fixture(
            {
                "schema_version": "capability-spec-registry-v1",
                "registry_version": "test",
                "capabilities": [
                    _capability(
                        "navigation",
                        active=True,
                        opening_gate="closed",
                    )
                ],
            }
        )

        with self.assertRaisesRegex(CapabilitySpecRegistryError, "closed opening_gate cannot be active"):
            load_capability_spec_registry(path)

    def test_rejects_notice_get_as_structured_handoff_tool(self) -> None:
        path = _capability_registry_fixture(
            {
                "schema_version": "capability-spec-registry-v1",
                "registry_version": "test",
                "capabilities": [
                    {
                        **_capability("notice", active=True, opening_gate="open"),
                        "allowed_structured_tools": [
                            "campus_notice_discover",
                            "campus_notice_get",
                        ],
                    }
                ],
            }
        )

        with self.assertRaisesRegex(CapabilitySpecRegistryError, "campus_notice_get"):
            load_capability_spec_registry(path)


def _capability(
    capability_id: str,
    *,
    active: bool,
    opening_gate: str,
) -> dict[str, object]:
    defaults = {
        "knowledge": {
            "owner_package": "packages/knowledge-capability",
            "worker_role": "activity-worker-rag",
            "allowed_structured_tools": [],
            "context_projection_kinds": ["evidence_bundle"],
        },
        "navigation": {
            "owner_package": "packages/navigation-capability",
            "worker_role": "activity-worker-navigation",
            "allowed_structured_tools": [],
            "context_projection_kinds": ["place_context"],
        },
        "campus_services": {
            "owner_package": "packages/campus-services-capability",
            "worker_role": "activity-worker-campus-services",
            "allowed_structured_tools": [
                "service_status_lookup",
                "service_guide_lookup",
                "transport_schedule_lookup",
                "contact_directory_lookup",
                "academic_calendar_lookup",
            ],
            "context_projection_kinds": [
                "service_guide_facts",
                "schedule_baseline",
                "calendar_fact",
            ],
        },
        "notice": {
            "owner_package": "packages/notice-capability",
            "worker_role": "activity-worker-notice",
            "allowed_structured_tools": [
                "campus_notice_discover",
                "campus_notice_change_set_lookup",
            ],
            "context_projection_kinds": ["notice_context", "notice_change_set"],
        },
    }
    base = defaults.get(capability_id, defaults["knowledge"])
    return {
        "id": capability_id,
        "owner_package": base["owner_package"],
        "worker_role": base["worker_role"],
        "runtime_adapter": "temporal_activity_worker",
        "active": active,
        "opening_gate": opening_gate,
        "allowed_structured_tools": base["allowed_structured_tools"],
        "context_projection_kinds": base["context_projection_kinds"],
        "description": "fixture",
    }


def _capability_registry_fixture(payload: dict[str, object]) -> Path:
    temp_dir = Path(tempfile.mkdtemp(prefix="capability-spec-registry-"))
    path = temp_dir / "capabilities.v1.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _fake_settings():
    class _Settings:
        retrieval_observation_jsonl_path = ""
        retrieval_runtime_event_jsonl_path = ""
        otel_enabled = False
        retrieval_observation_include_query_text = False
        internal_query_base_url = ""
        internal_query_shared_secret = ""
        structured_query_timeout_seconds = 5.0
        prompt_runtime_provider = ""
        runtime_provider = ""
        prompt_runtime_api_key = ""
        agent_prompt_model = ""
        prompt_runtime_base_url = ""
        prompt_runtime_reasoning_effort = ""
        prompt_runtime_max_output_tokens = 0
        prompt_runtime_transport = "responses"
        prompt_runtime_connect_timeout_seconds = 5.0
        prompt_runtime_read_timeout_seconds = 30.0
        prompt_runtime_write_timeout_seconds = 30.0
        prompt_runtime_pool_timeout_seconds = 5.0
        prompt_runtime_max_connections = 10
        prompt_runtime_max_keepalive_connections = 5
        prompt_runtime_keepalive_expiry_seconds = 30.0

    return _Settings()


if __name__ == "__main__":
    unittest.main()
