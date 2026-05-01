from __future__ import annotations

import argparse
import json
import os
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, is_dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib import error as urllib_error
from urllib import request as urllib_request

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
    release_registry_scope,
    replay_official_web_source_truth_local,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_handoff_consumer_runtime import materialize_replay_input
from campus_ingestion_worker.official_web_projection_import import import_projection_output


class OfficialWebTargetReleaseError(RuntimeError):
    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class OfficialWebTargetReleaseAppApiClient(Protocol):
    def get_release_gate(self, *, release_id: str) -> dict[str, object]: ...

    def update_release_gate_execution_status(
        self, *, release_id: str, payload: dict[str, object]
    ) -> None: ...


class OfficialWebReleaseObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


@dataclass(frozen=True, slots=True)
class OfficialWebTargetReleaseResult:
    release_id: str
    status: str
    corpus: str
    collection: str
    document_ids: tuple[str, ...]
    work_dir: str
    source_bundle_key: str


class HttpOfficialWebTargetReleaseAppApiClient:
    def __init__(self, *, base_url: str, internal_shared_secret: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_shared_secret = internal_shared_secret

    def get_release_gate(self, *, release_id: str) -> dict[str, object]:
        request = urllib_request.Request(
            f"{self._base_url}/api/internal/official-web/target-release-gates/{release_id}",
            headers={"x-app-internal-auth": self._internal_shared_secret},
            method="GET",
        )
        payload = _request_json(request=request, operation="official_web release gate fetch")
        release_gate = payload.get("releaseGate")
        if not isinstance(release_gate, dict):
            raise OfficialWebTargetReleaseError(
                code="invalid_release_gate_response",
                message="app-api release gate response must include releaseGate object.",
            )
        return dict(release_gate)

    def update_release_gate_execution_status(
        self, *, release_id: str, payload: dict[str, object]
    ) -> None:
        request = urllib_request.Request(
            (
                f"{self._base_url}/api/internal/official-web/target-release-gates/"
                f"{release_id}/execution-status"
            ),
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-app-internal-auth": self._internal_shared_secret,
            },
            method="POST",
        )
        _request_json(request=request, operation="official_web release gate status callback")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Release one approved official_web stable_reference target gate.",
    )
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--work-dir", default="./var/official-web-target-releases")
    parser.add_argument("--source-bucket", default=DEFAULT_BUCKET_SOURCE)
    parser.add_argument("--declarations-path")
    parser.add_argument("--reset-index", action="store_true")
    return parser


def build_app_api_client_from_env(
    env: Mapping[str, str] | None = None,
) -> HttpOfficialWebTargetReleaseAppApiClient:
    source = dict(os.environ if env is None else env)
    base_url = source.get("INGESTION_WORKER_APP_API_BASE_URL", "").strip()
    shared_secret = source.get("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", "").strip()
    if not (base_url and shared_secret):
        raise OfficialWebTargetReleaseError(
            code="app_api_client_not_configured",
            message=(
                "INGESTION_WORKER_APP_API_BASE_URL and "
                "INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET are required."
            ),
        )
    return HttpOfficialWebTargetReleaseAppApiClient(
        base_url=base_url,
        internal_shared_secret=shared_secret,
    )


def release_official_web_target(
    *,
    release_id: str,
    app_api_client: OfficialWebTargetReleaseAppApiClient,
    object_store: OfficialWebReleaseObjectStore,
    derived_object_store: OfficialWebReleaseObjectStore,
    document_registry: object,
    raw_asset_registry: object,
    work_dir: Path,
    object_store_settings: ObjectStoreSettings | None = None,
    source_bucket: str = DEFAULT_BUCKET_SOURCE,
    declarations_path: Path | None = None,
    reset_index: bool = False,
) -> OfficialWebTargetReleaseResult:
    release_gate = _release_gate_payload(app_api_client.get_release_gate(release_id=release_id))
    _assert_release_gate_approved(release_gate, release_id=release_id)
    settings = _resolve_object_store_settings(
        object_store_settings=object_store_settings,
        source_bucket=source_bucket,
    )
    replay_input_dir = work_dir / "replay-input"
    projection_output_dir = work_dir / "projection-output"
    _reset_dir(replay_input_dir)
    _reset_dir(projection_output_dir)

    source_bundle_key = ""
    try:
        _report_status(
            app_api_client=app_api_client,
            release_id=release_id,
            payload={"status": "running", "updatedAt": _utcnow()},
        )
        source_bundle_key = _source_bundle_key(release_gate)
        bundle_payload = _download_source_truth_bundle(
            object_store=object_store,
            bucket=settings.bucket_source,
            key=source_bundle_key,
        )
        _write_json(replay_input_dir / "source-truth-bundle.json", bundle_payload)
        materialize_replay_input(
            replay_input_dir=replay_input_dir,
            bundle_payload=bundle_payload,
            object_store=object_store,
            bucket=settings.bucket_source,
        )
        replay_official_web_source_truth_local(
            output_dir=replay_input_dir,
            projection_output_dir=projection_output_dir,
            declarations_path=declarations_path,
        )
        target_documents = _filter_projection_report_to_release_target(
            projection_output_dir=projection_output_dir,
            release_gate=release_gate,
            source_urls=_string_list(
                _object_mapping(
                    release_gate.get("evidenceJson") or release_gate.get("evidence")
                ).get("sourceUrls")
            ),
        )
        if not target_documents:
            raise OfficialWebTargetReleaseError(
                code="missing_release_projection_document",
                message="release gate target produced no matching projection documents.",
            )
        corpus = _require_text(target_documents[0].get("target_corpus"), "target_corpus")
        collection = _require_text(
            target_documents[0].get("target_collection"), "target_collection"
        )
        import_report = import_projection_output(
            work_dir=work_dir,
            projection_output_dir=projection_output_dir,
            replay_input_dir=replay_input_dir,
            source_object_store=object_store,
            derived_object_store=derived_object_store,
            document_registry=document_registry,  # type: ignore[arg-type]
            raw_asset_registry=raw_asset_registry,  # type: ignore[arg-type]
            object_store_settings=settings,
            scope_refresh=None,
            require_promotable=True,
            dry_run=False,
        )
        _report_status(
            app_api_client=app_api_client,
            release_id=release_id,
            payload={
                "execution": {
                    "documentIds": list(import_report.document_ids),
                    "importReportPath": import_report.report_path,
                },
                "status": "materialized",
                "updatedAt": _utcnow(),
            },
        )
        publish_alias = release_gate.get("publishAlias") is True
        release_report = release_registry_scope(
            corpus=corpus,
            collection=collection,
            preparation_run_id=release_id,
            acceptance_case_path=None,
            reset_index=reset_index,
            publish_alias=publish_alias,
        )
        final_status = "published" if publish_alias else "indexed"
        _report_status(
            app_api_client=app_api_client,
            release_id=release_id,
            payload={
                "execution": {
                    "publishAlias": publish_alias,
                    "registryRelease": _jsonable(release_report),
                },
                "status": final_status,
                "updatedAt": _utcnow(),
            },
        )
        return OfficialWebTargetReleaseResult(
            release_id=release_id,
            status=final_status,
            corpus=corpus,
            collection=collection,
            document_ids=tuple(import_report.document_ids),
            work_dir=str(work_dir.resolve()),
            source_bundle_key=source_bundle_key,
        )
    except Exception as exc:
        _report_status(
            app_api_client=app_api_client,
            release_id=release_id,
            payload={
                "error": {
                    "code": getattr(exc, "code", exc.__class__.__name__),
                    "message": str(exc),
                },
                "status": "failed",
                "updatedAt": _utcnow(),
            },
            suppress_errors=True,
        )
        raise


def _release_gate_payload(payload: dict[str, object]) -> dict[str, object]:
    nested = payload.get("releaseGate")
    return _object_mapping(nested) if isinstance(nested, dict) else payload


def _assert_release_gate_approved(release_gate: dict[str, object], *, release_id: str) -> None:
    if release_gate.get("releaseId") != release_id:
        raise OfficialWebTargetReleaseError(
            code="release_gate_id_mismatch",
            message="app-api release gate response releaseId does not match requested release.",
        )
    if release_gate.get("decision") != "approved" or release_gate.get("status") != "approved":
        raise OfficialWebTargetReleaseError(
            code="release_gate_not_approved",
            message="official_web target release gate must be approved before execution.",
        )
    _require_text(release_gate.get("jobId"), "releaseGate.jobId")


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


def _source_bundle_key(release_gate: dict[str, object]) -> str:
    evidence = _object_mapping(release_gate.get("evidenceJson") or release_gate.get("evidence"))
    source_keys = _string_list(evidence.get("sourceObjectKeys"))
    for key in source_keys:
        if key.endswith("source-truth-bundle.json"):
            return key
    if source_keys:
        return source_keys[0]
    raise OfficialWebTargetReleaseError(
        code="missing_source_truth_bundle_key",
        message="release gate evidence has no sourceObjectKeys.",
    )


def _download_source_truth_bundle(
    *, object_store: OfficialWebReleaseObjectStore, bucket: str, key: str
) -> dict[str, object]:
    payload = json.loads(object_store.get_bytes(bucket=bucket, key=key).decode("utf-8"))
    if not isinstance(payload, dict):
        raise OfficialWebTargetReleaseError(
            code="invalid_source_truth_bundle",
            message="source truth bundle must be a JSON object.",
        )
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
        raise OfficialWebTargetReleaseError(
            code="invalid_projection_report",
            message="projection report documents must be an array.",
        )
    job_id = _require_text(release_gate.get("jobId"), "releaseGate.jobId")
    filtered = [
        document
        for document in (_object_mapping(item) for item in documents)
        if _document_matches_release_gate(document=document, job_id=job_id, source_urls=source_urls)
    ]
    report["documents"] = filtered
    counts = report.get("counts")
    if isinstance(counts, dict):
        counts["emitted_documents"] = len(filtered)
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
    if document.get("target_corpus") != "official_web":
        return False
    if document.get("target_collection") != "stable_reference":
        return False
    if document.get("serving_intent") != "promotable":
        return False
    if document.get("materialization_policy") != "release_gate_required":
        return False
    if document.get("target_job_id") != job_id:
        return False
    return not source_urls or document.get("normalized_canonical_url") in source_urls


def _report_status(
    *,
    app_api_client: OfficialWebTargetReleaseAppApiClient,
    release_id: str,
    payload: dict[str, object],
    suppress_errors: bool = False,
) -> None:
    try:
        app_api_client.update_release_gate_execution_status(
            release_id=release_id,
            payload=payload,
        )
    except Exception:
        if not suppress_errors:
            raise


def _request_json(*, request: urllib_request.Request, operation: str) -> dict[str, object]:
    try:
        with urllib_request.urlopen(request) as response:
            if response.status < 200 or response.status >= 300:
                raise OfficialWebTargetReleaseError(
                    code="app_api_request_failed",
                    message=f"{operation} returned unexpected status {response.status}.",
                )
            payload = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        raise OfficialWebTargetReleaseError(
            code="app_api_request_failed",
            message=f"{operation} failed: {exc.code}",
        ) from exc
    except urllib_error.URLError as exc:
        raise OfficialWebTargetReleaseError(
            code="app_api_request_failed",
            message=f"{operation} failed: {exc.reason}",
        ) from exc
    if not isinstance(payload, dict):
        raise OfficialWebTargetReleaseError(
            code="invalid_app_api_response",
            message=f"{operation} response must be a JSON object.",
        )
    return payload


def _read_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise OfficialWebTargetReleaseError(
            code="invalid_json",
            message=f"{path} must contain a JSON object.",
        )
    return payload


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _object_mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OfficialWebTargetReleaseError(
            code="invalid_payload",
            message=f"{field_name} must be a non-empty string.",
        )
    return value.strip()


def _reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def _utcnow() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def _jsonable(value: Any) -> dict[str, object]:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, dict):
        return value
    if hasattr(value, "__dict__"):
        return dict(value.__dict__)
    return {"value": str(value)}


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = _resolve_object_store_settings(
        object_store_settings=ObjectStoreSettings.from_env(),
        source_bucket=args.source_bucket,
    )
    object_store = S3ObjectStoreAdmin(settings)
    result = release_official_web_target(
        release_id=args.release_id,
        app_api_client=build_app_api_client_from_env(),
        object_store=object_store,
        derived_object_store=object_store,
        document_registry=build_document_registry_from_env(prefer_operator=True),
        raw_asset_registry=build_raw_asset_registry_from_env(prefer_operator=True),
        work_dir=Path(args.work_dir).resolve() / args.release_id,
        object_store_settings=settings,
        source_bucket=args.source_bucket,
        declarations_path=Path(args.declarations_path).resolve()
        if args.declarations_path
        else None,
        reset_index=args.reset_index,
    )
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


__all__ = [
    "HttpOfficialWebTargetReleaseAppApiClient",
    "OfficialWebTargetReleaseError",
    "OfficialWebTargetReleaseResult",
    "build_app_api_client_from_env",
    "build_parser",
    "main",
    "release_official_web_target",
]


if __name__ == "__main__":
    main()
