from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_gitops_skeleton import GitOpsSkeletonIssue, audit_gitops_skeleton


class CheckGitOpsSkeletonTest(unittest.TestCase):
    def write_secret_contract(self, root: Path) -> None:
        readme = root / "infra" / "gitops" / "secrets" / "README.md"
        readme.parent.mkdir(parents=True, exist_ok=True)
        readme.write_text("# Secret Delivery\n", encoding="utf-8")

    def test_accepts_helm_chart_with_values_source(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            app = root / "infra" / "gitops" / "apps" / "platform-keda.yaml"
            values = root / "infra" / "gitops" / "values" / "keda" / "staging.yaml"
            app.parent.mkdir(parents=True)
            values.parent.mkdir(parents=True)
            values.write_text("logging:\n  operator:\n    level: info\n", encoding="utf-8")
            app.write_text(
                "apiVersion: argoproj.io/v1alpha1\n"
                "kind: Application\n"
                "metadata:\n"
                "  name: platform-keda\n"
                "  namespace: argocd\n"
                "spec:\n"
                "  project: default\n"
                "  sources:\n"
                "    - repoURL: https://kedacore.github.io/charts\n"
                "      chart: keda\n"
                "      targetRevision: 2.20.1\n"
                "      helm:\n"
                "        valueFiles:\n"
                "          - $values/infra/gitops/values/keda/staging.yaml\n"
                "    - repoURL: https://github.com/MUC-WIKI/campus-agent.git\n"
                "      targetRevision: develop\n"
                "      ref: values\n"
                "  destination:\n"
                "    server: https://kubernetes.default.svc\n"
                "    namespace: keda\n",
                encoding="utf-8",
            )

            self.assertEqual(audit_gitops_skeleton(root=root), ())

    def test_rejects_missing_kustomize_path(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            app = root / "infra" / "gitops" / "apps" / "runtime.yaml"
            app.parent.mkdir(parents=True)
            app.write_text(
                "apiVersion: argoproj.io/v1alpha1\n"
                "kind: Application\n"
                "metadata:\n"
                "  name: runtime\n"
                "  namespace: argocd\n"
                "spec:\n"
                "  project: default\n"
                "  source:\n"
                "    repoURL: https://github.com/MUC-WIKI/campus-agent.git\n"
                "    targetRevision: develop\n"
                "    path: infra/k8s/missing\n"
                "  destination:\n"
                "    server: https://kubernetes.default.svc\n"
                "    namespace: campus-agent-staging\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/apps/runtime.yaml",
                        message="source[0].path does not exist: infra/k8s/missing",
                    ),
                ),
            )

    def test_rejects_provider_secret_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            app = root / "infra" / "gitops" / "apps" / "runtime.yaml"
            runtime_path = root / "infra" / "k8s" / "execution-runtime" / "overlays" / "staging"
            app.parent.mkdir(parents=True)
            runtime_path.mkdir(parents=True)
            app.write_text(
                "apiVersion: argoproj.io/v1alpha1\n"
                "kind: Application\n"
                "metadata:\n"
                "  name: runtime\n"
                "  namespace: argocd\n"
                "spec:\n"
                "  project: default\n"
                "  source:\n"
                "    repoURL: https://github.com/MUC-WIKI/campus-agent.git\n"
                "    targetRevision: develop\n"
                "    path: infra/k8s/execution-runtime/overlays/staging\n"
                "  destination:\n"
                "    server: https://kubernetes.default.svc\n"
                "    namespace: campus-agent-staging\n"
                "  # PUBLIC_WEB_SEARCH_API_KEY must not be configured here.\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/apps/runtime.yaml",
                        message=(
                            "GitOps skeleton must not reference provider secret key "
                            "PUBLIC_WEB_SEARCH_API_KEY"
                        ),
                    ),
                ),
            )

    def test_rejects_helm_value_files_outside_values_source(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            app = root / "infra" / "gitops" / "apps" / "platform-keda.yaml"
            app.parent.mkdir(parents=True)
            app.write_text(
                "apiVersion: argoproj.io/v1alpha1\n"
                "kind: Application\n"
                "metadata:\n"
                "  name: platform-keda\n"
                "  namespace: argocd\n"
                "spec:\n"
                "  project: default\n"
                "  source:\n"
                "    repoURL: https://kedacore.github.io/charts\n"
                "    chart: keda\n"
                "    targetRevision: 2.20.1\n"
                "    helm:\n"
                "      valueFiles:\n"
                "        - ../../values/keda/staging.yaml\n"
                "  destination:\n"
                "    server: https://kubernetes.default.svc\n"
                "    namespace: keda\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/apps/platform-keda.yaml",
                        message="source[0].helm.valueFiles must use $values/ repo references",
                    ),
                ),
            )

    def test_rejects_missing_values_ref_source(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            app = root / "infra" / "gitops" / "apps" / "platform-keda.yaml"
            values = root / "infra" / "gitops" / "values" / "keda" / "staging.yaml"
            app.parent.mkdir(parents=True)
            values.parent.mkdir(parents=True)
            values.write_text("logging:\n  operator:\n    level: info\n", encoding="utf-8")
            app.write_text(
                "apiVersion: argoproj.io/v1alpha1\n"
                "kind: Application\n"
                "metadata:\n"
                "  name: platform-keda\n"
                "  namespace: argocd\n"
                "spec:\n"
                "  project: default\n"
                "  source:\n"
                "    repoURL: https://kedacore.github.io/charts\n"
                "    chart: keda\n"
                "    targetRevision: 2.20.1\n"
                "    helm:\n"
                "      valueFiles:\n"
                "        - $values/infra/gitops/values/keda/staging.yaml\n"
                "  destination:\n"
                "    server: https://kubernetes.default.svc\n"
                "    namespace: keda\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/apps/platform-keda.yaml",
                        message=(
                            "source[0].helm.valueFiles uses $values but Application lacks "
                            "campus-agent source with ref: values"
                        ),
                    ),
                ),
            )

    def test_rejects_missing_secret_delivery_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            app = root / "infra" / "gitops" / "apps" / "runtime.yaml"
            runtime_path = root / "infra" / "k8s" / "execution-runtime" / "overlays" / "staging"
            app.parent.mkdir(parents=True)
            runtime_path.mkdir(parents=True)
            app.write_text(
                "apiVersion: argoproj.io/v1alpha1\n"
                "kind: Application\n"
                "metadata:\n"
                "  name: runtime\n"
                "  namespace: argocd\n"
                "spec:\n"
                "  project: default\n"
                "  source:\n"
                "    repoURL: https://github.com/MUC-WIKI/campus-agent.git\n"
                "    targetRevision: develop\n"
                "    path: infra/k8s/execution-runtime/overlays/staging\n"
                "  destination:\n"
                "    server: https://kubernetes.default.svc\n"
                "    namespace: campus-agent-staging\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/secrets/README.md",
                        message="GitOps secret delivery contract README is required",
                    ),
                ),
            )


if __name__ == "__main__":
    unittest.main()
