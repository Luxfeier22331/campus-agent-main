from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_source_run_retention import (
    AuthenticatedNoticeSourceRunObject,
    AuthenticatedNoticeSourceRunRetentionAuditRequest,
    AuthenticatedNoticeSourceRunRetentionCleanupRequest,
    audit_authenticated_notice_source_run_retention,
    classify_authenticated_notice_source_runs,
    cleanup_authenticated_notice_source_runs,
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


def _object(run_id: str, suffix: str, size: int) -> AuthenticatedNoticeSourceRunObject:
    return AuthenticatedNoticeSourceRunObject(
        bucket="campus-agent-source",
        object_key=f"authenticated_notice_portal/runs/{run_id}/{suffix}",
        byte_size=size,
        last_modified="2026-04-12T00:00:00+00:00",
    )


class AuthenticatedNoticeSourceRunRetentionTest(unittest.TestCase):
    def test_classifies_source_runs_by_references(self) -> None:
        runs = classify_authenticated_notice_source_runs(
            objects=(
                _object("db-run", "notices-bundle.json", 10),
                _object("repo-run", "export-manifest.json", 20),
                _object("legacy-run", "export-manifest.json", 30),
                _object("smoke-run", "export-manifest.json", 40),
            ),
            db_referenced_run_ids=frozenset({"db-run"}),
            repo_referenced_run_ids=frozenset({"repo-run"}),
        )

        by_run = {run.run_id: run for run in runs}
        self.assertEqual(by_run["db-run"].classification, "protected_db_referenced_run")
        self.assertEqual(by_run["repo-run"].classification, "protected_repo_referenced_run")
        self.assertEqual(
            by_run["legacy-run"].classification,
            "delete_candidate_unreferenced_source_run",
        )
        self.assertEqual(
            by_run["smoke-run"].classification,
            "delete_candidate_debug_source_run",
        )

    def test_audit_writes_delete_candidate_inventory(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            summary = audit_authenticated_notice_source_run_retention(
                request=AuthenticatedNoticeSourceRunRetentionAuditRequest(
                    output_dir=output_dir,
                ),
                env={"OBJECT_STORE_BUCKET_SOURCE": "campus-agent-source"},
                objects=(
                    _object("keep-run", "notices-bundle.json", 10),
                    _object("delete-run", "export-manifest.json", 20),
                ),
                db_referenced_run_ids=frozenset({"keep-run"}),
                repo_referenced_run_ids=frozenset(),
            )
            candidates = [
                json.loads(line)
                for line in (output_dir / "delete-candidate-objects.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["delete_candidate_run_count"], 1)
        self.assertEqual(summary["delete_candidate_object_count"], 1)
        self.assertEqual(
            candidates[0]["object_key"],
            "authenticated_notice_portal/runs/delete-run/export-manifest.json",
        )

    def test_cleanup_requires_delete_candidate_inventory_and_verifies_delete(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            candidate_path = output_dir / "delete-candidate-objects.jsonl"
            object_key = "authenticated_notice_portal/runs/delete-run/export-manifest.json"
            candidate_path.write_text(
                json.dumps(
                    {
                        "bucket": "campus-agent-source",
                        "object_key": object_key,
                        "run_id": "delete-run",
                        "byte_size": 20,
                        "classification": "delete_candidate_unreferenced_source_run",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            object_store = FakeCleanupObjectStore(
                {object_key: {"ContentLength": 20, "ETag": '"abc"'}}
            )

            summary = cleanup_authenticated_notice_source_runs(
                request=AuthenticatedNoticeSourceRunRetentionCleanupRequest(
                    candidate_objects_path=candidate_path,
                    output_dir=output_dir / "delete",
                    dry_run=False,
                ),
                env={"OBJECT_STORE_BUCKET_SOURCE": "campus-agent-source"},
                object_store=object_store,
            )

            self.assertEqual(summary["deleted_count"], 1)
            self.assertEqual(summary["already_absent_count"], 0)
            self.assertEqual(object_store.deleted, [object_key])

    def test_cleanup_rejects_non_candidate_inventory_rows(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            candidate_path = output_dir / "delete-candidate-objects.jsonl"
            candidate_path.write_text(
                json.dumps(
                    {
                        "bucket": "campus-agent-source",
                        "object_key": "authenticated_notice_portal/runs/keep-run/export.json",
                        "run_id": "keep-run",
                        "byte_size": 10,
                        "classification": "protected_db_referenced_run",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "not a delete candidate"):
                cleanup_authenticated_notice_source_runs(
                    request=AuthenticatedNoticeSourceRunRetentionCleanupRequest(
                        candidate_objects_path=candidate_path,
                        output_dir=output_dir / "delete",
                        dry_run=True,
                    ),
                    env={"OBJECT_STORE_BUCKET_SOURCE": "campus-agent-source"},
                    object_store=FakeCleanupObjectStore({}),
                )


if __name__ == "__main__":
    unittest.main()
