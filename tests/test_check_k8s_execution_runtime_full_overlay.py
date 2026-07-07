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

    def test_ingresses_are_owned_by_traefik_staging_class(self) -> None:
        ingresses = {
            doc["metadata"]["name"]: doc for doc in _rendered_docs() if doc.get("kind") == "Ingress"
        }

        self.assertEqual(set(ingresses), {"execution-control-staging"})
        for ingress in ingresses.values():
            with self.subTest(ingress=ingress["metadata"]["name"]):
                self.assertEqual(ingress["spec"]["ingressClassName"], "traefik-staging")
                self.assertEqual(
                    ingress["spec"]["tls"][0]["secretName"],
                    "mucwiki-edge-origin-tls",
                )


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
