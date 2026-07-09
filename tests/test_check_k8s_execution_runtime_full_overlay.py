from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

from scripts.check_k8s_execution_runtime_full_overlay import audit_full_overlay

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full"


class CheckK8sExecutionRuntimeFullOverlayTest(unittest.TestCase):
    def test_requires_full_overlay(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            issues = audit_full_overlay(root=Path(directory))

        self.assertTrue(any(issue.path.endswith("nc-arm-6c-staging-full") for issue in issues))

    def test_repo_overlay_is_first_party_runtime_without_docker_bridge_or_stateful(self) -> None:
        issues = audit_full_overlay(root=ROOT)

        self.assertEqual([f"{issue.path}: {issue.message}" for issue in issues], [])

    def test_full_overlay_uses_private_service_path_without_public_ingress(self) -> None:
        docs = _rendered_docs()
        ingresses = [doc for doc in docs if doc.get("kind") == "Ingress"]
        deployments = {
            doc["metadata"]["name"]: doc for doc in docs if doc.get("kind") == "Deployment"
        }

        self.assertEqual(ingresses, [])
        self.assertIn("cloudflared-execution-control", deployments)
        args = deployments["cloudflared-execution-control"]["spec"]["template"]["spec"][
            "containers"
        ][0]["args"]
        self.assertIn("--token-file", args)


def _rendered_docs() -> tuple[dict, ...]:
    result = subprocess.run(
        ("kubectl", "kustomize", str(OVERLAY)),
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return tuple(doc for doc in yaml.safe_load_all(result.stdout) if isinstance(doc, dict))


if __name__ == "__main__":
    unittest.main()
