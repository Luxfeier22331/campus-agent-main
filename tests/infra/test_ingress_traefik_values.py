from __future__ import annotations

import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


class IngressTraefikValuesTest(unittest.TestCase):
    def test_shadow_values_use_non_default_class_and_shadow_host_ports(self) -> None:
        values = _load("nc-arm-6c-shadow.yaml")

        self.assertEqual(values["ingressClass"]["name"], "traefik-staging")
        self.assertFalse(values["ingressClass"]["isDefaultClass"])
        self.assertEqual(
            values["providers"]["kubernetesIngress"]["ingressClass"], "traefik-staging"
        )
        self.assertEqual(
            values["providers"]["kubernetesIngress"]["namespaces"], ["campus-agent-staging"]
        )
        self.assertFalse(values["providers"]["kubernetesCRD"]["enabled"])
        self.assertFalse(values["providers"]["kubernetesGateway"]["enabled"])
        self.assertEqual(values["ports"]["web"]["hostPort"], 18080)
        self.assertEqual(values["ports"]["websecure"]["hostPort"], 18443)
        self.assertFalse(values["service"]["enabled"])

    def test_cutover_values_bind_public_host_ports_only_for_explicit_cutover(self) -> None:
        values = _load("nc-arm-6c-cutover.yaml")

        self.assertEqual(values["ingressClass"]["name"], "traefik-staging")
        self.assertFalse(values["ingressClass"]["isDefaultClass"])
        self.assertEqual(values["ports"]["web"]["hostPort"], 80)
        self.assertEqual(values["ports"]["websecure"]["hostPort"], 443)
        self.assertFalse(values["service"]["enabled"])


def _load(name: str) -> dict:
    path = ROOT / "infra" / "gitops" / "values" / "traefik" / name
    return yaml.safe_load(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
