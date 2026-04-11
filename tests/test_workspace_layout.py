import tests
from importlib import import_module
from pathlib import Path
import unittest

from campus_contracts import KnowledgeScope, RagRequestPayload, SpecialistRequest


ROOT = Path(__file__).resolve().parents[1]

EXPECTED_WORKSPACES = {
    "apps/app-api",
    "apps/ingestion-worker",
    "apps/protected-panel-web",
    "apps/public-chat-web",
    "apps/supervisor-api",
    "packages/availability-specialist",
    "packages/contracts",
    "packages/evals",
    "packages/ingestion-core",
    "packages/navigation-specialist",
    "packages/rag-specialist",
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
            target="rag-specialist",
            user_goal="library hours",
            payload=RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_handbook",
                )
            ),
        )

        self.assertEqual(
            request.payload,
            RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_handbook",
                )
            ),
        )

    def test_supervisor_api_exposes_stable_runtime_routes(self) -> None:
        supervisor_api = import_module("campus_supervisor_api")

        app = supervisor_api.create_app()

        self.assertEqual(app.name, "campus-agent-v2")
        self.assertEqual(
            {route.path for route in app.routes},
            {"/api/v1/answer", "/healthz", "/readyz"},
        )
        self.assertEqual(app.runtime.provider, "")


if __name__ == "__main__":
    unittest.main()
