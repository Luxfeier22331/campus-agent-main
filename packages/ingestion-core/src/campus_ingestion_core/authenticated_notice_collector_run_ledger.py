from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired

DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE = (
    "ingestion_projection.authenticated_notice_collector_run"
)
AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY = (
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL"
)
AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY = (
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL"
)

AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS = (
    "run_id",
    "site_id",
    "source_surface",
    "collection_mode",
    "source_home_url",
    "notice_type_ids",
    "selected_notice_ids",
    "bundle_path",
    "manifest_path",
    "bundle_object_key",
    "manifest_object_key",
    "notices_collected",
    "pages_fetched",
    "detail_fetched",
    "items_seen",
    "attachment_refs_seen",
    "attachment_uploaded",
    "attachment_terminal_unavailable",
    "attachment_transient_failed",
    "attachment_reference_only",
    "status",
    "error_count",
    "started_at",
    "finished_at",
    "record",
    "source_bucket",
    "bundle_content_sha256",
    "bundle_byte_size",
    "manifest_content_sha256",
    "manifest_byte_size",
    "verification_status",
    "required_source_object_count",
    "verified_source_object_count",
    "missing_source_object_count",
    "checksum_mismatch_count",
    "size_mismatch_count",
    "failure_reason",
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
    del env, run_id, expected_source_surface, table_name
    raise_python_db_runtime_retired("authenticated notice collector run ledger")


def collector_run_ledger_database_url_from_env(env: dict[str, str]) -> str:
    del env
    raise_python_db_runtime_retired("authenticated notice collector run ledger database url")


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
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS",
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL_ENV_KEY",
    "AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_OPERATOR_DATABASE_URL_ENV_KEY",
    "DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE",
    "AuthenticatedNoticeCollectorRunObjectRefs",
    "collector_run_ledger_database_url_from_env",
    "collector_run_refs_from_row",
    "resolve_authenticated_notice_collector_run_refs",
]
