from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.internal_notice_consumption_admission import (
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NoticeConsumptionProjectionEntry,
    build_notice_consumption_projection_store_from_env,
)
from campus_ingestion_core.registry import build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.wechat_public_notice_multimodal import (
    ChatCompletionsWeChatPublicNoticeMultimodalProvider,
    HttpxWeChatPublicNoticeInlineImageFetcher,
    WeChatPublicNoticeMultimodalProcessingReport,
    build_wechat_public_notice_multimodal_attempt_store_from_env,
    process_wechat_public_notice_pending_multimodal_entries,
    select_wechat_public_notice_pending_multimodal_notice_ids,
)
from campus_ingestion_core.wechat_public_notice_projection import (
    WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
    WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
    WeChatPublicNoticeProjectionRequest,
    WeChatSourceTruthArtifactRefs,
    materialize_wechat_public_notice_read_model,
    rebuild_wechat_public_notice_projection,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Drain pending WeChat public-notice multimodal rows and reopen projection."
    )
    parser.add_argument("--corpus", default=WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS)
    parser.add_argument("--collection", default=WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION)
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--skip-read-model-rebuild", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.limit <= 0:
        parser.error("--limit must be greater than zero")
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")
    if args.max_attempts <= 0:
        parser.error("--max-attempts must be greater than zero")

    projection_store = build_notice_consumption_projection_store_from_env()
    selected_notice_ids = _resolve_selected_notice_ids(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
        source_corpus=args.corpus,
        source_collection=args.collection,
        projection_store=projection_store,
        limit=args.limit,
    )
    command_args = {
        "selection_source": "explicit_notice_ids"
        if args.notice_ids
        else ("selection_path" if args.selection_path else "projection_pending_scan"),
        "selection_path": str(args.selection_path or "").strip(),
        "limit": int(args.limit),
        "batch_size": int(args.batch_size),
        "max_attempts": int(args.max_attempts),
        "skip_read_model_rebuild": bool(args.skip_read_model_rebuild),
    }
    admission_store = build_internal_notice_consumption_admission_store_from_env()
    admission_created_at = utc_now()
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="wechat_multimodal_drain",
        notice_ids=selected_notice_ids,
        status="started",
        created_at=admission_created_at,
        selection_source=str(command_args["selection_source"]),
        selection_path=str(command_args["selection_path"]),
        selection_sha256=_selection_sha256(args.selection_path),
        command_args=command_args,
        store=admission_store,
    )
    source_settings = ObjectStoreSettings.from_env()
    source_object_store = S3ObjectStoreAdmin(source_settings)
    derived_object_store = S3ObjectStoreWriter(source_settings)
    attempt_store = build_wechat_public_notice_multimodal_attempt_store_from_env(
        prefer_operator=True
    )
    processor = ChatCompletionsWeChatPublicNoticeMultimodalProvider.from_env()
    fetcher = HttpxWeChatPublicNoticeInlineImageFetcher()
    registry = build_document_registry_from_env()

    if not selected_notice_ids:
        empty_report = _empty_processing_report(
            source_corpus=args.corpus,
            source_collection=args.collection,
        )
        payload = asdict(empty_report)
        payload["read_model_rebuilt_count"] = 0
        payload["reprojected_notice_count"] = 0
        payload["batch_id"] = record_internal_notice_consumption_admission(
            source_corpus=args.corpus,
            source_collection=args.collection,
            command="wechat_multimodal_drain",
            notice_ids=(),
            status="completed",
            batch_id=batch_id,
            created_at=admission_created_at,
            result_counts={
                "pending_entry_count": 0,
                "attempted_image_count": 0,
                "admitted_count": 0,
                "terminal_failure_count": 0,
                "read_model_rebuilt_count": 0,
            },
            selection_source=str(command_args["selection_source"]),
            selection_path=str(command_args["selection_path"]),
            selection_sha256=_selection_sha256(args.selection_path),
            command_args=command_args,
            store=admission_store,
        )
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return

    try:
        process_report = _drain_batches(
            source_corpus=args.corpus,
            source_collection=args.collection,
            notice_ids=selected_notice_ids,
            batch_size=args.batch_size,
            projection_store=projection_store,
            source_object_store=source_object_store,
            derived_object_store=derived_object_store,
            source_bucket=source_settings.bucket_source,
            derived_bucket=source_settings.bucket_derived,
            image_fetcher=fetcher,
            provider=processor,
            registry=registry,
            attempt_store=attempt_store,
            max_attempts=args.max_attempts,
            admission_batch_id=batch_id,
        )
        projection_entries = projection_store.list_by_scope(
            args.corpus,
            args.collection,
            notice_ids=selected_notice_ids,
        )
        projection_request = _build_projection_request_from_projection_entries(
            projection_entries=projection_entries,
            source_bucket=source_settings.bucket_source,
            source_corpus=args.corpus,
            source_collection=args.collection,
            consumer_admission_batch_id=batch_id,
        )
        rebuild_report = rebuild_wechat_public_notice_projection(
            request=projection_request,
            projection_store=projection_store,
        )
        if args.skip_read_model_rebuild:
            read_model_rebuilt_count = 0
        else:
            read_model_rebuilt_count = len(
                materialize_wechat_public_notice_read_model(
                    projection_entries=rebuild_report.projection_entries,
                    read_model_store=build_internal_notice_read_model_store_from_env(),
                    source_object_store=source_object_store,
                    derived_object_store=derived_object_store,
                    source_bucket=source_settings.bucket_source,
                    derived_bucket=source_settings.bucket_derived,
                )
            )
    except Exception as exc:
        record_internal_notice_consumption_admission(
            source_corpus=args.corpus,
            source_collection=args.collection,
            command="wechat_multimodal_drain",
            notice_ids=selected_notice_ids,
            status="failed",
            batch_id=batch_id,
            created_at=admission_created_at,
            error=str(exc),
            selection_source=str(command_args["selection_source"]),
            selection_path=str(command_args["selection_path"]),
            selection_sha256=_selection_sha256(args.selection_path),
            command_args=command_args,
            store=admission_store,
        )
        raise

    payload = asdict(process_report)
    payload["read_model_rebuilt_count"] = read_model_rebuilt_count
    payload["reprojected_notice_count"] = len(
        {
            entry.source_notice_id
            for entry in rebuild_report.projection_entries
            if entry.source_notice_id.strip()
        }
    )
    payload["batch_id"] = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="wechat_multimodal_drain",
        notice_ids=selected_notice_ids,
        status="completed",
        batch_id=batch_id,
        created_at=admission_created_at,
        result_counts={
            "pending_entry_count": process_report.pending_entry_count,
            "attempted_image_count": process_report.attempted_image_count,
            "admitted_count": process_report.admitted_count,
            "terminal_failure_count": process_report.terminal_failure_count,
            "read_model_rebuilt_count": read_model_rebuilt_count,
        },
        selection_source=str(command_args["selection_source"]),
        selection_path=str(command_args["selection_path"]),
        selection_sha256=_selection_sha256(args.selection_path),
        command_args=command_args,
        store=admission_store,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def _resolve_selected_notice_ids(
    *,
    explicit_notice_ids: Sequence[str],
    selection_path: str | None,
    source_corpus: str,
    source_collection: str,
    projection_store,
    limit: int,
) -> tuple[str, ...]:
    explicit = tuple(
        sorted({str(item).strip() for item in explicit_notice_ids if str(item).strip()})
    )
    if explicit:
        return explicit
    if selection_path:
        payload = json.loads(Path(selection_path).read_text(encoding="utf-8"))
        if isinstance(payload, list):
            selected = tuple(str(item).strip() for item in payload if str(item).strip())
        elif isinstance(payload, dict):
            raw_notice_ids = payload.get("notice_ids") or payload.get("selected_notice_ids") or ()
            selected = tuple(str(item).strip() for item in raw_notice_ids if str(item).strip())
        else:
            selected = ()
        if not selected:
            raise ValueError("selection-path must contain notice_ids or selected_notice_ids")
        return tuple(sorted(dict.fromkeys(selected)))
    return select_wechat_public_notice_pending_multimodal_notice_ids(
        projection_store=projection_store,
        source_corpus=source_corpus,
        source_collection=source_collection,
        limit=limit,
    )


def _drain_batches(
    *,
    source_corpus: str,
    source_collection: str,
    notice_ids: Sequence[str],
    batch_size: int,
    projection_store,
    source_object_store,
    derived_object_store,
    source_bucket: str,
    derived_bucket: str,
    image_fetcher,
    provider,
    registry,
    attempt_store,
    max_attempts: int,
    admission_batch_id: str,
) -> WeChatPublicNoticeMultimodalProcessingReport:
    batch_reports: list[WeChatPublicNoticeMultimodalProcessingReport] = []
    for batch in _chunked(tuple(notice_ids), batch_size):
        batch_reports.append(
            process_wechat_public_notice_pending_multimodal_entries(
                source_corpus=source_corpus,
                source_collection=source_collection,
                notice_ids=batch,
                projection_store=projection_store,
                object_store=source_object_store,
                registry=registry,
                source_bucket=source_bucket,
                derived_bucket=derived_bucket,
                image_fetcher=image_fetcher,
                provider=provider,
                attempt_store=attempt_store,
                max_attempts=max_attempts,
                admission_batch_id=admission_batch_id,
            )
        )
    return _merge_processing_reports(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=tuple(notice_ids),
        batch_reports=batch_reports,
    )


def _build_projection_request_from_projection_entries(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    source_bucket: str,
    source_corpus: str = WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
    source_collection: str = WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
    consumer_admission_batch_id: str = "",
) -> WeChatPublicNoticeProjectionRequest:
    refs: dict[tuple[str, str], WeChatSourceTruthArtifactRefs] = {}
    for entry in projection_entries:
        metadata = dict(entry.role_metadata or {})
        manifest_key = str(metadata.get("manifest_key") or "").strip()
        content_blocks_key = str(metadata.get("content_blocks_key") or "").strip()
        media_refs_key = str(metadata.get("media_refs_key") or "").strip()
        if not (manifest_key and content_blocks_key and media_refs_key):
            continue
        bucket = str(metadata.get("source_bucket") or source_bucket).strip()
        ref = WeChatSourceTruthArtifactRefs(
            article_manifest_key=manifest_key,
            content_blocks_key=content_blocks_key,
            media_refs_key=media_refs_key,
            bucket=bucket,
        )
        refs[(ref.bucket, ref.article_manifest_key)] = ref
    if not refs:
        raise ValueError("selected projection entries do not include source-truth artifact refs")
    return WeChatPublicNoticeProjectionRequest(
        artifact_refs=tuple(
            sorted(refs.values(), key=lambda item: (item.bucket, item.article_manifest_key))
        ),
        source_corpus=source_corpus,
        source_collection=source_collection,
        source_bucket=source_bucket,
        consumer_admission_batch_id=consumer_admission_batch_id,
    )


def _merge_processing_reports(
    *,
    source_corpus: str,
    source_collection: str,
    selected_notice_ids: tuple[str, ...],
    batch_reports: Sequence[WeChatPublicNoticeMultimodalProcessingReport],
) -> WeChatPublicNoticeMultimodalProcessingReport:
    item_reports = []
    pending_notice_ids: set[str] = set()
    projection_entry_count = 0
    pending_entry_count = 0
    scanned_image_count = 0
    attempted_image_count = 0
    admitted_count = 0
    no_extractable_text_count = 0
    terminal_failure_count = 0
    still_pending_count = 0
    for report in batch_reports:
        pending_notice_ids.update(report.pending_notice_ids)
        projection_entry_count += report.projection_entry_count
        pending_entry_count += report.pending_entry_count
        scanned_image_count += report.scanned_image_count
        attempted_image_count += report.attempted_image_count
        admitted_count += report.admitted_count
        no_extractable_text_count += report.no_extractable_text_count
        terminal_failure_count += report.terminal_failure_count
        still_pending_count += report.still_pending_count
        item_reports.extend(report.item_reports)
    return WeChatPublicNoticeMultimodalProcessingReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=selected_notice_ids,
        pending_notice_ids=tuple(sorted(pending_notice_ids)),
        projection_entry_count=projection_entry_count,
        pending_entry_count=pending_entry_count,
        scanned_image_count=scanned_image_count,
        attempted_image_count=attempted_image_count,
        admitted_count=admitted_count,
        no_extractable_text_count=no_extractable_text_count,
        terminal_failure_count=terminal_failure_count,
        still_pending_count=still_pending_count,
        item_reports=tuple(item_reports),
    )


def _empty_processing_report(
    *,
    source_corpus: str,
    source_collection: str,
) -> WeChatPublicNoticeMultimodalProcessingReport:
    return WeChatPublicNoticeMultimodalProcessingReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=(),
        pending_notice_ids=(),
        projection_entry_count=0,
        pending_entry_count=0,
        scanned_image_count=0,
        attempted_image_count=0,
        admitted_count=0,
        no_extractable_text_count=0,
        terminal_failure_count=0,
        still_pending_count=0,
        item_reports=(),
    )


def _chunked(values: Sequence[str], size: int) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(values[index : index + size]) for index in range(0, len(values), size))


def _selection_sha256(selection_path: str | None) -> str:
    normalized = str(selection_path or "").strip()
    if not normalized:
        return ""
    return hashlib.sha256(Path(normalized).read_bytes()).hexdigest()


__all__ = [
    "_build_projection_request_from_projection_entries",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
