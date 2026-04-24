from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NOTICE_RUNTIME,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_NOTICE_RUNTIME,
    NoticeConsumptionProjectionEntry,
)

worker = importlib.import_module(
    "campus_ingestion_worker.rebuild_internal_notice_consumption_projection"
)


class RebuildInternalNoticeConsumptionProjectionWorkerCliTest(unittest.TestCase):
    def test_main_rebuilds_projection_for_selected_notice_ids(self) -> None:
        entries = (
            _entry(
                notice_id="351907",
                unit_id="notice_unit:351907:notice_window",
                primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
                target_surface=NOTICE_TARGET_SURFACE_NOTICE_RUNTIME,
                consumption_status=NOTICE_CONSUMPTION_STATUS_NOTICE_RUNTIME,
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

        with (
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.rebuild_internal_notice_consumption_projection.rebuild_internal_notice_consumption_projection",
                return_value=entries,
            ) as rebuild,
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
        self.assertEqual(request.notice_ids, ("351907",))
        self.assertEqual(str(request.promotion_routing_path), "/tmp/promotion-routing.v1.json")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["projection_entry_count"], 2)
        self.assertEqual(payload["ready_for_target_count"], 1)
        self.assertEqual(payload["held_in_notice_runtime_count"], 1)
        self.assertEqual(payload["primary_role_counts"][NOTICE_PRIMARY_ROLE_NOTICE_WINDOW], 1)


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
