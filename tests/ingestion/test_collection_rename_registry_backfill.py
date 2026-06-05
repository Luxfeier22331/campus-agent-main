from __future__ import annotations

import unittest
from contextlib import contextmanager
from unittest.mock import patch

from campus_ingestion_core.collection_rename_registry_backfill import (
    REGULATIONS_CORPUS,
    apply_registry_collection_rename_backfill,
    audit_registry_collection_rename_backfill,
    resolve_registry_collection_rename_targets,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
)


class CollectionRenameRegistryBackfillTest(unittest.TestCase):
    def test_resolve_targets_reads_registry_env_keys(self) -> None:
        env = {
            DOCUMENT_REGISTRY_ENV_KEY: "postgresql://runtime-document",
            RAW_ASSET_REGISTRY_ENV_KEY: "postgresql://runtime-raw",
            DOCUMENT_REGISTRY_OPERATOR_ENV_KEY: "postgresql://operator-document",
            RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY: "postgresql://operator-raw",
        }

        with (
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.validate_persistent_postgres_runtime_url",
                side_effect=lambda value: value,
            ),
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.validate_operator_postgres_url",
                side_effect=lambda value: value,
            ),
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.normalize_postgres_connection_url",
                side_effect=lambda value: value,
            ),
        ):
            targets = resolve_registry_collection_rename_targets(env)

        self.assertEqual(len(targets), 4)
        self.assertEqual(
            tuple(target.target_names for target in targets),
            (
                ("operator_document_registry",),
                ("runtime_document_registry",),
                ("operator_raw_asset_registry",),
                ("runtime_raw_asset_registry",),
            ),
        )
        self.assertEqual(
            tuple(target.kind for target in targets),
            (
                "document_registry",
                "document_registry",
                "raw_asset_registry",
                "raw_asset_registry",
            ),
        )
        self.assertTrue(all(target.database_url.startswith("postgresql://") for target in targets))
        self.assertEqual(REGULATIONS_CORPUS, "regulations")

    def test_audit_counts_and_samples_legacy_collection_rows(self) -> None:
        store = _FakeRegistryStore(
            {
                "postgresql://document": [
                    _registry_row(
                        identity=("doc-001", "track", "v1"),
                        collection="student_handbook",
                        record_collection="student_handbook",
                    ),
                    _registry_row(
                        identity=("doc-002", "track", "v1"),
                        collection="student_rules",
                        record_collection="student_handbook",
                    ),
                    _registry_row(
                        identity=("doc-003", "track", "v1"),
                        collection="student_rules",
                        record_collection="student_rules",
                    ),
                ],
            }
        )

        with (
            _patched_postgres_runtime(),
            _patched_registry_schema_bootstrap(),
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.open_postgres_connection",
                side_effect=store.open,
            ),
        ):
            report = audit_registry_collection_rename_backfill(
                {
                    DOCUMENT_REGISTRY_ENV_KEY: "postgresql://document",
                    RAW_ASSET_REGISTRY_ENV_KEY: "postgresql://raw",
                }
            )

        self.assertEqual(report.command, "audit")
        target = next(item for item in report.targets if item.kind == "document_registry")
        self.assertEqual(target.legacy_row_count, 2)
        self.assertIsNone(target.updated_row_count)
        self.assertIsNone(target.remaining_legacy_row_count)
        self.assertEqual(
            tuple(sample.identity for sample in target.sample_rows),
            ("doc-001|track|v1", "doc-002|track|v1"),
        )
        self.assertEqual(target.sample_rows[0].column_collection, "student_handbook")
        self.assertEqual(target.sample_rows[1].record_collection, "student_handbook")
        raw_target = next(item for item in report.targets if item.kind == "raw_asset_registry")
        self.assertEqual(raw_target.legacy_row_count, 0)

    def test_audit_bootstraps_registry_tables_before_querying_targets(self) -> None:
        store = _FakeRegistryStore(
            {
                "postgresql://document": [],
                "postgresql://raw": [],
            }
        )

        with (
            _patched_postgres_runtime(),
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.PostgresDocumentRegistry",
                create=True,
            ) as document_registry,
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.PostgresRawAssetRegistry",
                create=True,
            ) as raw_asset_registry,
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.open_postgres_connection",
                side_effect=store.open,
            ),
        ):
            audit_registry_collection_rename_backfill(
                {
                    DOCUMENT_REGISTRY_ENV_KEY: "postgresql://document",
                    RAW_ASSET_REGISTRY_ENV_KEY: "postgresql://raw",
                }
            )

        document_registry.assert_called_once_with(
            "postgresql://document",
            table_name="ingestion_registry.document_registry_records",
        )
        raw_asset_registry.assert_called_once_with(
            "postgresql://raw",
            table_name="ingestion_registry.raw_asset_registry_records",
        )

    def test_apply_rewrites_scalar_and_record_collection_and_reports_remaining_rows(self) -> None:
        store = _FakeRegistryStore(
            {
                "postgresql://document": [
                    _registry_row(
                        identity=("doc-001", "track", "v1"),
                        collection="student_handbook",
                        record_collection="student_handbook",
                    ),
                    _registry_row(
                        identity=("doc-002", "track", "v1"),
                        collection="student_rules",
                        record_collection="student_handbook",
                    ),
                    _registry_row(
                        identity=("doc-003", "track", "v1"),
                        collection="institutional_regulations",
                        record_collection="institutional_regulations",
                    ),
                ],
            }
        )

        with (
            _patched_postgres_runtime(),
            _patched_registry_schema_bootstrap(),
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.open_postgres_connection",
                side_effect=store.open,
            ),
        ):
            report = apply_registry_collection_rename_backfill(
                {
                    DOCUMENT_REGISTRY_ENV_KEY: "postgresql://document",
                    RAW_ASSET_REGISTRY_ENV_KEY: "postgresql://raw",
                }
            )

        self.assertEqual(report.command, "apply")
        target = next(item for item in report.targets if item.kind == "document_registry")
        self.assertEqual(target.legacy_row_count, 3)
        self.assertEqual(target.updated_row_count, 3)
        self.assertEqual(target.remaining_legacy_row_count, 0)
        self.assertEqual(
            [
                (row["collection"], row["record"]["collection"])
                for row in store.rows_by_url["postgresql://document"]
            ],
            [
                ("student_rules", "student_rules"),
                ("student_rules", "student_rules"),
                ("institutional_rules", "institutional_rules"),
            ],
        )

    def test_apply_bootstraps_registry_tables_before_querying_targets(self) -> None:
        store = _FakeRegistryStore(
            {
                "postgresql://document": [],
                "postgresql://raw": [],
            }
        )

        with (
            _patched_postgres_runtime(),
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.PostgresDocumentRegistry",
                create=True,
            ) as document_registry,
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.PostgresRawAssetRegistry",
                create=True,
            ) as raw_asset_registry,
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.open_postgres_connection",
                side_effect=store.open,
            ),
        ):
            apply_registry_collection_rename_backfill(
                {
                    DOCUMENT_REGISTRY_ENV_KEY: "postgresql://document",
                    RAW_ASSET_REGISTRY_ENV_KEY: "postgresql://raw",
                }
            )

        document_registry.assert_called_once_with(
            "postgresql://document",
            table_name="ingestion_registry.document_registry_records",
        )
        raw_asset_registry.assert_called_once_with(
            "postgresql://raw",
            table_name="ingestion_registry.raw_asset_registry_records",
        )


if __name__ == "__main__":
    unittest.main()


@contextmanager
def _patched_postgres_runtime():
    with (
        patch(
            "campus_ingestion_core.collection_rename_registry_backfill.validate_persistent_postgres_runtime_url",
            side_effect=lambda value: value,
        ),
        patch(
            "campus_ingestion_core.collection_rename_registry_backfill.validate_operator_postgres_url",
            side_effect=lambda value: value,
        ),
        patch(
            "campus_ingestion_core.collection_rename_registry_backfill.normalize_postgres_connection_url",
            side_effect=lambda value: value,
        ),
    ):
        yield


@contextmanager
def _patched_registry_schema_bootstrap():
    with (
        patch("campus_ingestion_core.collection_rename_registry_backfill.PostgresDocumentRegistry"),
        patch("campus_ingestion_core.collection_rename_registry_backfill.PostgresRawAssetRegistry"),
    ):
        yield


def _registry_row(
    *,
    identity: tuple[str, str, str],
    collection: str,
    record_collection: str,
) -> dict[str, object]:
    document_id, revision_track, version_id = identity
    return {
        "corpus": "regulations",
        "document_id": document_id,
        "revision_track": revision_track,
        "version_id": version_id,
        "collection": collection,
        "record": {"collection": record_collection},
    }


class _FakeRegistryStore:
    def __init__(self, rows_by_url: dict[str, list[dict[str, object]]]) -> None:
        self.rows_by_url = rows_by_url

    def open(self, database_url: str, *, autocommit: bool = True):
        return _FakeConnectionContext(_FakeConnection(self.rows_by_url.get(database_url, [])))


class _FakeConnectionContext:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    def __enter__(self) -> _FakeConnection:
        return self._connection

    def __exit__(self, *args: object) -> None:
        return None


class _FakeConnection:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows

    def cursor(self) -> _FakeCursorContext:
        return _FakeCursorContext(_FakeCursor(self._rows))


class _FakeCursorContext:
    def __init__(self, cursor: _FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeCursor:
        return self._cursor

    def __exit__(self, *args: object) -> None:
        return None


class _FakeCursor:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows
        self._result_rows: list[tuple[object, ...]] = []
        self.rowcount = 0

    def execute(self, sql: str, params: tuple[object, ...]) -> None:
        if "select count(*)::int" in sql:
            self._result_rows = [(len(self._legacy_rows()),)]
            return
        if "select" in sql and "record->>'collection' as record_collection" in sql:
            self._result_rows = [
                (
                    "|".join(
                        str(row[key]) for key in ("document_id", "revision_track", "version_id")
                    ),
                    row["collection"],
                    row["record"]["collection"],  # type: ignore[index]
                )
                for row in self._legacy_rows()
            ][:5]
            return
        if "update" in sql:
            updated = 0
            for row in self._legacy_rows():
                collection = str(row["collection"])
                record = row["record"]  # type: ignore[assignment]
                record_collection = str(record["collection"])
                next_collection = _canonical_collection(collection)
                next_record_collection = _canonical_collection(record_collection)
                row["collection"] = next_collection
                record["collection"] = next_record_collection
                updated += 1
            self.rowcount = updated
            self._result_rows = []
            return
        raise AssertionError(f"unexpected SQL: {sql}")

    def fetchone(self) -> tuple[object, ...] | None:
        return self._result_rows[0] if self._result_rows else None

    def fetchall(self) -> list[tuple[object, ...]]:
        return list(self._result_rows)

    def _legacy_rows(self) -> list[dict[str, object]]:
        return [
            row
            for row in self._rows
            if row["corpus"] == "regulations"
            and (
                row["collection"] in {"student_handbook", "institutional_regulations"}
                or row["record"]["collection"]  # type: ignore[index]
                in {"student_handbook", "institutional_regulations"}
            )
        ]


def _canonical_collection(collection: str) -> str:
    return {
        "student_handbook": "student_rules",
        "institutional_regulations": "institutional_rules",
    }.get(collection, collection)
