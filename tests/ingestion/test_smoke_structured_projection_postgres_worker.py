from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_worker import smoke_structured_projection_postgres as worker


class SmokeStructuredProjectionPostgresWorkerTest(unittest.TestCase):
    def test_main_publishes_all_campus_services_readiness_collections(self) -> None:
        publisher = _RecordingPublisher()

        with (
            patch.object(worker, "load_worker_env"),
            patch.object(
                worker, "build_structured_projection_publisher_from_env", return_value=publisher
            ),
            redirect_stdout(io.StringIO()) as stdout,
        ):
            worker.main(
                (
                    "--release-id",
                    "supervisor-runtime-process-smoke",
                    "--generated-at",
                    "2026-04-24T20:30:00+08:00",
                )
            )

        collections = [call["collection"] for call in publisher.publish_calls]
        self.assertEqual(
            collections,
            [
                "service_status",
                "transport_schedule",
                "service_guide",
                "contact_directory",
                "academic_calendar",
            ],
        )
        corpora = [call["corpus"] for call in publisher.publish_calls]
        self.assertEqual(
            corpora,
            [
                "campus_services",
                "campus_services",
                "campus_services",
                "campus_services",
                "calendar",
            ],
        )
        contact_call = publisher.publish_calls[3]
        self.assertEqual(
            contact_call["release_id"],
            "supervisor-runtime-process-smoke-contact-directory",
        )
        self.assertEqual(
            contact_call["schema_version"],
            "campus_services_contact_directory_projection.v1",
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(
            payload["releases"]["contact_directory"]["counts"]["contact_records"],
            1,
        )
        self.assertEqual(
            payload["releases"]["academic_calendar"]["counts"]["academic_calendar_records"],
            1,
        )
        transport_call = publisher.publish_calls[1]
        transport_bundle = transport_call["bundle"]
        assert isinstance(transport_bundle, dict)
        self.assertEqual(len(transport_bundle["transport_routes"]), 2)
        self.assertEqual(len(transport_bundle["scheduled_departures"]), 2)
        self.assertEqual(len(transport_bundle["transport_operational_notices"]), 1)
        self.assertEqual(
            transport_bundle["transport_operational_notices"][0]["notice_id"],
            "353903",
        )

    def test_main_can_limit_seed_to_selected_collections_and_closes_pools(self) -> None:
        publisher = _RecordingPublisher()

        with (
            patch.object(worker, "load_worker_env"),
            patch.object(
                worker,
                "build_structured_projection_publisher_from_env",
                return_value=publisher,
            ) as build_publisher,
            patch.object(worker, "close_persistent_postgres_pools") as close_pools,
            redirect_stdout(io.StringIO()),
        ):
            worker.main(
                (
                    "--release-id",
                    "supervisor-runtime-process-smoke",
                    "--generated-at",
                    "2026-04-24T20:30:00+08:00",
                    "--collection",
                    "transport_schedule",
                )
            )

        collections = [call["collection"] for call in publisher.publish_calls]
        self.assertEqual(collections, ["transport_schedule"])
        self.assertEqual(
            build_publisher.call_args.kwargs["bootstrap_collections"],
            ("transport_schedule",),
        )
        close_pools.assert_called_once_with()


class _RecordingPublisher:
    def __init__(self) -> None:
        self.publish_calls: list[dict[str, object]] = []
        self.current_release_by_collection: dict[str, str] = {}

    def publish_release(self, **kwargs: object) -> SimpleNamespace:
        self.publish_calls.append(dict(kwargs))
        collection = str(kwargs["collection"])
        release_id = str(kwargs["release_id"])
        self.current_release_by_collection[collection] = release_id
        bundle = kwargs["bundle"]
        if not isinstance(bundle, dict):
            raise AssertionError("bundle must be a dict")
        counts = {
            "service_status_records": len(bundle.get("service_status_records", [])),
            "snapshots": len(bundle.get("transport_schedule_snapshots", [])),
            "routes": len(bundle.get("transport_routes", [])),
            "scheduled_departures": len(bundle.get("scheduled_departures", [])),
            "service_guide_records": len(bundle.get("service_guide_records", [])),
            "contact_records": len(bundle.get("contact_records", [])),
            "academic_calendar_records": len(bundle.get("academic_calendar_records", [])),
        }
        return SimpleNamespace(release_id=release_id, counts=counts)

    def get_current_release(self, *, corpus: str, collection: str) -> str:
        return self.current_release_by_collection[collection]


if __name__ == "__main__":
    unittest.main()
