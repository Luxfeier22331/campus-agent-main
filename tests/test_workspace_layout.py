import tests
from importlib import import_module
from pathlib import Path
import unittest

from campus_contracts import DelegateToRagAgentRequest


ROOT = Path(__file__).resolve().parents[1]

EXPECTED_WORKSPACES = {
    "apps/ingestion-worker",
    "apps/supervisor-api",
    "packages/contracts",
    "packages/evals",
    "packages/ingestion-core",
    "packages/rag-specialist",
    "packages/retrieval-core",
    "packages/shared",
    "packages/supervisor-core",
}


class WorkspaceLayoutTest(unittest.TestCase):
    def test_workspace_directories_exist(self) -> None:
        missing = [path for path in EXPECTED_WORKSPACES if not (ROOT / path).exists()]
        self.assertEqual(missing, [])

    def test_supervisor_core_handles_request_contract(self) -> None:
        supervisor_core = import_module("campus_supervisor_core")

        response = supervisor_core.handle_request(
            DelegateToRagAgentRequest(user_goal="library hours")
        )

        self.assertIn(response.status, {"completed", "no_answer", "error"})
        self.assertTrue(response.evidence)
        self.assertEqual(response.evidence.corpus, "student_handbook")
        if response.status == "completed":
            self.assertTrue(response.answer_text)
            self.assertTrue(response.evidence.sources)

    def test_supervisor_api_exposes_phase1_routes(self) -> None:
        supervisor_api = import_module("campus_supervisor_api")

        app = supervisor_api.create_app()

        self.assertEqual(app.name, "campus-agent-v2")
        self.assertEqual(
            {route.path for route in app.routes},
            {"/api/v1/answer", "/healthz", "/readyz"},
        )
        self.assertEqual(app.runtime.provider, "agno")


if __name__ == "__main__":
    unittest.main()
