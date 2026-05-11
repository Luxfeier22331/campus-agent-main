from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _postgres_connection,
    _qualified_table_sql,
)

DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE = (
    "ingestion_projection.authenticated_notice_collector_run"
)
AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY = (
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL"
)
AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY = (
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL"
)

_COLLECTOR_RUN_REF_COLUMNS = (
    "run_id",
    "source_surface",
    "status",
    "verification_status",
    "source_bucket",
    "bundle_object_key",
    "bundle_content_sha256",
    "bundle_byte_size",
    "manifest_object_key",
    "manifest_content_sha256",
    "manifest_byte_size",
)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeCollectorRunObjectRefs:
    run_id: str
    source_surface: str
    source_bucket: str
    bundle_object_key: str
    manifest_object_key: str
    bundle_content_sha256: str
    bundle_byte_size: int
    manifest_content_sha256: str
    manifest_byte_size: int


def resolve_authenticated_notice_collector_run_refs(
    *,
    env: dict[str, str],
    run_id: str,
    expected_source_surface: str,
    table_name: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
) -> AuthenticatedNoticeCollectorRunObjectRefs:
    database_url = _collector_run_ledger_database_url(env)
    if database_url is None:
        raise ValueError(
            f"{AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY} or "
            f"{AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY} or "
            f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} "
            "is required for authenticated notice run_id import"
        )
    table_sql = _qualified_table_sql(table_name)
    columns_sql = ", ".join(_COLLECTOR_RUN_REF_COLUMNS)
    with _postgres_connection(database_url) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
            select {columns_sql}
            from {table_sql}
            where run_id = %s
            limit 1
            """,
            (run_id,),
        )
        row = cursor.fetchone()
    if row is None:
        raise ValueError(f"collector run ledger row not found for run_id: {run_id}")
    return collector_run_refs_from_row(
        dict(zip(_COLLECTOR_RUN_REF_COLUMNS, row, strict=True)),
        expected_source_surface=expected_source_surface,
    )


def collector_run_refs_from_row(
    row: dict[str, Any],
    *,
    expected_source_surface: str,
) -> AuthenticatedNoticeCollectorRunObjectRefs:
    run_id = _required_text(row.get("run_id"), "run_id")
    source_surface = _required_text(row.get("source_surface"), "source_surface")
    if source_surface != expected_source_surface:
        raise ValueError(
            "collector run ledger source_surface mismatch: "
            f"expected {expected_source_surface}, got {source_surface}"
        )
    status = _required_text(row.get("status"), "status")
    if status != "success":
        raise ValueError(
            f"collector run ledger row {run_id} must have status=success; got {status}"
        )
    verification_status = _required_text(row.get("verification_status"), "verification_status")
    if verification_status != "verified":
        raise ValueError(
            "collector run ledger row "
            f"{run_id} must have verification_status=verified; got {verification_status}"
        )
    return AuthenticatedNoticeCollectorRunObjectRefs(
        run_id=run_id,
        source_surface=source_surface,
        source_bucket=_required_text(row.get("source_bucket"), "source_bucket"),
        bundle_object_key=_required_text(row.get("bundle_object_key"), "bundle_object_key"),
        manifest_object_key=_required_text(row.get("manifest_object_key"), "manifest_object_key"),
        bundle_content_sha256=_required_sha256(
            row.get("bundle_content_sha256"),
            "bundle_content_sha256",
        ),
        bundle_byte_size=_required_non_negative_int(
            row.get("bundle_byte_size"), "bundle_byte_size"
        ),
        manifest_content_sha256=_required_sha256(
            row.get("manifest_content_sha256"),
            "manifest_content_sha256",
        ),
        manifest_byte_size=_required_non_negative_int(
            row.get("manifest_byte_size"),
            "manifest_byte_size",
        ),
    )


def _collector_run_ledger_database_url(env: dict[str, str]) -> str | None:
    direct = (env.get(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY) or "").strip()
    if direct:
        return normalize_postgres_connection_url(direct)
    operator = (
        env.get(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY)
        or env.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
        or ""
    ).strip()
    if not operator:
        return None
    normalized = normalize_postgres_connection_url(operator)
    return build_operator_postgres_connection_url(normalized)


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"collector run ledger {label} is required")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"collector run ledger {label} is required")
    return normalized


def _required_sha256(value: object, label: str) -> str:
    normalized = _required_text(value, label)
    if len(normalized) != 64 or any(
        character not in "0123456789abcdef" for character in normalized
    ):
        raise ValueError(f"collector run ledger {label} must be a lowercase sha256 hex digest")
    return normalized


def _required_non_negative_int(value: object, label: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"collector run ledger {label} must be a non-negative integer")
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"collector run ledger {label} must be a non-negative integer") from exc
    if parsed < 0:
        raise ValueError(f"collector run ledger {label} must be a non-negative integer")
    return parsed


__all__ = [
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY",
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY",
    "DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE",
    "AuthenticatedNoticeCollectorRunObjectRefs",
    "collector_run_refs_from_row",
    "resolve_authenticated_notice_collector_run_refs",
]
