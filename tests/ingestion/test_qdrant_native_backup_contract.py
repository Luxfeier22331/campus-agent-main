from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class QdrantNativeBackupContractTest(unittest.TestCase):
    def test_object_store_snapshot_create_restore_are_not_active_worker_commands(self) -> None:
        self.assertFalse((REPO_ROOT / "apps" / "ingestion-worker").exists())

    def test_object_store_snapshot_create_restore_are_not_public_python_core_api(self) -> None:
        self.assertFalse((REPO_ROOT / "packages" / "ingestion-core").exists())

    def test_self_hosted_qdrant_healthcheck_uses_configured_tls_tcp_probe(self) -> None:
        compose_path = REPO_ROOT / "infra" / "local" / "docker-compose.qdrant-single-node.yml"
        compose = compose_path.read_text(encoding="utf-8")

        self.assertIn("QDRANT__SERVICE__API_KEY", compose)
        self.assertIn("QDRANT__SERVICE__READ_ONLY_API_KEY", compose)
        self.assertIn('QDRANT__SERVICE__ENABLE_TLS: "true"', compose)
        self.assertIn("QDRANT__TLS__CERT", compose)
        self.assertIn("QDRANT__TLS__KEY", compose)
        self.assertIn("/dev/tcp/127.0.0.1/6333", compose)
        self.assertNotIn("GET /readyz HTTP/1.1", compose)


if __name__ == "__main__":
    unittest.main()
