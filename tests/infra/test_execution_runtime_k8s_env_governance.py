from __future__ import annotations

import unittest
from pathlib import Path

from scripts.check_retired_runtime_helpers import (
    RETIRED_PATHS,
    audit_retired_runtime_helpers,
)

ROOT = Path(__file__).resolve().parents[2]


class ExecutionRuntimeK8sEnvGovernanceTest(unittest.TestCase):
    def test_base_kustomization_includes_tracked_runtime_configmap(self) -> None:
        kustomization = (ROOT / "infra/k8s/execution-runtime/base/kustomization.yaml").read_text(
            encoding="utf-8"
        )
        configmap = (ROOT / "infra/k8s/execution-runtime/base/configmap.yaml").read_text(
            encoding="utf-8"
        )

        self.assertIn("- configmap.yaml", kustomization)
        self.assertIn("name: execution-runtime-rendered-config", configmap)
        self.assertNotIn("stringData:", configmap)

    def test_gitops_runbook_does_not_use_local_env_helpers_as_formal_path(self) -> None:
        documents = {
            "docs/runbooks/gitops-k8s.md": (ROOT / "docs/runbooks/gitops-k8s.md").read_text(
                encoding="utf-8"
            ),
            "infra/gitops/README.md": (ROOT / "infra/gitops/README.md").read_text(encoding="utf-8"),
        }

        for helper in (
            "render-execution-runtime-k8s-env.sh",
            "project-local-runtime-env.mjs",
            "ensure-runtime-secrets.mjs",
            "sync_worker_observability_env.py",
            "sync_app_api_local_db_env.py",
        ):
            for path, text in documents.items():
                with self.subTest(path=path, helper=helper):
                    self.assertNotIn(helper, text)

        for path, text in documents.items():
            with self.subTest(path=path):
                self.assertNotIn("Render/apply first-party execution-runtime env", text)

    def test_retired_env_renderer_and_boundary_are_removed(self) -> None:
        for retired_path in RETIRED_PATHS:
            with self.subTest(retired_path=retired_path):
                self.assertFalse((ROOT / retired_path).exists())
        self.assertFalse((ROOT / "infra/k8s/execution-runtime/base/secret.example.yaml").exists())

    def test_active_docs_and_code_do_not_reference_retired_runtime_helpers(self) -> None:
        self.assertEqual(audit_retired_runtime_helpers(root=ROOT), ())


if __name__ == "__main__":
    unittest.main()
