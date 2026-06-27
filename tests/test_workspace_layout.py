import unittest
from pathlib import Path

from campus_contracts import KnowledgeScope, RagRequestPayload, ToolRequest

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_WORKSPACES = {
    "apps/app-api",
    "apps/authenticated-notice-collector",
    "apps/campus-web",
    "apps/ingestion-worker",
    "apps/official-web-collector",
    "apps/operator-console-web",
    "apps/execution-control",
    "packages/contracts",
    "packages/evals",
    "packages/ingestion-core",
    "packages/navigation-tool",
    "packages/official-web-core",
    "packages/shared",
}


class WorkspaceLayoutTest(unittest.TestCase):
    def test_workspace_directories_exist(self) -> None:
        missing = [path for path in EXPECTED_WORKSPACES if not (ROOT / path).exists()]
        self.assertEqual(missing, [])

    def test_standalone_legacy_core_package_is_retired(self) -> None:
        self.assertFalse((ROOT / ("packages/" + "super" + "visor-core")).exists())
        self.assertFalse((ROOT / ("apps/" + "super" + "visor-agent-worker")).exists())

    def test_legacy_operator_surface_apps_are_retired(self) -> None:
        self.assertFalse((ROOT / "apps/protected-panel-web").exists())
        self.assertFalse((ROOT / "apps/campus-ops-web").exists())

    def test_chatkit_adapter_app_is_retired(self) -> None:
        self.assertFalse((ROOT / "apps/chatkit-adapter").exists())

    def test_contract_surface_exposes_generic_tool_request(self) -> None:
        request = ToolRequest(
            tool="knowledge_query",
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
