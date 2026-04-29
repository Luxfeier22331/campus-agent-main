from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.wechat_public_notice_projection import (
    WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
    WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
    WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
    WeChatPublicNoticeProjectionRequest,
    WeChatSourceTruthArtifactRefs,
    parse_wechat_projection_selection_path,
    rebuild_wechat_public_notice_projection,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run Phase 5 acceptance smoke for wechat_public_notice projection "
            "without opening query-serving."
        )
    )
    parser.add_argument("--corpus", default=WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS)
    parser.add_argument("--collection", default=WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION)
    parser.add_argument("--selection-path")
    parser.add_argument("--article-manifest-key", action="append", default=[])
    parser.add_argument("--source-bucket", default="")
    parser.add_argument("--reference-scope", action="append", default=[])
    parser.add_argument("--min-article-count", type=int, default=1)
    parser.add_argument("--min-retained-count", type=int, default=0)
    parser.add_argument("--min-duplicate-suppressed-count", type=int, default=0)
    parser.add_argument("--min-captured-count", type=int, default=0)
    parser.add_argument("--max-fetch-failed-count", type=int)
    parser.add_argument("--require-suppressed-source-family", action="append", default=[])
    parser.add_argument("--summary-output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)

    selection_path = str(args.selection_path or "").strip()
    explicit_manifest_keys = tuple(
        str(item).strip() for item in args.article_manifest_key if str(item).strip()
    )
    if not selection_path and not explicit_manifest_keys:
        raise SystemExit("pass --selection-path or --article-manifest-key for wechat phase5 smoke")
    if args.min_article_count < 0:
        raise SystemExit("--min-article-count must be >= 0")
    if args.min_retained_count < 0:
        raise SystemExit("--min-retained-count must be >= 0")
    if args.min_duplicate_suppressed_count < 0:
        raise SystemExit("--min-duplicate-suppressed-count must be >= 0")
    if args.min_captured_count < 0:
        raise SystemExit("--min-captured-count must be >= 0")
    if args.max_fetch_failed_count is not None and args.max_fetch_failed_count < 0:
        raise SystemExit("--max-fetch-failed-count must be >= 0")

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
        raise SystemExit("selection did not yield source-truth artifact references")

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
    build_report = rebuild_wechat_public_notice_projection(
        request=request,
        dry_run=True,
    )
    summary = build_phase5_smoke_summary(
        build_report=build_report,
        min_article_count=int(args.min_article_count),
        min_retained_count=int(args.min_retained_count),
        min_duplicate_suppressed_count=int(args.min_duplicate_suppressed_count),
        min_captured_count=int(args.min_captured_count),
        max_fetch_failed_count=(
            int(args.max_fetch_failed_count) if args.max_fetch_failed_count is not None else None
        ),
        required_suppressed_source_families=tuple(
            str(item).strip() for item in args.require_suppressed_source_family if str(item).strip()
        ),
        selection_path=selection_path,
        explicit_manifest_count=len(explicit_manifest_keys),
    )
    if args.summary_output_path:
        summary_path = Path(args.summary_output_path)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(
            f"{json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True)}\n",
            encoding="utf-8",
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    if not bool(summary["ok"]):
        raise SystemExit(1)


def build_phase5_smoke_summary(
    *,
    build_report: object,
    min_article_count: int,
    min_retained_count: int,
    min_duplicate_suppressed_count: int,
    min_captured_count: int,
    max_fetch_failed_count: int | None,
    required_suppressed_source_families: Sequence[str],
    selection_path: str,
    explicit_manifest_count: int,
) -> dict[str, Any]:
    entries = tuple(getattr(build_report, "projection_entries", ()))
    total_article_count = int(getattr(build_report, "total_article_count", 0))
    retained_count = int(getattr(build_report, "retained_count", 0))
    duplicate_suppressed_count = int(getattr(build_report, "duplicate_suppressed_count", 0))
    duplicate_source_family_counts = dict(
        sorted(dict(getattr(build_report, "duplicate_source_family_counts", {})).items())
    )
    errors: list[str] = []
    suppressed_entries = 0
    retained_entries = 0
    body_state_counter: Counter[str] = Counter()
    target_surface_counter: Counter[str] = Counter()
    consumption_status_counter: Counter[str] = Counter()
    captured_entries = 0
    fetch_failed_entries = 0
    allowed_body_states = {"captured", "not_captured", "fetch_failed"}
    for entry in entries:
        if entry.source_family != WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY:
            errors.append(f"unexpected source_family in projection entry: {entry.source_family!r}")
        metadata = dict(entry.role_metadata or {})
        body_state = str(metadata.get("body_state") or "").strip()
        if body_state:
            body_state_counter[body_state] += 1
            if body_state not in allowed_body_states:
                errors.append(f"unexpected body_state for wechat source-truth: {body_state!r}")
            if body_state == "captured":
                captured_entries += 1
                body_paragraph_count = metadata.get("body_paragraph_count")
                if int(body_paragraph_count or 0) <= 0:
                    errors.append(
                        "captured entry is missing positive body_paragraph_count in role metadata"
                    )
                if not str(metadata.get("body_excerpt") or "").strip():
                    errors.append("captured entry is missing body_excerpt in role metadata")
            if body_state == "fetch_failed":
                fetch_failed_entries += 1
        target_surface_counter[entry.target_surface] += 1
        consumption_status_counter[entry.consumption_status] += 1
        if entry.consumption_status == "no_adoption":
            suppressed_entries += 1
            if entry.target_surface != "unsupported":
                errors.append("suppressed duplicate entry must use target_surface='unsupported'")
        if entry.consumption_status == "retained_for_notice_query":
            retained_entries += 1

    if total_article_count < min_article_count:
        errors.append(
            f"total_article_count={total_article_count} below required minimum {min_article_count}"
        )
    if retained_count < min_retained_count:
        errors.append(
            f"retained_count={retained_count} below required minimum {min_retained_count}"
        )
    if duplicate_suppressed_count < min_duplicate_suppressed_count:
        errors.append(
            "duplicate_suppressed_count="
            f"{duplicate_suppressed_count} below required minimum {min_duplicate_suppressed_count}"
        )
    if captured_entries < min_captured_count:
        errors.append(
            f"captured_entry_count={captured_entries} below required minimum {min_captured_count}"
        )
    if max_fetch_failed_count is not None and fetch_failed_entries > max_fetch_failed_count:
        errors.append(
            "fetch_failed_entry_count="
            f"{fetch_failed_entries} exceeds maximum {max_fetch_failed_count}"
        )
    if suppressed_entries != duplicate_suppressed_count:
        errors.append(
            "suppressed entry count mismatch between projection entries and summary "
            f"({suppressed_entries} != {duplicate_suppressed_count})"
        )
    for family in required_suppressed_source_families:
        if int(duplicate_source_family_counts.get(family, 0)) <= 0:
            errors.append(f"required suppressed source family missing: {family}")

    return {
        "ok": not errors,
        "errors": errors,
        "selection": {
            "selection_path": selection_path,
            "explicit_manifest_count": explicit_manifest_count,
        },
        "projection": {
            "article_count": total_article_count,
            "projection_entry_count": len(entries),
            "retained_count": retained_count,
            "duplicate_suppressed_count": duplicate_suppressed_count,
            "duplicate_source_family_counts": duplicate_source_family_counts,
            "retained_entry_count": retained_entries,
            "suppressed_entry_count": suppressed_entries,
            "captured_entry_count": captured_entries,
            "fetch_failed_entry_count": fetch_failed_entries,
            "body_state_counts": dict(sorted(body_state_counter.items())),
            "target_surface_counts": dict(sorted(target_surface_counter.items())),
            "consumption_status_counts": dict(sorted(consumption_status_counter.items())),
            "query_serving_opened": False,
        },
        "runtime_gate_expectation": {
            "wechat_public_notice_runtime_open": False,
            "verification_hint": (
                "Run go test ./internal/structuredquery -run Notice in apps/supervisor-api "
                "to validate fail-close behavior for wechat_public_notice."
            ),
        },
    }


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


__all__ = [
    "build_parser",
    "build_phase5_smoke_summary",
    "main",
]


if __name__ == "__main__":
    main()
