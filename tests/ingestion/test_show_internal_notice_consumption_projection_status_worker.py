from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)

worker = importlib.import_module(
    "campus_ingestion_worker.show_internal_notice_consumption_projection_status"
)


class ShowInternalNoticeConsumptionProjectionStatusWorkerCliTest(unittest.TestCase):
    def test_main_prints_projection_status_for_notice_id(self) -> None:
        store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    notice_id="351907",
                    unit_id="notice_unit:351907:notice_window",
                    primary_role=NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    reasons=("notice_query_retained",),
                ),
                _entry(
                    notice_id="351907",
                    unit_id="notice_unit:351907:attachment_rule_body",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
                    target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                    reasons=("ready_for_regulation_materialization",),
                ),
            )
        )

        with (
            patch(
                "campus_ingestion_worker.show_internal_notice_consumption_projection_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.show_internal_notice_consumption_projection_status.build_notice_consumption_projection_store_from_env",
                return_value=store,
            ) as build_store,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "351907"])

        build_store.assert_called_once()
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["source_notice_id"], "351907")
        self.assertEqual(payload["unit_count"], 2)
        self.assertEqual(payload["ready_unit_count"], 1)
        self.assertEqual(payload["held_unit_count"], 1)
        self.assertTrue(payload["has_target_ready_units"])
        self.assertEqual(
            {unit["primary_role"] for unit in payload["units"]},
            {NOTICE_PRIMARY_ROLE_NOTICE_WINDOW, NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY},
        )


def _entry(
    *,
    notice_id: str,
    unit_id: str,
    primary_role: str,
    target_surface: str,
    consumption_status: str,
    reasons: tuple[str, ...],
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
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        role_metadata={"reasons": reasons},
    )


if __name__ == "__main__":
    unittest.main()
