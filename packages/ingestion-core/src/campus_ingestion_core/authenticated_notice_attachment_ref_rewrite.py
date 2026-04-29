from __future__ import annotations

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, TextIO

from campus_ingestion_core.object_store import (
    SOURCE_PROVIDER_STAGE,
    SOURCE_TRUTH_STAGE,
    S3ObjectStoreClientFactory,
    parse_source_object_key,
)
from campus_ingestion_core.settings import ObjectStoreSettings


class AuthenticatedNoticeAttachmentRefRewriteObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None: ...

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]: ...


class AuthenticatedNoticeAttachmentRefRewriteS3ObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._factory = S3ObjectStoreClientFactory(settings)
        self._client = self._factory.create()

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        kwargs: dict[str, object] = {
            "Bucket": bucket,
            "Key": key,
            "Body": data,
            "ContentType": content_type,
        }
        if metadata:
            kwargs["Metadata"] = dict(metadata)
        self._client.put_object(**kwargs)

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        keys: list[str] = []
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys.extend(str(item["Key"]) for item in response.get("Contents") or ())
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
        return tuple(keys)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentRefRewriteRequest:
    referenced_inventory_path: Path
    output_dir: Path
    notice_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "referenced_inventory_path", Path(self.referenced_inventory_path))
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        object.__setattr__(
            self,
            "notice_ids",
            tuple(sorted({str(item).strip() for item in self.notice_ids if str(item).strip()})),
        )


@dataclass(frozen=True, slots=True)
class _InventoryRow:
    notice_id: str | None
    attachment_refs_key: str
    attachment_ref_id: str
    legacy_object_key: str
    canonical_object_key: str
    content_sha256: str


@dataclass(slots=True)
class _ArtifactRewriteDraft:
    attachment_refs_key: str
    notice_ids: set[str] = field(default_factory=set)
    inventory_rows: list[_InventoryRow] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _ArtifactRewriteCandidate:
    attachment_refs_key: str
    notice_ids: tuple[str, ...]
    inventory_rows: tuple[_InventoryRow, ...]


def rewrite_authenticated_notice_source_attachment_refs(
    *,
    request: AuthenticatedNoticeAttachmentRefRewriteRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeAttachmentRefRewriteObjectStore | None = None,
    max_concurrency: int = 8,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    if max_concurrency <= 0:
        raise ValueError("max_concurrency must be positive")
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or AuthenticatedNoticeAttachmentRefRewriteS3ObjectStore(
        settings
    )
    log_output = stderr if stderr is not None else sys.stderr
    candidates, selected_notice_ids, inventory_row_count = _load_candidates(request)
    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    rewritten_attachment_refs_path = output_dir / "rewritten-attachment-refs-artifacts.jsonl"
    rewritten_provider_path = output_dir / "rewritten-provider-artifacts.jsonl"
    summary_path = output_dir / "summary.json"

    if not candidates:
        summary = {
            "referenced_inventory_path": str(request.referenced_inventory_path),
            "output_dir": str(output_dir),
            "selected_notice_count": len(selected_notice_ids),
            "selected_notice_ids": list(selected_notice_ids),
            "inventory_row_count": inventory_row_count,
            "candidate_count": 0,
            "rewritten_attachment_ref_artifact_count": 0,
            "rewritten_attachment_ref_row_count": 0,
            "already_canonical_attachment_ref_row_count": 0,
            "rewritten_provider_artifact_count": 0,
            "rewritten_provider_row_count": 0,
            "already_canonical_provider_row_count": 0,
            "rewritten_attachment_refs_inventory_path": str(rewritten_attachment_refs_path),
            "rewritten_provider_inventory_path": str(rewritten_provider_path),
        }
        _write_jsonl(rewritten_attachment_refs_path, ())
        _write_jsonl(rewritten_provider_path, ())
        summary_path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return summary

    attachment_artifact_rows: list[dict[str, Any]] = []
    provider_artifact_rows: list[dict[str, Any]] = []
    rewritten_attachment_ref_row_count = 0
    already_canonical_attachment_ref_row_count = 0
    rewritten_provider_row_count = 0
    already_canonical_provider_row_count = 0
    completed = 0
    total = len(candidates)
    with ThreadPoolExecutor(
        max_workers=max_concurrency,
        thread_name_prefix="authenticated-notice-attachment-ref-rewrite",
    ) as executor:
        futures = {
            executor.submit(
                _process_candidate,
                candidate=candidate,
                bucket=settings.bucket_source,
                object_store=runtime_object_store,
            ): candidate.attachment_refs_key
            for candidate in candidates
        }
        for future in as_completed(futures):
            result = future.result()
            completed += 1
            attachment_summary = result["attachment_refs_artifact"]
            provider_summaries = result["provider_artifacts"]
            if attachment_summary["rewritten_row_count"] > 0:
                attachment_artifact_rows.append(attachment_summary)
            rewritten_attachment_ref_row_count += int(attachment_summary["rewritten_row_count"])
            already_canonical_attachment_ref_row_count += int(
                attachment_summary["already_canonical_row_count"]
            )
            for provider_summary in provider_summaries:
                if provider_summary["rewritten_row_count"] > 0:
                    provider_artifact_rows.append(provider_summary)
                rewritten_provider_row_count += int(provider_summary["rewritten_row_count"])
                already_canonical_provider_row_count += int(
                    provider_summary["already_canonical_row_count"]
                )
            if completed == total or completed % 25 == 0:
                print(
                    (
                        "[authenticated-notice-attachment-ref-rewrite] "
                        f"completed={completed}/{total} "
                        f"rewritten_attachment_ref_rows={rewritten_attachment_ref_row_count} "
                        f"rewritten_provider_rows={rewritten_provider_row_count}"
                    ),
                    file=log_output,
                )

    attachment_artifact_rows_sorted = sorted(
        attachment_artifact_rows,
        key=lambda row: str(row["artifact_key"]),
    )
    provider_artifact_rows_sorted = sorted(
        provider_artifact_rows,
        key=lambda row: str(row["artifact_key"]),
    )
    _write_jsonl(rewritten_attachment_refs_path, attachment_artifact_rows_sorted)
    _write_jsonl(rewritten_provider_path, provider_artifact_rows_sorted)
    summary = {
        "referenced_inventory_path": str(request.referenced_inventory_path),
        "output_dir": str(output_dir),
        "selected_notice_count": len(selected_notice_ids),
        "selected_notice_ids": list(selected_notice_ids),
        "inventory_row_count": inventory_row_count,
        "candidate_count": len(candidates),
        "rewritten_attachment_ref_artifact_count": len(attachment_artifact_rows_sorted),
        "rewritten_attachment_ref_row_count": rewritten_attachment_ref_row_count,
        "already_canonical_attachment_ref_row_count": already_canonical_attachment_ref_row_count,
        "rewritten_provider_artifact_count": len(provider_artifact_rows_sorted),
        "rewritten_provider_row_count": rewritten_provider_row_count,
        "already_canonical_provider_row_count": already_canonical_provider_row_count,
        "rewritten_attachment_refs_inventory_path": str(rewritten_attachment_refs_path),
        "rewritten_provider_inventory_path": str(rewritten_provider_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def _load_candidates(
    request: AuthenticatedNoticeAttachmentRefRewriteRequest,
) -> tuple[tuple[_ArtifactRewriteCandidate, ...], tuple[str, ...], int]:
    filter_notice_ids = set(request.notice_ids)
    drafts_by_attachment_refs_key: dict[str, _ArtifactRewriteDraft] = {}
    selected_notice_ids: set[str] = set()
    inventory_row_count = 0
    for row in _load_jsonl_rows(request.referenced_inventory_path):
        notice_id = _normalize_optional_text(row.get("notice_id"))
        if filter_notice_ids and notice_id not in filter_notice_ids:
            continue
        inventory_row_count += 1
        if notice_id is not None:
            selected_notice_ids.add(notice_id)
        inventory_row = _InventoryRow(
            notice_id=notice_id,
            attachment_refs_key=_required_text(
                row.get("attachment_refs_key"),
                label="attachment_refs_key",
            ),
            attachment_ref_id=_required_text(
                row.get("attachment_ref_id"),
                label="attachment_ref_id",
            ),
            legacy_object_key=_required_text(
                row.get("legacy_object_key"),
                label="legacy_object_key",
            ),
            canonical_object_key=_required_text(
                row.get("canonical_object_key"),
                label="canonical_object_key",
            ),
            content_sha256=_required_text(
                row.get("content_sha256"),
                label="content_sha256",
            ),
        )
        draft = drafts_by_attachment_refs_key.get(inventory_row.attachment_refs_key)
        if draft is None:
            draft = _ArtifactRewriteDraft(
                attachment_refs_key=inventory_row.attachment_refs_key,
            )
            drafts_by_attachment_refs_key[inventory_row.attachment_refs_key] = draft
        draft.inventory_rows.append(inventory_row)
        if notice_id is not None:
            draft.notice_ids.add(notice_id)
    candidates = tuple(
        sorted(
            (
                _ArtifactRewriteCandidate(
                    attachment_refs_key=draft.attachment_refs_key,
                    notice_ids=tuple(sorted(draft.notice_ids)),
                    inventory_rows=tuple(draft.inventory_rows),
                )
                for draft in drafts_by_attachment_refs_key.values()
            ),
            key=lambda item: item.attachment_refs_key,
        )
    )
    return candidates, tuple(sorted(selected_notice_ids)), inventory_row_count


def _process_candidate(
    *,
    candidate: _ArtifactRewriteCandidate,
    bucket: str,
    object_store: AuthenticatedNoticeAttachmentRefRewriteObjectStore,
) -> dict[str, Any]:
    attachment_rows = _load_jsonl_payload(
        object_store.get_bytes(bucket=bucket, key=candidate.attachment_refs_key)
    )
    rewritten_attachment_rows, attachment_summary, unique_mappings = _rewrite_attachment_rows(
        candidate=candidate,
        rows=attachment_rows,
    )
    if attachment_summary["rewritten_row_count"] > 0:
        object_store.put_bytes(
            bucket=bucket,
            key=candidate.attachment_refs_key,
            data=_jsonl_bytes(rewritten_attachment_rows),
            content_type="application/x-ndjson",
        )

    provider_keys = _discover_provider_artifact_keys(
        attachment_refs_key=candidate.attachment_refs_key,
        bucket=bucket,
        object_store=object_store,
    )
    if not provider_keys:
        raise FileNotFoundError(
            f"{candidate.attachment_refs_key} provider attachment-observations artifact not found"
        )

    provider_summaries: list[dict[str, Any]] = []
    matched_provider_mapping_keys: set[tuple[str, str, str]] = set()
    for provider_key in provider_keys:
        provider_rows = _load_jsonl_payload(object_store.get_bytes(bucket=bucket, key=provider_key))
        rewritten_provider_rows, provider_summary, matched_keys = _rewrite_provider_rows(
            artifact_key=provider_key,
            notice_ids=candidate.notice_ids,
            rows=provider_rows,
            unique_mappings=unique_mappings,
        )
        matched_provider_mapping_keys.update(matched_keys)
        if provider_summary["rewritten_row_count"] > 0:
            object_store.put_bytes(
                bucket=bucket,
                key=provider_key,
                data=_jsonl_bytes(rewritten_provider_rows),
                content_type="application/x-ndjson",
            )
        provider_summaries.append(provider_summary)

    missing_provider_matches = sorted(unique_mappings.keys() - matched_provider_mapping_keys)
    if missing_provider_matches:
        raise ValueError(
            f"{candidate.attachment_refs_key} provider attachment-observations rows missing for "
            f"{missing_provider_matches}"
        )

    return {
        "attachment_refs_artifact": attachment_summary,
        "provider_artifacts": provider_summaries,
    }


def _rewrite_attachment_rows(
    *,
    candidate: _ArtifactRewriteCandidate,
    rows: tuple[dict[str, Any], ...],
) -> tuple[tuple[dict[str, Any], ...], dict[str, Any], dict[tuple[str, str, str], _InventoryRow]]:
    mappings_by_ref_id = {row.attachment_ref_id: row for row in candidate.inventory_rows}
    seen_ref_ids: set[str] = set()
    rewritten_row_count = 0
    already_canonical_row_count = 0
    rewritten_rows: list[dict[str, Any]] = []
    unique_mappings: dict[tuple[str, str, str], _InventoryRow] = {}
    for row in rows:
        payload = dict(row)
        attachment_ref_id = _normalize_optional_text(payload.get("attachment_ref_id"))
        mapping = mappings_by_ref_id.get(attachment_ref_id or "")
        if mapping is None:
            rewritten_rows.append(payload)
            continue
        seen_ref_ids.add(mapping.attachment_ref_id)
        current_key = _normalize_optional_text(payload.get("object_key"))
        current_sha256 = _normalize_optional_text(payload.get("content_sha256"))
        if current_sha256 is not None and current_sha256 != mapping.content_sha256:
            raise ValueError(
                f"{candidate.attachment_refs_key}#{mapping.attachment_ref_id} content_sha256 mismatch: "
                f"{current_sha256} != {mapping.content_sha256}"
            )
        if current_key == mapping.legacy_object_key:
            payload["object_key"] = mapping.canonical_object_key
            rewritten_row_count += 1
        elif current_key == mapping.canonical_object_key:
            already_canonical_row_count += 1
        else:
            raise ValueError(
                f"{candidate.attachment_refs_key}#{mapping.attachment_ref_id} unexpected object_key: "
                f"{current_key!r}"
            )
        unique_mappings[
            (mapping.legacy_object_key, mapping.canonical_object_key, mapping.content_sha256)
        ] = mapping
        rewritten_rows.append(payload)
    missing_ref_ids = sorted(set(mappings_by_ref_id) - seen_ref_ids)
    if missing_ref_ids:
        raise ValueError(
            f"{candidate.attachment_refs_key} missing attachment_ref_ids: {missing_ref_ids}"
        )
    summary = {
        "artifact_key": candidate.attachment_refs_key,
        "notice_ids": list(candidate.notice_ids),
        "targeted_row_count": len(mappings_by_ref_id),
        "rewritten_row_count": rewritten_row_count,
        "already_canonical_row_count": already_canonical_row_count,
    }
    return tuple(rewritten_rows), summary, unique_mappings


def _rewrite_provider_rows(
    *,
    artifact_key: str,
    notice_ids: tuple[str, ...],
    rows: tuple[dict[str, Any], ...],
    unique_mappings: dict[tuple[str, str, str], _InventoryRow],
) -> tuple[tuple[dict[str, Any], ...], dict[str, Any], set[tuple[str, str, str]]]:
    rewritten_row_count = 0
    already_canonical_row_count = 0
    rewritten_rows: list[dict[str, Any]] = []
    matched_mapping_keys: set[tuple[str, str, str]] = set()
    for row in rows:
        payload = dict(row)
        current_key = _normalize_optional_text(payload.get("object_key"))
        current_sha256 = _normalize_optional_text(payload.get("content_sha256"))
        matched_mapping_key: tuple[str, str, str] | None = None
        rewrite_state: str | None = None
        for mapping_key, mapping in unique_mappings.items():
            if current_sha256 is not None and current_sha256 != mapping.content_sha256:
                continue
            if current_key == mapping.legacy_object_key:
                matched_mapping_key = mapping_key
                rewrite_state = "rewrite"
                break
            if current_key == mapping.canonical_object_key:
                matched_mapping_key = mapping_key
                rewrite_state = "already_canonical"
                break
        if matched_mapping_key is not None:
            matched_mapping_keys.add(matched_mapping_key)
            mapping = unique_mappings[matched_mapping_key]
            if rewrite_state == "rewrite":
                payload["object_key"] = mapping.canonical_object_key
                rewritten_row_count += 1
            else:
                already_canonical_row_count += 1
        rewritten_rows.append(payload)
    summary = {
        "artifact_key": artifact_key,
        "notice_ids": list(notice_ids),
        "targeted_row_count": len(matched_mapping_keys),
        "rewritten_row_count": rewritten_row_count,
        "already_canonical_row_count": already_canonical_row_count,
    }
    return tuple(rewritten_rows), summary, matched_mapping_keys


def _discover_provider_artifact_keys(
    *,
    attachment_refs_key: str,
    bucket: str,
    object_store: AuthenticatedNoticeAttachmentRefRewriteObjectStore,
) -> tuple[str, ...]:
    parsed = parse_source_object_key(attachment_refs_key)
    if (
        parsed is None
        or parsed.get("stage") != SOURCE_TRUTH_STAGE
        or parsed.get("filename") != "attachment-refs.jsonl"
    ):
        raise ValueError(f"invalid attachment refs artifact key: {attachment_refs_key}")
    raw_version_segments = parsed.get("raw_version_segments")
    if not isinstance(raw_version_segments, tuple):
        raise ValueError(f"invalid raw_version_segments in artifact key: {attachment_refs_key}")
    prefix = (
        "/".join(
            [
                str(parsed["source_channel"]),
                str(parsed["source_asset_slug"]),
                str(parsed["year"]),
                *[str(segment) for segment in raw_version_segments],
                SOURCE_PROVIDER_STAGE,
            ]
        )
        + "/"
    )
    provider_keys = []
    for key in object_store.list_keys(bucket=bucket, prefix=prefix):
        parsed_provider = parse_source_object_key(key)
        if (
            parsed_provider is not None
            and parsed_provider.get("stage") == SOURCE_PROVIDER_STAGE
            and parsed_provider.get("filename") == "attachment-observations.jsonl"
        ):
            provider_keys.append(key)
    return tuple(sorted(provider_keys))


def _load_jsonl_rows(path: Path) -> tuple[dict[str, Any], ...]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return ()
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        payload = json.loads(normalized)
        if not isinstance(payload, dict):
            raise ValueError(f"inventory row must be an object: {normalized}")
        rows.append(dict(payload))
    return tuple(rows)


def _load_jsonl_payload(payload: bytes) -> tuple[dict[str, Any], ...]:
    text = payload.decode("utf-8").strip()
    if not text:
        return ()
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        value = json.loads(normalized)
        if not isinstance(value, dict):
            raise ValueError(f"artifact row must be an object: {normalized}")
        rows.append(dict(value))
    return tuple(rows)


def _jsonl_bytes(rows: tuple[dict[str, Any], ...] | list[dict[str, Any]]) -> bytes:
    if not rows:
        return b""
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows).strip() + "\n").encode(
        "utf-8"
    )


def _write_jsonl(path: Path, rows: tuple[dict[str, Any], ...] | list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _required_text(value: object, *, label: str) -> str:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    return normalized


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


__all__ = [
    "AuthenticatedNoticeAttachmentRefRewriteRequest",
    "AuthenticatedNoticeAttachmentRefRewriteS3ObjectStore",
    "rewrite_authenticated_notice_source_attachment_refs",
]
