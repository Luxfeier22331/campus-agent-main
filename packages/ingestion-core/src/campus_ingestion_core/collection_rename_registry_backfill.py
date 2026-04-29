from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

from campus_ingestion_core.postgres_runtime import (
    normalize_postgres_connection_url,
    open_postgres_connection,
    validate_operator_postgres_url,
    validate_persistent_postgres_runtime_url,
)
from campus_ingestion_core.registry import (
    DEFAULT_DOCUMENT_REGISTRY_TABLE,
    DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)

REGULATIONS_CORPUS = "regulations"
COLLECTION_RENAME_MAP = {
    "institutional_regulations": "institutional_rules",
    "student_handbook": "student_rules",
}
LEGACY_COLLECTION_NAMES = tuple(COLLECTION_RENAME_MAP.keys())
_SAMPLE_LIMIT = 5

_COLLECTION_CASE_SQL = """
case
    when collection = 'student_handbook' then 'student_rules'
    when collection = 'institutional_regulations' then 'institutional_rules'
    else collection
end
"""

_RECORD_COLLECTION_CASE_SQL = """
case
    when collection = 'student_handbook' or record->>'collection' = 'student_handbook'
        then jsonb_set(record, '{collection}', to_jsonb('student_rules'::text), true)
    when collection = 'institutional_regulations'
        or record->>'collection' = 'institutional_regulations'
        then jsonb_set(record, '{collection}', to_jsonb('institutional_rules'::text), true)
    else record
end
"""


@dataclass(frozen=True, slots=True)
class RegistryCollectionRenameSample:
    column_collection: str
    identity: str
    record_collection: str | None


@dataclass(frozen=True, slots=True)
class RegistryCollectionRenameTargetResult:
    kind: Literal["document_registry", "raw_asset_registry"]
    legacy_row_count: int
    sample_rows: tuple[RegistryCollectionRenameSample, ...]
    table_name: str
    target_names: tuple[str, ...]
    updated_row_count: int | None = None


@dataclass(frozen=True, slots=True)
class RegistryCollectionRenameAuditReport:
    command: Literal["audit"]
    targets: tuple[RegistryCollectionRenameTargetResult, ...]


@dataclass(frozen=True, slots=True)
class RegistryCollectionRenameApplyReport:
    command: Literal["apply"]
    targets: tuple[RegistryCollectionRenameTargetResult, ...]


@dataclass(frozen=True, slots=True)
class _RegistryBackfillTarget:
    database_url: str
    kind: Literal["document_registry", "raw_asset_registry"]
    table_name: str
    target_names: tuple[str, ...]


def _read_first_non_empty(source: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = str(source.get(key) or "").strip()
        if value:
            return value
    return ""


def _optional_runtime_document_registry_url(source: dict[str, str]) -> str:
    database_url = _read_first_non_empty(
        source,
        DOCUMENT_REGISTRY_ENV_KEY,
        SHARED_POSTGRES_ENV_KEY,
    )
    if not database_url:
        return ""
    return validate_persistent_postgres_runtime_url(database_url)


def _optional_runtime_raw_asset_registry_url(source: dict[str, str]) -> str:
    database_url = _read_first_non_empty(
        source,
        RAW_ASSET_REGISTRY_ENV_KEY,
        DOCUMENT_REGISTRY_ENV_KEY,
        SHARED_POSTGRES_ENV_KEY,
    )
    if not database_url:
        return ""
    return validate_persistent_postgres_runtime_url(database_url)


def _optional_operator_document_registry_url(source: dict[str, str]) -> str:
    database_url = _read_first_non_empty(
        source,
        DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
        DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
        SHARED_POSTGRES_OPERATOR_ENV_KEY,
        SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    )
    if not database_url:
        return ""
    return validate_operator_postgres_url(database_url)


def _optional_operator_raw_asset_registry_url(source: dict[str, str]) -> str:
    database_url = _read_first_non_empty(
        source,
        RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
        RAW_ASSET_REGISTRY_MANAGEMENT_ENV_KEY,
        DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
        DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
        SHARED_POSTGRES_OPERATOR_ENV_KEY,
        SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    )
    if not database_url:
        return ""
    return validate_operator_postgres_url(database_url)


def resolve_registry_collection_rename_targets(
    env: dict[str, str] | None = None,
) -> tuple[_RegistryBackfillTarget, ...]:
    source = dict(env if env is not None else os.environ)
    resolved_targets = (
        (
            "runtime_document_registry",
            _optional_runtime_document_registry_url(source),
            "document_registry",
            DEFAULT_DOCUMENT_REGISTRY_TABLE,
        ),
        (
            "runtime_raw_asset_registry",
            _optional_runtime_raw_asset_registry_url(source),
            "raw_asset_registry",
            DEFAULT_RAW_ASSET_REGISTRY_TABLE,
        ),
        (
            "operator_document_registry",
            _optional_operator_document_registry_url(source),
            "document_registry",
            DEFAULT_DOCUMENT_REGISTRY_TABLE,
        ),
        (
            "operator_raw_asset_registry",
            _optional_operator_raw_asset_registry_url(source),
            "raw_asset_registry",
            DEFAULT_RAW_ASSET_REGISTRY_TABLE,
        ),
    )

    deduped: dict[tuple[str, str], _RegistryBackfillTarget] = {}
    for target_name, database_url, kind, table_name in resolved_targets:
        if not database_url:
            continue
        key = (normalize_postgres_connection_url(database_url), table_name)
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = _RegistryBackfillTarget(
                database_url=database_url,
                kind=kind,
                table_name=table_name,
                target_names=(target_name,),
            )
            continue
        deduped[key] = _RegistryBackfillTarget(
            database_url=existing.database_url,
            kind=existing.kind,
            table_name=existing.table_name,
            target_names=tuple(sorted({*existing.target_names, target_name})),
        )

    return tuple(
        deduped[key]
        for key in sorted(
            deduped,
            key=lambda item: (
                deduped[item].kind,
                deduped[item].table_name,
                ",".join(deduped[item].target_names),
            ),
        )
    )


def _count_legacy_rows(target: _RegistryBackfillTarget) -> int:
    with open_postgres_connection(target.database_url) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
                select count(*)::int
                from {target.table_name}
                where corpus = %s
                  and (
                    collection = any(%s::text[])
                    or record->>'collection' = any(%s::text[])
                  )
                """,
            (REGULATIONS_CORPUS, list(LEGACY_COLLECTION_NAMES), list(LEGACY_COLLECTION_NAMES)),
        )
        row = cursor.fetchone()
    return int(row[0] if row is not None else 0)


def _sample_legacy_rows(
    target: _RegistryBackfillTarget,
) -> tuple[RegistryCollectionRenameSample, ...]:
    identity_sql = (
        "concat_ws('|', document_id, revision_track, version_id)"
        if target.kind == "document_registry"
        else "concat_ws('@', raw_asset_id, raw_version_id)"
    )
    with open_postgres_connection(target.database_url) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
                select
                    {identity_sql} as identity,
                    collection,
                    record->>'collection' as record_collection
                from {target.table_name}
                where corpus = %s
                  and (
                    collection = any(%s::text[])
                    or record->>'collection' = any(%s::text[])
                  )
                order by identity asc
                limit %s
                """,
            (
                REGULATIONS_CORPUS,
                list(LEGACY_COLLECTION_NAMES),
                list(LEGACY_COLLECTION_NAMES),
                _SAMPLE_LIMIT,
            ),
        )
        rows = cursor.fetchall()
    return tuple(
        RegistryCollectionRenameSample(
            identity=str(row[0]),
            column_collection=str(row[1]),
            record_collection=str(row[2]) if row[2] is not None else None,
        )
        for row in rows
    )


def audit_registry_collection_rename_backfill(
    env: dict[str, str] | None = None,
) -> RegistryCollectionRenameAuditReport:
    targets = resolve_registry_collection_rename_targets(env)
    results = tuple(
        RegistryCollectionRenameTargetResult(
            kind=target.kind,
            legacy_row_count=_count_legacy_rows(target),
            sample_rows=_sample_legacy_rows(target),
            table_name=target.table_name,
            target_names=target.target_names,
        )
        for target in targets
    )
    return RegistryCollectionRenameAuditReport(command="audit", targets=results)


def _apply_legacy_row_backfill(target: _RegistryBackfillTarget) -> int:
    with (
        open_postgres_connection(target.database_url, autocommit=False) as conn,
        conn.cursor() as cursor,
    ):
        cursor.execute(
            f"""
            update {target.table_name}
            set collection = {_COLLECTION_CASE_SQL},
                record = {_RECORD_COLLECTION_CASE_SQL}
            where corpus = %s
              and (
                collection = any(%s::text[])
                or record->>'collection' = any(%s::text[])
              )
            """,
            (REGULATIONS_CORPUS, list(LEGACY_COLLECTION_NAMES), list(LEGACY_COLLECTION_NAMES)),
        )
        return int(cursor.rowcount or 0)


def apply_registry_collection_rename_backfill(
    env: dict[str, str] | None = None,
) -> RegistryCollectionRenameApplyReport:
    targets = resolve_registry_collection_rename_targets(env)
    results = tuple(
        RegistryCollectionRenameTargetResult(
            kind=target.kind,
            legacy_row_count=_count_legacy_rows(target),
            sample_rows=_sample_legacy_rows(target),
            table_name=target.table_name,
            target_names=target.target_names,
            updated_row_count=_apply_legacy_row_backfill(target),
        )
        for target in targets
    )
    return RegistryCollectionRenameApplyReport(command="apply", targets=results)


__all__ = [
    "COLLECTION_RENAME_MAP",
    "LEGACY_COLLECTION_NAMES",
    "RegistryCollectionRenameApplyReport",
    "RegistryCollectionRenameAuditReport",
    "RegistryCollectionRenameSample",
    "RegistryCollectionRenameTargetResult",
    "apply_registry_collection_rename_backfill",
    "audit_registry_collection_rename_backfill",
    "resolve_registry_collection_rename_targets",
]
