from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)

worker = importlib.import_module(
    "campus_ingestion_worker.list_internal_notice_service_status_candidates"
)


class ListInternalNoticeServiceStatusCandidatesWorkerTest(unittest.TestCase):
    def test_main_prints_only_service_status_candidates(self) -> None:
        store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    notice_id="353903",
                    title="关于更改通勤班车丰台校区乘车点的通知",
                    target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                    notice_family="transport_commute_status",
                    candidate_kind="transport_schedule",
                ),
                _entry(
                    notice_id="355001",
                    title="关于信息门户升级维护的通知",
                    target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                    notice_family="it_platform_service_status",
                    candidate_kind="service_status",
                ),
                _entry(
                    notice_id="355777",
                    title="关于提交材料的通知",
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    notice_family="document_collection_deadline",
                    candidate_kind="",
                ),
            )
        )

        with (
            patch(
                "campus_ingestion_worker.list_internal_notice_service_status_candidates.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.list_internal_notice_service_status_candidates.build_notice_consumption_projection_store_from_env",
                return_value=store,
            ) as build_store,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main([])

        build_store.assert_called_once()
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["source_corpus"], "campus_notices")
        self.assertEqual(payload["source_collection"], "internal_notice")
        self.assertEqual(payload["candidate_count"], 2)
        self.assertEqual(
            [candidate["source_notice_id"] for candidate in payload["candidates"]],
            ["353903", "355001"],
        )
        self.assertEqual(
            payload["candidate_kind_counts"], {"service_status": 1, "transport_schedule": 1}
        )
        self.assertEqual(payload["notice_family_counts"]["it_platform_service_status"], 1)
        self.assertEqual(
            payload["candidates"][0]["source_ref"],
            "notice:muc_internal_portal:353903",
        )
        self.assertEqual(
            payload["candidates"][1]["notice_title"],
            "关于信息门户升级维护的通知",
        )

    def test_main_filters_by_status(self) -> None:
        store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    notice_id="353903",
                    title="关于更改通勤班车丰台校区乘车点的通知",
                    target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                    notice_family="transport_commute_status",
                    candidate_kind="transport_schedule",
                ),
                _entry(
                    notice_id="355001",
                    title="关于图书馆开放时间调整的通知",
                    target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    notice_family="library_service_status",
                    candidate_kind="service_status",
                ),
            )
        )

        with (
            patch(
                "campus_ingestion_worker.list_internal_notice_service_status_candidates.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.list_internal_notice_service_status_candidates.build_notice_consumption_projection_store_from_env",
                return_value=store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--consumption-status", NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["candidate_count"], 1)
        self.assertEqual(payload["candidates"][0]["source_notice_id"], "353903")


def _entry(
    *,
    notice_id: str,
    title: str,
    target_surface: str,
    consumption_status: str,
    notice_family: str,
    candidate_kind: str,
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:notice:muc_internal_portal:{notice_id}:service_status_override",
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE
        if target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        else NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
        semantic_owner="notice_body",
        default_agent="campus-services-agent",
        target_surface=target_surface,
        temporal_policy="current_override",
        completeness_status="complete",
        answerability="body_only_answerable",
        consumption_status=consumption_status,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_notice_release_time="2026-04-28T09:00:00+08:00",
        role_metadata={
            "notice_title": title,
            "notice_family": notice_family,
            "service_status_candidate_kind": candidate_kind,
        },
    )


if __name__ == "__main__":
    unittest.main()
