from __future__ import annotations

import importlib
import tomllib
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class QdrantNativeBackupContractTest(unittest.TestCase):
    def test_object_store_snapshot_create_restore_are_not_active_worker_commands(self) -> None:
        pyproject_path = REPO_ROOT / "apps" / "ingestion-worker" / "pyproject.toml"
        pyproject = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
        scripts = pyproject["project"]["scripts"]

        self.assertNotIn("campus-ingestion-qdrant-backup-create", scripts)
        self.assertNotIn("campus-ingestion-qdrant-backup-restore", scripts)
        self.assertIn("campus-ingestion-qdrant-filesystem-backup-create", scripts)
        self.assertIn("campus-ingestion-qdrant-backup-cleanup", scripts)

    def test_object_store_snapshot_create_restore_are_not_public_core_api(self) -> None:
        core = importlib.import_module("campus_ingestion_core")

        self.assertFalse(hasattr(core, "SnapshotBackupRequest"))
        self.assertFalse(hasattr(core, "SnapshotRestoreRequest"))
        self.assertFalse(hasattr(core, "SnapshotRestoreReport"))
        self.assertFalse(hasattr(core, "create_snapshot_backup"))
        self.assertFalse(hasattr(core, "restore_snapshot_backup"))
        self.assertTrue(hasattr(core, "FilesystemSnapshotBackupRequest"))
        self.assertTrue(hasattr(core, "create_filesystem_snapshot_backup"))

    def test_self_hosted_qdrant_healthcheck_uses_configured_api_key(self) -> None:
        compose_path = REPO_ROOT / "infra" / "local" / "docker-compose.qdrant-single-node.yml"
        compose = compose_path.read_text(encoding="utf-8")

        self.assertIn("QDRANT__SERVICE__API_KEY", compose)
        self.assertIn("/dev/tcp/127.0.0.1/6333", compose)
        self.assertIn("GET /readyz HTTP/1.1", compose)
        self.assertIn("api-key: %s", compose)
        self.assertIn("/readyz", compose)


if __name__ == "__main__":
    unittest.main()
