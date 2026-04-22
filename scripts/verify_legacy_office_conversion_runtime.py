from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence
from urllib import error as urllib_error
from urllib import request as urllib_request

from campus_ingestion_core.file_asset_contract import serialize_file_asset_outcome
from campus_ingestion_core.raw_ingestion import S3ObjectStoreClient
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment import (
    normalize_authenticated_notice_legacy_office_attachment,
)

_DOC_MEDIA_TYPE = "application/msword"
_XLS_MEDIA_TYPE = "application/vnd.ms-excel"
_AUTHENTICATED_NOTICE_PREFIX = "authenticated_notice_portal/"
_CAPTURE_SEGMENT = "/capture/"


class LegacyOfficeRuntimeVerificationError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class LegacyOfficeRuntimeContract:
    base_url: str
    internal_shared_secret: str


@dataclass(frozen=True, slots=True)
class LegacyOfficeVerificationSample:
    sample_kind: str
    source_object_key: str
    filename: str
    source_sha256: str
    source_media_type: str
    target_format: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Verify the service-backed legacy Office conversion runtime with real "
            "authenticated_notice source-bucket assets."
        )
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repo root used for worker env bootstrap. Defaults to the current directory.",
    )
    parser.add_argument(
        "--output-dir",
        default=".tmp/phase-h-libreoffice-runtime-productization",
        help="Directory for health probes, downloaded samples, normalized outputs, and summary artifacts.",
    )
    parser.add_argument(
        "--doc-object-key",
        help="Explicit authenticated_notice source object key for the .doc sample.",
    )
    parser.add_argument(
        "--xls-object-key",
        help="Explicit authenticated_notice source object key for the .xls sample.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the final verification summary as JSON.",
    )
    return parser


def select_legacy_office_source_keys(
    object_keys: Sequence[str],
    *,
    doc_object_key: str | None = None,
    xls_object_key: str | None = None,
) -> dict[str, str]:
    selection: dict[str, str] = {}
    explicit_doc = _normalize_optional_text(doc_object_key)
    explicit_xls = _normalize_optional_text(xls_object_key)
    if explicit_doc is not None:
        selection["doc"] = explicit_doc
    if explicit_xls is not None:
        selection["xls"] = explicit_xls

    for raw_key in object_keys:
        normalized_key = _normalize_optional_text(raw_key)
        if normalized_key is None:
            continue
        lower_key = normalized_key.lower()
        if "doc" not in selection and lower_key.endswith(".doc"):
            selection["doc"] = normalized_key
        elif "xls" not in selection and lower_key.endswith(".xls"):
            selection["xls"] = normalized_key
        if "doc" in selection and "xls" in selection:
            break

    missing = [name for name in ("doc", "xls") if name not in selection]
    if missing:
        raise LegacyOfficeRuntimeVerificationError(
            "authenticated_notice source bucket did not provide required legacy Office samples: "
            + ", ".join(missing)
        )
    return selection


def list_authenticated_notice_legacy_office_source_keys(
    *,
    object_store: S3ObjectStoreClient,
    bucket: str,
) -> tuple[str, ...]:
    s3_client = getattr(object_store, "_client", None)
    if s3_client is None:
        raise LegacyOfficeRuntimeVerificationError(
            "object store client does not expose list_objects_v2"
        )

    discovered: list[str] = []
    request: dict[str, Any] = {
        "Bucket": bucket,
        "Prefix": _AUTHENTICATED_NOTICE_PREFIX,
        "MaxKeys": 1000,
    }
    while True:
        response = s3_client.list_objects_v2(**request)
        for item in response.get("Contents") or ():
            key = _normalize_optional_text(item.get("Key"))
            if key is None or _CAPTURE_SEGMENT not in key:
                continue
            lower_key = key.lower()
            if lower_key.endswith(".doc") or lower_key.endswith(".xls"):
                discovered.append(key)
        if not response.get("IsTruncated"):
            break
        request["ContinuationToken"] = response["NextContinuationToken"]
    return tuple(discovered)


def verify_legacy_office_conversion_runtime(
    *,
    repo_root: Path,
    output_dir: Path,
    doc_object_key: str | None = None,
    xls_object_key: str | None = None,
) -> dict[str, Any]:
    resolved_repo_root = repo_root.resolve()
    load_worker_env(repo_root=resolved_repo_root)
    contract = _resolve_runtime_contract(dict(os.environ))

    output_dir.mkdir(parents=True, exist_ok=True)
    samples_dir = output_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreClient(settings)

    candidate_keys = list_authenticated_notice_legacy_office_source_keys(
        object_store=object_store,
        bucket=settings.bucket_source,
    )
    selection = select_legacy_office_source_keys(
        candidate_keys,
        doc_object_key=doc_object_key,
        xls_object_key=xls_object_key,
    )

    healthz_payload = _fetch_json(contract.base_url, "/healthz")
    readyz_payload = _fetch_json(contract.base_url, "/readyz")
    (output_dir / "service-healthz.json").write_text(
        json.dumps(healthz_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "service-readyz.json").write_text(
        json.dumps(readyz_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if int(readyz_payload["status_code"]) != 200:
        raise LegacyOfficeRuntimeVerificationError(
            f"legacy Office conversion runtime is not ready: {readyz_payload['status_code']}"
        )

    doc_result = _materialize_sample(
        sample_kind="doc",
        source_object_key=selection["doc"],
        object_store=object_store,
        bucket=settings.bucket_source,
        samples_dir=samples_dir,
        result_dir=output_dir / "doc",
    )
    xls_result = _materialize_sample(
        sample_kind="xls",
        source_object_key=selection["xls"],
        object_store=object_store,
        bucket=settings.bucket_source,
        samples_dir=samples_dir,
        result_dir=output_dir / "xls",
    )
    manifest_payload = {
        "schema_version": "legacy_office_runtime_verification_manifest_v1",
        "service_base_url": contract.base_url,
        "bucket": settings.bucket_source,
        "samples": [doc_result, xls_result],
    }
    (samples_dir / "manifest.json").write_text(
        json.dumps(manifest_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    summary_text = _build_summary(doc_result=doc_result, xls_result=xls_result)
    (output_dir / "SUMMARY.md").write_text(summary_text, encoding="utf-8")
    return {
        "output_dir": str(output_dir),
        "service_healthz_path": str(output_dir / "service-healthz.json"),
        "service_readyz_path": str(output_dir / "service-readyz.json"),
        "samples_manifest_path": str(samples_dir / "manifest.json"),
        "summary_path": str(output_dir / "SUMMARY.md"),
        "samples": [doc_result, xls_result],
    }


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = verify_legacy_office_conversion_runtime(
        repo_root=Path(args.repo_root),
        output_dir=Path(args.output_dir),
        doc_object_key=args.doc_object_key,
        xls_object_key=args.xls_object_key,
    )
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(report["summary_path"])
    return 0


def _resolve_runtime_contract(env: dict[str, str]) -> LegacyOfficeRuntimeContract:
    base_url = _normalize_optional_text(env.get("LEGACY_OFFICE_CONVERSION_BASE_URL"))
    internal_shared_secret = _normalize_optional_text(
        env.get("LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET")
    )
    if base_url is None or internal_shared_secret is None:
        raise LegacyOfficeRuntimeVerificationError(
            "LEGACY_OFFICE_CONVERSION_BASE_URL and "
            "LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET are required"
        )
    return LegacyOfficeRuntimeContract(
        base_url=base_url.rstrip("/"),
        internal_shared_secret=internal_shared_secret,
    )


def _fetch_json(base_url: str, path: str) -> dict[str, Any]:
    request = urllib_request.Request(f"{base_url}{path}", method="GET")
    try:
        with urllib_request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return {
                "status_code": response.status,
                "payload": payload,
            }
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"raw_body": body}
        return {"status_code": exc.code, "payload": payload}
    except urllib_error.URLError as exc:
        raise LegacyOfficeRuntimeVerificationError(
            f"failed to reach legacy Office conversion runtime at {path}: {exc.reason}"
        ) from exc


def _materialize_sample(
    *,
    sample_kind: str,
    source_object_key: str,
    object_store: S3ObjectStoreClient,
    bucket: str,
    samples_dir: Path,
    result_dir: Path,
) -> dict[str, Any]:
    result_dir.mkdir(parents=True, exist_ok=True)
    sample_bytes = object_store.get_bytes(bucket=bucket, key=source_object_key)
    filename = Path(source_object_key).name
    source_sha256 = hashlib.sha256(sample_bytes).hexdigest()
    source_media_type = _source_media_type_for_key(source_object_key)
    target_format = _target_format_for_key(source_object_key)
    sample = LegacyOfficeVerificationSample(
        sample_kind=sample_kind,
        source_object_key=source_object_key,
        filename=filename,
        source_sha256=source_sha256,
        source_media_type=source_media_type,
        target_format=target_format,
    )

    sample_input_path = samples_dir / sample_kind / filename
    sample_input_path.parent.mkdir(parents=True, exist_ok=True)
    sample_input_path.write_bytes(sample_bytes)

    outcome = normalize_authenticated_notice_legacy_office_attachment(
        input_path=sample_input_path,
        output_dir=result_dir,
        source_object_key=sample.source_object_key,
        source_sha256=sample.source_sha256,
        source_mime_type=sample.source_media_type,
    )
    normalized_path = Path(outcome.output_path)
    result_payload = {
        "sample_kind": sample.sample_kind,
        "source_object_key": sample.source_object_key,
        "source_sha256": sample.source_sha256,
        "source_filename": sample.filename,
        "source_media_type": sample.source_media_type,
        "target_format": sample.target_format,
        "normalized_path": str(normalized_path),
        "normalization": serialize_file_asset_outcome(outcome),
        "engine_name": outcome.normalizer_name,
        "engine_version": outcome.normalizer_version,
    }
    (result_dir / "result.json").write_text(
        json.dumps(result_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return result_payload


def _source_media_type_for_key(source_object_key: str) -> str:
    lower_key = source_object_key.lower()
    if lower_key.endswith(".doc"):
        return _DOC_MEDIA_TYPE
    if lower_key.endswith(".xls"):
        return _XLS_MEDIA_TYPE
    raise LegacyOfficeRuntimeVerificationError(
        f"unsupported legacy Office sample key: {source_object_key}"
    )


def _target_format_for_key(source_object_key: str) -> str:
    lower_key = source_object_key.lower()
    if lower_key.endswith(".doc"):
        return "docx"
    if lower_key.endswith(".xls"):
        return "xlsx"
    raise LegacyOfficeRuntimeVerificationError(
        f"unsupported legacy Office sample key: {source_object_key}"
    )


def _build_summary(*, doc_result: dict[str, Any], xls_result: dict[str, Any]) -> str:
    rows = [
        "# Legacy Office Conversion Runtime Verification",
        "",
        "## Samples",
    ]
    for result in (doc_result, xls_result):
        normalization = dict(result["normalization"])
        rows.extend(
            [
                f"- `{result['sample_kind']}`",
                f"  - `source_object_key`: `{result['source_object_key']}`",
                f"  - `source_sha256`: `{result['source_sha256']}`",
                f"  - `normalized_sha256`: `{normalization['normalized_sha256']}`",
                f"  - `target_format`: `{result['target_format']}`",
                f"  - `engine_name`: `{result['engine_name']}`",
                f"  - `engine_version`: `{result['engine_version']}`",
            ]
        )
    return "\n".join(rows) + "\n"


def _normalize_optional_text(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


if __name__ == "__main__":
    raise SystemExit(main())
