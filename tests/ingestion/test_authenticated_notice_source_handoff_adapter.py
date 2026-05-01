from __future__ import annotations

import hashlib
import json
import unittest

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer import (
    consume_authenticated_notice_ingest_queue,
)
from campus_ingestion_core.collected_notice_ingest_queue import (
    build_authenticated_notice_run_ingest_job,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)
from campus_ingestion_core.source_handoff_store import InMemorySourceHandoffStore


class AuthenticatedNoticeSourceHandoffAdapterTest(unittest.TestCase):
    def test_queue_consumer_projects_source_truth_execution_into_canonical_store(self) -> None:
        bundle_bytes = _json_bytes([{"notice_id": "355867", "title": "班车通知"}])
        manifest_bytes = _json_bytes({"run_id": "run-001", "filters": {}})
        queue_store = InMemoryNoticeIngestQueueStore()
        job = _job(
            run_id="run-001",
            bundle_sha=_sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=_sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        queue_store.enqueue(job)
        source_handoff_store = InMemorySourceHandoffStore()

        result = consume_authenticated_notice_ingest_queue(
            queue_store=queue_store,
            object_store=_ObjectStore(
                {
                    ("campus-rag-source", job.bundle_object_key): bundle_bytes,
                    ("campus-rag-source", job.manifest_object_key): manifest_bytes,
                }
            ),
            run_ref_resolver=_resolver_for(job),
            importer=_RecordingImporter({"notice_count": 1, "source_truth_only": True}),
            mode="execute",
            worker_id="worker-a",
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            source_truth_only=True,
            source_handoff_store=source_handoff_store,
        )

        summary = source_handoff_store.operator_summary()
        row = result.trace["trace_rows"][0]

        self.assertEqual(queue_store.get(job.job_id).status, "succeeded")  # type: ignore[union-attr]
        self.assertEqual(summary["handoffs"]["by_status"], {"verified": 1})
        self.assertEqual(summary["executions"]["by_status"], {"completed": 1})
        self.assertEqual(summary["steps"]["by_status"]["passed"], 4)
        self.assertEqual(summary["child_tasks"]["by_status"], {"completed": 3})
        self.assertTrue(str(row["source_handoff_id"]).startswith("an_handoff:"))
        self.assertTrue(str(row["ingestion_execution_id"]).startswith("an_exec:"))
        self.assertEqual(row["child_task_summary"]["by_state"]["completed"], 3)


class _ObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self._objects = objects

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self._objects[(bucket, key)]
        except KeyError as exc:
            raise KeyError(f"{bucket}/{key}") from exc


class _RecordingImporter:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result

    def __call__(self, *, request, env, object_store):
        del request, env, object_store
        return dict(self.result)


def _resolver_for(job):
    def _resolve(*, env, run_id, expected_source_surface, table_name):
        del env, table_name
        if run_id != job.run_id:
            raise ValueError(f"unexpected run_id: {run_id}")
        return AuthenticatedNoticeCollectorRunObjectRefs(
            run_id=job.run_id,
            source_surface=expected_source_surface,
            source_bucket=job.source_bucket,
            bundle_object_key=job.bundle_object_key,
            manifest_object_key=job.manifest_object_key,
            bundle_content_sha256=job.bundle_content_sha256,
            bundle_byte_size=job.bundle_byte_size,
            manifest_content_sha256=job.manifest_content_sha256,
            manifest_byte_size=job.manifest_byte_size,
        )

    return _resolve


def _job(
    *,
    run_id: str,
    bundle_sha: str,
    bundle_size: int,
    manifest_sha: str,
    manifest_size: int,
):
    return build_authenticated_notice_run_ingest_job(
        source_surface="notice",
        site_id="muc_internal_portal",
        run_id=run_id,
        source_bucket="campus-rag-source",
        bundle_object_key=f"authenticated_notice_portal/runs/{run_id}/bundle.json",
        bundle_content_sha256=bundle_sha,
        bundle_byte_size=bundle_size,
        manifest_object_key=f"authenticated_notice_portal/runs/{run_id}/manifest.json",
        manifest_content_sha256=manifest_sha,
        manifest_byte_size=manifest_size,
        enqueue_source="manual_replay",
        replay_batch_id="manual-run-20260501",
    )


def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")


def _sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


if __name__ == "__main__":
    unittest.main()
