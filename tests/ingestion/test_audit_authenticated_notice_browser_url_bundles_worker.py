from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.audit_authenticated_notice_browser_url_bundles"
)


class AuditAuthenticatedNoticeBrowserUrlBundlesWorkerTest(unittest.TestCase):
    def test_main_audits_and_optionally_writes_backfilled_bundles(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_a = root / "bundle-a.json"
            bundle_b = root / "bundle-b.json"
            summary_path = root / "summary.json"
            output_dir = root / "backfilled"
            bundle_a.write_text(
                json.dumps(
                    [
                        {
                            "notice_id": 351117,
                            "notice": {
                                "notice_id": 351117,
                                "notice_link": None,
                                "notice_link_state": 0,
                                "notice_source": 0,
                                "categories": [{"notice_type": "9980"}],
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )
            bundle_b.write_text(
                json.dumps(
                    [
                        {
                            "notice_id": 355119,
                            "notice": {
                                "notice_id": 355119,
                                "notice_browser_url": "https://portal.example.edu/notice/355119",
                                "notice_browser_url_source": "api_notice_link",
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_browser_url_bundles.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--bundle-path",
                        str(bundle_a),
                        "--bundle-path",
                        str(bundle_b),
                        "--source-home-url",
                        "https://my.muc.edu.cn",
                        "--summary-output-path",
                        str(summary_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            written_summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(written_summary, payload)
            self.assertEqual(payload["bundle_count"], 2)
            self.assertEqual(payload["records_seen"], 2)
            self.assertEqual(payload["already_present_count"], 1)
            self.assertEqual(payload["backfilled_count"], 1)
            self.assertEqual(payload["notice_browser_url_source_counts"]["portal_print_route"], 1)
            output_bundle = output_dir / "bundle-a.json"
            self.assertTrue(output_bundle.exists())
            backfilled_notice = json.loads(output_bundle.read_text(encoding="utf-8"))[0]["notice"]
            self.assertEqual(
                backfilled_notice["notice_browser_url"],
                "https://my.muc.edu.cn/#/print?type=9980&notice_id=351117&show_type=1",
            )


if __name__ == "__main__":
    unittest.main()
