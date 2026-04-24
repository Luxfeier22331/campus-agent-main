import unittest
from importlib import import_module
from pathlib import Path

from campus_contracts import KnowledgeScope, RagRequestPayload, SpecialistRequest

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_WORKSPACES = {
    "apps/app-api",
    "apps/authenticated-notice-collector",
    "apps/ingestion-worker",
    "apps/official-web-collector",
    "apps/protected-panel-web",
    "apps/public-chat-web",
    "apps/supervisor-api",
    "apps/supervisor-core-worker",
    "packages/contracts",
    "packages/evals",
    "packages/ingestion-core",
    "packages/navigation-agent",
    "packages/official-web-core",
    "packages/rag-agent",
    "packages/retrieval-core",
    "packages/shared",
    "packages/supervisor-core",
}


class WorkspaceLayoutTest(unittest.TestCase):
    def test_workspace_directories_exist(self) -> None:
        missing = [path for path in EXPECTED_WORKSPACES if not (ROOT / path).exists()]
        self.assertEqual(missing, [])

    def test_contract_surface_exposes_generic_specialist_request(self) -> None:
        request = SpecialistRequest(
            target="rag-agent",
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

    def test_supervisor_core_worker_exposes_private_bridge_routes(self) -> None:
        supervisor_core_worker = import_module("campus_supervisor_core_worker")

        self.assertFalse(hasattr(supervisor_core_worker, "create_app"))
        self.assertTrue(hasattr(supervisor_core_worker, "create_bridge_app"))

        app = supervisor_core_worker.create_bridge_app()

        self.assertEqual(app.name, "campus-agent-v2")
        self.assertEqual(
            {route.path for route in app.routes},
            {
                "/internal/bridge/execution/cancel",
                "/internal/bridge/supervisor/answer",
                "/internal/bridge/healthz",
                "/internal/bridge/readyz",
            },
        )
        self.assertEqual(app.runtime.provider, "")


if __name__ == "__main__":
    unittest.main()
