from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ingestion_core.authenticated_notice_closeout_operations_retention import (
    AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX,
    AuthenticatedNoticeCloseoutOperationObject,
    AuthenticatedNoticeCloseoutOperationsAuditRequest,
    AuthenticatedNoticeCloseoutOperationsCleanupRequest,
    CloseoutDbRunState,
    audit_authenticated_notice_closeout_operations_retention,
    classify_authenticated_notice_closeout_operation_runs,
    cleanup_authenticated_notice_closeout_operations,
)


class FakeCleanupObjectStore:
    def __init__(self, objects: dict[str, dict[str, object]]) -> None:
        self.objects = dict(objects)
        self.deleted: list[str] = []

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        del bucket
        if key not in self.objects:
            raise KeyError(key)
        return dict(self.objects[key])

    def delete_object(self, *, bucket: str, key: str) -> None:
        del bucket
        if key not in self.objects:
            raise KeyError(key)
        self.deleted.append(key)
        del self.objects[key]


def _object(run_id: str, suffix: str, size: int) -> AuthenticatedNoticeCloseoutOperationObject:
    return AuthenticatedNoticeCloseoutOperationObject(
        bucket="campus-rag-derived",
        object_key=f"{AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX}{run_id}/{suffix}",
        byte_size=size,
        last_modified="2026-04-06T00:00:00+00:00",
    )


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


class AuthenticatedNoticeCloseoutOperationsRetentionTests(unittest.TestCase):
    def test_classifies_runs_by_registry_repo_and_db_evidence(self) -> None:
        objects = (
            _object("documented-run", "run-manifest.json", 10),
            _object("done-run", "run-manifest.json", 20),
            _object("verified-run", "run-manifest.json", 30),
            _object("registry-run", "run-manifest.json", 40),
            _object("probe-run", "run-manifest.json", 50),
            _object("legacy-run", "run-manifest.json", 60),
        )

        runs = classify_authenticated_notice_closeout_operation_runs(
            objects=objects,
            db_runs={
                "done-run": CloseoutDbRunState(
                    run_id="done-run",
                    state="done",
                    promotion_state="done",
                    promotion_phase="done",
                ),
                "verified-run": CloseoutDbRunState(run_id="verified-run", state="verified"),
            },
            repo_referenced_run_ids=frozenset({"documented-run"}),
            registry_referenced_run_ids=frozenset({"registry-run"}),
        )

        by_run = {run.run_id: run for run in runs}
        self.assertEqual(by_run["documented-run"].classification, "protected_documented_evidence")
        self.assertEqual(by_run["done-run"].classification, "protected_db_done_run")
        self.assertEqual(by_run["verified-run"].classification, "review_db_non_promoted_run")
        self.assertEqual(by_run["registry-run"].classification, "protected_registry_referenced_run")
        self.assertEqual(by_run["probe-run"].classification, "delete_candidate_debug_probe_run")
        self.assertEqual(
            by_run["legacy-run"].classification,
            "delete_candidate_unreferenced_legacy_run",
        )

    def test_audit_writes_exact_delete_candidate_objects(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            summary = audit_authenticated_notice_closeout_operations_retention(
                request=AuthenticatedNoticeCloseoutOperationsAuditRequest(output_dir=output_dir),
                objects=(
                    _object("keep-run", "run-manifest.json", 10),
                    _object("delete-run", "batches/000001/input.json", 20),
                    _object(
                        "delete-run", "staging/batches/000001/documents/a/document-units.jsonl", 30
                    ),
                ),
                db_runs={
                    "keep-run": CloseoutDbRunState(
                        run_id="keep-run",
                        state="done",
                        promotion_state="done",
                        promotion_phase="done",
                    ),
                },
                repo_referenced_run_ids=frozenset(),
                registry_referenced_run_ids=frozenset(),
            )

            self.assertEqual(summary["delete_candidate_run_count"], 1)
            self.assertEqual(summary["delete_candidate_object_count"], 2)
            candidate_objects = _read_jsonl(output_dir / "delete-candidate-objects.jsonl")
            self.assertEqual(
                [row["object_key"] for row in candidate_objects],
                [
                    f"{AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX}delete-run/batches/000001/input.json",
                    (
                        f"{AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX}"
                        "delete-run/staging/batches/000001/documents/a/document-units.jsonl"
                    ),
                ],
            )

    def test_cleanup_requires_delete_candidate_inventory_and_verifies_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            candidate_path = output_dir / "delete-candidate-objects.jsonl"
            object_key = (
                f"{AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX}"
                "delete-run/batches/000001/input.json"
            )
            candidate_path.write_text(
                json.dumps(
                    {
                        "bucket": "campus-rag-derived",
                        "object_key": object_key,
                        "run_id": "delete-run",
                        "byte_size": 20,
                        "classification": "delete_candidate_unreferenced_legacy_run",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            object_store = FakeCleanupObjectStore(
                {object_key: {"ContentLength": 20, "ETag": '"abc"'}}
            )

            summary = cleanup_authenticated_notice_closeout_operations(
                request=AuthenticatedNoticeCloseoutOperationsCleanupRequest(
                    candidate_objects_path=candidate_path,
                    output_dir=output_dir / "delete",
                    dry_run=False,
                ),
                env={"OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived"},
                object_store=object_store,
            )

            self.assertEqual(summary["deleted_count"], 1)
            self.assertEqual(summary["already_absent_count"], 0)
            self.assertEqual(object_store.deleted, [object_key])

    def test_cleanup_rejects_non_candidate_inventory_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            candidate_path = output_dir / "delete-candidate-objects.jsonl"
            candidate_path.write_text(
                json.dumps(
                    {
                        "bucket": "campus-rag-derived",
                        "object_key": (
                            f"{AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX}"
                            "keep-run/run-manifest.json"
                        ),
                        "run_id": "keep-run",
                        "byte_size": 10,
                        "classification": "protected_documented_evidence",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "not a delete candidate"):
                cleanup_authenticated_notice_closeout_operations(
                    request=AuthenticatedNoticeCloseoutOperationsCleanupRequest(
                        candidate_objects_path=candidate_path,
                        output_dir=output_dir / "delete",
                        dry_run=True,
                    ),
                    env={"OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived"},
                    object_store=FakeCleanupObjectStore({}),
                )


if __name__ == "__main__":
    unittest.main()
