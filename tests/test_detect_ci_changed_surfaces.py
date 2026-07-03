from __future__ import annotations

import unittest

from scripts.detect_ci_changed_surfaces import classify_changed_surfaces


class DetectCiChangedSurfacesTest(unittest.TestCase):
    def test_docs_only_change_does_not_trigger_runtime_surfaces(self) -> None:
        surfaces = classify_changed_surfaces(("docs/reference/testing-and-verification-lanes.md",))

        self.assertEqual(
            surfaces,
            {
                "contracts": False,
                "go": False,
                "ingestion": False,
                "langfuse": False,
                "web_graph": False,
                "worker_runtime": False,
            },
        )

    def test_worker_app_change_triggers_web_graph_and_worker_runtime(self) -> None:
        surfaces = classify_changed_surfaces(("apps/app-api/src/index.ts",))

        self.assertTrue(surfaces["web_graph"])
        self.assertTrue(surfaces["worker_runtime"])
        self.assertFalse(surfaces["go"])

    def test_contract_runtime_change_triggers_contracts_and_go(self) -> None:
        surfaces = classify_changed_surfaces(("configs/runtime/tool-function-schemas.v1.json",))

        self.assertTrue(surfaces["contracts"])
        self.assertTrue(surfaces["go"])
        self.assertTrue(surfaces["worker_runtime"])

    def test_execution_control_change_triggers_go_lane(self) -> None:
        surfaces = classify_changed_surfaces(("apps/execution-control/internal/httpapi/server.go",))

        self.assertTrue(surfaces["go"])
        self.assertFalse(surfaces["web_graph"])

    def test_contract_package_change_triggers_contracts_lane(self) -> None:
        surfaces = classify_changed_surfaces(("packages/contracts/src/index.py",))

        self.assertTrue(surfaces["contracts"])
        self.assertFalse(surfaces["go"])

    def test_langfuse_change_triggers_langfuse_lane(self) -> None:
        surfaces = classify_changed_surfaces(("packages/eval-langfuse/src/cli.ts",))

        self.assertTrue(surfaces["langfuse"])
        self.assertTrue(surfaces["web_graph"])

    def test_ragas_runner_change_triggers_langfuse_lane(self) -> None:
        surfaces = classify_changed_surfaces(("packages/ragas-runner/src/ragas_runner/cli.py",))

        self.assertTrue(surfaces["langfuse"])
        self.assertFalse(surfaces["web_graph"])

    def test_ingestion_change_triggers_ingestion_lane(self) -> None:
        surfaces = classify_changed_surfaces(("apps/ingestion-control/src/index.ts",))

        self.assertTrue(surfaces["ingestion"])
        self.assertTrue(surfaces["web_graph"])

    def test_rust_ingestion_kernel_change_triggers_ingestion_lane(self) -> None:
        surfaces = classify_changed_surfaces(("packages/ingestion-kernels-rs/src/lib.rs",))

        self.assertTrue(surfaces["ingestion"])
        self.assertFalse(surfaces["web_graph"])

    def test_dining_sync_job_change_triggers_web_graph_lane(self) -> None:
        surfaces = classify_changed_surfaces(("jobs/dining-sync/src/sync-pipeline.ts",))

        self.assertTrue(surfaces["web_graph"])
        self.assertFalse(surfaces["worker_runtime"])

    def test_root_ci_config_changes_trigger_all_runtime_surfaces(self) -> None:
        global_paths = (
            ".github/workflows/pr-checks.yml",
            "package.json",
            "pnpm-lock.yaml",
            "turbo.json",
            "scripts/detect_ci_changed_surfaces.py",
            "scripts/check_ci_workflow_contracts.py",
            "scripts/ci_workflow_manual_contracts.py",
        )

        for path in global_paths:
            with self.subTest(path=path):
                surfaces = classify_changed_surfaces((path,))
                self.assertTrue(all(surfaces.values()))


if __name__ == "__main__":
    unittest.main()
