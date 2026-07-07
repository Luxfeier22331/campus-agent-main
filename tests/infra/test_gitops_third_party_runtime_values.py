from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]


class GitOpsThirdPartyRuntimeValuesTest(unittest.TestCase):
    def test_staging_external_secret_example_keeps_platform_secrets_out_of_execution_runtime(
        self,
    ) -> None:
        docs = _yaml_docs(
            "infra/gitops/secrets/staging-secret-delivery.externalsecrets.example.yaml"
        )
        external_secrets = {
            doc["metadata"]["name"]: doc for doc in docs if doc.get("kind") == "ExternalSecret"
        }

        self.assertIn("data-qdrant-server-secrets", external_secrets)
        qdrant_secret = external_secrets["data-qdrant-server-secrets"]
        self.assertEqual(qdrant_secret["spec"]["target"]["name"], "qdrant-server-secrets")
        self.assertNotIn("execution-qdrant-server-secrets", str(qdrant_secret))
        self.assertEqual(
            set(qdrant_secret["spec"]["target"]["template"]["data"]),
            {"QDRANT_API_KEY", "QDRANT_READ_ONLY_API_KEY", "local.yaml"},
        )
        self.assertIn(
            'api_key: "{{ .qdrantApiKey }}"',
            qdrant_secret["spec"]["target"]["template"]["data"]["local.yaml"],
        )
        self.assertEqual(
            {
                external_secrets["data-qdrant-server-tls"]["spec"]["target"]["name"],
                external_secrets["platform-temporal-db-secret"]["spec"]["target"]["name"],
                external_secrets["memory-hindsight-api-secrets"]["spec"]["target"]["name"],
                external_secrets["observability-otel-collector-secrets"]["spec"]["target"]["name"],
            },
            {
                "qdrant-server-tls",
                "temporal-db-secret",
                "hindsight-api-secrets",
                "otel-collector-secrets",
            },
        )

    def test_hindsight_uses_external_provider_and_external_postgres_without_ui(self) -> None:
        values = _load_values("hindsight/staging.yaml")

        self.assertTrue(values["api"]["enabled"])
        self.assertFalse(values["controlPlane"]["enabled"])
        self.assertFalse(values["worker"]["enabled"])
        self.assertFalse(values["postgresql"]["enabled"])
        self.assertFalse(values["tei"]["reranker"]["enabled"])
        self.assertFalse(values["tei"]["embedding"]["enabled"])
        self.assertEqual(values["existingSecret"], "hindsight-api-secrets")
        self.assertEqual(values["postgresql"]["external"]["host"], "campus-agent-postgres-rw")
        self.assertEqual(values["api"]["env"]["HINDSIGHT_API_LLM_PROVIDER"], "openai")
        self.assertEqual(values["api"]["env"]["HINDSIGHT_API_EMBEDDINGS_PROVIDER"], "openai")
        self.assertNotIn("HINDSIGHT_API_DATABASE_URL", values["api"]["env"])

        docs = _helm_docs(
            "hindsight",
            "oci://ghcr.io/vectorize-io/charts/hindsight",
            ["-f", "infra/gitops/values/hindsight/staging.yaml"],
        )
        self.assertEqual(_names(docs, "Deployment"), {"hindsight-api"})
        self.assertEqual(_names(docs, "Service"), {"hindsight-api"})
        self.assertEqual(_names(docs, "StatefulSet"), set())

    def test_qdrant_helm_values_own_server_credentials_not_execution_runtime(self) -> None:
        values = _load_values("qdrant/staging.yaml")

        self.assertEqual(values["fullnameOverride"], "qdrant")
        self.assertFalse(values["apiKey"])
        self.assertFalse(values["readOnlyApiKey"])
        self.assertFalse(values["config"]["cluster"]["enabled"])
        self.assertTrue(values["config"]["service"]["enable_tls"])
        self.assertEqual(
            values["config"]["tls"],
            {
                "cert": "/qdrant/tls/tls.crt",
                "key": "/qdrant/tls/tls.key",
                "ca_cert": "/qdrant/tls/ca.crt",
            },
        )
        volume_names = {volume["name"] for volume in values["additionalVolumes"]}
        self.assertEqual(volume_names, {"qdrant-server-config", "qdrant-server-tls"})
        secret_names = {
            volume["secret"]["secretName"]
            for volume in values["additionalVolumes"]
            if "secret" in volume
        }
        self.assertEqual(secret_names, {"qdrant-server-secrets", "qdrant-server-tls"})
        mount_paths = {mount["mountPath"] for mount in values["additionalVolumeMounts"]}
        self.assertEqual(mount_paths, {"/qdrant/config/local.yaml", "/qdrant/tls"})

        docs = _helm_docs(
            "qdrant",
            "qdrant",
            [
                "--repo",
                "https://qdrant.github.io/qdrant-helm",
                "--version",
                "1.18.2",
                "--skip-tests",
                "-f",
                "infra/gitops/values/qdrant/staging.yaml",
            ],
        )
        self.assertIn("qdrant", _names(docs, "Service"))
        self.assertEqual(_names(docs, "StatefulSet"), {"qdrant"})
        configmap = next(
            doc
            for doc in docs
            if doc.get("kind") == "ConfigMap" and doc["metadata"]["name"] == "qdrant"
        )
        self.assertIn("enable_tls: true", configmap["data"]["production.yaml"])
        stateful_set = next(doc for doc in docs if doc.get("kind") == "StatefulSet")
        qdrant_container = stateful_set["spec"]["template"]["spec"]["containers"][0]
        self.assertEqual(
            {
                (mount["name"], mount["mountPath"], mount.get("readOnly", False))
                for mount in qdrant_container["volumeMounts"]
            }
            & {
                ("qdrant-server-config", "/qdrant/config/local.yaml", True),
                ("qdrant-server-tls", "/qdrant/tls", True),
            },
            {
                ("qdrant-server-config", "/qdrant/config/local.yaml", True),
                ("qdrant-server-tls", "/qdrant/tls", True),
            },
        )

    def test_temporal_uses_external_cnpg_databases_and_disables_ui_by_default(self) -> None:
        values = _load_values("temporal/staging.yaml")
        app = _yaml_docs("infra/gitops/apps/platform-temporal-staging.yaml")[0]
        chart_source = app["spec"]["sources"][0]

        self.assertTrue(chart_source["helm"]["skipTests"])
        self.assertFalse(values["web"]["enabled"])
        self.assertFalse(values["admintools"]["enabled"])
        self.assertFalse(values["shims"]["dockerize"])
        self.assertFalse(values["shims"]["elasticsearchTool"])
        self.assertTrue(values["server"]["config"]["namespaces"]["create"])
        datastores = values["server"]["config"]["persistence"]["datastores"]
        self.assertEqual(
            datastores["default"]["sql"]["connectAddr"],
            "campus-agent-postgres-rw:5432",
        )
        self.assertFalse(datastores["default"]["sql"]["createDatabase"])
        self.assertTrue(datastores["default"]["sql"]["manageSchema"])
        self.assertFalse(datastores["visibility"]["sql"]["createDatabase"])
        self.assertTrue(datastores["visibility"]["sql"]["manageSchema"])
        self.assertEqual(
            datastores["visibility"]["sql"]["databaseName"],
            "temporal_visibility",
        )
        self.assertEqual(
            datastores["default"]["sql"]["existingSecret"],
            "temporal-db-secret",
        )

        docs = _helm_docs(
            "temporal",
            "temporal",
            [
                "--repo",
                "https://go.temporal.io/helm-charts",
                "--version",
                "1.5.0",
                "--skip-tests",
                "-f",
                "infra/gitops/values/temporal/staging.yaml",
            ],
        )
        self.assertEqual(
            _names(docs, "Deployment"),
            {"temporal-frontend", "temporal-history", "temporal-matching", "temporal-worker"},
        )
        self.assertNotIn("temporal-web", _names(docs, "Deployment"))
        self.assertNotIn("Pod", {doc.get("kind") for doc in docs})

        schema_job = next(
            doc
            for doc in docs
            if doc.get("kind") == "Job" and doc["metadata"]["name"] == "temporal-schema"
        )
        schema_annotations = schema_job["metadata"]["annotations"]
        self.assertEqual(schema_annotations["helm.sh/hook"], "pre-install,pre-upgrade")
        self.assertNotIn("argocd.argoproj.io/hook", schema_annotations)
        pod_spec = schema_job["spec"]["template"]["spec"]
        schema_containers = pod_spec.get("initContainers", []) + pod_spec.get("containers", [])
        commands = [
            " ".join([*(container.get("command") or []), *(container.get("args") or [])])
            for container in schema_containers
        ]
        self.assertNotIn("temporal-sql-tool create-database", "\n".join(commands))

    def test_otel_collector_is_helm_owned_and_reads_secret_contract(self) -> None:
        values = _load_values("opentelemetry-collector/staging.yaml")

        self.assertEqual(values["mode"], "deployment")
        self.assertEqual(values["image"]["repository"], "otel/opentelemetry-collector-contrib")
        self.assertEqual(
            values["extraEnvsFrom"],
            [{"secretRef": {"name": "otel-collector-secrets"}}],
        )
        self.assertIn("bearertokenauth", values["alternateConfig"]["extensions"])
        self.assertIn("otlphttp/langfuse", values["alternateConfig"]["exporters"])
        self.assertFalse(values["presets"]["kubernetesAttributes"]["enabled"])

        docs = _helm_docs(
            "otel-collector",
            "opentelemetry-collector",
            [
                "--repo",
                "https://open-telemetry.github.io/opentelemetry-helm-charts",
                "--version",
                "0.162.0",
                "-f",
                "infra/gitops/values/opentelemetry-collector/staging.yaml",
            ],
        )
        self.assertEqual(_names(docs, "Deployment"), {"otel-collector"})
        self.assertEqual(_names(docs, "Service"), {"otel-collector"})

    def test_cnpg_postgres_declares_cluster_roles_databases_and_pgvector(self) -> None:
        _helm_docs(
            "cnpg",
            "cloudnative-pg",
            [
                "--repo",
                "https://cloudnative-pg.github.io/charts",
                "--version",
                "0.29.0",
                "-f",
                "infra/gitops/values/cloudnativepg/staging.yaml",
            ],
        )
        docs = _kustomize_docs("infra/k8s/data-postgres/overlays/nc-arm-6c-staging")
        clusters = [doc for doc in docs if doc.get("kind") == "Cluster"]
        self.assertEqual(len(clusters), 1)
        cluster = clusters[0]

        self.assertEqual(cluster["spec"]["instances"], 1)
        self.assertEqual(
            cluster["spec"]["imageName"], "ghcr.io/cloudnative-pg/postgresql:18.0-trixie"
        )
        self.assertEqual(
            cluster["spec"]["postgresql"]["extensions"],
            [
                {
                    "name": "pgvector",
                    "image": {"reference": "ghcr.io/cloudnative-pg/pgvector:0.8.1-18-trixie"},
                }
            ],
        )
        self.assertEqual(
            _names(docs, "Database"),
            {
                "campus-agent-postgres-campus-agent",
                "campus-agent-postgres-hindsight",
                "campus-agent-postgres-temporal",
                "campus-agent-postgres-temporal-visibility",
            },
        )
        hindsight = next(
            doc
            for doc in docs
            if doc.get("kind") == "Database"
            and doc["metadata"]["name"] == "campus-agent-postgres-hindsight"
        )
        self.assertEqual(hindsight["spec"]["extensions"], [{"name": "vector"}])


def _load_values(relative: str) -> dict[str, Any]:
    return yaml.safe_load((ROOT / "infra/gitops/values" / relative).read_text(encoding="utf-8"))


def _helm_docs(release: str, chart: str, args: list[str]) -> tuple[dict[str, Any], ...]:
    result = subprocess.run(
        ["helm", "template", release, chart, "--namespace", "campus-agent-staging", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return tuple(doc for doc in yaml.safe_load_all(result.stdout) if isinstance(doc, dict))


def _kustomize_docs(path: str) -> tuple[dict[str, Any], ...]:
    result = subprocess.run(
        ["kubectl", "kustomize", path],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return tuple(doc for doc in yaml.safe_load_all(result.stdout) if isinstance(doc, dict))


def _yaml_docs(path: str) -> tuple[dict[str, Any], ...]:
    return tuple(
        doc
        for doc in yaml.safe_load_all((ROOT / path).read_text(encoding="utf-8"))
        if isinstance(doc, dict)
    )


def _names(docs: tuple[dict[str, Any], ...], kind: str) -> set[str]:
    return {str(doc["metadata"]["name"]) for doc in docs if doc.get("kind") == kind}


if __name__ == "__main__":
    unittest.main()
