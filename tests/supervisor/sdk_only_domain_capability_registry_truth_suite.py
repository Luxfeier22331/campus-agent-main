from __future__ import annotations

import json
import unittest
from pathlib import Path


class SdkOnlyDomainCapabilityRegistryTruthTest(unittest.TestCase):
    def test_capability_spec_uses_temporal_worker_truth_without_direct_delegate_fields(
        self,
    ) -> None:
        payload = json.loads(Path("configs/runtime/capabilities.v1.json").read_text(encoding="utf-8"))
        capabilities = {capability["id"]: capability for capability in payload["capabilities"]}

        campus_services = capabilities["campus_services"]
        notice = capabilities["notice"]

        self.assertEqual(campus_services["runtime_adapter"], "temporal_activity_worker")
        self.assertEqual(notice["runtime_adapter"], "temporal_activity_worker")
        self.assertEqual(campus_services["worker_role"], "activity-worker-campus-services")
        self.assertEqual(notice["worker_role"], "activity-worker-notice")
        self.assertNotIn("delegate_module", campus_services)
        self.assertNotIn("delegate_symbol", campus_services)
        self.assertNotIn("delegate_module", notice)
        self.assertNotIn("delegate_symbol", notice)
        self.assertEqual(
            notice["allowed_structured_tools"],
            ["campus_notice_discover", "campus_notice_change_set_lookup"],
        )


if __name__ == "__main__":
    unittest.main()
