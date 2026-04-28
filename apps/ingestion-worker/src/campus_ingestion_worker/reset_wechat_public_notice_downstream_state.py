from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass

from campus_ingestion_core.internal_notice_consumption_admission import (
    DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_EVENT_TABLE,
    DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE,
    build_internal_notice_consumption_admission_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    build_notice_consumption_projection_store_from_env,
)
from campus_ingestion_core.postgres_runtime import open_postgres_connection
from campus_ingestion_core.registry import (
    _coerce_json_payload,
    build_document_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.wechat_public_notice_multimodal import (
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

WECHAT_SOURCE_CHANNEL = "wechat_official_account"
WECHAT_CHILD_DOCUMENT_PREFIX = "wechat_notice_image:"


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeDownstreamResetReport:
    source_corpus: str
    source_collection: str
    projection_removed_count: int
    read_model_removed_count: int
    registry_document_removed_count: int
    source_artifact_removed_count: int
    derived_artifact_removed_count: int
    attempt_row_removed_count: int
    admission_row_removed_count: int
    dry_run: bool


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Reset WeChat public-notice downstream state back to collected-but-not-imported. "
            "Keeps capture/source-truth, clears consumption/read-model/multimodal downstream artifacts."
        )
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="wechat_public_notice")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if not args.dry_run and not args.yes:
        parser.error("pass --yes to execute scope reset")
    source_corpus = str(args.corpus or "").strip() or "campus_notices"
    source_collection = str(args.collection or "").strip() or "wechat_public_notice"

    projection_store = build_notice_consumption_projection_store_from_env(prefer_operator=True)
    read_model_store = build_internal_notice_read_model_store_from_env(prefer_operator=True)
    registry = build_document_registry_from_env(prefer_operator=True)
    object_store_settings = ObjectStoreSettings.from_env(dict(os.environ))
    object_store = S3ObjectStoreAdmin(object_store_settings)

    projection_entries = projection_store.list_by_scope(source_corpus, source_collection)
    read_model_rows = read_model_store.list_by_scope(source_corpus, source_collection)
    registry_rows = tuple(
        row
        for row in registry.list_by_scope(source_corpus, source_collection)
        if _is_wechat_registry_row(row)
    )
    attempt_rows = _load_attempt_rows(
        source_corpus=source_corpus,
        source_collection=source_collection,
    )
    admission_rows = _load_admission_rows(
        source_corpus=source_corpus,
        source_collection=source_collection,
    )

    source_object_keys = _collect_source_artifact_keys(
        projection_entries=projection_entries,
        attempt_rows=attempt_rows,
        object_store=object_store,
        source_bucket=object_store_settings.bucket_source,
    )
    derived_object_keys = _collect_derived_artifact_keys(
        read_model_rows=read_model_rows,
        registry_rows=registry_rows,
    )

    if not args.dry_run:
        for object_key in source_object_keys:
            object_store.delete_prefix(
                bucket=object_store_settings.bucket_source, prefix=object_key
            )
        for object_key in derived_object_keys:
            object_store.delete_prefix(
                bucket=object_store_settings.bucket_derived, prefix=object_key
            )
        for row in registry_rows:
            registry.delete_document(str(row.document_id))
        projection_store.replace_scope(source_corpus, source_collection, ())
        read_model_store.replace_scope(source_corpus, source_collection, ())
        _delete_attempt_rows(source_corpus=source_corpus, source_collection=source_collection)
        _delete_admission_rows(source_corpus=source_corpus, source_collection=source_collection)

    report = WeChatPublicNoticeDownstreamResetReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        projection_removed_count=len(projection_entries),
        read_model_removed_count=len(read_model_rows),
        registry_document_removed_count=len(registry_rows),
        source_artifact_removed_count=len(source_object_keys),
        derived_artifact_removed_count=len(derived_object_keys),
        attempt_row_removed_count=len(attempt_rows),
        admission_row_removed_count=len(admission_rows),
        dry_run=bool(args.dry_run),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


def _collect_source_artifact_keys(
    *,
    projection_entries: Sequence[object],
    attempt_rows: Sequence[Mapping[str, object]],
    object_store: S3ObjectStoreAdmin,
    source_bucket: str,
) -> tuple[str, ...]:
    keys: list[str] = []
    for entry in projection_entries:
        metadata = dict(getattr(entry, "role_metadata", {}) or {})
        for object_key in _string_tuple(metadata.get("ocr_manifest_keys")):
            keys.append(object_key)
            keys.extend(
                _read_source_artifact_keys_from_ocr_manifest(
                    object_store=object_store,
                    source_bucket=source_bucket,
                    ocr_manifest_key=object_key,
                )
            )
    for row in attempt_rows:
        keys.extend(
            _string_tuple(
                (
                    row.get("fetch_manifest_key"),
                    row.get("ocr_manifest_key"),
                    row.get("provider_response_key"),
                    row.get("layout_elements_key"),
                )
            )
        )
    return tuple(dict.fromkeys(key for key in keys if key))


def _read_source_artifact_keys_from_ocr_manifest(
    *,
    object_store: S3ObjectStoreAdmin,
    source_bucket: str,
    ocr_manifest_key: str,
) -> tuple[str, ...]:
    try:
        payload = json.loads(
            object_store.get_bytes(bucket=source_bucket, key=ocr_manifest_key).decode("utf-8")
        )
    except Exception:
        return ()
    return _string_tuple(
        (
            payload.get("provider_response_key"),
            payload.get("layout_elements_key"),
        )
    )


def _collect_derived_artifact_keys(
    *,
    read_model_rows: Sequence[object],
    registry_rows: Sequence[object],
) -> tuple[str, ...]:
    keys: list[str] = []
    for row in read_model_rows:
        keys.extend(_string_tuple((getattr(row, "canonical_markdown_object_key", ""),)))
    for row in registry_rows:
        keys.extend(_string_tuple(getattr(row, "processed_object_keys", ())))
        keys.extend(
            _string_tuple(
                (
                    getattr(row, "canonical_markdown_object_key", ""),
                    getattr(row, "document_units_object_key", ""),
                )
            )
        )
    return tuple(dict.fromkeys(key for key in keys if key))


def _is_wechat_registry_row(row: object) -> bool:
    source_channel = str(getattr(row, "source_channel", "") or "").strip()
    import_source = str(getattr(row, "import_source", "") or "").strip()
    document_id = str(getattr(row, "document_id", "") or "").strip()
    return (
        source_channel == WECHAT_SOURCE_CHANNEL
        or import_source == WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE
        or document_id.startswith(WECHAT_CHILD_DOCUMENT_PREFIX)
    )


def _load_attempt_rows(
    *,
    source_corpus: str,
    source_collection: str,
) -> tuple[dict[str, object], ...]:
    database_url = _database_url_from_store(
        build_internal_wechat_attempt_store=True,
    )
    with open_postgres_connection(database_url) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
            select record from {DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE}
            where source_corpus = %s and source_collection = %s
            order by source_notice_id asc, media_ref_id asc, attempt_number asc
            """,
            (source_corpus, source_collection),
        )
        rows = cursor.fetchall()
    return tuple(dict(_coerce_json_payload(row[0])) for row in rows)


def _delete_attempt_rows(
    *,
    source_corpus: str,
    source_collection: str,
) -> None:
    database_url = _database_url_from_store(
        build_internal_wechat_attempt_store=True,
    )
    with open_postgres_connection(database_url, autocommit=False) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
            delete from {DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE}
            where source_corpus = %s and source_collection = %s
            """,
            (source_corpus, source_collection),
        )


def _load_admission_rows(
    *,
    source_corpus: str,
    source_collection: str,
) -> tuple[dict[str, object], ...]:
    database_url = _database_url_from_store(
        build_internal_admission_store=True,
    )
    rows: list[dict[str, object]] = []
    with open_postgres_connection(database_url) as conn, conn.cursor() as cursor:
        for table_name in (
            DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE,
            DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_EVENT_TABLE,
        ):
            cursor.execute(
                f"""
                select record from {table_name}
                where source_corpus = %s and source_collection = %s
                """,
                (source_corpus, source_collection),
            )
            rows.extend(dict(_coerce_json_payload(row[0])) for row in cursor.fetchall())
    return tuple(rows)


def _delete_admission_rows(
    *,
    source_corpus: str,
    source_collection: str,
) -> None:
    database_url = _database_url_from_store(
        build_internal_admission_store=True,
    )
    with open_postgres_connection(database_url, autocommit=False) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
            delete from {DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_EVENT_TABLE}
            where source_corpus = %s and source_collection = %s
            """,
            (source_corpus, source_collection),
        )
        cursor.execute(
            f"""
            delete from {DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE}
            where source_corpus = %s and source_collection = %s
            """,
            (source_corpus, source_collection),
        )


def _database_url_from_store(
    *,
    build_internal_admission_store: bool = False,
    build_internal_wechat_attempt_store: bool = False,
) -> str:
    if build_internal_admission_store:
        store = build_internal_notice_consumption_admission_store_from_env(prefer_operator=True)
    elif build_internal_wechat_attempt_store:
        from campus_ingestion_core.wechat_public_notice_multimodal import (
            build_wechat_public_notice_multimodal_attempt_store_from_env,
        )

        store = build_wechat_public_notice_multimodal_attempt_store_from_env(prefer_operator=True)
    else:  # pragma: no cover
        raise ValueError("one store selector is required")
    database_url = str(getattr(store, "database_url", "") or "").strip()
    if not database_url:
        raise ValueError("operator database url is unavailable for reset")
    return database_url


def _string_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        normalized = value.strip()
        return (normalized,) if normalized else ()
    if (
        isinstance(value, tuple)
        and len(value) == 4
        and all(not isinstance(item, (list, tuple, dict)) for item in value)
    ):
        values = value
    elif not isinstance(value, (list, tuple)):
        return ()
    else:
        values = value
    items: list[str] = []
    for item in values:
        normalized = str(item or "").strip()
        if normalized:
            items.append(normalized)
    return tuple(dict.fromkeys(items))


__all__ = [
    "WeChatPublicNoticeDownstreamResetReport",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
