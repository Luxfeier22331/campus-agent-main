from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    InternalNoticeConsumerAdmissionManifest,
    load_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
    normalize_notice_ids,
)

from campus_ingestion_worker.build_transport_schedule_projection_io import _read_json
from campus_ingestion_worker.build_transport_schedule_projection_publish import (
    _writes_structured_projection,
)


def _load_consumer_admission_manifest_for_transport(
    *,
    manifest_path: str | None,
) -> InternalNoticeConsumerAdmissionManifest:
    if not str(manifest_path or "").strip():
        raise ValueError(
            "consumer admission manifest is required before transport_schedule typed materialization"
        )
    return load_internal_notice_consumer_admission_manifest(Path(str(manifest_path)).resolve())


def _assert_transport_consumer_admission_gate_allows(
    *,
    manifest: InternalNoticeConsumerAdmissionManifest,
    notice_ids: Sequence[str],
) -> None:
    report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=tuple(notice_ids),
            scope_write_mode="upsert_selected",
            target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
            max_empty_body_count=0,
            max_unsupported_binary_count=0,
        ),
    )
    if not report.allowed:
        raise ValueError(
            "consumer admission manifest gate blocked transport_schedule materialization: "
            + ", ".join(report.reason_codes)
        )


def _assert_transport_preview_gate_allows(
    *,
    publish_mode: str,
    report_path: str | None,
    selected_notice_ids: Sequence[str],
) -> Mapping[str, Any] | None:
    if not _writes_structured_projection(publish_mode):
        return None
    normalized_path = str(report_path or "").strip()
    if not normalized_path:
        raise ValueError(
            "transport preview gate report is required before transport_schedule stage/promote"
        )
    report = _read_json(Path(normalized_path).resolve())
    if report.get("schema_version") != "schedule_transport_preview_gate.v1":
        raise ValueError("transport preview gate report has unsupported schema_version")
    if not bool(report.get("validation_valid")):
        raise ValueError("transport preview gate validation is not valid")

    selected = set(normalize_notice_ids(selected_notice_ids))
    buckets = dict(report.get("buckets") or {})
    passed = set(normalize_notice_ids(buckets.get("preview_passed") or ()))
    missing = sorted(selected - passed)
    if missing:
        raise ValueError(
            "transport preview gate did not pass selected notice ids: " + ", ".join(missing)
        )

    release_write_buckets = dict(report.get("release_write_buckets") or {})
    skipped = set(normalize_notice_ids(release_write_buckets.get("preview_failed_skip") or ()))
    blocked = sorted(selected & skipped)
    if blocked:
        raise ValueError(
            "transport preview gate marked selected notice ids as preview_failed_skip: "
            + ", ".join(blocked)
        )
    return report


def _assert_transport_bundle_matches_preview_gate_report(
    *,
    publish_mode: str,
    bundle: Mapping[str, Any],
    preview_gate_report: Mapping[str, Any] | None,
    selected_notice_ids: Sequence[str],
) -> None:
    if not _writes_structured_projection(publish_mode) or preview_gate_report is None:
        return
    selected = set(normalize_notice_ids(selected_notice_ids))
    release_write_buckets = dict(preview_gate_report.get("release_write_buckets") or {})
    current_serving = set(
        normalize_notice_ids(release_write_buckets.get("current_serving_write") or ())
    )
    historical_snapshot_only = set(
        normalize_notice_ids(release_write_buckets.get("historical_snapshot_only_write") or ())
    )
    scoped_historical = (
        historical_snapshot_only & selected if selected else historical_snapshot_only
    )
    current_snapshot_notice_ids = _current_snapshot_notice_ids(bundle)
    serving_notice_ids = _serving_notice_ids(bundle)
    historical_current_notice_ids = sorted(current_snapshot_notice_ids & scoped_historical)
    if historical_current_notice_ids:
        raise ValueError(
            "transport preview gate marked notice ids as historical_snapshot_only_write, "
            "but bundle would publish them as current snapshots: "
            + ", ".join(historical_current_notice_ids)
        )
    invalid_current_notice_ids = sorted(current_snapshot_notice_ids - current_serving)
    if invalid_current_notice_ids:
        raise ValueError(
            "transport preview gate does not allow bundle current snapshot notice ids: "
            + ", ".join(invalid_current_notice_ids)
        )
    historical_serving_notice_ids = sorted(serving_notice_ids & scoped_historical)
    if historical_serving_notice_ids:
        raise ValueError(
            "transport preview gate marked notice ids as historical_snapshot_only_write, "
            "but bundle contains serving rows for them: " + ", ".join(historical_serving_notice_ids)
        )


def _current_snapshot_notice_ids(bundle: Mapping[str, Any]) -> set[str]:
    return {
        notice_id
        for snapshot in _list_of_mappings(bundle.get("transport_schedule_snapshots"))
        if bool(snapshot.get("is_current"))
        if (notice_id := _notice_id_from_source_ref(snapshot.get("source_ref")))
    }


def _serving_notice_ids(bundle: Mapping[str, Any]) -> set[str]:
    notice_ids: set[str] = set()
    for departure in _list_of_mappings(bundle.get("scheduled_departures")):
        notice_ids.update(_notice_ids_from_refs(departure.get("related_notice_refs")))
    for exception in _list_of_mappings(bundle.get("transport_service_exceptions")):
        notice_ids.update(_notice_ids_from_refs(exception.get("related_notice_refs")))
    for operational_notice in _list_of_mappings(bundle.get("transport_operational_notices")):
        notice_id = _notice_id_from_source_ref(operational_notice.get("source_ref"))
        if notice_id:
            notice_ids.add(notice_id)
    return notice_ids


def _notice_ids_from_refs(value: object) -> set[str]:
    if isinstance(value, str):
        values: Sequence[object] = (value,)
    elif isinstance(value, Sequence):
        values = value
    else:
        values = ()
    return {
        notice_id for raw_value in values if (notice_id := _notice_id_from_source_ref(raw_value))
    }


def _notice_id_from_source_ref(value: object) -> str:
    parts = str(value or "").strip().split(":")
    if len(parts) >= 3 and parts[0] == "notice":
        return parts[-1].strip()
    return ""


def _list_of_mappings(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(dict(item) for item in value if isinstance(item, Mapping))


def _ready_transport_projection_entries(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    return tuple(
        entry
        for entry in entries
        if entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        and str(entry.role_metadata.get("service_status_candidate_kind") or "")
        == "transport_schedule"
    )


def _assert_transport_release_scope_allows(
    *,
    publish_mode: str,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    selected_notice_ids: Sequence[str],
    all_ready_transport_candidates: bool,
    allow_multi_notice_release: bool,
) -> None:
    if not _writes_structured_projection(publish_mode):
        return
    if allow_multi_notice_release:
        return
    if all_ready_transport_candidates:
        raise ValueError(
            "all-ready transport candidates cannot be staged or promoted without "
            "--allow-multi-notice-release; use explicit --notice-id for per-notice selected write"
        )
    release_notice_ids = normalize_notice_ids(
        selected_notice_ids or tuple(entry.source_notice_id for entry in projection_entries)
    )
    if len(release_notice_ids) != 1:
        raise ValueError(
            "transport schedule stage/promote from consumption projection requires exactly one "
            "selected notice id unless --allow-multi-notice-release is set"
        )
