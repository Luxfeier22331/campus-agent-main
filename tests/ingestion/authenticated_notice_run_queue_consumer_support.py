from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.collected_notice_ingest_queue import (
    build_authenticated_notice_run_ingest_job,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)


class _ObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self._objects = objects

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self._objects[(bucket, key)]
        except KeyError as exc:
            raise KeyError(f"{bucket}/{key}") from exc


class _HeartbeatRecordingQueueStore(InMemoryNoticeIngestQueueStore):
    def __init__(self) -> None:
        super().__init__()
        self.heartbeat_seen = threading.Event()
        self.heartbeat_count = 0

    def heartbeat(self, *args, **kwargs):
        self.heartbeat_count += 1
        self.heartbeat_seen.set()
        return super().heartbeat(*args, **kwargs)


class _FailingHeartbeatQueueStore(InMemoryNoticeIngestQueueStore):
    def __init__(self) -> None:
        super().__init__()
        self.heartbeat_attempted = threading.Event()

    def heartbeat(self, *args, **kwargs):
        self.heartbeat_attempted.set()
        raise RuntimeError("heartbeat boom")


class _RecordingImporter:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.requests = []

    def __call__(self, *, request, env, object_store):
        del env, object_store
        self.requests.append(request)
        return dict(self.result)


class _RecordingTypedMaterializer:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.calls: list[dict[str, object]] = []

    def __call__(
        self,
        *,
        import_result,
        env,
        object_store,
        operations_dir,
        consumer_admission_manifest_path,
        source_corpus,
        source_collection,
        run_id,
        job_id,
        generated_at,
    ):
        del import_result, env, object_store, generated_at
        self.calls.append(
            {
                "operations_dir": operations_dir,
                "consumer_admission_manifest_path": consumer_admission_manifest_path,
                "source_corpus": source_corpus,
                "source_collection": source_collection,
                "run_id": run_id,
                "job_id": job_id,
            }
        )
        return dict(self.result)


class _RecordingProcessingProjectionReporter:
    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, object], ...]] = []

    def report(self, *, snapshots):
        self.calls.append(tuple(dict(snapshot) for snapshot in snapshots))


class _RecordingRunProcessingProjectionReporter:
    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, object], ...]] = []

    def report(self, *, snapshots):
        self.calls.append(tuple(dict(snapshot) for snapshot in snapshots))


class _WaitForHeartbeatImporter(_RecordingImporter):
    def __init__(self, heartbeat_seen: threading.Event, result: dict[str, object]) -> None:
        super().__init__(result)
        self.heartbeat_seen = heartbeat_seen
        self.observed_heartbeat = False

    def __call__(self, *, request, env, object_store):
        self.observed_heartbeat = self.heartbeat_seen.wait(timeout=1.0)
        if not self.observed_heartbeat:
            raise AssertionError("consumer did not heartbeat before importer returned")
        return super().__call__(request=request, env=env, object_store=object_store)


class _WaitForHeartbeatAttemptImporter(_RecordingImporter):
    def __init__(self, heartbeat_attempted: threading.Event, result: dict[str, object]) -> None:
        super().__init__(result)
        self.heartbeat_attempted = heartbeat_attempted

    def __call__(self, *, request, env, object_store):
        if not self.heartbeat_attempted.wait(timeout=1.0):
            raise AssertionError("consumer did not attempt heartbeat before importer returned")
        return super().__call__(request=request, env=env, object_store=object_store)


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


def _write_passed_media_gate_evidence(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    artifact_payloads = {
        "media-extraction-candidate-inventory.json": {"candidates": []},
        "media-extraction-attempt-ledger.json": {"attempts": []},
        "media-extraction-candidate-inventory.closeout.json": {"candidates": []},
        "target-admission-manifest.json": {"admissions": []},
        "cleanup.dry-run.json": {"items": []},
        "media-source-object-verification-report.json": {"objects": []},
    }
    for filename, payload in artifact_payloads.items():
        (root / filename).write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    audit = {
        "verdict": "passed",
        "strict_gate": True,
        "finding_count": 0,
        "input_hashes": {
            "candidate_inventory_sha256": _sha(
                (root / "media-extraction-candidate-inventory.json").read_bytes()
            ),
            "attempt_ledger_sha256": _sha(
                (root / "media-extraction-attempt-ledger.json").read_bytes()
            ),
            "closeout_candidate_inventory_sha256": _sha(
                (root / "media-extraction-candidate-inventory.closeout.json").read_bytes()
            ),
            "target_admission_manifest_1_sha256": _sha(
                (root / "target-admission-manifest.json").read_bytes()
            ),
            "cleanup_report_sha256": _sha((root / "cleanup.dry-run.json").read_bytes()),
            "object_verification_report_sha256": _sha(
                (root / "media-source-object-verification-report.json").read_bytes()
            ),
        },
    }
    (root / "media-closeout-state-machine-audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = [name for name in globals() if not name.startswith("__")]
