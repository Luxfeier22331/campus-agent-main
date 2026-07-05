from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

from scripts.check_k8s_execution_runtime_slim_overlay import _is_secret_like_key, audit_slim_overlay

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "infra/k8s/execution-runtime/overlays/nc-arm-6c-staging"


class CheckK8sExecutionRuntimeSlimOverlayTest(unittest.TestCase):
    def test_requires_nc_arm_6c_overlay(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            issues = audit_slim_overlay(root=Path(directory))

        self.assertTrue(any(issue.path.endswith("overlays/nc-arm-6c-staging") for issue in issues))

    def test_repo_overlay_is_slim_and_externalizes_stateful_dependencies(self) -> None:
        issues = audit_slim_overlay(root=ROOT)

        self.assertEqual([f"{issue.path}: {issue.message}" for issue in issues], [])

    def test_required_runtime_deployments_mount_runtime_projection_artifacts(self) -> None:
        deployments = {
            doc["metadata"]["name"]: doc
            for doc in _rendered_docs()
            if doc.get("kind") == "Deployment"
        }

        for name in ("execution-control", "activity-worker-knowledge"):
            with self.subTest(name=name):
                volume_names = {
                    volume["name"]
                    for volume in deployments[name]["spec"]["template"]["spec"].get("volumes", [])
                }
                self.assertIn("provider-config-projection", volume_names)
                self.assertIn("qdrant-tls-ca", volume_names)

        for name in ("activity-worker-core", "activity-worker-agent"):
            with self.subTest(name=name):
                volume_names = {
                    volume["name"]
                    for volume in deployments[name]["spec"]["template"]["spec"].get("volumes", [])
                }
                self.assertEqual(volume_names, {"provider-config-projection"})

    def test_secret_like_configmap_key_detection_covers_generated_secret_names(self) -> None:
        for key in (
            "PUBLIC_CACHE_SALT",
            "OTEL_EXPORTER_TOKEN",
            "OBJECT_STORE_ACCESS_KEY",
            "TLS_PRIVATE_KEY",
        ):
            with self.subTest(key=key):
                self.assertTrue(_is_secret_like_key(key))

    def test_network_policy_allows_only_required_docker_host_ports(self) -> None:
        policies = {
            doc["metadata"]["name"]: doc
            for doc in _rendered_docs()
            if doc.get("kind") == "NetworkPolicy"
        }

        egress_rules = policies["execution-runtime-platform-egress"]["spec"]["egress"]
        docker_host_rules = [
            rule
            for rule in egress_rules
            if rule.get("to") == [{"ipBlock": {"cidr": "10.42.0.1/32"}}]
        ]

        self.assertEqual(len(docker_host_rules), 1)
        self.assertEqual(
            docker_host_rules[0]["ports"],
            [
                {"protocol": "TCP", "port": 4318},
                {"protocol": "TCP", "port": 5432},
                {"protocol": "TCP", "port": 6333},
                {"protocol": "TCP", "port": 7233},
                {"protocol": "TCP", "port": 8888},
            ],
        )

    def test_rendered_env_entries_do_not_mix_value_and_value_from(self) -> None:
        for doc in _rendered_docs():
            if doc.get("kind") != "Deployment":
                continue
            for container in doc["spec"]["template"]["spec"].get("containers", []):
                for env in container.get("env", []):
                    with self.subTest(
                        deployment=doc["metadata"]["name"],
                        container=container["name"],
                        env=env["name"],
                    ):
                        self.assertFalse("value" in env and "valueFrom" in env)

    def test_runtime_env_is_owned_by_rendered_configmap_only(self) -> None:
        rendered_keys = _rendered_config_keys()
        for doc in _rendered_docs():
            if doc.get("kind") != "Deployment":
                continue
            for container in doc["spec"]["template"]["spec"].get("containers", []):
                env_from = container.get("envFrom", [])
                with self.subTest(deployment=doc["metadata"]["name"], container=container["name"]):
                    self.assertNotIn(
                        {"configMapRef": {"name": "execution-runtime-config"}},
                        env_from,
                    )
                    self.assertIn(
                        {"configMapRef": {"name": "execution-runtime-rendered-config"}},
                        env_from,
                    )
                for env in container.get("env", []):
                    with self.subTest(
                        deployment=doc["metadata"]["name"],
                        container=container["name"],
                        env=env["name"],
                    ):
                        self.assertNotIn(env["name"], rendered_keys)

    def test_slim_runtime_deployments_do_not_consume_full_only_configmaps(self) -> None:
        forbidden_configmaps = {
            "execution-runtime-config",
            "execution-telemetry-collector-config",
        }
        for doc in _rendered_docs():
            if doc.get("kind") != "Deployment":
                continue
            for container in doc["spec"]["template"]["spec"].get("containers", []):
                refs = {
                    entry.get("configMapRef", {}).get("name")
                    for entry in container.get("envFrom", [])
                    if isinstance(entry, dict)
                }
                with self.subTest(deployment=doc["metadata"]["name"], container=container["name"]):
                    self.assertTrue(forbidden_configmaps.isdisjoint(refs))

    def test_execution_control_hostport_is_bound_to_docker_proxy_bridge_only(self) -> None:
        deployments = {
            doc["metadata"]["name"]: doc
            for doc in _rendered_docs()
            if doc.get("kind") == "Deployment"
        }
        strategy = deployments["execution-control"]["spec"]["strategy"]
        ports = deployments["execution-control"]["spec"]["template"]["spec"]["containers"][0][
            "ports"
        ]

        self.assertEqual(strategy, {"type": "Recreate"})
        self.assertIn(
            {
                "name": "http",
                "containerPort": 8000,
                "hostIP": "172.20.0.1",
                "hostPort": 27051,
            },
            ports,
        )

    def test_execution_control_host_traefik_ingress_is_explicit(self) -> None:
        policies = {
            doc["metadata"]["name"]: doc
            for doc in _rendered_docs()
            if doc.get("kind") == "NetworkPolicy"
        }
        ingress = policies["execution-control-host-traefik-ingress"]["spec"]["ingress"]

        self.assertEqual(
            ingress,
            [
                {
                    "from": [
                        {"ipBlock": {"cidr": "172.20.0.0/16"}},
                        {"ipBlock": {"cidr": "10.42.0.1/32"}},
                    ],
                    "ports": [{"protocol": "TCP", "port": 8000}],
                }
            ],
        )

    def test_runbook_uses_env_renderer_not_raw_env_file_secret(self) -> None:
        runbook = (ROOT / "docs/runbooks/gitops-k8s.md").read_text(encoding="utf-8")

        self.assertIn("render-execution-runtime-k8s-env.sh | kubectl apply -f -", runbook)
        self.assertNotIn("render-execution-runtime-k8s-secrets.sh", runbook)
        self.assertNotIn(
            "--from-env-file /srv/docker/campus-agent/staging/env/runtime.env", runbook
        )

    def test_external_service_ports_match_endpoint_slices(self) -> None:
        docs = _rendered_docs()
        services = {doc["metadata"]["name"]: doc for doc in docs if doc.get("kind") == "Service"}
        endpoint_slices = {
            doc["metadata"]["name"]: doc for doc in docs if doc.get("kind") == "EndpointSlice"
        }

        for name in (
            "temporal",
            "hindsight-api",
            "qdrant",
            "campus-agent-postgres",
            "otel-collector",
        ):
            with self.subTest(name=name):
                service_ports = [
                    (port["name"], port["port"]) for port in services[name]["spec"]["ports"]
                ]
                endpoint_ports = [
                    (port["name"], port["port"]) for port in endpoint_slices[name]["ports"]
                ]
                self.assertEqual(service_ports, endpoint_ports)

    def test_docker_host_bind_overrides_replace_ports_instead_of_appending(self) -> None:
        for path in (
            "infra/local/docker-compose.execution-control-runtime.k8s-host.yml",
            "infra/local/docker-compose.postgres-k8s-host.yml",
            "infra/local/docker-compose.qdrant-k8s-host.yml",
        ):
            with self.subTest(path=path):
                text = (ROOT / path).read_text(encoding="utf-8")

                self.assertIn("ports: !override", text)
                self.assertNotIn("ports:\n      -", text)


def _rendered_docs() -> tuple[dict, ...]:
    result = subprocess.run(
        ("kubectl", "kustomize", str(OVERLAY)),
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return tuple(doc for doc in yaml.safe_load_all(result.stdout) if isinstance(doc, dict))


def _rendered_config_keys() -> set[str]:
    import json

    boundary = json.loads(
        (ROOT / "configs/runtime/k8s-execution-runtime-env-boundary.v1.json").read_text(
            encoding="utf-8"
        )
    )
    return set(boundary["configmaps"]["execution-runtime-rendered-config"])


if __name__ == "__main__":
    unittest.main()
