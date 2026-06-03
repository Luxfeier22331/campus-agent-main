from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

from campus_ingestion_core.wechat_public_notice_projection_models import (
    WeChatSourceTruthArtifactRefs,
)
from campus_ingestion_core.wechat_public_notice_projection_scalars import _text


def parse_wechat_projection_selection_path(
    path: Path,
    *,
    default_bucket: str = "",
) -> tuple[WeChatSourceTruthArtifactRefs, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    refs = tuple(
        _normalize_selection_ref(item, default_bucket=default_bucket)
        for item in _extract_selection_ref_items(payload)
    )
    if not refs:
        raise ValueError("selection must contain source-truth artifact references")
    deduped: dict[tuple[str, str], WeChatSourceTruthArtifactRefs] = {}
    for ref in refs:
        deduped[(ref.bucket, ref.article_manifest_key)] = ref
    return tuple(
        sorted(deduped.values(), key=lambda item: (item.bucket, item.article_manifest_key))
    )


def _extract_selection_ref_items(payload: object) -> tuple[dict[str, object], ...]:
    if isinstance(payload, list):
        return tuple(item for item in payload if isinstance(item, dict))
    if not isinstance(payload, dict):
        return ()
    source_truth_articles = payload.get("source_truth_articles")
    if not isinstance(source_truth_articles, list):
        source_truth_articles = payload.get("sourceTruthArticles")
    if isinstance(source_truth_articles, list):
        return tuple(item for item in source_truth_articles if isinstance(item, dict))
    refs_from_artifacts = _derive_source_truth_refs_from_artifacts(payload)
    if refs_from_artifacts:
        return refs_from_artifacts
    return ()


def _derive_source_truth_refs_from_artifacts(
    payload: Mapping[str, object],
) -> tuple[dict[str, object], ...]:
    artifacts = payload.get("artifacts")
    object_keys = payload.get("artifact_keys")
    candidate_keys: list[tuple[str, str]] = []
    if isinstance(artifacts, list):
        for item in artifacts:
            if not isinstance(item, dict):
                continue
            object_key = _text(item.get("objectKey")) or _text(item.get("object_key"))
            if not object_key:
                continue
            bucket = _text(item.get("bucket")) or _text(item.get("source_bucket"))
            candidate_keys.append((bucket, object_key))
    if isinstance(object_keys, list):
        for item in object_keys:
            object_key = _text(item)
            if object_key:
                candidate_keys.append(("", object_key))
    manifests: dict[tuple[str, str], dict[str, object]] = {}
    for bucket, key in candidate_keys:
        if not key.endswith("/source-truth/article-manifest.json"):
            continue
        prefix = key.rsplit("/source-truth/article-manifest.json", 1)[0]
        manifests[(bucket, prefix)] = {
            "bucket": bucket,
            "article_manifest_key": f"{prefix}/source-truth/article-manifest.json",
            "content_blocks_key": f"{prefix}/source-truth/content-blocks.jsonl",
            "media_refs_key": f"{prefix}/source-truth/media-refs.jsonl",
        }
    return tuple(manifests.values())


def _normalize_selection_ref(
    payload: Mapping[str, object],
    *,
    default_bucket: str,
) -> WeChatSourceTruthArtifactRefs:
    manifest_key = _text(payload.get("article_manifest_key")) or _text(
        payload.get("articleManifestKey")
    )
    content_blocks_key = _text(payload.get("content_blocks_key")) or _text(
        payload.get("contentBlocksKey")
    )
    media_refs_key = _text(payload.get("media_refs_key")) or _text(payload.get("mediaRefsKey"))
    object_key = _text(payload.get("object_key")) or _text(payload.get("objectKey"))
    if (
        not manifest_key
        and not content_blocks_key
        and not media_refs_key
        and object_key.endswith("/source-truth/article-manifest.json")
    ):
        prefix = object_key.rsplit("/source-truth/article-manifest.json", 1)[0]
        manifest_key = f"{prefix}/source-truth/article-manifest.json"
        content_blocks_key = f"{prefix}/source-truth/content-blocks.jsonl"
        media_refs_key = f"{prefix}/source-truth/media-refs.jsonl"
    return WeChatSourceTruthArtifactRefs(
        article_manifest_key=manifest_key,
        content_blocks_key=content_blocks_key,
        media_refs_key=media_refs_key,
        bucket=_text(payload.get("bucket")) or default_bucket,
    ).normalized(default_bucket=default_bucket)
