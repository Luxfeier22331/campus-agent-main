from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from campus_ingestion_core import DEFAULT_BUCKET_SOURCE, ObjectStoreSettings
from campus_ingestion_core.official_web_projection_engine import (
    replay_official_web_source_truth_local,
)
from campus_ingestion_core.registry_scope_release import release_registry_scope

from campus_ingestion_worker.official_web_handoff_consumer_runtime import (
    materialize_replay_input,
)
from campus_ingestion_worker.official_web_projection_import import (
    import_projection_output,
)


class OfficialWebReleaseAppApiClient(Protocol):
    def get_release_gate(self, *, release_id: str) -> dict[str, object]: ...

    def update_release_gate_execution_status(
        self,
        *,
        release_id: str,
        payload: dict[str, object],
    ) -> None: ...


class OfficialWebReleaseObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class OfficialWebReleaseDerivedObjectStore(Protocol):
    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


@dataclass(frozen=True, slots=True)
class OfficialWebTargetReleaseResult:
    release_id: str
    status: str
    corpus: str
    collection: str
    document_ids: tuple[str, ...]


def release_official_web_target(
    *,
    release_id: str,
    app_api_client: OfficialWebReleaseAppApiClient,
    object_store: OfficialWebReleaseObjectStore,
    derived_object_store: OfficialWebReleaseDerivedObjectStore,
    document_registry: object,
    raw_asset_registry: object,
    work_dir: Path,
) -> OfficialWebTargetReleaseResult:
    release_gate = _release_gate_payload(app_api_client.get_release_gate(release_id=release_id))
    _require_approved_release_gate(release_gate)
    _report_status(
        app_api_client=app_api_client,
        release_id=release_id,
        status="running",
        execution={"publishAlias": bool(release_gate.get("publishAlias"))},
    )

    evidence = _object_mapping(release_gate.get("evidenceJson") or release_gate.get("evidence"))
    source_keys = _string_list(evidence.get("sourceObjectKeys"))
    if not source_keys:
        raise ValueError("release gate evidence has no sourceObjectKeys")
    source_bucket = str(release_gate.get("sourceBucket") or DEFAULT_BUCKET_SOURCE)
    replay_input_dir = work_dir / "replay-input"
    projection_output_dir = work_dir / "projection-output"
    bundle_payload = _load_bundle_payload(
        object_store=object_store,
        bucket=source_bucket,
        key=source_keys[0],
    )
    materialize_replay_input(
        replay_input_dir=replay_input_dir,
        bundle_payload=bundle_payload,
        object_store=object_store,
        bucket=source_bucket,
    )
    replay_official_web_source_truth_local(
        output_dir=replay_input_dir,
        projection_output_dir=projection_output_dir,
    )
    target_documents = _filter_projection_report_to_release_target(
        projection_output_dir=projection_output_dir,
        release_gate=release_gate,
        source_urls=_string_list(evidence.get("sourceUrls")),
    )
    if not target_documents:
        raise ValueError("release gate target produced no matching documents")
    corpus = str(target_documents[0].get("target_corpus") or "official_web")
    collection = str(target_documents[0].get("target_collection") or "stable_reference")
    import_report = import_projection_output(
        work_dir=work_dir,
        projection_output_dir=projection_output_dir,
        replay_input_dir=replay_input_dir,
        source_object_store=object_store,
        derived_object_store=derived_object_store,
        document_registry=document_registry,  # type: ignore[arg-type]
        raw_asset_registry=raw_asset_registry,  # type: ignore[arg-type]
        object_store_settings=ObjectStoreSettings(
            endpoint="http://object-store.local",
            access_key="official-web-release",
            secret_key="official-web-release",
        ),
        scope_refresh=None,
        require_promotable=True,
        dry_run=False,
    )
    _report_status(
        app_api_client=app_api_client,
        release_id=release_id,
        status="materialized",
        execution={
            "documentIds": list(import_report.document_ids),
            "publishAlias": bool(release_gate.get("publishAlias")),
        },
    )
    release_report = release_registry_scope(
        corpus=corpus,
        collection=collection,
        preparation_run_id=release_id,
        acceptance_case_path=None,
        reset_index=False,
        publish_alias=bool(release_gate.get("publishAlias")),
    )
    _report_status(
        app_api_client=app_api_client,
        release_id=release_id,
        status="indexed",
        execution={
            "indexReleaseId": release_report.release_id,
            "publishAlias": bool(release_gate.get("publishAlias")),
        },
    )
    return OfficialWebTargetReleaseResult(
        release_id=release_id,
        status="indexed",
        corpus=corpus,
        collection=collection,
        document_ids=tuple(import_report.document_ids),
    )


def _release_gate_payload(payload: dict[str, object]) -> dict[str, object]:
    nested = payload.get("releaseGate")
    return _object_mapping(nested) if isinstance(nested, dict) else payload


def _require_approved_release_gate(release_gate: dict[str, object]) -> None:
    if str(release_gate.get("decision") or "") != "approved":
        raise ValueError("release gate decision must be approved")
    if str(release_gate.get("status") or "") != "approved":
        raise ValueError("release gate status must be approved")


def _load_bundle_payload(
    *,
    object_store: OfficialWebReleaseObjectStore,
    bucket: str,
    key: str,
) -> dict[str, object]:
    payload = json.loads(object_store.get_bytes(bucket=bucket, key=key).decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("source truth bundle must be an object")
    return payload


def _filter_projection_report_to_release_target(
    *,
    projection_output_dir: Path,
    release_gate: dict[str, object],
    source_urls: list[str],
) -> list[dict[str, object]]:
    report_path = projection_output_dir / "projection-report.json"
    report = _read_json_object(report_path)
    documents = report.get("documents")
    if not isinstance(documents, list):
        raise ValueError("projection report documents must be an array")
    job_id = str(release_gate.get("jobId") or "")
    filtered = [
        document
        for document in (_object_mapping(item) for item in documents)
        if _document_matches_release_gate(document=document, job_id=job_id, source_urls=source_urls)
    ]
    report["documents"] = filtered
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return filtered


def _document_matches_release_gate(
    *,
    document: dict[str, object],
    job_id: str,
    source_urls: list[str],
) -> bool:
    if job_id and str(document.get("target_job_id") or "") != job_id:
        return False
    if source_urls and str(document.get("normalized_canonical_url") or "") not in source_urls:
        return False
    return str(document.get("materialization_policy") or "") == "release_gate_required"


def _report_status(
    *,
    app_api_client: OfficialWebReleaseAppApiClient,
    release_id: str,
    status: str,
    execution: dict[str, object],
) -> None:
    app_api_client.update_release_gate_execution_status(
        release_id=release_id,
        payload={"execution": execution, "status": status},
    )


def _read_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _object_mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


__all__ = ["OfficialWebTargetReleaseResult", "release_official_web_target"]
