import unittest
from pathlib import Path

from campus_contracts import CapabilityRequest, KnowledgeScope, RagRequestPayload

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_WORKSPACES = {
    "apps/app-api",
    "apps/authenticated-notice-collector",
    "apps/campus-web",
    "apps/chatkit-adapter",
    "apps/ingestion-worker",
    "apps/official-web-collector",
    "apps/operator-console-web",
    "apps/public-chat-web",
    "apps/execution-control",
    "packages/contracts",
    "packages/evals",
    "packages/ingestion-core",
    "packages/navigation-capability",
    "packages/official-web-core",
    "packages/shared",
}


class WorkspaceLayoutTest(unittest.TestCase):
    def test_workspace_directories_exist(self) -> None:
        missing = [path for path in EXPECTED_WORKSPACES if not (ROOT / path).exists()]
        self.assertEqual(missing, [])

    def test_standalone_supervisor_core_package_is_retired(self) -> None:
        self.assertFalse((ROOT / "packages/supervisor-core").exists())
        self.assertFalse((ROOT / "apps/supervisor-agent-worker").exists())

    def test_legacy_operator_surface_apps_are_retired(self) -> None:
        self.assertFalse((ROOT / "apps/protected-panel-web").exists())
        self.assertFalse((ROOT / "apps/campus-ops-web").exists())

    def test_contract_surface_exposes_generic_capability_request(self) -> None:
        request = CapabilityRequest(
            capability="knowledge",
            user_goal="library hours",
            payload=RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                )
            ),
        )

        self.assertEqual(
            request.payload,
            RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                )
            ),
        )


if __name__ == "__main__":
    unittest.main()
