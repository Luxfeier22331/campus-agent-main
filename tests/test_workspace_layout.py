import unittest
from pathlib import Path

from campus_contracts import KnowledgeScope, RagRequestPayload, ToolRequest

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_WORKSPACES = {
    "apps/app-api",
    "apps/campus-web",
    "apps/operator-console-web",
    "apps/execution-control",
    "apps/source-collector",
    "jobs/dining-sync",
    "packages/domains/dining",
    "packages/contracts",
    "packages/eval-langfuse",
    "packages/navigation-tool",
    "packages/ragas-runner",
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

    def test_python_ingestion_worker_app_is_retired(self) -> None:
        self.assertFalse((ROOT / "apps/ingestion-worker").exists())

    def test_legacy_python_ingestion_core_package_is_retired(self) -> None:
        self.assertFalse((ROOT / "packages" / "ingestion-core").exists())

    def test_source_collector_core_packages_are_retired(self) -> None:
        self.assertFalse((ROOT / "packages" / "official-web-core").exists())
        self.assertFalse((ROOT / "packages" / "wechat-official-account-core").exists())

    def test_regulation_semantics_package_is_retired(self) -> None:
        self.assertFalse((ROOT / "packages" / "regulation-semantics").exists())

    def test_legacy_office_conversion_service_is_retired(self) -> None:
        self.assertFalse((ROOT / "apps" / "legacy-office-conversion-service").exists())

    def test_split_source_collector_apps_are_retired_as_workspaces(self) -> None:
        for app_name in (
            "authenticated-notice-collector",
            "official-web-collector",
            "wechat-official-account-collector",
        ):
            with self.subTest(app_name=app_name):
                self.assertFalse((ROOT / "apps" / app_name / "package.json").exists())

    def test_legacy_evals_package_is_retired(self) -> None:
        self.assertFalse((ROOT / "packages/evals").exists())

    def test_dining_domain_packages_are_consolidated(self) -> None:
        self.assertTrue((ROOT / "packages/domains/dining").exists())
        self.assertFalse((ROOT / "packages/dining-domain").exists())
        self.assertFalse((ROOT / "packages/dining-floorplans").exists())
        top_level_dining_packages = sorted(
            path.relative_to(ROOT).as_posix()
            for path in (ROOT / "packages").glob("dining-*")
            if path.is_dir()
        )
        self.assertEqual(top_level_dining_packages, [])

    def test_navigation_tool_package_is_not_model_visible(self) -> None:
        self.assertTrue((ROOT / "packages/navigation-tool").exists())
        tool_registry = (ROOT / "configs" / "runtime" / "tools.v4.json").read_text(encoding="utf-8")
        tool_function_schemas = (
            ROOT / "configs" / "runtime" / "tool-function-schemas.v1.json"
        ).read_text(encoding="utf-8")

        self.assertNotIn('"place_lookup"', tool_registry)
        self.assertNotIn('"place_lookup"', tool_function_schemas)

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
