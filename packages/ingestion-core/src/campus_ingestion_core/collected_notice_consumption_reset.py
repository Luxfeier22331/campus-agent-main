from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

from campus_ingestion_core.postgres_runtime import (
    build_management_postgres_connection_url,
    open_postgres_connection,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
)

RESET_SCHEMA_VERSION = "collected_notice_reset_report.v1"
BACKUP_SCHEMA_VERSION = "collected_notice_reset_backup.v1"
EXECUTE_SCHEMA_VERSION = "collected_notice_reset_execute.v1"
AUDIT_SCHEMA_VERSION = "collected_notice_reset_audit.v1"

RESET_PHASE = "phase-03-reset-derived-state-to-collected-only"
RESET_BASELINE = "captured_but_not_imported"
WORKSTREAM_SLUG = "collected-notice-consumption-replay-closeout"

SOURCE_TRUTH_RESET_SCOPES = (
    ("campus_notices", "internal_notice"),
    ("authenticated_documents", "common_download_source"),
)
FILE_RELEASE_INVENTORY_RESET_SCOPES = (
    ("authenticated_documents", "file_release_source"),
    ("campus_notices", "file_release_capture"),
)
REGISTRY_IMPORT_RESET_SCOPES = (
    ("campus_notices", "internal_notice"),
    ("authenticated_documents", "common_download_source"),
    ("authenticated_documents", "file_release_source"),
    ("campus_notices", "file_release_capture"),
)
CONSUMPTION_RESET_SCOPES = (
    ("campus_notices", "internal_notice"),
    ("campus_notices", "wechat_public_notice"),
    ("authenticated_documents", "common_download_source"),
    ("authenticated_documents", "file_release_source"),
    ("campus_notices", "file_release_capture"),
)

SERVICE_STATUS_RELEASE_PATTERN_SQL = (
    "coalesce(array_length(source_notice_ids, 1), 0) > 0 "
    "or release_id ilike any(array['%notice%', '%smoke%', '%stage%', '%current%', '%live%', '%e2e%'])"
)
TRANSPORT_RELEASE_PATTERN_SQL = (
    "coalesce(array_length(source_notice_ids, 1), 0) > 0 "
    "or release_id ilike any(array["
    "'%notice%', '%smoke%', '%stage%', '%full-ready%', '%manual-review%', "
    "'%reviewed-pdf%', '%clean-auto%', '%e2e%'"
    "])"
)
SERVICE_GUIDE_DELETE_RELEASE_PATTERN_SQL = (
    "coalesce(array_length(source_notice_ids, 1), 0) > 0 "
    "or release_id ilike any(array['%notice%', '%smoke%', '%stage%', '%preview%', '%transport%', '%e2e%'])"
)

SERVICE_STATUS_RELEASE_IDS_SQL = f"""
    select release_id
    from ingestion_projection.structured_projection_releases
    where corpus = 'campus_services'
      and collection = 'service_status'
      and ({SERVICE_STATUS_RELEASE_PATTERN_SQL})
"""
TRANSPORT_RELEASE_IDS_SQL = f"""
    select release_id
    from ingestion_projection.structured_projection_releases
    where corpus = 'campus_services'
      and collection = 'transport_schedule'
      and ({TRANSPORT_RELEASE_PATTERN_SQL})
"""
SERVICE_GUIDE_DELETE_RELEASE_IDS_SQL = f"""
    select release_id
    from ingestion_projection.structured_projection_releases
    where corpus = 'campus_services'
      and collection = 'service_guide'
      and ({SERVICE_GUIDE_DELETE_RELEASE_PATTERN_SQL})
"""
SERVICE_GUIDE_STABLE_RELEASE_IDS_SQL = f"""
    select release_id
    from ingestion_projection.structured_projection_releases
    where corpus = 'campus_services'
      and collection = 'service_guide'
      and not ({SERVICE_GUIDE_DELETE_RELEASE_PATTERN_SQL})
    order by published_at desc, generated_at desc, release_id desc
"""


@dataclass(frozen=True, slots=True)
class ResetDeleteAction:
    name: str
    table: str
    where_sql: str
    reason: str


@dataclass(frozen=True, slots=True)
class ResetPlan:
    baseline: str
    planned_deletes: tuple[ResetDeleteAction, ...]
    planned_source_object_deletes: tuple[str, ...] = ()
    preserved_state: tuple[str, ...] = (
        "source_bucket_objects",
        "collector_run_ledger",
        "object_locator_evidence",
        "workstream_evidence",
    )


@dataclass(frozen=True, slots=True)
class ServiceGuideCurrentResetAction:
    action: str
    release_id: str | None
    reason: str


def build_collected_notice_reset_plan() -> ResetPlan:
    return ResetPlan(
        baseline=RESET_BASELINE,
        planned_deletes=(
            ResetDeleteAction(
                name="authenticated_notice_source_truth_inventory",
                table="ingestion_projection.authenticated_notice_source_truth_inventory",
                where_sql=_scope_where("corpus", "collection", SOURCE_TRUTH_RESET_SCOPES),
                reason="clear imported source-truth rows back to captured-only baseline",
            ),
            ResetDeleteAction(
                name="authenticated_notice_file_release_inventory",
                table="ingestion_projection.authenticated_notice_file_release_inventory",
                where_sql=_scope_where("corpus", "collection", FILE_RELEASE_INVENTORY_RESET_SCOPES),
                reason="clear imported file-release source-truth rows back to captured-only baseline",
            ),
            ResetDeleteAction(
                name="document_registry_import_rows",
                table="ingestion_registry.document_registry_records",
                where_sql=_scope_where("corpus", "collection", REGISTRY_IMPORT_RESET_SCOPES),
                reason="clear document holding rows produced by authenticated notice/file-release imports",
            ),
            ResetDeleteAction(
                name="raw_asset_registry_import_rows",
                table="ingestion_registry.raw_asset_registry_records",
                where_sql=_scope_where("corpus", "collection", REGISTRY_IMPORT_RESET_SCOPES),
                reason="clear raw asset registry rows produced by authenticated notice/file-release imports",
            ),
            ResetDeleteAction(
                name="notice_consumption_projection",
                table="ingestion_projection.notice_consumption_projection",
                where_sql=_scope_where(
                    "source_corpus",
                    "source_collection",
                    CONSUMPTION_RESET_SCOPES,
                ),
                reason="clear old notice consumption projection state",
            ),
            ResetDeleteAction(
                name="internal_notice_read_model",
                table="ingestion_projection.internal_notice_read_model",
                where_sql=_scope_where(
                    "source_corpus",
                    "source_collection",
                    CONSUMPTION_RESET_SCOPES,
                ),
                reason="clear old searchable/read-model state before Phase 4 replay",
            ),
            ResetDeleteAction(
                name="internal_notice_consumption_admission",
                table="ingestion_projection.internal_notice_consumption_admission",
                where_sql=_scope_where(
                    "source_corpus",
                    "source_collection",
                    CONSUMPTION_RESET_SCOPES,
                ),
                reason="clear old admission batches before new manifest replay",
            ),
            ResetDeleteAction(
                name="internal_notice_consumption_admission_event",
                table="ingestion_projection.internal_notice_consumption_admission_event",
                where_sql=_scope_where(
                    "source_corpus",
                    "source_collection",
                    CONSUMPTION_RESET_SCOPES,
                ),
                reason="clear old admission events before new manifest replay",
            ),
            ResetDeleteAction(
                name="internal_notice_multimodal_attempt",
                table="ingestion_projection.internal_notice_multimodal_attempt",
                where_sql=_scope_where(
                    "source_corpus",
                    "source_collection",
                    CONSUMPTION_RESET_SCOPES,
                ),
                reason="clear old multimodal attempt state before unified Phase 5 ledger",
            ),
            ResetDeleteAction(
                name="internal_notice_schedule_image_ocr_attempt",
                table="ingestion_projection.internal_notice_schedule_image_ocr_attempt",
                where_sql=_scope_where(
                    "source_corpus",
                    "source_collection",
                    CONSUMPTION_RESET_SCOPES,
                ),
                reason="clear old schedule OCR attempt state before unified Phase 5 ledger",
            ),
            ResetDeleteAction(
                name="wechat_public_notice_multimodal_attempt",
                table="ingestion_projection.wechat_public_notice_multimodal_attempt",
                where_sql=_scope_where(
                    "source_corpus",
                    "source_collection",
                    CONSUMPTION_RESET_SCOPES,
                ),
                reason="clear old WeChat multimodal attempt state before unified Phase 5 ledger",
            ),
            ResetDeleteAction(
                name="service_status_notice_derived_read_model",
                table="ingestion_projection.service_status_read_model",
                where_sql=f"release_id in ({SERVICE_STATUS_RELEASE_IDS_SQL})",
                reason="clear notice-derived service_status read model rows",
            ),
            ResetDeleteAction(
                name="service_guide_non_stable_read_model",
                table="ingestion_projection.service_guide_read_model",
                where_sql=f"release_id in ({SERVICE_GUIDE_DELETE_RELEASE_IDS_SQL})",
                reason="clear notice-derived/smoke/stage/mixed service_guide rows while preserving stable releases",
            ),
            *(
                ResetDeleteAction(
                    name=f"transport_notice_derived_{table_name}",
                    table=f"ingestion_projection.{table_name}",
                    where_sql=f"release_id in ({TRANSPORT_RELEASE_IDS_SQL})",
                    reason="clear notice-derived transport schedule replay state",
                )
                for table_name in (
                    "transport_release_notices",
                    "transport_operational_notices",
                    "transport_routes",
                    "transport_schedule_snapshots",
                    "transport_scheduled_departures",
                    "transport_service_exceptions",
                    "transport_rejected_sources",
                )
            ),
            ResetDeleteAction(
                name="structured_projection_current_notice_derived_targets",
                table="ingestion_projection.structured_projection_current",
                where_sql=(
                    "(corpus = 'campus_services' and collection = 'service_status' "
                    f"and release_id in ({SERVICE_STATUS_RELEASE_IDS_SQL})) "
                    "or (corpus = 'campus_services' and collection = 'transport_schedule' "
                    f"and release_id in ({TRANSPORT_RELEASE_IDS_SQL}))"
                ),
                reason="clear old current pointers for replayed notice-derived targets",
            ),
            ResetDeleteAction(
                name="structured_projection_releases_notice_derived_targets",
                table="ingestion_projection.structured_projection_releases",
                where_sql=(
                    "(corpus = 'campus_services' and collection = 'service_status' "
                    f"and release_id in ({SERVICE_STATUS_RELEASE_IDS_SQL})) "
                    "or (corpus = 'campus_services' and collection = 'transport_schedule' "
                    f"and release_id in ({TRANSPORT_RELEASE_IDS_SQL})) "
                    "or (corpus = 'campus_services' and collection = 'service_guide' "
                    f"and release_id in ({SERVICE_GUIDE_DELETE_RELEASE_IDS_SQL}))"
                ),
                reason="clear old structured projection release records for reset scope",
            ),
        ),
    )


def choose_service_guide_current_reset_action(
    *,
    current_release_id: str | None,
    deleted_release_ids: Sequence[str],
    stable_release_ids: Sequence[str],
) -> ServiceGuideCurrentResetAction:
    current = str(current_release_id or "").strip()
    deleted = {str(item).strip() for item in deleted_release_ids if str(item).strip()}
    stable = tuple(str(item).strip() for item in stable_release_ids if str(item).strip())
    if not current:
        return ServiceGuideCurrentResetAction(
            action="none",
            release_id=None,
            reason="service_guide has no current pointer",
        )
    if current not in deleted:
        return ServiceGuideCurrentResetAction(
            action="keep_current",
            release_id=current,
            reason="service_guide current pointer already references a stable release",
        )
    if stable:
        return ServiceGuideCurrentResetAction(
            action="promote_stable_release",
            release_id=stable[0],
            reason="mixed current release is reset and a stable service_guide release exists",
        )
    return ServiceGuideCurrentResetAction(
        action="manual_review_required",
        release_id=None,
        reason="mixed current release is reset and no stable service_guide release exists",
    )


def resolve_collected_notice_reset_database_url(env: Mapping[str, str]) -> str:
    database_url = (
        env.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
        or env.get(RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY)
        or env.get(DOCUMENT_REGISTRY_ENV_KEY)
        or env.get(RAW_ASSET_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or {RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY} "
            f"or {DOCUMENT_REGISTRY_ENV_KEY} or {RAW_ASSET_REGISTRY_ENV_KEY} is required"
        )
    return build_management_postgres_connection_url(database_url)


def generate_collected_notice_reset_dry_run_report(
    *,
    database_url: str,
    input_refs: Sequence[str] = (),
) -> dict[str, Any]:
    plan = build_collected_notice_reset_plan()
    generated_at = _utc_now()
    with open_postgres_connection(database_url) as conn, conn.cursor() as cursor:
        release_sets = _load_release_sets(cursor)
        current_action = choose_service_guide_current_reset_action(
            current_release_id=release_sets["service_guide_current_release_id"],
            deleted_release_ids=release_sets["service_guide_deleted_release_ids"],
            stable_release_ids=release_sets["service_guide_stable_release_ids"],
        )
        planned_deletes = [_delete_action_report(cursor, action) for action in plan.planned_deletes]
        planned_updates = _planned_current_updates(cursor, current_action=current_action)
        preserved_counts = _preserved_counts(cursor)

    return {
        "schema_version": RESET_SCHEMA_VERSION,
        "report_id": f"collected-notice-reset-dry-run-{_compact_timestamp(generated_at)}",
        "generated_at": generated_at,
        "generated_by": "campus_ingestion_worker.reset_collected_notice_consumption_state",
        "mode": "dry_run",
        "phase": RESET_PHASE,
        "baseline": RESET_BASELINE,
        "input_refs": list(input_refs),
        "selection_policy": {
            "name": "collected_notice_consumption_replay_phase3_reset",
            "version": "v1",
        },
        "planned_writes": [],
        "planned_deletes": planned_deletes,
        "planned_updates": planned_updates,
        "planned_skips": [],
        "planned_defers": [],
        "planned_blocks": _planned_blocks(current_action),
        "counts": _counts_summary(
            planned_deletes=planned_deletes,
            planned_updates=planned_updates,
            preserved_counts=preserved_counts,
        ),
        "release_sets": release_sets,
        "preconditions": [
            "Phase 2 chain contract completed",
            "backup report generated before execute",
            "execute command references this dry-run report id",
            "operator passes --yes for execute",
        ],
        "backup_requirements": [
            {"table": action["table"], "row_count": action["row_count"]}
            for action in planned_deletes
            if int(action["row_count"]) > 0
        ],
        "write_manifest_candidate": {
            "baseline": RESET_BASELINE,
            "delete_action_names": [action.name for action in plan.planned_deletes],
            "service_guide_current_action": asdict(current_action),
        },
        "verification_queries": [
            "post-reset source-truth / holding / registry reset-scope counts are zero",
            "post-reset derived/downstream reset-scope counts are zero or explicitly preserved",
            "collector run ledger count remains non-zero",
            "service_guide current pointer references a stable release or is absent for manual review",
        ],
    }


def generate_collected_notice_reset_backup(
    *,
    database_url: str,
    dry_run_report: Mapping[str, Any],
) -> dict[str, Any]:
    _require_report_schema(dry_run_report, RESET_SCHEMA_VERSION, expected_mode="dry_run")
    plan = build_collected_notice_reset_plan()
    generated_at = _utc_now()
    with open_postgres_connection(database_url) as conn, conn.cursor() as cursor:
        table_backups = [
            _backup_action_rows(cursor, action)
            for action in plan.planned_deletes
            if _count_rows(cursor, action.table, action.where_sql) > 0
        ]
        current_rows = _backup_rows(
            cursor,
            table="ingestion_projection.structured_projection_current",
            where_sql=(
                "corpus = 'campus_services' "
                "and collection in ('service_guide', 'service_status', 'transport_schedule')"
            ),
        )
    return {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "report_id": f"collected-notice-reset-backup-{_compact_timestamp(generated_at)}",
        "generated_at": generated_at,
        "generated_by": "campus_ingestion_worker.reset_collected_notice_consumption_state",
        "mode": "backup",
        "phase": RESET_PHASE,
        "dry_run_report_id": str(dry_run_report.get("report_id") or ""),
        "table_backups": table_backups,
        "current_pointer_backup": {
            "table": "ingestion_projection.structured_projection_current",
            "row_count": len(current_rows),
            "rows": current_rows,
        },
        "counts": {
            "table_backup_count": len(table_backups),
            "row_count": sum(int(item["row_count"]) for item in table_backups) + len(current_rows),
        },
    }


def execute_collected_notice_reset(
    *,
    database_url: str,
    dry_run_report: Mapping[str, Any],
    backup_report: Mapping[str, Any],
) -> dict[str, Any]:
    _require_report_schema(dry_run_report, RESET_SCHEMA_VERSION, expected_mode="dry_run")
    _require_report_schema(backup_report, BACKUP_SCHEMA_VERSION, expected_mode="backup")
    dry_run_report_id = str(dry_run_report.get("report_id") or "")
    if str(backup_report.get("dry_run_report_id") or "") != dry_run_report_id:
        raise ValueError("backup report does not reference the supplied dry-run report")

    plan = build_collected_notice_reset_plan()
    generated_at = _utc_now()
    executed_deletes: list[dict[str, Any]] = []
    with open_postgres_connection(database_url, autocommit=False) as conn, conn.cursor() as cursor:
        release_sets = _load_release_sets(cursor)
        current_action = choose_service_guide_current_reset_action(
            current_release_id=release_sets["service_guide_current_release_id"],
            deleted_release_ids=release_sets["service_guide_deleted_release_ids"],
            stable_release_ids=release_sets["service_guide_stable_release_ids"],
        )
        for action in plan.planned_deletes:
            cursor.execute(f"delete from {action.table} where {action.where_sql}")
            executed_deletes.append(
                {
                    "name": action.name,
                    "table": action.table,
                    "row_count": int(cursor.rowcount if cursor.rowcount is not None else 0),
                }
            )
        executed_updates = _execute_service_guide_current_action(
            cursor,
            current_action=current_action,
        )

    return {
        "schema_version": EXECUTE_SCHEMA_VERSION,
        "report_id": f"collected-notice-reset-execute-{_compact_timestamp(generated_at)}",
        "generated_at": generated_at,
        "generated_by": "campus_ingestion_worker.reset_collected_notice_consumption_state",
        "mode": "execute",
        "phase": RESET_PHASE,
        "baseline": RESET_BASELINE,
        "dry_run_report_id": dry_run_report_id,
        "backup_report_id": str(backup_report.get("report_id") or ""),
        "executed_deletes": executed_deletes,
        "executed_updates": executed_updates,
        "counts": {
            "deleted_row_count": sum(int(item["row_count"]) for item in executed_deletes),
            "updated_row_count": sum(int(item["row_count"]) for item in executed_updates),
        },
        "source_object_delete_count": 0,
    }


def generate_collected_notice_post_reset_audit(
    *,
    database_url: str,
    execute_report: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if execute_report is not None:
        _require_report_schema(execute_report, EXECUTE_SCHEMA_VERSION, expected_mode="execute")
    plan = build_collected_notice_reset_plan()
    generated_at = _utc_now()
    with open_postgres_connection(database_url) as conn, conn.cursor() as cursor:
        remaining_reset_rows = [
            _delete_action_report(cursor, action) for action in plan.planned_deletes
        ]
        release_sets = _load_release_sets(cursor)
        preserved_counts = _preserved_counts(cursor)
        service_guide_current = _fetch_optional_text(
            cursor,
            """
            select release_id
            from ingestion_projection.structured_projection_current
            where corpus = 'campus_services' and collection = 'service_guide'
            """,
        )
    nonzero_remaining = [
        item for item in remaining_reset_rows if int(item.get("row_count") or 0) > 0
    ]
    return {
        "schema_version": AUDIT_SCHEMA_VERSION,
        "report_id": f"collected-notice-reset-audit-{_compact_timestamp(generated_at)}",
        "generated_at": generated_at,
        "generated_by": "campus_ingestion_worker.reset_collected_notice_consumption_state",
        "mode": "post_reset_audit",
        "phase": RESET_PHASE,
        "baseline": RESET_BASELINE,
        "execute_report_id": str((execute_report or {}).get("report_id") or ""),
        "remaining_reset_scope_rows": remaining_reset_rows,
        "nonzero_remaining_reset_scope_rows": nonzero_remaining,
        "preserved_counts": preserved_counts,
        "release_sets": release_sets,
        "service_guide_current_release_id": service_guide_current,
        "verdict": "passed" if not nonzero_remaining else "failed",
    }


def _scope_where(
    corpus_column: str,
    collection_column: str,
    scopes: Sequence[tuple[str, str]],
) -> str:
    values = ", ".join(f"('{corpus}', '{collection}')" for corpus, collection in scopes)
    return f"({corpus_column}, {collection_column}) in ({values})"


def _delete_action_report(cursor: Any, action: ResetDeleteAction) -> dict[str, Any]:
    return {
        "name": action.name,
        "table": action.table,
        "action": "delete_rows",
        "row_count": _count_rows(cursor, action.table, action.where_sql),
        "reason": action.reason,
    }


def _count_rows(cursor: Any, table: str, where_sql: str) -> int:
    cursor.execute(f"select count(*) from {table} where {where_sql}")
    row = cursor.fetchone()
    return int(row[0] if row is not None else 0)


def _backup_action_rows(cursor: Any, action: ResetDeleteAction) -> dict[str, Any]:
    rows = _backup_rows(cursor, table=action.table, where_sql=action.where_sql)
    return {
        "name": action.name,
        "table": action.table,
        "row_count": len(rows),
        "rows": rows,
    }


def _backup_rows(cursor: Any, *, table: str, where_sql: str) -> list[dict[str, Any]]:
    cursor.execute(
        f"""
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
            select *
            from {table}
            where {where_sql}
        ) as t
        """
    )
    row = cursor.fetchone()
    if row is None:
        return []
    value = row[0]
    if value is None:
        return []
    return [dict(item) for item in list(value)]


def _load_release_sets(cursor: Any) -> dict[str, Any]:
    service_status = _fetch_text_tuple(cursor, SERVICE_STATUS_RELEASE_IDS_SQL)
    transport = _fetch_text_tuple(cursor, TRANSPORT_RELEASE_IDS_SQL)
    service_guide_deleted = _fetch_text_tuple(cursor, SERVICE_GUIDE_DELETE_RELEASE_IDS_SQL)
    service_guide_stable = _fetch_text_tuple(cursor, SERVICE_GUIDE_STABLE_RELEASE_IDS_SQL)
    service_guide_current = _fetch_optional_text(
        cursor,
        """
        select release_id
        from ingestion_projection.structured_projection_current
        where corpus = 'campus_services' and collection = 'service_guide'
        """,
    )
    return {
        "service_status_deleted_release_ids": list(service_status),
        "transport_schedule_deleted_release_ids": list(transport),
        "service_guide_deleted_release_ids": list(service_guide_deleted),
        "service_guide_stable_release_ids": list(service_guide_stable),
        "service_guide_current_release_id": service_guide_current,
    }


def _fetch_text_tuple(cursor: Any, query: str) -> tuple[str, ...]:
    cursor.execute(query)
    return tuple(str(row[0]) for row in cursor.fetchall())


def _fetch_optional_text(cursor: Any, query: str) -> str | None:
    cursor.execute(query)
    row = cursor.fetchone()
    if row is None:
        return None
    return str(row[0])


def _planned_current_updates(
    cursor: Any,
    *,
    current_action: ServiceGuideCurrentResetAction,
) -> list[dict[str, Any]]:
    row_count = 0
    if current_action.action in {"promote_stable_release", "manual_review_required"}:
        cursor.execute(
            """
            select count(*)
            from ingestion_projection.structured_projection_current
            where corpus = 'campus_services' and collection = 'service_guide'
            """
        )
        row = cursor.fetchone()
        row_count = int(row[0] if row is not None else 0)
    return [
        {
            "name": "service_guide_current_pointer",
            "table": "ingestion_projection.structured_projection_current",
            "action": current_action.action,
            "release_id": current_action.release_id,
            "row_count": row_count,
            "reason": current_action.reason,
        }
    ]


def _planned_blocks(current_action: ServiceGuideCurrentResetAction) -> list[dict[str, Any]]:
    if current_action.action != "manual_review_required":
        return []
    return [
        {
            "name": "service_guide_current_manual_review",
            "reason": current_action.reason,
        }
    ]


def _execute_service_guide_current_action(
    cursor: Any,
    *,
    current_action: ServiceGuideCurrentResetAction,
) -> list[dict[str, Any]]:
    if current_action.action == "promote_stable_release" and current_action.release_id:
        cursor.execute(
            """
            insert into ingestion_projection.structured_projection_current (
                corpus,
                collection,
                release_id
            ) values ('campus_services', 'service_guide', %s)
            on conflict (corpus, collection) do update set
                release_id = excluded.release_id,
                updated_at = now()
            """,
            (current_action.release_id,),
        )
        return [
            {
                "name": "service_guide_current_pointer",
                "table": "ingestion_projection.structured_projection_current",
                "action": "promote_stable_release",
                "release_id": current_action.release_id,
                "row_count": 1,
            }
        ]
    if current_action.action == "manual_review_required":
        cursor.execute(
            """
            delete from ingestion_projection.structured_projection_current
            where corpus = 'campus_services' and collection = 'service_guide'
            """
        )
        return [
            {
                "name": "service_guide_current_pointer",
                "table": "ingestion_projection.structured_projection_current",
                "action": "manual_review_required",
                "release_id": None,
                "row_count": int(cursor.rowcount if cursor.rowcount is not None else 0),
            }
        ]
    return [
        {
            "name": "service_guide_current_pointer",
            "table": "ingestion_projection.structured_projection_current",
            "action": current_action.action,
            "release_id": current_action.release_id,
            "row_count": 0,
        }
    ]


def _preserved_counts(cursor: Any) -> dict[str, int]:
    return {
        "collector_run_ledger": _table_count(
            cursor,
            "ingestion_projection.authenticated_notice_collector_run",
        ),
        "source_bucket_object_delete_count": 0,
    }


def _table_count(cursor: Any, table: str) -> int:
    cursor.execute(f"select count(*) from {table}")
    row = cursor.fetchone()
    return int(row[0] if row is not None else 0)


def _counts_summary(
    *,
    planned_deletes: Sequence[Mapping[str, Any]],
    planned_updates: Sequence[Mapping[str, Any]],
    preserved_counts: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "planned_delete_table_count": len(planned_deletes),
        "planned_delete_row_count": sum(int(item["row_count"]) for item in planned_deletes),
        "planned_update_row_count": sum(int(item["row_count"]) for item in planned_updates),
        "preserved_counts": dict(preserved_counts),
    }


def _require_report_schema(
    report: Mapping[str, Any],
    expected_schema: str,
    *,
    expected_mode: str,
) -> None:
    schema = str(report.get("schema_version") or "")
    mode = str(report.get("mode") or "")
    if schema != expected_schema:
        raise ValueError(f"expected {expected_schema}, got {schema or '<missing>'}")
    if mode != expected_mode:
        raise ValueError(f"expected mode {expected_mode}, got {mode or '<missing>'}")
    if not str(report.get("report_id") or "").strip():
        raise ValueError("report_id is required")


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _compact_timestamp(value: str) -> str:
    return value.replace("-", "").replace(":", "").replace("+00:00", "Z")


__all__ = [
    "AUDIT_SCHEMA_VERSION",
    "BACKUP_SCHEMA_VERSION",
    "EXECUTE_SCHEMA_VERSION",
    "RESET_SCHEMA_VERSION",
    "ServiceGuideCurrentResetAction",
    "build_collected_notice_reset_plan",
    "choose_service_guide_current_reset_action",
    "execute_collected_notice_reset",
    "generate_collected_notice_post_reset_audit",
    "generate_collected_notice_reset_backup",
    "generate_collected_notice_reset_dry_run_report",
    "resolve_collected_notice_reset_database_url",
]
