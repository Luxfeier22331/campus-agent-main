from __future__ import annotations

import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.serving_seed_package import (
    ServingSeedRestoreReport,
    ServingSeedVerifyReport,
)
from campus_ingestion_worker import restore_serving_seed, verify_serving_seed


class ServingSeedWorkerTest(unittest.TestCase):
    def test_verify_cli_serializes_slots_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "serving-seed.json"
            manifest_path.write_text("{}", encoding="utf-8")
            with (
                patch("campus_ingestion_worker.verify_serving_seed.load_worker_env"),
                patch("campus_ingestion_worker.verify_serving_seed.ObjectStoreSettings.from_env"),
                patch("campus_ingestion_worker.verify_serving_seed.S3ObjectStoreAdmin"),
                patch(
                    "campus_ingestion_worker.verify_serving_seed.verify_serving_seed_manifest",
                    return_value=ServingSeedVerifyReport(
                        object_count=2,
                        total_size_bytes=12,
                    ),
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                verify_serving_seed.main(["--manifest-path", str(manifest_path)])

        self.assertEqual(
            json.loads(stdout.getvalue()),
            {"object_count": 2, "total_size_bytes": 12},
        )

    def test_restore_cli_serializes_slots_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "serving-seed.json"
            manifest_path.write_text("{}", encoding="utf-8")
            with (
                patch("campus_ingestion_worker.restore_serving_seed.load_worker_env"),
                patch("campus_ingestion_worker.restore_serving_seed.ObjectStoreSettings.from_env"),
                patch("campus_ingestion_worker.restore_serving_seed.S3ObjectStoreAdmin"),
                patch(
                    "campus_ingestion_worker.restore_serving_seed.restore_serving_seed_manifest",
                    return_value=ServingSeedRestoreReport(
                        restored_count=2,
                        total_size_bytes=12,
                    ),
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                restore_serving_seed.main(["--manifest-path", str(manifest_path)])

        self.assertEqual(
            json.loads(stdout.getvalue()),
            {"restored_count": 2, "total_size_bytes": 12},
        )


if __name__ == "__main__":
    unittest.main()
