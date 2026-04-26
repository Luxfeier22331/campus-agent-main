from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)

from .internal_notice_scoped_rule_materialization_test_support import _inventory_entry

worker = importlib.import_module(
    "campus_ingestion_worker.sample_authenticated_notice_routing_candidates"
)


class SampleAuthenticatedNoticeRoutingCandidatesWorkerCliTest(unittest.TestCase):
    def test_main_samples_bundle_records_and_writes_report(self) -> None:
        bundle = [
            {
                "notice_id": "354192",
                "notice": {
                    "notice_id": "354192",
                    "notice_title": "关于2025-2026学年第二学期本科生网上选课的通知",
                    "notice_content": "",
                    "categories": [
                        {"notice_type": "6", "notice_type_name": "教学通知"},
                    ],
                },
                "notice_attachments": [],
                "attachments": [],
            }
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle_path = Path(temp_dir) / "bundle.json"
            output_path = Path(temp_dir) / "routing-sample.json"
            bundle_path.write_text(json.dumps(bundle), encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker.sample_authenticated_notice_routing_candidates.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--bundle-path",
                        str(bundle_path),
                        "--sample-limit-per-group",
                        "3",
                        "--output-path",
                        str(output_path),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["notice_count"], 1)
            self.assertEqual(payload["samples"][0]["notice_id"], "354192")
            self.assertEqual(
                payload["samples"][0]["notice_family"],
                "course_teaching_arrangement",
            )
            self.assertEqual(json.loads(output_path.read_text())["notice_count"], 1)

    def test_main_writes_review_later_audit_report(self) -> None:
        bundle = [
            {
                "notice_id": "review-later-1",
                "notice": {
                    "notice_id": "review-later-1",
                    "notice_title": "关于校园道路树木修剪温馨提醒",
                    "notice_content": "",
                    "categories": [
                        {"notice_type": "5", "notice_type_name": "办公通知"},
                    ],
                },
                "notice_attachments": [],
                "attachments": [],
            },
            {
                "notice_id": "354192",
                "notice": {
                    "notice_id": "354192",
                    "notice_title": "关于2025-2026学年第二学期本科生网上选课的通知",
                    "notice_content": "",
                    "categories": [
                        {"notice_type": "6", "notice_type_name": "教学通知"},
                    ],
                },
                "notice_attachments": [],
                "attachments": [],
            },
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle_path = Path(temp_dir) / "bundle.json"
            audit_path = Path(temp_dir) / "routing-audit.json"
            bundle_path.write_text(json.dumps(bundle), encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker.sample_authenticated_notice_routing_candidates.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--bundle-path",
                        str(bundle_path),
                        "--sample-limit-per-group",
                        "0",
                        "--boundary-sample-limit",
                        "0",
                        "--audit-output-path",
                        str(audit_path),
                    ]
                )

            audit = json.loads(audit_path.read_text())
            self.assertEqual(audit["notice_count"], 2)
            self.assertEqual(audit["review_later_count"], 1)
            self.assertEqual(
                audit["review_later_notices"][0]["notice_id"],
                "review-later-1",
            )
            self.assertEqual(
                audit["review_later_clusters"][0]["recommended_action"],
                "keep_other_review_later",
            )

    def test_main_samples_source_truth_inventory_when_bundle_path_is_absent(self) -> None:
        store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355385",
                    notice_title="关于启动2026年国家留学基金委与加拿大麦克马斯特大学合作奖学金项目校内遴选工作的通知",
                ),
            )
        )

        with (
            patch(
                "campus_ingestion_worker.sample_authenticated_notice_routing_candidates.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.sample_authenticated_notice_routing_candidates.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--sample-limit-per-group", "3"])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["samples"][0]["notice_id"], "355385")
        self.assertEqual(payload["samples"][0]["notice_family"], "exchange_visit_project")


if __name__ == "__main__":
    unittest.main()
