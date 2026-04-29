from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from contextlib import suppress
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_legacy_export import (
    load_authenticated_notice_selection_notice_ids,
)
from campus_ingestion_core.notice_consumption_projection import normalize_notice_ids
from campus_ingestion_core.wechat_public_notice_projection import (
    WeChatPublicNoticeProjectionRequest,
    rebuild_wechat_public_notice_projection,
)
from campus_ingestion_core.wechat_public_notice_runtime_smoke import (
    run_wechat_public_notice_runtime_smoke,
)

from campus_ingestion_worker import project_wechat_public_notices as projection_worker
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Smoke check WeChat public-notice runtime state")
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="wechat_public_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--article-manifest-key", action="append", default=[])
    parser.add_argument("--source-bucket", default="")
    parser.add_argument("--capture-run-id")
    parser.add_argument("--latest-completed-capture-run", action="store_true")
    parser.add_argument("--capture-account-slug", default="")
    parser.add_argument("--check-multimodal-provider", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    notice_ids = _resolve_notice_ids(args)
    if not notice_ids:
        parser.error(
            "pass --notice-id or an explicit WeChat selection (selection path, manifest key, or capture run)"
        )
    report = run_wechat_public_notice_runtime_smoke(
        source_corpus=str(args.corpus or "").strip() or "campus_notices",
        source_collection=str(args.collection or "").strip() or "wechat_public_notice",
        notice_ids=notice_ids,
        env=dict(os.environ),
        check_multimodal_provider=bool(args.check_multimodal_provider),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))
    if not report.ok:
        raise SystemExit(1)


def _resolve_notice_ids(args: argparse.Namespace) -> tuple[str, ...]:
    explicit_notice_ids = tuple(
        str(item).strip() for item in getattr(args, "notice_ids", ()) if str(item).strip()
    )
    selection_path = str(getattr(args, "selection_path", "") or "").strip()
    source_bucket = str(getattr(args, "source_bucket", "") or "").strip()
    capture_run_id = str(getattr(args, "capture_run_id", "") or "").strip()
    latest_completed_capture_run = bool(getattr(args, "latest_completed_capture_run", False))
    capture_account_slug = str(getattr(args, "capture_account_slug", "") or "").strip()
    explicit_manifest_keys = tuple(
        str(item).strip() for item in getattr(args, "article_manifest_key", ()) if str(item).strip()
    )

    artifact_refs = []
    if explicit_manifest_keys:
        artifact_refs.extend(
            projection_worker._build_explicit_manifest_refs(
                manifest_keys=explicit_manifest_keys,
                source_bucket=source_bucket,
            )
        )
    if selection_path:
        with suppress(Exception):
            artifact_refs.extend(
                projection_worker._load_selection_refs(
                    selection_path=selection_path,
                    source_bucket=source_bucket,
                )
            )
    if capture_run_id or latest_completed_capture_run:
        capture_refs, _ = projection_worker._load_capture_run_refs(
            capture_run_id=capture_run_id,
            latest_completed_capture_run=latest_completed_capture_run,
            capture_account_slug=capture_account_slug,
            source_bucket=source_bucket,
            env=dict(os.environ),
        )
        artifact_refs.extend(capture_refs)
    artifact_notice_ids = _notice_ids_from_artifact_refs(
        artifact_refs=projection_worker._dedupe_artifact_refs(tuple(artifact_refs)),
        source_corpus=str(getattr(args, "corpus", "") or "").strip() or "campus_notices",
        source_collection=str(getattr(args, "collection", "") or "").strip()
        or "wechat_public_notice",
        source_bucket=source_bucket,
    )
    selection_notice_ids = ()
    if selection_path:
        try:
            selection_notice_ids = load_authenticated_notice_selection_notice_ids(
                Path(selection_path)
            )
        except Exception:
            selection_notice_ids = ()
    return normalize_notice_ids((*explicit_notice_ids, *selection_notice_ids, *artifact_notice_ids))


def _notice_ids_from_artifact_refs(
    *,
    artifact_refs,
    source_corpus: str,
    source_collection: str,
    source_bucket: str,
) -> tuple[str, ...]:
    if not artifact_refs:
        return ()
    report = rebuild_wechat_public_notice_projection(
        request=WeChatPublicNoticeProjectionRequest(
            artifact_refs=tuple(artifact_refs),
            source_corpus=source_corpus,
            source_collection=source_collection,
            source_bucket=source_bucket,
        ),
        dry_run=True,
    )
    return normalize_notice_ids(
        entry.source_notice_id
        for entry in getattr(report, "projection_entries", ())
        if str(entry.source_notice_id or "").strip()
    )


__all__ = ["build_parser", "main", "run_wechat_public_notice_runtime_smoke"]


if __name__ == "__main__":
    main()
