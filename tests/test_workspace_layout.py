import tests
from importlib import import_module
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]

EXPECTED_WORKSPACES = {
    "apps/supervisor-api",
    "packages/contracts",
    "packages/evals",
    "packages/rag-specialist",
    "packages/retrieval-core",
    "packages/shared",
    "packages/supervisor-core",
}


class WorkspaceLayoutTest(unittest.TestCase):
    def test_workspace_directories_exist(self) -> None:
        missing = [path for path in EXPECTED_WORKSPACES if not (ROOT / path).exists()]
        self.assertEqual(missing, [])

    def test_supervisor_core_delegates_to_rag_specialist(self) -> None:
        supervisor_core = import_module("campus_supervisor_core")

        response = supervisor_core.handle_user_goal("library hours")

        self.assertEqual(response.status, "completed")
        self.assertTrue(response.answer_text)
        self.assertTrue(response.sources)

    def test_supervisor_api_has_bootstrap_metadata(self) -> None:
        supervisor_api = import_module("campus_supervisor_api.app")

        app = supervisor_api.create_app()

        self.assertEqual(app["name"], "campus-agent-v2")
        self.assertIn("/delegate-to-rag-agent", app["routes"])


if __name__ == "__main__":
    unittest.main()
