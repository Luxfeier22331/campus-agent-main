from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
K8S_ROOT = ROOT / "infra/k8s/execution-runtime/base"
STAGING_OVERLAY = ROOT / "infra/k8s/execution-runtime/overlays/staging"

WORKERS = {
    "workflow-worker": ("workflow", "campus-agent.workflow", 3),
    "activity-worker-context": ("activity", "campus-agent.activity.context", 3),
    "activity-worker-agent": ("activity", "campus-agent.activity.agent", 3),
    "activity-worker-knowledge-plan": ("activity", "campus-agent.activity.knowledge.plan", 3),
    "activity-worker-knowledge-retrieval": (
        "activity",
        "campus-agent.activity.knowledge.retrieval",
        5,
    ),
    "activity-worker-knowledge-synthesis": (
        "activity",
        "campus-agent.activity.knowledge.synthesis",
        5,
    ),
    "activity-worker-campus-services": ("activity", "campus-agent.activity.campus_services", 3),
    "activity-worker-notice": ("activity", "campus-agent.activity.notice", 3),
    "activity-worker-navigation": ("activity", "campus-agent.activity.navigation", 3),
    "activity-worker-finalization": ("activity", "campus-agent.activity.finalization", 3),
}

FORBIDDEN_K8S_WORKLOADS = (
    "app-api",
    "campus-web",
    "operator-console-web",
    "operator-panel",
    "authenticated-notice-collector",
    "official-web-collector",
    "wechat-official-account-collector",
    "ingestion-control",
    "ingestion-worker",
    "legacy-office-conversion-service",
    "super" + "visor-agent-worker",
    "worker-autoscaler",
)

AVAILABLE_RUNTIME_TARGETS = ("execution-control", *WORKERS.keys())


def _docs() -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    for path in sorted(K8S_ROOT.glob("*.yaml")):
        for doc in yaml.safe_load_all(path.read_text(encoding="utf-8")):
            if isinstance(doc, dict):
                doc["_source_path"] = path.relative_to(ROOT).as_posix()
                docs.append(doc)
    return docs


def _by_kind_name(kind: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for doc in _docs():
        if doc.get("kind") == kind:
            result[str(doc["metadata"]["name"])] = doc
    return result


def _deployment_container(deployment: dict[str, Any]) -> dict[str, Any]:
    containers = deployment["spec"]["template"]["spec"]["containers"]
    if len(containers) != 1:
        raise AssertionError(f"{deployment['metadata']['name']} must have exactly one container")
    return containers[0]


def _surface_identity_values(doc: dict[str, Any]) -> list[tuple[str, str]]:
    values: list[tuple[str, str]] = []
    kind = str(doc.get("kind", "resource"))
    metadata = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
    labels = metadata.get("labels") if isinstance(metadata.get("labels"), dict) else {}
    values.append((f"{kind}.metadata.name", str(metadata.get("name", ""))))
    for key in ("app.kubernetes.io/name", "app.kubernetes.io/component"):
        if key in labels:
            values.append((f"{kind}.metadata.labels.{key}", str(labels[key])))

    spec = doc.get("spec") if isinstance(doc.get("spec"), dict) else {}
    selector = spec.get("selector") if isinstance(spec.get("selector"), dict) else {}
    selector_labels = (
        selector.get("matchLabels") if isinstance(selector.get("matchLabels"), dict) else selector
    )
    for key, value in selector_labels.items():
        values.append((f"{kind}.spec.selector.{key}", str(value)))

    scale_target = (
        spec.get("scaleTargetRef") if isinstance(spec.get("scaleTargetRef"), dict) else {}
    )
    if scale_target.get("name"):
        values.append((f"{kind}.spec.scaleTargetRef.name", str(scale_target["name"])))

    template = spec.get("template") if isinstance(spec.get("template"), dict) else {}
    template_metadata = (
        template.get("metadata") if isinstance(template.get("metadata"), dict) else {}
    )
    template_labels = (
        template_metadata.get("labels") if isinstance(template_metadata.get("labels"), dict) else {}
    )
    for key in ("app.kubernetes.io/name", "app.kubernetes.io/component"):
        if key in template_labels:
            values.append(
                (f"{kind}.spec.template.metadata.labels.{key}", str(template_labels[key]))
            )

    pod_spec = template.get("spec") if isinstance(template.get("spec"), dict) else {}
    for container in pod_spec.get("containers", []):
        if not isinstance(container, dict):
            continue
        values.append((f"{kind}.container.name", str(container.get("name", ""))))
        values.append((f"{kind}.container.image", str(container.get("image", ""))))
        for token in container.get("command", []):
            token = str(token)
            if token.startswith("/usr/local/bin/"):
                values.append((f"{kind}.container.command", Path(token).name))
    return values


class K8sExecutionRuntimeManifestTest(unittest.TestCase):
    def test_only_execution_runtime_surfaces_are_present(self) -> None:
        for doc in _docs():
            for source, value in _surface_identity_values(doc):
                for forbidden in FORBIDDEN_K8S_WORKLOADS:
                    with self.subTest(source=source, value=value, forbidden=forbidden):
                        self.assertNotIn(forbidden, value)

    def test_each_worker_has_deployment_and_scaledobject(self) -> None:
        deployments = _by_kind_name("Deployment")
        scaled_objects = _by_kind_name("ScaledObject")

        for worker, (queue_type, task_queue, max_replicas) in WORKERS.items():
            with self.subTest(worker=worker):
                self.assertIn(worker, deployments)
                self.assertIn(worker, scaled_objects)
                spec = scaled_objects[worker]["spec"]
                self.assertEqual(spec["scaleTargetRef"]["name"], worker)
                self.assertEqual(spec["minReplicaCount"], 1)
                self.assertEqual(spec["maxReplicaCount"], max_replicas)
                trigger = spec["triggers"][0]
                self.assertEqual(trigger["type"], "temporal")
                metadata = trigger["metadata"]
                self.assertEqual(metadata["queueTypes"], queue_type)
                self.assertEqual(metadata["taskQueue"], task_queue)
                self.assertEqual(metadata["targetQueueSize"], "8")

    def test_k8s_uses_keda_posture_collector_not_worker_autoscaler(self) -> None:
        deployments = _by_kind_name("Deployment")
        self.assertIn("keda-hpa-posture-collector", deployments)
        self.assertIn("temporal-task-queue-sampler", deployments)
        self.assertNotIn("worker-autoscaler", deployments)

    def test_worker_probes_use_role_runtime_check_not_config_file_presence(self) -> None:
        deployments = _by_kind_name("Deployment")

        for worker in WORKERS:
            with self.subTest(worker=worker):
                container = _deployment_container(deployments[worker])
                readiness = container["readinessProbe"]["exec"]["command"]
                liveness = container["livenessProbe"]["exec"]["command"]
                self.assertEqual(readiness, [f"/usr/local/bin/{worker}", "--check-runtime"])
                self.assertEqual(liveness, [f"/usr/local/bin/{worker}", "--check-runtime"])

    def test_only_posture_collector_service_account_can_read_k8s_posture(self) -> None:
        roles = _by_kind_name("Role")
        bindings = _by_kind_name("RoleBinding")
        deployments = _by_kind_name("Deployment")

        self.assertIn("keda-hpa-posture-reader", roles)
        self.assertIn("keda-hpa-posture-reader", bindings)
        binding_subjects = bindings["keda-hpa-posture-reader"]["subjects"]
        self.assertEqual(
            binding_subjects,
            [
                {
                    "kind": "ServiceAccount",
                    "name": "keda-hpa-posture-reader",
                    "namespace": "campus-agent-staging",
                }
            ],
        )
        self.assertEqual(
            deployments["keda-hpa-posture-collector"]["spec"]["template"]["spec"][
                "serviceAccountName"
            ],
            "keda-hpa-posture-reader",
        )
        for name, deployment in deployments.items():
            if name == "keda-hpa-posture-collector":
                continue
            with self.subTest(deployment=name):
                self.assertNotEqual(
                    deployment["spec"]["template"]["spec"].get("serviceAccountName"),
                    "keda-hpa-posture-reader",
                )

    def test_execution_namespace_has_default_deny_network_policy(self) -> None:
        policies = _by_kind_name("NetworkPolicy")

        self.assertIn("execution-runtime-default-deny", policies)
        policy = policies["execution-runtime-default-deny"]
        self.assertEqual(policy["spec"]["podSelector"], {})
        self.assertEqual(policy["spec"]["policyTypes"], ["Ingress", "Egress"])

    def test_availability_manifest_is_included_in_base_kustomization(self) -> None:
        kustomization = yaml.safe_load(
            (K8S_ROOT / "kustomization.yaml").read_text(encoding="utf-8")
        )

        self.assertIn("availability.yaml", kustomization["resources"])

    def test_execution_runtime_has_pod_disruption_budgets_for_available_targets(self) -> None:
        pdbs = _by_kind_name("PodDisruptionBudget")

        for name in AVAILABLE_RUNTIME_TARGETS:
            with self.subTest(target=name):
                self.assertIn(name, pdbs)
                spec = pdbs[name]["spec"]
                self.assertEqual(spec["minAvailable"], 1)
                self.assertEqual(
                    spec["selector"]["matchLabels"],
                    {"app.kubernetes.io/name": name},
                )

    def test_execution_runtime_rollouts_keep_one_pod_available(self) -> None:
        deployments = _by_kind_name("Deployment")

        for name in AVAILABLE_RUNTIME_TARGETS:
            with self.subTest(target=name):
                self.assertIn("strategy", deployments[name]["spec"])
                strategy = deployments[name]["spec"]["strategy"]
                self.assertEqual(strategy["type"], "RollingUpdate")
                rolling_update = strategy["rollingUpdate"]
                self.assertEqual(rolling_update["maxUnavailable"], 0)
                self.assertEqual(rolling_update["maxSurge"], 1)

    def test_posture_reader_can_list_events_and_workers_cannot(self) -> None:
        role = _by_kind_name("Role")["keda-hpa-posture-reader"]

        event_rules = [
            rule
            for rule in role["rules"]
            if rule["apiGroups"] == [""] and rule["resources"] == ["events"]
        ]
        self.assertEqual(len(event_rules), 1)
        self.assertEqual(event_rules[0]["verbs"], ["list"])

    def test_execution_network_policy_keeps_required_runtime_paths(self) -> None:
        policies = _by_kind_name("NetworkPolicy")

        namespace_policy = policies["execution-runtime-namespace-traffic"]
        self.assertEqual(
            namespace_policy["spec"]["egress"][0]["to"][0]["podSelector"]["matchLabels"],
            {"app.kubernetes.io/part-of": "campus-agent"},
        )

        platform_policy = policies["execution-runtime-platform-egress"]
        platform_egress = platform_policy["spec"]["egress"]
        dns_ports = platform_egress[0]["ports"]
        self.assertEqual(
            dns_ports, [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}]
        )
        external = platform_egress[1]
        self.assertEqual(external["to"], [{"ipBlock": {"cidr": "0.0.0.0/0"}}])
        self.assertEqual(
            external["ports"], [{"protocol": "TCP", "port": 443}, {"protocol": "TCP", "port": 5432}]
        )

        keda_policy = policies["execution-runtime-temporal-keda-ingress"]
        self.assertEqual(
            keda_policy["spec"]["podSelector"]["matchLabels"],
            {"app.kubernetes.io/name": "temporal"},
        )
        self.assertEqual(
            keda_policy["spec"]["ingress"][0]["from"],
            [{"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "keda"}}}],
        )
        self.assertEqual(
            keda_policy["spec"]["ingress"][0]["ports"], [{"protocol": "TCP", "port": 7233}]
        )

    def test_release_overlay_cannot_keep_mutable_runtime_identity(self) -> None:
        config = _by_kind_name("ConfigMap")["execution-runtime-config"]["data"]
        self.assertNotEqual(config["EXECUTION_CONTROL_RUNTIME_RELEASE"], "staging-k8s")
        self.assertRegex(
            config["EXECUTION_CONTROL_RUNTIME_RELEASE"],
            r"^execution-control@[0-9a-f]{7,40}$",
        )

    def test_staging_overlay_keeps_runtime_identity_traceable(self) -> None:
        if shutil.which("kubectl") is None:
            self.skipTest("kubectl is required for kustomize overlay validation")

        rendered = subprocess.run(
            ["kubectl", "kustomize", str(STAGING_OVERLAY)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        configs = [
            doc
            for doc in yaml.safe_load_all(rendered)
            if isinstance(doc, dict)
            and doc.get("kind") == "ConfigMap"
            and doc.get("metadata", {}).get("name") == "execution-runtime-config"
        ]
        self.assertEqual(len(configs), 1)
        release = configs[0]["data"]["EXECUTION_CONTROL_RUNTIME_RELEASE"]
        self.assertNotEqual(release, "staging-k8s")
        self.assertRegex(release, r"^execution-control@[0-9a-f]{7,40}$")


if __name__ == "__main__":
    unittest.main()
