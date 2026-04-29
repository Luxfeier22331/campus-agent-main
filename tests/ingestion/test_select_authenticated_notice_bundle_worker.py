from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.select_authenticated_notice_bundle")


class SelectAuthenticatedNoticeBundleWorkerTest(unittest.TestCase):
    def test_writes_selected_bundle_and_manifest_for_requested_notice_ids(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            output_bundle_path = root / "selected-bundle.json"
            output_manifest_path = root / "export-manifest.json"
            _write_json(
                bundle_path,
                [
                    {"notice_id": 355881, "notice": {"notice_title": "社会实践专车"}},
                    {"notice_id": 355867, "notice": {"notice_title": "两校区班车安排"}},
                ],
            )

            with patch("sys.stdout", new_callable=io.StringIO):
                worker.main(
                    [
                        "--bundle-path",
                        str(bundle_path),
                        "--notice-id",
                        "355881",
                        "--output-bundle-path",
                        str(output_bundle_path),
                        "--output-manifest-path",
                        str(output_manifest_path),
                    ]
                )

            selected_bundle = json.loads(output_bundle_path.read_text(encoding="utf-8"))
            manifest = json.loads(output_manifest_path.read_text(encoding="utf-8"))

        self.assertEqual([row["notice_id"] for row in selected_bundle], [355881])
        self.assertEqual(manifest["filters"]["selected_notice_ids"], ["355881"])
        self.assertEqual(manifest["counts"]["selected_notice_count"], 1)

    def test_fails_when_requested_notice_id_is_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            _write_json(bundle_path, [{"notice_id": 355867}])

            with self.assertRaisesRegex(ValueError, "missing selected notice ids: 355881"):
                worker.main(
                    [
                        "--bundle-path",
                        str(bundle_path),
                        "--notice-id",
                        "355881",
                        "--output-bundle-path",
                        str(root / "selected-bundle.json"),
                        "--output-manifest-path",
                        str(root / "export-manifest.json"),
                    ]
                )


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
