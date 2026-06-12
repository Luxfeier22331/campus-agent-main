import unittest
from importlib import import_module
from pathlib import Path

from campus_contracts import CapabilityRequest, KnowledgeScope, RagRequestPayload

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_WORKSPACES = {
    "apps/app-api",
    "apps/authenticated-notice-collector",
    "apps/hub-web",
    "apps/ingestion-worker",
    "apps/official-web-collector",
    "apps/protected-panel-web",
    "apps/public-chat-web",
    "apps/execution-control",
    "apps/supervisor-agent-worker",
    "packages/contracts",
    "packages/evals",
    "packages/ingestion-core",
    "packages/navigation-capability",
    "packages/official-web-core",
    "packages/knowledge-capability",
    "packages/retrieval-core",
    "packages/shared",
}


class WorkspaceLayoutTest(unittest.TestCase):
    def test_workspace_directories_exist(self) -> None:
        missing = [path for path in EXPECTED_WORKSPACES if not (ROOT / path).exists()]
        self.assertEqual(missing, [])

    def test_standalone_supervisor_core_package_is_retired(self) -> None:
        self.assertFalse((ROOT / "packages/supervisor-core").exists())

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

    def test_supervisor_agent_worker_exposes_private_bridge_routes(self) -> None:
        supervisor_agent_worker = import_module("campus_supervisor_agent_worker")
        worker_settings = import_module("campus_supervisor_agent_worker.settings")

        self.assertFalse(hasattr(supervisor_agent_worker, "create_app"))
        self.assertTrue(hasattr(supervisor_agent_worker, "create_bridge_app"))

        app = supervisor_agent_worker.create_bridge_app(settings=worker_settings.ApiSettings())

        self.assertEqual(app.name, "campus-agent-v2")
        self.assertEqual(
            {route.path for route in app.routes},
            {
                "/internal/bridge/execution/cancel",
                "/internal/bridge/semantic/execution",
                "/internal/bridge/supervisor/answer",
                "/internal/bridge/healthz",
                "/internal/bridge/readyz",
            },
        )
        self.assertEqual(app.runtime.provider, "")


if __name__ == "__main__":
    unittest.main()
