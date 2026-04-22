from __future__ import annotations

import json
import os
import zipfile
from contextlib import ExitStack
from dataclasses import asdict, dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Protocol

from campus_ingestion_core.artifacts import PROVIDER_RESPONSE_FILENAME
from campus_ingestion_core.file_asset_routing import (
    RawAssetTypedMetadata,
    RawAssetTypeRefinement,
    infer_raw_asset_typed_metadata,
    refine_raw_asset_typed_metadata_with_ocr_evidence,
    select_adjudicated_image_routing,
    select_online_ocr_routing,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_source_model_slug,
    build_source_ocr_artifact_key,
    infer_year_label,
)
from campus_ingestion_core.online_ocr_evidence import (
    build_adjudication,
    build_provider_summary,
    extract_paddle_plain_text,
)
from campus_ingestion_core.raw_ingestion import (
    DEFAULT_ONLINE_OCR_MODEL,
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    OnlineOcrSettings,
    S3ObjectStoreClient,
    build_online_ocr_client,
)
from campus_ingestion_core.registry import RawAssetRegistry, build_raw_asset_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings


@dataclass(frozen=True, slots=True)
class OnlineOcrCompareRequest:
    output_dir: Path
    file_path: Path | None = None
    raw_asset_id: str | None = None
    raw_version_id: str | None = None
    baseline_provider_response_path: Path | None = None
    baseline_provider_response_key: str | None = None
    baseline_model: str = DEFAULT_ONLINE_OCR_MODEL

    def __post_init__(self) -> None:
        has_file_path = self.file_path is not None
        has_raw_asset = bool(
            (self.raw_asset_id or "").strip() or (self.raw_version_id or "").strip()
        )
        if has_file_path == has_raw_asset:
            raise ValueError("provide exactly one of file_path or raw_asset_id/raw_version_id")
        if has_raw_asset and not (
            (self.raw_asset_id or "").strip() and (self.raw_version_id or "").strip()
        ):
            raise ValueError("raw_asset_id and raw_version_id must be configured together")


@dataclass(frozen=True, slots=True)
class OnlineOcrCompareReport:
    provider: str
    model: str
    input_filename: str
    output_dir: str
    provider_response_path: str
    candidate_markdown_path: str | None
    comparison_path: str
    summary_path: str


class CompareObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


def compare_online_ocr(
    *,
    request: OnlineOcrCompareRequest,
    env: dict[str, str] | None = None,
    object_store: CompareObjectStoreReader | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    online_ocr: OnlineOcrClient | None = None,
) -> OnlineOcrCompareReport:
    source = dict(env if env is not None else os.environ)
    settings = OnlineOcrSettings.from_env(source, required=True)
    if settings is None:  # pragma: no cover
        raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")

    request.output_dir.mkdir(parents=True, exist_ok=True)
    with ExitStack() as stack:
        reader = _build_object_store_reader(source=source, object_store=object_store)
        registry = (
            raw_asset_registry or build_raw_asset_registry_from_env(source)
            if request.raw_asset_id
            else raw_asset_registry
        )
        input_path, source_file_name, baseline_default_key, raw_asset_record = _resolve_input_path(
            request=request,
            reader=reader,
            raw_asset_registry=registry,
            source=source,
            stack=stack,
        )
        initial_typed_metadata = _resolve_initial_typed_metadata(
            input_path=input_path,
            raw_asset_record=raw_asset_record,
        )
        ocr_client = online_ocr or build_online_ocr_client(settings)
        provider_response_path: Path | None = None
        candidate_markdown_path: Path | None = None
        candidate_text = ""
        candidate_error: str | None = None
        candidate_error_type: str | None = None
        candidate_metadata: dict[str, object] | None = None
        candidate_provider_response_available = False
        try:
            provider_result = (
                ocr_client.parse_pdf(input_path)
                if input_path.suffix.strip().lower() == ".pdf"
                else ocr_client.parse_file(input_path)
            )
            candidate_metadata = provider_result.metadata
            provider_suffix = (
                ".zip"
                if settings.provider == ONLINE_OCR_PROVIDER_MINERU_API
                and _looks_like_zip_archive(provider_result.provider_result_bytes)
                else ".jsonl"
            )
            provider_response_path = request.output_dir / f"provider-response{provider_suffix}"
            provider_response_path.write_bytes(provider_result.provider_result_bytes)
            candidate_provider_response_available = True
            candidate_text, candidate_markdown_path, candidate_error_type, candidate_error = (
                _extract_candidate_text(
                    provider=settings.provider,
                    provider_response_bytes=provider_result.provider_result_bytes,
                    output_dir=request.output_dir / "candidate",
                )
            )
        except Exception as exc:
            candidate_error_type = type(exc).__name__
            candidate_error = str(exc)

        baseline_bytes, baseline_error = _load_baseline_provider_response_bytes(
            request=request,
            reader=reader,
            baseline_default_key=baseline_default_key,
            source=source,
        )
        baseline_provider_response_available = bool(baseline_bytes)
        baseline_error_type: str | None = None
        baseline_text = ""
        if baseline_bytes:
            try:
                baseline_text = extract_paddle_plain_text(baseline_bytes)
            except Exception as exc:
                baseline_error_type = type(exc).__name__
                baseline_error = str(exc)
        if baseline_bytes:
            (request.output_dir / "baseline-provider-response.jsonl").write_bytes(baseline_bytes)

        candidate_summary = build_provider_summary(
            provider=settings.provider,
            model=settings.model,
            text=candidate_text,
            provider_response_available=candidate_provider_response_available,
            error=candidate_error,
            error_type=candidate_error_type,
            provider_metadata=candidate_metadata,
        )
        baseline_summary = build_provider_summary(
            provider=ONLINE_OCR_PROVIDER_ASYNC_JOBS,
            model=request.baseline_model,
            text=baseline_text,
            provider_response_available=baseline_provider_response_available,
            error=baseline_error,
            error_type=baseline_error_type,
        )
        adjudication_payload = build_adjudication(
            candidate_summary=candidate_summary,
            baseline_summary=baseline_summary,
        )
        refined_typing = refine_raw_asset_typed_metadata_with_ocr_evidence(
            typed_metadata=initial_typed_metadata,
            source_name=source_file_name,
            candidate_summary=candidate_summary,
            baseline_summary=baseline_summary,
            adjudication=adjudication_payload,
        )
        routing_decision = _build_compare_routing_decision(
            source_file_name=source_file_name,
            initial_typed_metadata=initial_typed_metadata,
            refined_typing=refined_typing,
            candidate_summary=candidate_summary,
            baseline_summary=baseline_summary,
        )

        comparison_payload = {
            "candidate": candidate_summary,
            "baseline": baseline_summary,
            "diff": {
                "candidate_equals_baseline": bool(baseline_bytes)
                and candidate_text == baseline_text,
                "candidate_text_length_delta": candidate_summary["plain_text_length"]
                - baseline_summary["plain_text_length"],
                "candidate_html_tag_count_delta": candidate_summary["structure_signals"][
                    "html_tag_count"
                ]
                - baseline_summary["structure_signals"]["html_tag_count"],
                "candidate_table_row_count_delta": candidate_summary["structure_signals"][
                    "table_row_count"
                ]
                - baseline_summary["structure_signals"]["table_row_count"],
            },
            "adjudication": adjudication_payload,
            "asset_typing": _asset_typing_payload(
                initial_typed_metadata=initial_typed_metadata,
                refined_typing=refined_typing,
            ),
            "routing_recommendation": _routing_decision_payload(routing_decision),
        }
        comparison_path = request.output_dir / "comparison.json"
        comparison_path.write_text(
            json.dumps(comparison_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        summary_payload = {
            "provider": settings.provider,
            "model": settings.model,
            "input_filename": source_file_name,
            "candidate": candidate_summary,
            "baseline": baseline_summary,
            "adjudication": adjudication_payload,
            "asset_typing": _asset_typing_payload(
                initial_typed_metadata=initial_typed_metadata,
                refined_typing=refined_typing,
            ),
            "routing_recommendation": _routing_decision_payload(routing_decision),
            "comparison_path": str(comparison_path),
        }
        summary_path = request.output_dir / "summary.json"
        summary_path.write_text(
            json.dumps(summary_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    return OnlineOcrCompareReport(
        provider=settings.provider,
        model=settings.model,
        input_filename=source_file_name,
        output_dir=str(request.output_dir),
        provider_response_path=str(provider_response_path)
        if provider_response_path is not None
        else "",
        candidate_markdown_path=str(candidate_markdown_path)
        if candidate_markdown_path is not None
        else None,
        comparison_path=str(comparison_path),
        summary_path=str(summary_path),
    )


def _build_object_store_reader(
    *,
    source: dict[str, str],
    object_store: CompareObjectStoreReader | None,
) -> CompareObjectStoreReader | None:
    if object_store is not None:
        return object_store
    if not (source.get("OBJECT_STORE_ENDPOINT") or "").strip():
        return None
    return S3ObjectStoreClient(ObjectStoreSettings.from_env(source))


def _resolve_input_path(
    *,
    request: OnlineOcrCompareRequest,
    reader: CompareObjectStoreReader | None,
    raw_asset_registry: RawAssetRegistry | None,
    source: dict[str, str],
    stack: ExitStack,
) -> tuple[Path, str, str | None, RawAssetRecord | None]:
    if request.file_path is not None:
        return request.file_path.resolve(), request.file_path.name, None, None
    if reader is None:
        raise ValueError("OBJECT_STORE_* env is required when comparing a registered raw asset")
    if raw_asset_registry is None:
        raise ValueError("RAW_ASSET_REGISTRY_DATABASE_URL is required for raw-asset compare")
    raw_asset_id = str(request.raw_asset_id or "").strip()
    raw_version_id = str(request.raw_version_id or "").strip()
    raw_asset_record = raw_asset_registry.get(raw_asset_id, raw_version_id)
    if raw_asset_record is None:
        raise ValueError(f"raw asset is not registered: {raw_asset_id}@{raw_version_id}")
    temp_dir = Path(stack.enter_context(TemporaryDirectory()))
    input_path = temp_dir / raw_asset_record.source_filename
    source_bucket = ObjectStoreSettings.from_env(source).bucket_source
    input_path.write_bytes(reader.get_bytes(bucket=source_bucket, key=raw_asset_record.object_key))
    baseline_key = build_source_ocr_artifact_key(
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        model_slug=build_source_model_slug(request.baseline_model),
        year=infer_year_label(raw_asset_record.source_filename),
    )
    return input_path, raw_asset_record.source_filename, baseline_key, raw_asset_record


def _resolve_initial_typed_metadata(
    *,
    input_path: Path,
    raw_asset_record: RawAssetRecord | None,
) -> RawAssetTypedMetadata:
    inferred = infer_raw_asset_typed_metadata(
        source_path=input_path,
        file_bytes=input_path.read_bytes(),
    )
    if raw_asset_record is None:
        return inferred
    return RawAssetTypedMetadata(
        content_type=raw_asset_record.content_type or inferred.content_type,
        file_extension=raw_asset_record.file_extension or inferred.file_extension,
        byte_size=raw_asset_record.byte_size
        if raw_asset_record.byte_size is not None
        else inferred.byte_size,
        page_count=raw_asset_record.page_count
        if raw_asset_record.page_count is not None
        else inferred.page_count,
        image_width=raw_asset_record.image_width
        if raw_asset_record.image_width is not None
        else inferred.image_width,
        image_height=raw_asset_record.image_height
        if raw_asset_record.image_height is not None
        else inferred.image_height,
        asset_kind=raw_asset_record.asset_kind or inferred.asset_kind,
        asset_subkind=raw_asset_record.asset_subkind or inferred.asset_subkind,
        classification_confidence=(
            raw_asset_record.classification_confidence
            if raw_asset_record.classification_confidence is not None
            else inferred.classification_confidence
        ),
    )


def _build_compare_routing_decision(
    *,
    source_file_name: str,
    initial_typed_metadata: RawAssetTypedMetadata,
    refined_typing: RawAssetTypeRefinement,
    candidate_summary: dict[str, object],
    baseline_summary: dict[str, object],
):
    if initial_typed_metadata.asset_kind == "image":
        return select_adjudicated_image_routing(
            refined_asset_subkind=refined_typing.asset_subkind,
            candidate_summary=candidate_summary,
            baseline_summary=baseline_summary,
        )
    return select_online_ocr_routing(
        asset_kind=refined_typing.asset_kind,
        asset_subkind=refined_typing.asset_subkind,
        mineru_available=True,
    )


def _extract_mineru_archive(*, archive_bytes: bytes, output_dir: Path) -> Path | None:
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / "provider-response.zip"
    archive_path.write_bytes(archive_bytes)
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(output_dir)
        markdown_names = [
            member
            for member in archive.namelist()
            if Path(member).name == "full.md" or member.endswith(".md")
        ]
    if not markdown_names:
        return None
    return output_dir / markdown_names[0]


def _extract_candidate_text(
    *,
    provider: str,
    provider_response_bytes: bytes,
    output_dir: Path,
) -> tuple[str, Path | None, str | None, str | None]:
    try:
        if provider == ONLINE_OCR_PROVIDER_MINERU_API:
            if not _looks_like_zip_archive(provider_response_bytes):
                return extract_paddle_plain_text(provider_response_bytes), None, None, None
            candidate_markdown_path = _extract_mineru_archive(
                archive_bytes=provider_response_bytes,
                output_dir=output_dir,
            )
            candidate_text = (
                candidate_markdown_path.read_text(encoding="utf-8")
                if candidate_markdown_path is not None
                else ""
            )
            return candidate_text, candidate_markdown_path, None, None
        return extract_paddle_plain_text(provider_response_bytes), None, None, None
    except Exception as exc:
        return "", None, type(exc).__name__, str(exc)


def _looks_like_zip_archive(payload: bytes) -> bool:
    return len(payload) >= 4 and payload[:4] == b"PK\x03\x04"


def _load_baseline_provider_response_bytes(
    *,
    request: OnlineOcrCompareRequest,
    reader: CompareObjectStoreReader | None,
    baseline_default_key: str | None,
    source: dict[str, str],
) -> tuple[bytes | None, str | None]:
    if request.baseline_provider_response_path is not None:
        return request.baseline_provider_response_path.read_bytes(), None
    if reader is None:
        return None, None
    baseline_key = request.baseline_provider_response_key or baseline_default_key
    if not baseline_key:
        return None, None
    try:
        return reader.get_bytes(
            bucket=ObjectStoreSettings.from_env(source).bucket_source,
            key=baseline_key,
        ), None
    except Exception as exc:  # pragma: no cover - depends on backing object store
        return None, str(exc)


def _asset_typing_payload(
    *,
    initial_typed_metadata: RawAssetTypedMetadata,
    refined_typing: RawAssetTypeRefinement,
) -> dict[str, object]:
    return {
        "initial": asdict(initial_typed_metadata),
        "refined": {
            "asset_kind": refined_typing.asset_kind,
            "asset_subkind": refined_typing.asset_subkind,
            "classification_confidence": refined_typing.classification_confidence,
            "reason_codes": list(refined_typing.reason_codes),
        },
    }


def _routing_decision_payload(decision) -> dict[str, object]:
    return {
        "route_id": decision.route_id,
        "canonical_allowed": decision.canonical_allowed,
        "canonical_provider": decision.canonical_provider,
        "fallback_provider": decision.fallback_provider,
        "parser_version": decision.parser_version,
        "reason_codes": list(decision.reason_codes),
        "persist_raw_provider_artifact": decision.persist_raw_provider_artifact,
    }


__all__ = [
    "OnlineOcrCompareReport",
    "OnlineOcrCompareRequest",
    "compare_online_ocr",
]
