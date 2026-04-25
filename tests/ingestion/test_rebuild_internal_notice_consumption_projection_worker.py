from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NoticeConsumptionProjectionEntry,
)

worker = importlib.import_module(
    "campus_ingestion_worker.rebuild_internal_notice_consumption_projection"
)


class RebuildInternalNoticeConsumptionProjectionWorkerCliTest(unittest.TestCase):
    def test_main_refuses_implicit_full_scope_rebuild(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.rebuild_internal_notice_consumption_projection"
            ) as rebuild,
            patch("sys.stderr", new_callable=io.StringIO),
            self.assertRaises(SystemExit),
        ):
            worker.main([])

        rebuild.assert_not_called()

    def test_main_rebuilds_projection_for_selected_notice_ids(self) -> None:
        entries = (
            _entry(
                notice_id="351907",
                unit_id="notice_unit:351907:notice_window",
                primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
                target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            ),
            _entry(
                notice_id="351907",
                unit_id="notice_unit:351907:attachment_rule_body",
                primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
                target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
                consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                source_document_id="notice:muc_internal_portal:351907",
            ),
        )
        admission_store = object()

        with (
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.rebuild_internal_notice_consumption_projection",
                return_value=entries,
            ) as rebuild,
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.record_internal_notice_consumption_admission",
                side_effect=("batch-projection-001", "batch-projection-001"),
            ) as record_admission,
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ) as build_admission_store,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(
                [
                    "--notice-id",
                    "351907",
                    "--promotion-routing-path",
                    "/tmp/promotion-routing.v1.json",
                ]
            )

        request = rebuild.call_args.kwargs["request"]
        build_admission_store.assert_called_once()
        self.assertEqual(request.notice_ids, ("351907",))
        self.assertEqual(str(request.promotion_routing_path), "/tmp/promotion-routing.v1.json")
        self.assertEqual(
            rebuild.call_args.kwargs["admission_batch_id"],
            "batch-projection-001",
        )
        self.assertEqual(
            rebuild.call_args.kwargs["admission_command"],
            "projection_rebuild",
        )
        self.assertEqual(record_admission.call_count, 2)
        started_kwargs = record_admission.call_args_list[0].kwargs
        completed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(started_kwargs["command"], "projection_rebuild")
        self.assertEqual(started_kwargs["notice_ids"], ("351907",))
        self.assertEqual(started_kwargs["status"], "started")
        self.assertEqual(started_kwargs["selection_source"], "explicit_notice_ids")
        self.assertEqual(
            started_kwargs["command_args"]["promotion_routing_path"],
            "/tmp/promotion-routing.v1.json",
        )
        self.assertIs(started_kwargs["store"], admission_store)
        self.assertEqual(completed_kwargs["status"], "completed")
        self.assertEqual(completed_kwargs["batch_id"], "batch-projection-001")
        self.assertEqual(completed_kwargs["selection_source"], "explicit_notice_ids")
        self.assertIs(completed_kwargs["store"], admission_store)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["batch_id"], "batch-projection-001")
        self.assertEqual(payload["projection_entry_count"], 2)
        self.assertEqual(payload["ready_for_target_count"], 1)
        self.assertEqual(payload["retained_for_notice_query_count"], 1)
        self.assertEqual(payload["held_in_notice_runtime_count"], 1)
        self.assertEqual(payload["primary_role_counts"][NOTICE_PRIMARY_ROLE_NOTICE_WINDOW], 1)
        self.assertIn(
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            payload["consumption_status_counts"],
        )

    def test_main_reports_pending_multimodal_processing_without_manual_review_count(
        self,
    ) -> None:
        entries = (
            _entry(
                notice_id="351907",
                unit_id="notice_unit:351907:manual-gap",
                primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
                target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
                consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
            ),
        )

        with (
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.rebuild_internal_notice_consumption_projection",
                return_value=entries,
            ),
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.build_internal_notice_consumption_admission_store_from_env"
            ),
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.record_internal_notice_consumption_admission",
                side_effect=("batch-projection-001", "batch-projection-001"),
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "351907"])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["pending_multimodal_processing_count"], 1)
        self.assertNotIn("manual_review_required_count", payload)

    def test_main_merges_notice_ids_from_selection_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selected-notices.json"
            selection_path.write_text(
                json.dumps(
                    {
                        "selected_notice_ids": [
                            "351907",
                            "355222",
                            "351907",
                        ]
                    }
                ),
                encoding="utf-8",
            )
            expected_sha256 = sha256(selection_path.read_bytes()).hexdigest()

            with (
                patch(
                    "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.rebuild_internal_notice_consumption_projection",
                    return_value=(),
                ) as rebuild,
                patch(
                    "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.build_internal_notice_consumption_admission_store_from_env"
                ),
                patch(
                    "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.record_internal_notice_consumption_admission",
                    side_effect=("batch-projection-001", "batch-projection-001"),
                ) as record_admission,
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--notice-id",
                        "355222",
                        "--selection-path",
                        str(selection_path),
                    ]
                )

        request = rebuild.call_args.kwargs["request"]
        self.assertEqual(request.notice_ids, ("351907", "355222"))
        started_kwargs = record_admission.call_args_list[0].kwargs
        self.assertEqual(
            started_kwargs["selection_source"],
            "explicit_notice_ids+selection_path",
        )
        self.assertEqual(started_kwargs["selection_path"], str(selection_path))
        self.assertEqual(started_kwargs["selection_sha256"], expected_sha256)
        self.assertEqual(
            started_kwargs["command_args"]["selection_source"],
            "explicit_notice_ids+selection_path",
        )


def _entry(
    *,
    notice_id: str,
    unit_id: str,
    primary_role: str,
    target_surface: str,
    consumption_status: str,
    source_document_id: str | None = None,
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=unit_id,
        primary_role=primary_role,
        semantic_owner="notice_body",
        default_agent="notice-agent",
        target_surface=target_surface,
        temporal_policy="announcement_window",
        completeness_status="complete",
        answerability="answerable",
        consumption_status=consumption_status,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=source_document_id or f"notice:muc_internal_portal:{notice_id}",
    )


if __name__ == "__main__":
    unittest.main()
