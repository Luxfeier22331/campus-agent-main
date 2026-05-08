from __future__ import annotations

import json
import unittest
from pathlib import Path


class SdkOnlyDomainAgentRegistryTruthTest(unittest.TestCase):
    def test_agent_spec_uses_worker_dispatch_truth_without_direct_delegate_fields(self) -> None:
        payload = json.loads(Path("configs/runtime/agents.v1.json").read_text(encoding="utf-8"))
        agents = {agent["id"]: agent for agent in payload["agents"]}

        campus_services = agents["campus-services-agent"]
        notice = agents["notice-agent"]

        self.assertEqual(campus_services["runtime_adapter"], "worker_dispatch")
        self.assertEqual(notice["runtime_adapter"], "worker_dispatch")
        self.assertNotIn("delegate_module", campus_services)
        self.assertNotIn("delegate_symbol", campus_services)
        self.assertNotIn("delegate_module", notice)
        self.assertNotIn("delegate_symbol", notice)
        self.assertEqual(
            notice["allowed_structured_handoff_tools"],
            ["campus_notice_discover", "campus_notice_change_set_lookup"],
        )


if __name__ == "__main__":
    unittest.main()
