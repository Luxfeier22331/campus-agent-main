from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml

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

    def test_rejects_plaintext_secret_manifest_under_gitops_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            secret = root / "infra" / "gitops" / "secrets" / "runtime.yaml"
            secret.write_text(
                "apiVersion: v1\n"
                "kind: Secret\n"
                "metadata:\n"
                "  name: execution-control-secrets\n"
                "  namespace: campus-agent-staging\n"
                "stringData:\n"
                "  EXAMPLE_ONLY: placeholder\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/secrets/runtime.yaml",
                        message=(
                            "GitOps secret delivery must not track plaintext Kubernetes "
                            "Secret; use SealedSecret, ExternalSecret, SOPS-encrypted "
                            "Secret or an operator runbook"
                        ),
                    ),
                ),
            )

    def test_accepts_sops_encrypted_secret_manifest_under_gitops_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            secret = root / "infra" / "gitops" / "secrets" / "runtime.sops.yaml"
            secret.write_text(
                "apiVersion: v1\n"
                "kind: Secret\n"
                "metadata:\n"
                "  name: execution-control-secrets\n"
                "  namespace: campus-agent-staging\n"
                "data:\n"
                "  EXAMPLE_ONLY: ENC[AES256_GCM,data:example,type:str]\n"
                "sops:\n"
                "  mac: ENC[AES256_GCM,data:example,type:str]\n",
                encoding="utf-8",
            )

            self.assertEqual(audit_gitops_skeleton(root=root), ())

    def test_rejects_wide_scope_sealed_secret_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            secret = root / "infra" / "gitops" / "secrets" / "runtime.sealedsecret.yaml"
            secret.write_text(
                "apiVersion: bitnami.com/v1alpha1\n"
                "kind: SealedSecret\n"
                "metadata:\n"
                "  name: execution-control-secrets\n"
                "  namespace: campus-agent-staging\n"
                "  annotations:\n"
                '    sealedsecrets.bitnami.com/cluster-wide: "true"\n'
                "spec:\n"
                "  encryptedData:\n"
                "    EXAMPLE_ONLY: AgByExample\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/secrets/runtime.sealedsecret.yaml",
                        message=(
                            "SealedSecret manifests must use strict scope by default; "
                            "remove sealedsecrets.bitnami.com/cluster-wide=true"
                        ),
                    ),
                ),
            )

    def test_rejects_local_secret_delivery_inputs_under_gitops_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            secret = root / "infra" / "gitops" / "secrets" / "runtime.secret.local.yaml"
            secret.write_text(
                "apiVersion: v1\nkind: Secret\nmetadata:\n  name: execution-control-secrets\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/secrets/runtime.secret.local.yaml",
                        message=(
                            "GitOps secret delivery must not track local plaintext inputs "
                            "or backup manifests"
                        ),
                    ),
                ),
            )

    def test_rejects_sealed_secret_without_encrypted_data(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            self.write_secret_contract(root)
            secret = root / "infra" / "gitops" / "secrets" / "runtime.sealedsecret.yaml"
            secret.write_text(
                "apiVersion: bitnami.com/v1alpha1\n"
                "kind: SealedSecret\n"
                "metadata:\n"
                "  name: execution-control-secrets\n"
                "  namespace: campus-agent-staging\n"
                "spec:\n"
                "  template:\n"
                "    metadata:\n"
                "      name: execution-control-secrets\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_gitops_skeleton(root=root),
                (
                    GitOpsSkeletonIssue(
                        path="infra/gitops/secrets/runtime.sealedsecret.yaml",
                        message="SealedSecret manifests must contain non-empty spec.encryptedData",
                    ),
                ),
            )

    def test_repo_execution_runtime_application_points_to_full_staging_overlay(self) -> None:
        app = yaml.safe_load(
            (
                Path(__file__).resolve().parents[1]
                / "infra"
                / "gitops"
                / "apps"
                / "execution-runtime-staging.yaml"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(
            app["spec"]["source"]["path"],
            "infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full",
        )

    def test_repo_declares_required_platform_applications(self) -> None:
        root = Path(__file__).resolve().parents[1]
        app_dir = root / "infra" / "gitops" / "apps"
        expected = {
            "data-postgres-staging.yaml",
            "data-qdrant-staging.yaml",
            "dining-sync-staging.yaml",
            "execution-runtime-staging.yaml",
            "ingress-traefik-staging.yaml",
            "memory-hindsight-staging.yaml",
            "observability-otel-collector-staging.yaml",
            "platform-cloudnativepg.yaml",
            "platform-external-secrets.yaml",
            "platform-keda.yaml",
            "platform-sealed-secrets.yaml",
            "platform-temporal-alias-staging.yaml",
            "platform-temporal-staging.yaml",
        }

        self.assertEqual({path.name for path in app_dir.glob("*.yaml")}, expected)

    def test_repo_platform_helm_applications_pin_chart_versions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        app_dir = root / "infra" / "gitops" / "apps"
        expected = {
            "data-qdrant-staging.yaml": ("qdrant", "1.18.2"),
            "ingress-traefik-staging.yaml": ("traefik", "41.0.1"),
            "memory-hindsight-staging.yaml": ("hindsight", "0.8.4"),
            "observability-otel-collector-staging.yaml": (
                "opentelemetry-collector",
                "0.162.0",
            ),
            "platform-cloudnativepg.yaml": ("cloudnative-pg", "0.29.0"),
            "platform-sealed-secrets.yaml": ("sealed-secrets", "2.19.1"),
            "platform-temporal-staging.yaml": ("temporal", "1.5.0"),
        }

        for filename, (chart, version) in expected.items():
            with self.subTest(filename=filename):
                app = yaml.safe_load((app_dir / filename).read_text(encoding="utf-8"))
                chart_source = next(
                    source
                    for source in app["spec"]["sources"]
                    if isinstance(source, dict) and source.get("chart")
                )
                self.assertEqual(chart_source["chart"], chart)
                self.assertEqual(chart_source["targetRevision"], version)
                self.assertIn(
                    "$values/infra/gitops/values/",
                    chart_source["helm"]["valueFiles"][0],
                )

    def test_repo_sealed_secrets_values_keep_kubeseal_default_controller_identity(self) -> None:
        root = Path(__file__).resolve().parents[1]
        values = yaml.safe_load(
            (root / "infra" / "gitops" / "values" / "sealed-secrets" / "staging.yaml").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(values["fullnameOverride"], "sealed-secrets-controller")
        self.assertEqual(values["namespace"], "kube-system")
        self.assertTrue(values["createController"])
        self.assertEqual(values["resources"]["requests"]["cpu"], "25m")
        self.assertEqual(values["resources"]["requests"]["memory"], "64Mi")
        self.assertEqual(values["resources"]["limits"]["cpu"], "150m")
        self.assertEqual(values["resources"]["limits"]["memory"], "256Mi")

    def test_hindsight_oci_application_uses_argocd_repo_url_without_oci_prefix(self) -> None:
        root = Path(__file__).resolve().parents[1]
        app = yaml.safe_load(
            (root / "infra" / "gitops" / "apps" / "memory-hindsight-staging.yaml").read_text(
                encoding="utf-8"
            )
        )

        chart_source = app["spec"]["sources"][0]
        self.assertEqual(chart_source["repoURL"], "ghcr.io/vectorize-io/charts")
        self.assertNotIn("oci://", chart_source["repoURL"])

    def test_qdrant_application_skips_values_driven_helm_test_hook(self) -> None:
        root = Path(__file__).resolve().parents[1]
        app = yaml.safe_load(
            (root / "infra" / "gitops" / "apps" / "data-qdrant-staging.yaml").read_text(
                encoding="utf-8"
            )
        )

        chart_source = app["spec"]["sources"][0]
        self.assertEqual(chart_source["chart"], "qdrant")
        self.assertTrue(chart_source["helm"]["skipTests"])

    def test_secret_delivery_docs_keep_backend_optional(self) -> None:
        root = Path(__file__).resolve().parents[1]
        secret_adr = (root / "docs" / "decisions" / "adr-0066-secret-delivery.md").read_text(
            encoding="utf-8"
        )
        secret_readme = (root / "infra" / "gitops" / "secrets" / "README.md").read_text(
            encoding="utf-8"
        )
        gitops_readme = (root / "infra" / "gitops" / "README.md").read_text(encoding="utf-8")

        self.assertIn("stable Kubernetes Secret names", secret_adr)
        self.assertIn("Manual Kubernetes Secrets", secret_readme)
        self.assertIn("Sealed Secrets", secret_readme)
        self.assertIn("External Secrets Operator", secret_readme)
        self.assertIn("optional External Secrets Operator", gitops_readme)
        self.assertIn("recommended default", secret_adr)
        self.assertNotIn(
            "Use External Secrets Operator as the target Kubernetes secret delivery layer",
            secret_adr,
        )


if __name__ == "__main__":
    unittest.main()
