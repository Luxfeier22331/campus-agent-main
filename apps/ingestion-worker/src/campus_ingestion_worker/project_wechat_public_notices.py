from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from hashlib import sha256
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.internal_notice_consumption_admission import (
    DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY,
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY,
)
from campus_ingestion_core.postgres_runtime import open_postgres_connection
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.wechat_public_notice_projection import (
    WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
    WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
    WeChatPublicNoticeProjectionRequest,
    WeChatSourceTruthArtifactRefs,
    build_wechat_public_notice_read_model_evidence_entries,
    materialize_wechat_public_notice_read_model,
    parse_wechat_projection_selection_path,
    rebuild_wechat_public_notice_projection,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

WECHAT_CAPTURE_LEDGER_ENV_KEY = "WECHAT_OFFICIAL_ACCOUNT_CAPTURE_LEDGER_DATABASE_URL"
_WECHAT_CAPTURE_RUN_TABLE = "wechat_official_account.capture_runs"
_WECHAT_CAPTURE_RUN_ARTIFACT_TABLE = "wechat_official_account.run_artifacts"
_WECHAT_CAPTURE_COMPLETED_STATUSES = ("completed", "completed_with_errors")
_SOURCE_TRUTH_ARTIFACT_TYPE_MANIFEST = "source_truth_article_manifest"
_SOURCE_TRUTH_ARTIFACT_TYPE_CONTENT_BLOCKS = "source_truth_content_blocks"
_SOURCE_TRUTH_ARTIFACT_TYPE_MEDIA_REFS = "source_truth_media_refs"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Project WeChat source-truth articles into notice consumption projection."
    )
    parser.add_argument("--corpus", default=WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS)
    parser.add_argument("--collection", default=WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION)
    parser.add_argument("--selection-path")
    parser.add_argument(
        "--article-manifest-key",
        action="append",
        default=[],
        help=(
            "Object key for source-truth/article-manifest.json. Repeatable. "
            "content/media keys are derived from the same prefix."
        ),
    )
    parser.add_argument("--source-bucket", default="")
    parser.add_argument("--capture-run-id")
    parser.add_argument("--latest-completed-capture-run", action="store_true")
    parser.add_argument("--capture-account-slug", default="")
    parser.add_argument(
        "--reference-scope",
        action="append",
        default=[],
        help="Optional reference scope in corpus/collection or corpus:collection format.",
    )
    parser.add_argument("--emit-read-model-evidence", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    selection_path = str(args.selection_path or "").strip()
    capture_run_id = str(args.capture_run_id or "").strip()
    latest_completed_capture_run = bool(args.latest_completed_capture_run)
    capture_account_slug = str(args.capture_account_slug or "").strip()
    source_bucket = str(args.source_bucket or "").strip()
    if capture_run_id and latest_completed_capture_run:
        parser.error("--capture-run-id and --latest-completed-capture-run are mutually exclusive")
    if latest_completed_capture_run and not capture_account_slug:
        parser.error("--capture-account-slug is required with --latest-completed-capture-run")
    if capture_account_slug and not latest_completed_capture_run and not capture_run_id:
        parser.error(
            "--capture-account-slug is only supported with --capture-run-id or "
            "--latest-completed-capture-run"
        )
    explicit_manifest_keys = tuple(
        str(item).strip() for item in args.article_manifest_key if str(item).strip()
    )
    if (
        not selection_path
        and not explicit_manifest_keys
        and not capture_run_id
        and not latest_completed_capture_run
    ):
        parser.error(
            "refusing implicit full-scope projection rebuild; pass --selection-path or "
            "--article-manifest-key or capture-run selection options"
        )

    explicit_refs = _build_explicit_manifest_refs(
        manifest_keys=explicit_manifest_keys,
        source_bucket=source_bucket,
    )
    selected_refs = _load_selection_refs(
        selection_path=selection_path,
        source_bucket=source_bucket,
    )
    capture_refs, resolved_capture_run_id = _load_capture_run_refs(
        capture_run_id=capture_run_id,
        latest_completed_capture_run=latest_completed_capture_run,
        capture_account_slug=capture_account_slug,
        source_bucket=source_bucket,
        env=dict(os.environ),
    )
    artifact_refs = _dedupe_artifact_refs((*explicit_refs, *selected_refs, *capture_refs))
    if not artifact_refs:
        parser.error("selection did not yield source-truth artifact references")

    source_corpus = str(args.corpus or "").strip() or WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS
    source_collection = str(args.collection or "").strip() or WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION
    reference_scopes = _parse_reference_scopes(args.reference_scope)
    effective_reference_scopes = reference_scopes or (
        (WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS, "internal_notice"),
        (WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS, WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION),
    )
    selection_sha256 = (
        sha256(Path(selection_path).read_bytes()).hexdigest() if selection_path else ""
    )
    selection_source = _selection_source(
        has_explicit_manifest_keys=bool(explicit_manifest_keys),
        has_selection_path=bool(selection_path),
        capture_selection_mode=_capture_selection_mode(
            capture_run_id=capture_run_id,
            latest_completed_capture_run=latest_completed_capture_run,
        ),
    )
    command = (
        "wechat_public_notice_projection_dry_run"
        if args.dry_run
        else "wechat_public_notice_projection_rebuild"
    )
    command_args = {
        "selection_source": selection_source,
        "selection_path": selection_path,
        "selection_sha256": selection_sha256,
        "source_bucket": source_bucket,
        "capture_run_id": resolved_capture_run_id,
        "capture_account_slug": capture_account_slug,
        "reference_scopes": [
            f"{corpus}/{collection}" for corpus, collection in effective_reference_scopes
        ],
        "dry_run": bool(args.dry_run),
        "emit_read_model_evidence": bool(args.emit_read_model_evidence),
        "selected_manifest_count": len(artifact_refs),
    }

    admission_store = build_internal_notice_consumption_admission_store_from_env()
    admission_created_at = utc_now()
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        notice_ids=(),
        status="started",
        created_at=admission_created_at,
        selection_source=selection_source,
        selection_path=selection_path,
        selection_sha256=selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    request_kwargs: dict[str, object] = {
        "artifact_refs": artifact_refs,
        "source_corpus": source_corpus,
        "source_collection": source_collection,
        "source_bucket": source_bucket,
        "consumer_admission_batch_id": batch_id,
    }
    if reference_scopes:
        request_kwargs["reference_scopes"] = reference_scopes
    request = WeChatPublicNoticeProjectionRequest(**request_kwargs)
    try:
        build_report = rebuild_wechat_public_notice_projection(
            request=request,
            dry_run=bool(args.dry_run),
        )
        if args.dry_run:
            read_model_entries = ()
        else:
            object_store_settings = ObjectStoreSettings.from_env(dict(os.environ))
            read_model_entries = materialize_wechat_public_notice_read_model(
                projection_entries=build_report.projection_entries,
                read_model_store=build_internal_notice_read_model_store_from_env(),
                source_object_store=S3ObjectStoreAdmin(object_store_settings),
                derived_object_store=S3ObjectStoreWriter(object_store_settings),
                source_bucket=request.source_bucket or object_store_settings.bucket_source,
                derived_bucket=object_store_settings.bucket_derived,
            )
    except Exception as exc:
        record_internal_notice_consumption_admission(
            source_corpus=request.source_corpus,
            source_collection=request.source_collection,
            command=command,
            notice_ids=(),
            status="failed",
            batch_id=batch_id,
            created_at=admission_created_at,
            error=str(exc),
            selection_source=selection_source,
            selection_path=selection_path,
            selection_sha256=selection_sha256,
            command_args=command_args,
            store=admission_store,
        )
        raise

    evidence_entries = (
        build_wechat_public_notice_read_model_evidence_entries(build_report.projection_entries)
        if args.emit_read_model_evidence
        else ()
    )
    notice_ids = tuple(
        sorted(
            {
                entry.source_notice_id
                for entry in build_report.projection_entries
                if entry.source_notice_id.strip()
            }
        )
    )
    report = _build_report(
        build_report=build_report,
        dry_run=bool(args.dry_run),
        read_model_entries=read_model_entries,
        emit_read_model_evidence=bool(args.emit_read_model_evidence),
        evidence_entries=evidence_entries,
    )
    if resolved_capture_run_id:
        report["capture_run_id"] = resolved_capture_run_id
    report["batch_id"] = record_internal_notice_consumption_admission(
        source_corpus=request.source_corpus,
        source_collection=request.source_collection,
        command=command,
        notice_ids=notice_ids,
        status="completed",
        batch_id=batch_id,
        created_at=admission_created_at,
        result_counts={
            "projection_entry_count": int(report["projection_entry_count"]),
            "retained_count": int(report["retained_count"]),
            "duplicate_suppressed_count": int(report["duplicate_suppressed_count"]),
            "read_model_entry_count": int(report["read_model_entry_count"]),
            "read_model_queryable_count": int(report["read_model_queryable_count"]),
            "read_model_evidence_count": int(report["read_model_evidence_count"]),
        },
        selection_source=selection_source,
        selection_path=selection_path,
        selection_sha256=selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def _build_explicit_manifest_refs(
    *,
    manifest_keys: Sequence[str],
    source_bucket: str,
) -> tuple[WeChatSourceTruthArtifactRefs, ...]:
    refs: list[WeChatSourceTruthArtifactRefs] = []
    for manifest_key in manifest_keys:
        if not manifest_key.endswith("/source-truth/article-manifest.json"):
            raise ValueError(
                "article manifest key must end with /source-truth/article-manifest.json"
            )
        prefix = manifest_key.rsplit("/source-truth/article-manifest.json", 1)[0]
        refs.append(
            WeChatSourceTruthArtifactRefs(
                article_manifest_key=manifest_key,
                content_blocks_key=f"{prefix}/source-truth/content-blocks.jsonl",
                media_refs_key=f"{prefix}/source-truth/media-refs.jsonl",
                bucket=source_bucket,
            )
        )
    return tuple(refs)


def _load_selection_refs(
    *,
    selection_path: str,
    source_bucket: str,
) -> tuple[WeChatSourceTruthArtifactRefs, ...]:
    if not selection_path:
        return ()
    return parse_wechat_projection_selection_path(
        Path(selection_path),
        default_bucket=source_bucket,
    )


def _parse_reference_scopes(values: Sequence[str]) -> tuple[tuple[str, str], ...]:
    scopes: list[tuple[str, str]] = []
    for value in values:
        normalized = str(value).strip()
        if not normalized:
            continue
        if "/" in normalized:
            corpus, collection = normalized.split("/", 1)
        elif ":" in normalized:
            corpus, collection = normalized.split(":", 1)
        else:
            raise ValueError(
                "--reference-scope must be in corpus/collection or corpus:collection format"
            )
        corpus = corpus.strip()
        collection = collection.strip()
        if not corpus or not collection:
            raise ValueError(
                "--reference-scope must be in corpus/collection or corpus:collection format"
            )
        scopes.append((corpus, collection))
    return tuple(dict.fromkeys(scopes))


def _dedupe_artifact_refs(
    refs: Sequence[WeChatSourceTruthArtifactRefs],
) -> tuple[WeChatSourceTruthArtifactRefs, ...]:
    deduped: dict[tuple[str, str], WeChatSourceTruthArtifactRefs] = {}
    for ref in refs:
        deduped[(ref.bucket, ref.article_manifest_key)] = ref
    return tuple(
        sorted(deduped.values(), key=lambda item: (item.bucket, item.article_manifest_key))
    )


def _selection_source(
    *,
    has_explicit_manifest_keys: bool,
    has_selection_path: bool,
    capture_selection_mode: str = "",
) -> str:
    sources: list[str] = []
    if has_explicit_manifest_keys:
        sources.append("explicit_manifest_keys")
    if has_selection_path:
        sources.append("selection_path")
    if capture_selection_mode:
        sources.append(capture_selection_mode)
    return "+".join(sources)


def _capture_selection_mode(
    *,
    capture_run_id: str,
    latest_completed_capture_run: bool,
) -> str:
    if capture_run_id:
        return "capture_run_id"
    if latest_completed_capture_run:
        return "latest_completed_capture_run"
    return ""


def _load_capture_run_refs(
    *,
    capture_run_id: str,
    latest_completed_capture_run: bool,
    capture_account_slug: str,
    source_bucket: str,
    env: dict[str, str],
) -> tuple[tuple[WeChatSourceTruthArtifactRefs, ...], str]:
    resolved_capture_run_id = capture_run_id.strip()
    capture_account_slug = capture_account_slug.strip()
    if not resolved_capture_run_id and not latest_completed_capture_run:
        return (), ""
    database_url = _capture_ledger_database_url(env)
    if not database_url:
        raise ValueError(
            f"{WECHAT_CAPTURE_LEDGER_ENV_KEY} or "
            f"{SHARED_POSTGRES_ENV_KEY} or "
            f"{DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY} or "
            f"{DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY} or "
            f"{DOCUMENT_REGISTRY_ENV_KEY} is required for capture-run selection"
        )
    with open_postgres_connection(database_url) as conn, conn.cursor() as cursor:
        if latest_completed_capture_run:
            cursor.execute(
                f"""
                select run_id
                from {_WECHAT_CAPTURE_RUN_TABLE}
                where account_slug = %s
                  and status = any(%s)
                order by started_at desc
                limit 1
                """,
                (capture_account_slug, list(_WECHAT_CAPTURE_COMPLETED_STATUSES)),
            )
            latest_row = cursor.fetchone()
            if latest_row is None:
                raise ValueError(
                    f"no completed capture run found for account_slug={capture_account_slug!r}"
                )
            resolved_capture_run_id = str(latest_row[0]).strip()
        cursor.execute(
            f"""
            select account_slug, status
            from {_WECHAT_CAPTURE_RUN_TABLE}
            where run_id = %s
            """,
            (resolved_capture_run_id,),
        )
        run_row = cursor.fetchone()
        if run_row is None:
            raise ValueError(f"wechat capture run not found: {resolved_capture_run_id!r}")
        run_account_slug = str(run_row[0]).strip()
        run_status = str(run_row[1]).strip()
        if capture_account_slug and run_account_slug != capture_account_slug:
            raise ValueError(
                "capture run account_slug mismatch: "
                f"expected {capture_account_slug!r}, got {run_account_slug!r}"
            )
        if run_status not in _WECHAT_CAPTURE_COMPLETED_STATUSES:
            raise ValueError(
                "capture run must be completed before projection: "
                f"run_id={resolved_capture_run_id!r}, status={run_status!r}"
            )
        cursor.execute(
            f"""
            select artifact_type, object_key
            from {_WECHAT_CAPTURE_RUN_ARTIFACT_TABLE}
            where run_id = %s
            order by artifact_type asc, object_key asc
            """,
            (resolved_capture_run_id,),
        )
        artifact_rows = tuple(
            (str(row[0]).strip(), str(row[1]).strip()) for row in cursor.fetchall()
        )
    refs = _build_capture_refs_from_artifacts(
        artifact_rows=artifact_rows,
        source_bucket=source_bucket,
        run_id=resolved_capture_run_id,
    )
    return refs, resolved_capture_run_id


def _build_capture_refs_from_artifacts(
    *,
    artifact_rows: Sequence[tuple[str, str]],
    source_bucket: str,
    run_id: str,
) -> tuple[WeChatSourceTruthArtifactRefs, ...]:
    manifest_keys = {
        key
        for artifact_type, key in artifact_rows
        if artifact_type == _SOURCE_TRUTH_ARTIFACT_TYPE_MANIFEST and key
    }
    content_blocks_keys = {
        key
        for artifact_type, key in artifact_rows
        if artifact_type == _SOURCE_TRUTH_ARTIFACT_TYPE_CONTENT_BLOCKS and key
    }
    media_refs_keys = {
        key
        for artifact_type, key in artifact_rows
        if artifact_type == _SOURCE_TRUTH_ARTIFACT_TYPE_MEDIA_REFS and key
    }
    if not manifest_keys:
        raise ValueError(
            "capture run does not contain source-truth article manifest artifacts: "
            f"run_id={run_id!r}"
        )
    refs: list[WeChatSourceTruthArtifactRefs] = []
    for manifest_key in sorted(manifest_keys):
        if not manifest_key.endswith("/source-truth/article-manifest.json"):
            raise ValueError(
                f"capture run artifact has unexpected manifest key shape: {manifest_key!r}"
            )
        prefix = manifest_key.rsplit("/source-truth/article-manifest.json", 1)[0]
        content_blocks_key = f"{prefix}/source-truth/content-blocks.jsonl"
        media_refs_key = f"{prefix}/source-truth/media-refs.jsonl"
        if content_blocks_key not in content_blocks_keys:
            raise ValueError(
                f"capture run missing source-truth content blocks for manifest: {manifest_key!r}"
            )
        if media_refs_key not in media_refs_keys:
            raise ValueError(
                f"capture run missing source-truth media refs for manifest: {manifest_key!r}"
            )
        refs.append(
            WeChatSourceTruthArtifactRefs(
                article_manifest_key=manifest_key,
                content_blocks_key=content_blocks_key,
                media_refs_key=media_refs_key,
                bucket=source_bucket,
            )
        )
    return tuple(refs)


def _capture_ledger_database_url(env: dict[str, str]) -> str:
    return (
        env.get(WECHAT_CAPTURE_LEDGER_ENV_KEY)
        or env.get(SHARED_POSTGRES_ENV_KEY)
        or env.get(DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY)
        or env.get(DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY)
        or env.get(DOCUMENT_REGISTRY_ENV_KEY)
        or ""
    ).strip()


def _build_report(
    *,
    build_report: object,
    dry_run: bool,
    read_model_entries: Sequence[object],
    emit_read_model_evidence: bool,
    evidence_entries: Sequence[object],
) -> dict[str, Any]:
    read_model_queryable_count = sum(
        1 for entry in read_model_entries if bool(getattr(entry, "queryable", False))
    )
    return {
        "projection_entry_count": len(getattr(build_report, "projection_entries", ())),
        "article_count": int(getattr(build_report, "total_article_count", 0)),
        "retained_count": int(getattr(build_report, "retained_count", 0)),
        "duplicate_suppressed_count": int(getattr(build_report, "duplicate_suppressed_count", 0)),
        "duplicate_source_family_counts": dict(
            sorted(dict(getattr(build_report, "duplicate_source_family_counts", {})).items())
        ),
        "query_serving_opened": not dry_run and read_model_queryable_count > 0,
        "projection_write_performed": not dry_run,
        "read_model_write_performed": not dry_run,
        "read_model_entry_count": len(read_model_entries),
        "read_model_queryable_count": read_model_queryable_count,
        "read_model_evidence_emitted": emit_read_model_evidence,
        "read_model_evidence_count": len(evidence_entries),
        "entries": [asdict(entry) for entry in getattr(build_report, "projection_entries", ())],
        "read_model_entries": [asdict(entry) for entry in read_model_entries],
        "read_model_evidence_entries": [asdict(entry) for entry in evidence_entries],
    }


__all__ = [
    "build_parser",
    "main",
    "rebuild_wechat_public_notice_projection",
]


if __name__ == "__main__":
    main()
