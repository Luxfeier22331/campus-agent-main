from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


def _load_hygiene_module():
    try:
        return importlib.import_module("campus_ingestion_core.derived_bucket_hygiene")
    except ModuleNotFoundError as exc:  # pragma: no cover - red phase
        raise AssertionError("missing derived bucket hygiene module") from exc


def _load_audit_worker():
    try:
        return importlib.import_module("campus_ingestion_worker.audit_derived_bucket_hygiene")
    except ModuleNotFoundError as exc:  # pragma: no cover - red phase
        raise AssertionError("missing derived bucket hygiene audit worker") from exc


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
    }


class _FakeDerivedBucketObjectStore:
    def __init__(self, keys: tuple[str, ...]) -> None:
        self.keys = keys

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        return tuple(sorted(key for key in self.keys if key.startswith(prefix)))


class DerivedBucketHygieneTest(unittest.TestCase):
    def test_audit_detects_unexpected_root_prefixes_and_families(self) -> None:
        hygiene = _load_hygiene_module()
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "audit"
            object_store = _FakeDerivedBucketObjectStore(
                keys=(
                    "regulations/documents/student_handbook/学生手册--abc12345/source-faithful/2018/canonical.md",
                    "curriculum/archive/curriculum_plan/example.json",
                    "scratch/tmp.json",
                )
            )
            with patch(
                "campus_ingestion_core.derived_bucket_hygiene.list_corpora",
                return_value=("curriculum", "regulations"),
            ):
                summary = hygiene.audit_derived_bucket_hygiene(
                    request=hygiene.DerivedBucketHygieneAuditRequest(output_dir=output_dir),
                    env=_object_store_env(),
                    object_store=object_store,
                )

            unexpected_prefixes = [
                json.loads(line)
                for line in (output_dir / "unexpected-root-prefixes.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            unexpected_families = [
                json.loads(line)
                for line in (output_dir / "unexpected-families.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            unexpected_keys = [
                json.loads(line)
                for line in (output_dir / "unexpected-keys.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["derived_key_count"], 3)
        self.assertEqual(summary["unexpected_root_prefix_count"], 1)
        self.assertEqual(summary["unexpected_family_count"], 1)
        self.assertEqual(summary["unexpected_key_count"], 2)
        self.assertEqual(
            unexpected_prefixes,
            [{"root_prefix": "scratch", "key_count": 1}],
        )
        self.assertEqual(
            unexpected_families,
            [{"root_prefix": "curriculum", "family": "archive", "key_count": 1}],
        )
        self.assertEqual(
            unexpected_keys,
            [
                {
                    "root_prefix": "curriculum",
                    "family": "archive",
                    "reason": "unexpected_family",
                    "object_key": "curriculum/archive/curriculum_plan/example.json",
                },
                {
                    "root_prefix": "scratch",
                    "family": "tmp.json",
                    "reason": "unexpected_root_prefix",
                    "object_key": "scratch/tmp.json",
                },
            ],
        )

    def test_audit_cli_renders_summary(self) -> None:
        audit_worker = _load_audit_worker()
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "audit"
            with (
                patch("campus_ingestion_worker.audit_derived_bucket_hygiene.load_worker_env"),
                patch(
                    "campus_ingestion_worker.audit_derived_bucket_hygiene.audit_derived_bucket_hygiene",
                    return_value={
                        "derived_key_count": 11,
                        "unexpected_root_prefix_count": 1,
                        "unexpected_family_count": 2,
                        "unexpected_key_count": 3,
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                audit_worker.main(["--output-dir", str(output_dir)])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["unexpected_root_prefix_count"], 1)
        self.assertEqual(payload["unexpected_family_count"], 2)
        self.assertEqual(payload["unexpected_key_count"], 3)


if __name__ == "__main__":
    unittest.main()
