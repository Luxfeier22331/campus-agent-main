from __future__ import annotations

import json
import shutil
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.official_web_release_task import OfficialWebReleaseTask

from campus_ingestion_worker.release_official_web_selected_write_common import (
    OfficialWebSelectedWriteObjectStore,
    OfficialWebSelectedWriteProjectionReporter,
    OfficialWebSelectedWriteReleaseError,
    _evidence,
    _mapping_list,
    _selected_write_target_from_task,
    _string_list,
    _unique_strings,
)

_TARGET_INVENTORY_SOURCE_URLS_BY_ID: dict[str, list[str]] | None = None


def _load_current_projection_bundle(
    *,
    object_store: OfficialWebSelectedWriteObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
    filename: str,
) -> dict[str, object] | None:
    key = build_index_release_artifact_key(
        corpus=corpus,
        collection=collection,
        release_id="current",
        filename=filename,
    )
    try:
        payload = json.loads(object_store.get_bytes(bucket=bucket, key=key).decode("utf-8"))
    except Exception as exc:
        if _is_missing_object_error(exc):
            return None
        raise OfficialWebSelectedWriteReleaseError(
            code="current_projection_read_failed",
            message=f"failed to read current {corpus}/{collection} projection: {exc}",
        ) from exc
    if not isinstance(payload, dict):
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_current_projection",
            message=f"current {corpus}/{collection} projection must be a JSON object.",
        )
    return payload


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, KeyError | FileNotFoundError):
        return True
    response = getattr(exc, "response", None)
    if not isinstance(response, Mapping):
        return False
    error = response.get("Error")
    if not isinstance(error, Mapping):
        return False
    return str(error.get("Code") or "").strip() in {
        "404",
        "NoSuchKey",
        "NotFound",
    }


def _merge_current_projection_bundle(
    *,
    current_bundle: Mapping[str, object] | None,
    new_bundle: dict[str, object],
    records_field: str,
    id_field: str,
) -> dict[str, object]:
    new_records = [
        {**record, "release_record_state": "newly_selected"}
        for record in _mapping_list(new_bundle.get(records_field))
    ]
    new_bundle = {
        **new_bundle,
        records_field: new_records,
        "release_record_lineage": _release_record_lineage(new_records),
    }
    if current_bundle is None:
        return new_bundle
    if current_bundle.get("schema_version") != new_bundle.get("schema_version"):
        raise OfficialWebSelectedWriteReleaseError(
            code="current_projection_schema_mismatch",
            message="current projection schema does not match selected-write projection schema.",
        )
    current_records = _mapping_list(current_bundle.get(records_field))
    replacement_ids = {str(record.get(id_field) or "").strip() for record in new_records}
    replacement_inventory_ids = _record_inventory_ids(new_records)
    carried_records = [
        _with_carried_forward_source_urls(
            record={**record, "release_record_state": "carried_forward"}
        )
        for record in current_records
        if str(record.get(id_field) or "").strip() not in replacement_ids
        and not (_record_inventory_ids([record]) & replacement_inventory_ids)
    ]
    merged_records = [*carried_records, *new_records]
    return {
        **new_bundle,
        "source_families": _unique_strings(
            [
                *_string_list(current_bundle.get("source_families")),
                *_string_list(new_bundle.get("source_families")),
            ]
        ),
        "source_documents": _merge_source_documents(
            current_bundle.get("source_documents"),
            new_bundle.get("source_documents"),
        ),
        records_field: merged_records,
        "release_record_lineage": _release_record_lineage(merged_records),
        "conflict_records": [
            *_mapping_list(current_bundle.get("conflict_records")),
            *_mapping_list(new_bundle.get("conflict_records")),
        ],
        "manual_review_sources": [
            *_mapping_list(current_bundle.get("manual_review_sources")),
            *_mapping_list(new_bundle.get("manual_review_sources")),
        ],
    }


def _release_record_lineage(records: Sequence[Mapping[str, object]]) -> dict[str, int]:
    counts = {"carried_forward": 0, "newly_selected": 0}
    for record in records:
        state = str(record.get("release_record_state") or "").strip()
        if state in counts:
            counts[state] += 1
    return counts


def _merge_source_documents(
    current_value: object,
    new_value: object,
) -> list[dict[str, object]]:
    documents_by_title: dict[str, dict[str, object]] = {}
    for document in [*_mapping_list(current_value), *_mapping_list(new_value)]:
        title = str(document.get("title") or "").strip()
        if not title:
            continue
        existing = documents_by_title.get(title)
        if existing is None:
            documents_by_title[title] = {
                **document,
                "source_refs": _string_list(document.get("source_refs")),
            }
            continue
        existing["source_refs"] = _unique_strings(
            [
                *_string_list(existing.get("source_refs")),
                *_string_list(document.get("source_refs")),
            ]
        )
    return list(documents_by_title.values())


def _record_inventory_ids(records: Sequence[Mapping[str, object]]) -> set[str]:
    inventory_ids: set[str] = set()
    for record in records:
        for source_ref in _string_list(record.get("source_refs")):
            inventory_id = _official_web_inventory_id_from_source_ref(source_ref)
            if inventory_id:
                inventory_ids.add(inventory_id)
    return inventory_ids


def _official_web_inventory_id_from_source_ref(source_ref: str) -> str:
    if not source_ref.startswith("official_web:"):
        return ""
    parts = source_ref.split(":", 2)
    if len(parts) < 3:
        return ""
    return parts[1].strip()


def _with_carried_forward_source_urls(*, record: dict[str, object]) -> dict[str, object]:
    source_urls = _public_source_urls_for_record(record)
    if not source_urls:
        return record

    def patch_mapping(value: object) -> object:
        if isinstance(value, list):
            return [patch_mapping(item) for item in value]
        if not isinstance(value, dict):
            return value
        patched = {key: patch_mapping(item) for key, item in value.items()}
        source_refs = _string_list(patched.get("source_refs"))
        if source_refs:
            patched["source_refs"] = _unique_strings([*source_refs, *source_urls])
        return patched

    patched_record = patch_mapping(record)
    return dict(patched_record) if isinstance(patched_record, dict) else record


def _public_source_urls_for_record(record: Mapping[str, object]) -> list[str]:
    urls: list[str] = []
    for source_ref in _string_list(record.get("source_refs")):
        inventory_id = _official_web_inventory_id_from_source_ref(source_ref)
        if not inventory_id:
            continue
        urls.extend(_source_urls_for_inventory_id(inventory_id))
    return _unique_strings(urls)


def _source_urls_for_inventory_id(inventory_id: str) -> list[str]:
    global _TARGET_INVENTORY_SOURCE_URLS_BY_ID
    if _TARGET_INVENTORY_SOURCE_URLS_BY_ID is not None:
        return list(_TARGET_INVENTORY_SOURCE_URLS_BY_ID.get(inventory_id, []))
    inventory_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "sources"
        / "official_web"
        / "muc_public"
        / "target-inventory.json"
    )
    try:
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    except Exception:
        _TARGET_INVENTORY_SOURCE_URLS_BY_ID = {}
        return []
    urls_by_id: dict[str, list[str]] = {}
    for entry in _mapping_list(inventory.get("entries")):
        entry_inventory_id = str(entry.get("inventory_id") or "").strip()
        if entry_inventory_id:
            urls_by_id[entry_inventory_id] = _string_list(entry.get("source_urls"))
    _TARGET_INVENTORY_SOURCE_URLS_BY_ID = urls_by_id
    return list(urls_by_id.get(inventory_id, []))


def _resolve_object_store_settings(
    *,
    object_store_settings: ObjectStoreSettings | None,
    source_bucket: str,
) -> ObjectStoreSettings:
    settings = object_store_settings or ObjectStoreSettings(
        endpoint="http://127.0.0.1:9000",
        access_key="local",
        secret_key="local",
        bucket_source=source_bucket,
    )
    if settings.bucket_source == source_bucket:
        return settings
    return ObjectStoreSettings(
        endpoint=settings.endpoint,
        access_key=settings.access_key,
        secret_key=settings.secret_key,
        region=settings.region,
        bucket_source=source_bucket,
        bucket_derived=settings.bucket_derived,
        secure=settings.secure,
        source_access_key=settings.source_access_key,
        source_secret_key=settings.source_secret_key,
        derived_access_key=settings.derived_access_key,
        derived_secret_key=settings.derived_secret_key,
    )


def _source_bundle_key(selected_write_task: dict[str, object]) -> str:
    source_keys = _string_list(_evidence(selected_write_task).get("sourceObjectKeys"))
    for key in source_keys:
        if key.endswith("source-truth-bundle.json"):
            return key
    if source_keys:
        return source_keys[0]
    raise OfficialWebSelectedWriteReleaseError(
        code="missing_source_truth_bundle_key",
        message="selected-write task evidence has no sourceObjectKeys.",
    )


def _download_source_truth_bundle(
    *, object_store: OfficialWebSelectedWriteObjectStore, bucket: str, key: str
) -> dict[str, object]:
    payload = json.loads(object_store.get_bytes(bucket=bucket, key=key).decode("utf-8"))
    if not isinstance(payload, dict):
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_source_truth_bundle",
            message="source truth bundle must be a JSON object.",
        )
    return payload


def _read_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_json",
            message=f"{path} must contain a JSON object.",
        )
    return payload


def _report_projection(
    *,
    projection_reporter: OfficialWebSelectedWriteProjectionReporter | None,
    task: OfficialWebReleaseTask,
    snapshot: dict[str, object],
    suppress_errors: bool = False,
) -> None:
    if projection_reporter is None:
        return
    payload = {
        "inventoryId": task.inventory_id,
        "jobId": task.job_id,
        "releaseId": task.release_id,
        "runId": task.run_id,
        "selectedWriteTarget": _selected_write_target_from_task(task),
        "sourceChannel": "official_web",
        "taskId": task.task_id,
        "taskType": task.task_type,
        **snapshot,
    }
    try:
        projection_reporter.report(snapshot=payload)
    except Exception:
        if not suppress_errors:
            raise


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _selected_write_release_id(*, selected_write_id: str, generated_at: str) -> str:
    timestamp = (
        generated_at.replace("-", "")
        .replace(":", "")
        .replace("+", "_")
        .replace(".", "_")
        .replace("T", "_")
    )
    return f"{selected_write_id}_{timestamp}"


def _reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()
