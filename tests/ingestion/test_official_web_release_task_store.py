from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from campus_ingestion_core.official_web_release_task import build_official_web_release_task
from campus_ingestion_core.official_web_release_task_store import (
    InMemoryOfficialWebReleaseTaskStore,
    OfficialWebReleaseTaskLeaseError,
    PostgresOfficialWebReleaseTaskStore,
)


def _task(task_id: str = "owrelease_contact") -> object:
    return build_official_web_release_task(
        input_ref={
            "sourceObjectKeys": [
                "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
            ],
            "sourceUrls": ["https://www.muc.edu.cn/"],
        },
        inventory_id="muc-main-homepage-contact",
        job_id="owtarget_contact",
        run_id="owrun_contact",
        selected_write_target="campus_services/contact_directory",
        task_id=task_id,
        task_type="official_web_selected_write_contact_directory",
        now=datetime(2026, 5, 1, 8, 0, tzinfo=UTC),
    )


class OfficialWebReleaseTaskStoreTest(unittest.TestCase):
    def test_create_or_get_is_idempotent_by_task_id(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        created = store.create_or_get_task(_task())
        existing = store.create_or_get_task(_task())

        self.assertEqual(created, existing)
        self.assertEqual(store.get_task("owrelease_contact"), created)

    def test_claims_queued_tasks_in_created_order_and_heartbeats_lease(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        store.create_or_get_task(_task("owrelease_2"))
        store.create_or_get_task(_task("owrelease_1"))

        claimed = store.claim_next_task(worker_id="worker-a", lease_seconds=60, now=now)
        self.assertIsNotNone(claimed)
        self.assertEqual(claimed.task_id, "owrelease_1")
        self.assertEqual(claimed.status, "claimed")
        self.assertEqual(claimed.attempt_count, 1)

        heartbeat = store.heartbeat_task(
            "owrelease_1",
            worker_id="worker-a",
            lease_seconds=120,
            now=now + timedelta(seconds=30),
        )
        self.assertEqual(heartbeat.lease_expires_at, now + timedelta(seconds=150))

    def test_expired_claim_can_be_reclaimed_by_another_worker(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        store.create_or_get_task(_task())
        first = store.claim_next_task(worker_id="worker-a", lease_seconds=60, now=now)

        reclaimed = store.claim_next_task(
            worker_id="worker-b",
            lease_seconds=60,
            now=now + timedelta(seconds=61),
        )

        self.assertIsNotNone(first)
        self.assertIsNotNone(reclaimed)
        self.assertEqual(reclaimed.task_id, first.task_id)
        self.assertEqual(reclaimed.lease_owner, "worker-b")
        self.assertEqual(reclaimed.attempt_count, 2)

    def test_non_owner_cannot_mutate_running_task(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        store.create_or_get_task(_task())
        claimed = store.claim_next_task(worker_id="worker-a", lease_seconds=60, now=now)
        self.assertIsNotNone(claimed)

        with self.assertRaises(OfficialWebReleaseTaskLeaseError):
            store.mark_task_running(
                claimed.task_id,
                worker_id="worker-b",
                now=now + timedelta(seconds=1),
            )

    def test_retryable_failure_becomes_reclaimable_until_attempts_exhaust(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        store.create_or_get_task(_task())

        claimed = store.claim_next_task(worker_id="worker-a", lease_seconds=60, now=now)
        self.assertIsNotNone(claimed)
        failed = store.fail_task_retryable(
            claimed.task_id,
            error_code="object_store_unavailable",
            error_message="object store unavailable",
            worker_id="worker-a",
            now=now + timedelta(seconds=1),
        )
        self.assertEqual(failed.status, "failed_retryable")

        reclaimed = store.claim_next_task(
            worker_id="worker-a",
            lease_seconds=60,
            now=now + timedelta(seconds=2),
        )
        self.assertIsNotNone(reclaimed)
        self.assertEqual(reclaimed.attempt_count, 2)

        store.fail_task_retryable(
            reclaimed.task_id,
            error_code="object_store_unavailable",
            error_message="object store unavailable",
            worker_id="worker-a",
            now=now + timedelta(seconds=3),
        )
        final_claim = store.claim_next_task(
            worker_id="worker-a",
            lease_seconds=60,
            now=now + timedelta(seconds=4),
        )
        self.assertIsNotNone(final_claim)
        dead = store.fail_task_retryable(
            final_claim.task_id,
            error_code="object_store_unavailable",
            error_message="object store unavailable",
            worker_id="worker-a",
            now=now + timedelta(seconds=5),
        )
        self.assertEqual(dead.status, "failed_terminal")

    def test_materialized_indexed_and_published_are_terminal_completion_states(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        store.create_or_get_task(_task())
        claimed = store.claim_next_task(worker_id="worker-a", lease_seconds=60, now=now)
        self.assertIsNotNone(claimed)

        running = store.mark_task_running(
            claimed.task_id,
            worker_id="worker-a",
            now=now + timedelta(seconds=1),
        )
        materialized = store.mark_task_materialized(
            running.task_id,
            output_ref={"releaseId": "release_contact", "artifactObjectKey": "secret/key.json"},
            worker_id="worker-a",
            now=now + timedelta(seconds=2),
        )
        indexed = store.mark_task_indexed(
            materialized.task_id,
            output_ref={"releaseId": "release_contact"},
            worker_id="worker-a",
            now=now + timedelta(seconds=3),
        )

        self.assertEqual(materialized.status, "materialized")
        self.assertEqual(indexed.status, "indexed")
        self.assertEqual(indexed.lease_owner, "")
        self.assertIsNone(indexed.lease_expires_at)
        self.assertIsNone(
            store.claim_next_task(worker_id="worker-a", now=now + timedelta(seconds=4))
        )

    def test_postgres_set_status_binds_status_before_json_output_ref(self) -> None:
        store = object.__new__(PostgresOfficialWebReleaseTaskStore)
        store.database_url = "postgresql://localhost/campus"
        store.table_name = "ingestion_queue.official_web_release_tasks"
        executed: list[tuple[str, tuple[object, ...]]] = []

        class Cursor:
            def __enter__(self) -> Cursor:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def execute(self, query: str, params: tuple[object, ...]) -> None:
                executed.append((query, params))

            def fetchone(self) -> tuple[object, ...]:
                now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
                return (
                    "owrelease_contact",
                    "official_web_selected_write_contact_directory",
                    "published",
                    "muc-main-homepage-contact",
                    "owtarget_contact",
                    "owrun_contact",
                    "campus_services/contact_directory",
                    False,
                    {"sourceObjectKeys": ["official_web/source-truth-bundle.json"]},
                    {"releaseId": "release_contact"},
                    1,
                    3,
                    None,
                    None,
                    None,
                    None,
                    now,
                    now,
                )

        class Connection:
            def __enter__(self) -> Connection:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def cursor(self) -> Cursor:
                return Cursor()

        with patch(
            "campus_ingestion_core.official_web_release_task_store._postgres_connection",
            return_value=Connection(),
        ):
            store.mark_task_published(
                "owrelease_contact",
                output_ref={"releaseId": "release_contact"},
                worker_id="worker-a",
            )

        self.assertEqual(executed[0][1][0], "published")
        self.assertEqual(executed[0][1][1], '{"releaseId":"release_contact"}')


if __name__ == "__main__":
    unittest.main()
