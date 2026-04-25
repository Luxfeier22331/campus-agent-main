from __future__ import annotations

import unittest
from pathlib import Path

SUPERVISOR_CORE = Path("packages/supervisor-core/src/campus_supervisor_core")
BRIDGE_PARSER = Path(
    "apps/supervisor-core-worker/src/campus_supervisor_core_worker/api_request_parsing.py"
)


class SupervisorRuntimeGuardrailTest(unittest.TestCase):
    def test_python_validation_does_not_reintroduce_capability_inference(self) -> None:
        validation_source = (SUPERVISOR_CORE / "validation.py").read_text(encoding="utf-8")

        forbidden_fragments = (
            "context.user_goal",
            "request.user_goal",
            "user_goal.casefold",
            "校车",
            "班车",
            "通知",
            "公告",
            "哪里",
            "在哪里",
            "_infer",
            "infer_",
        )
        for fragment in forbidden_fragments:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, validation_source)

    def test_python_routing_does_not_reintroduce_structured_payload_planner(self) -> None:
        routing_source = (SUPERVISOR_CORE / "routing.py").read_text(encoding="utf-8")

        forbidden_fragments = (
            "runtime_decisions",
            "preplanned_handoff",
            "preplanned_target",
            "planning_outcome",
            "allowed_tools_for_target",
            "transport_schedule_lookup",
            "service_status_lookup",
            "campus_notice_discover",
            "campus_notice_get",
            "route_selector",
            "service_time_query",
        )
        for fragment in forbidden_fragments:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, routing_source)

    def test_supervisor_core_package_does_not_parse_bridge_runtime_decisions(self) -> None:
        for path in SUPERVISOR_CORE.rglob("*.py"):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("runtime_decisions", source)
                self.assertNotIn("routing_frame", source)
                self.assertNotIn("supervisor_bridge_v2", source)

    def test_bridge_parser_is_v2_only_and_requires_go_runtime_routing_frame(self) -> None:
        parser_source = BRIDGE_PARSER.read_text(encoding="utf-8")

        self.assertIn('"supervisor_bridge_v2"', parser_source)
        self.assertIn("runtime_decisions.routing_frame", parser_source)
        self.assertNotIn("legacy", parser_source.casefold())
