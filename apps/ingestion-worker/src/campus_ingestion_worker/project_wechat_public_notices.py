from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from hashlib import sha256
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.internal_notice_consumption_admission import (
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)
from campus_ingestion_core.wechat_public_notice_projection import (
    WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
    WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
    WeChatPublicNoticeProjectionRequest,
    WeChatSourceTruthArtifactRefs,
    build_wechat_public_notice_read_model_evidence_entries,
    parse_wechat_projection_selection_path,
    rebuild_wechat_public_notice_projection,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


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
    explicit_manifest_keys = tuple(
        str(item).strip() for item in args.article_manifest_key if str(item).strip()
    )
    if not selection_path and not explicit_manifest_keys:
        parser.error(
            "refusing implicit full-scope projection rebuild; pass --selection-path or "
            "--article-manifest-key"
        )

    explicit_refs = _build_explicit_manifest_refs(
        manifest_keys=explicit_manifest_keys,
        source_bucket=str(args.source_bucket or ""),
    )
    selected_refs = _load_selection_refs(
        selection_path=selection_path,
        source_bucket=str(args.source_bucket or ""),
    )
    artifact_refs = _dedupe_artifact_refs((*explicit_refs, *selected_refs))
    if not artifact_refs:
        parser.error("selection did not yield source-truth artifact references")

    reference_scopes = _parse_reference_scopes(args.reference_scope)
    request_kwargs: dict[str, object] = {
        "artifact_refs": artifact_refs,
        "source_corpus": str(args.corpus or "").strip() or WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
        "source_collection": str(args.collection or "").strip()
        or WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
        "source_bucket": str(args.source_bucket or "").strip(),
    }
    if reference_scopes:
        request_kwargs["reference_scopes"] = reference_scopes
    request = WeChatPublicNoticeProjectionRequest(**request_kwargs)
    selection_sha256 = (
        sha256(Path(selection_path).read_bytes()).hexdigest() if selection_path else ""
    )
    selection_source = _selection_source(
        has_explicit_manifest_keys=bool(explicit_manifest_keys),
        has_selection_path=bool(selection_path),
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
        "source_bucket": request.source_bucket,
        "reference_scopes": [
            f"{corpus}/{collection}" for corpus, collection in request.reference_scopes
        ],
        "dry_run": bool(args.dry_run),
        "emit_read_model_evidence": bool(args.emit_read_model_evidence),
        "selected_manifest_count": len(artifact_refs),
    }

    admission_store = build_internal_notice_consumption_admission_store_from_env()
    admission_created_at = utc_now()
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=request.source_corpus,
        source_collection=request.source_collection,
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
    try:
        build_report = rebuild_wechat_public_notice_projection(
            request=request,
            dry_run=bool(args.dry_run),
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
        emit_read_model_evidence=bool(args.emit_read_model_evidence),
        evidence_entries=evidence_entries,
    )
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
            ).normalized(default_bucket=source_bucket)
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
) -> str:
    sources: list[str] = []
    if has_explicit_manifest_keys:
        sources.append("explicit_manifest_keys")
    if has_selection_path:
        sources.append("selection_path")
    return "+".join(sources)


def _build_report(
    *,
    build_report: object,
    dry_run: bool,
    emit_read_model_evidence: bool,
    evidence_entries: Sequence[object],
) -> dict[str, Any]:
    return {
        "projection_entry_count": len(getattr(build_report, "projection_entries", ())),
        "article_count": int(getattr(build_report, "total_article_count", 0)),
        "retained_count": int(getattr(build_report, "retained_count", 0)),
        "duplicate_suppressed_count": int(getattr(build_report, "duplicate_suppressed_count", 0)),
        "duplicate_source_family_counts": dict(
            sorted(dict(getattr(build_report, "duplicate_source_family_counts", {})).items())
        ),
        "query_serving_opened": False,
        "projection_write_performed": not dry_run,
        "read_model_evidence_emitted": emit_read_model_evidence,
        "read_model_evidence_count": len(evidence_entries),
        "entries": [asdict(entry) for entry in getattr(build_report, "projection_entries", ())],
        "read_model_evidence_entries": [asdict(entry) for entry in evidence_entries],
    }


__all__ = [
    "build_parser",
    "main",
    "rebuild_wechat_public_notice_projection",
]


if __name__ == "__main__":
    main()
