from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(".")


class SdkOnlyDomainAgentGuardsTest(unittest.TestCase):
    def test_direct_online_runtime_modules_are_removed(self) -> None:
        forbidden_paths = (
            REPO_ROOT / "packages/campus-services-agent/src/campus_services_agent/service.py",
            REPO_ROOT / "packages/campus-services-agent/src/campus_services_agent/tool_adapter.py",
            REPO_ROOT / "packages/notice-agent/src/campus_notice_agent/service.py",
            REPO_ROOT / "packages/notice-agent/src/campus_notice_agent/tool_adapter.py",
            REPO_ROOT
            / "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/provider_function_calling.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists(), f"legacy direct runtime module still exists: {path}")

    def test_production_code_does_not_import_direct_delegate_symbols(self) -> None:
        checked_paths = (
            REPO_ROOT / "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker",
            REPO_ROOT / "packages/campus-services-agent/src/campus_services_agent",
            REPO_ROOT / "packages/notice-agent/src/campus_notice_agent",
        )
        forbidden_fragments = (
            "delegate_to_campus_services_agent",
            "delegate_to_notice_agent",
            "campus_services_agent.service",
            "campus_notice_agent.service",
            "campus_services_agent.tool_adapter",
            "campus_notice_agent.tool_adapter",
            "provider_function_calling",
        )
        for root in checked_paths:
            for path in sorted(root.glob("*.py")):
                source = path.read_text(encoding="utf-8")
                with self.subTest(path=str(path)):
                    for fragment in forbidden_fragments:
                        self.assertNotIn(
                            fragment,
                            source,
                            f"{path} reintroduced forbidden direct runtime fragment {fragment!r}",
                        )

    def test_agent_spec_registry_keeps_worker_dispatch_truth(self) -> None:
        source = (REPO_ROOT / "configs/runtime/agents.v1.json").read_text(encoding="utf-8")
        self.assertNotIn('"delegate_module"', source)
        self.assertNotIn('"delegate_symbol"', source)
        self.assertIn('"runtime_adapter": "worker_dispatch"', source)


if __name__ == "__main__":
    unittest.main()
