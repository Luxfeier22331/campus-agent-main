from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_contracts import ALLOWED_AGENT_TARGETS
from campus_supervisor_agent_worker.agent_delegates import _build_agent_delegates
from campus_supervisor_agent_worker.agent_spec_registry import (
    AgentSpecRegistryError,
    load_agent_spec_registry,
)
from campus_supervisor_agent_worker.tool_spec_registry import load_tool_spec_registry


class AgentSpecRegistryTest(unittest.TestCase):
    def test_loads_default_registry_for_current_agent_inventory(self) -> None:
        registry = load_agent_spec_registry()
        tool_registry = load_tool_spec_registry()

        self.assertEqual(registry.schema_version, "agent-spec-registry-v2")
        self.assertEqual(registry.known_agent_ids(), ALLOWED_AGENT_TARGETS)
        self.assertEqual(
            registry.active_agent_ids(),
            ("rag-agent", "campus-services-agent", "notice-agent"),
        )
        self.assertEqual(
            tool_registry.payload_kinds_for_target("campus-services-agent"),
            (
                "service_status_lookup",
                "service_guide_lookup",
                "transport_schedule_lookup",
                "contact_directory_lookup",
                "academic_calendar_lookup",
            ),
        )

    def test_notice_agent_keeps_internal_notice_get_outside_structured_handoff_surface(
        self,
    ) -> None:
        agent_registry = load_agent_spec_registry()
        tool_registry = load_tool_spec_registry()
        notice_agent = agent_registry.agent_by_id("notice-agent")

        self.assertIsNotNone(notice_agent)
        assert notice_agent is not None
        self.assertEqual(
            notice_agent.allowed_structured_handoff_tools,
            ("campus_notice_discover", "campus_notice_change_set_lookup"),
        )
        self.assertEqual(
            tool_registry.payload_kinds_for_target("notice-agent"),
            (
                "campus_notice_change_set_lookup",
                "campus_notice_discover",
                "campus_notice_get",
            ),
        )
        self.assertEqual(
            set(tool_registry.agent_facing_tool_names_for_target("notice-agent")),
            set(notice_agent.allowed_structured_handoff_tools),
        )

    def test_delegate_map_matches_agent_spec_registry(self) -> None:
        registry = load_agent_spec_registry()
        delegates = _build_agent_delegates(
            settings=_fake_settings(),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            notice_query_service=None,
        )

        self.assertEqual(tuple(sorted(delegates)), tuple(sorted(registry.known_agent_ids())))

    def test_rejects_duplicate_agent_ids(self) -> None:
        path = _agent_registry_fixture(
            {
                "schema_version": "agent-spec-registry-v2",
                "registry_version": "test",
                "agents": [
                    _agent("rag-agent", capability="knowledge", active=True, opening_gate="open"),
                    _agent(
                        "rag-agent", capability="campus_services", active=True, opening_gate="open"
                    ),
                ],
            }
        )

        with self.assertRaisesRegex(AgentSpecRegistryError, "duplicate AgentSpec id"):
            load_agent_spec_registry(path)

    def test_rejects_unknown_agent_id(self) -> None:
        path = _agent_registry_fixture(
            {
                "schema_version": "agent-spec-registry-v2",
                "registry_version": "test",
                "agents": [
                    {
                        **_agent(
                            "rag-agent", capability="knowledge", active=True, opening_gate="open"
                        ),
                        "id": "external-agent",
                    }
                ],
            }
        )

        with self.assertRaisesRegex(AgentSpecRegistryError, "unsupported AgentSpec id"):
            load_agent_spec_registry(path)

    def test_rejects_closed_agent_marked_active(self) -> None:
        path = _agent_registry_fixture(
            {
                "schema_version": "agent-spec-registry-v2",
                "registry_version": "test",
                "agents": [
                    _agent(
                        "navigation-agent",
                        capability="place_lookup",
                        active=True,
                        opening_gate="closed",
                    )
                ],
            }
        )

        with self.assertRaisesRegex(AgentSpecRegistryError, "closed opening_gate cannot be active"):
            load_agent_spec_registry(path)

    def test_rejects_notice_get_as_structured_handoff_tool(self) -> None:
        path = _agent_registry_fixture(
            {
                "schema_version": "agent-spec-registry-v2",
                "registry_version": "test",
                "agents": [
                    {
                        **_agent(
                            "notice-agent", capability="notice", active=True, opening_gate="open"
                        ),
                        "allowed_structured_handoff_tools": [
                            "campus_notice_discover",
                            "campus_notice_get",
                        ],
                    }
                ],
            }
        )

        with self.assertRaisesRegex(AgentSpecRegistryError, "campus_notice_get"):
            load_agent_spec_registry(path)


def _agent(
    agent_id: str,
    *,
    capability: str,
    active: bool,
    opening_gate: str,
) -> dict[str, object]:
    defaults = {
        "rag-agent": {
            "owner_package": "packages/rag-agent",
            "allowed_structured_handoff_tools": [],
            "context_projection_kinds": ["evidence_bundle"],
        },
        "navigation-agent": {
            "owner_package": "packages/navigation-agent",
            "allowed_structured_handoff_tools": [],
            "context_projection_kinds": ["place_context"],
        },
        "campus-services-agent": {
            "owner_package": "packages/campus-services-agent",
            "allowed_structured_handoff_tools": [
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
        "notice-agent": {
            "owner_package": "packages/notice-agent",
            "allowed_structured_handoff_tools": [
                "campus_notice_discover",
                "campus_notice_change_set_lookup",
            ],
            "context_projection_kinds": ["notice_context", "notice_change_set"],
        },
    }
    base = defaults.get(agent_id, defaults["rag-agent"])
    return {
        "id": agent_id,
        "capability": capability,
        "owner_package": base["owner_package"],
        "runtime_adapter": "worker_dispatch",
        "active": active,
        "opening_gate": opening_gate,
        "allowed_structured_handoff_tools": base["allowed_structured_handoff_tools"],
        "context_projection_kinds": base["context_projection_kinds"],
        "description": "fixture",
    }


def _agent_registry_fixture(payload: dict[str, object]) -> Path:
    temp_dir = Path(tempfile.mkdtemp(prefix="agent-spec-registry-"))
    path = temp_dir / "agents.v2.json"
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
