from __future__ import annotations

import json
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

FINDING_HIGH = "high"
FINDING_MEDIUM = "medium"
FINDING_LOW = "low"

_FETCH_POLICIES = {
    "fetch_to_quarantine",
    "fetch_required_for_source_truth",
    "fetch_required_for_admitted_owner",
}


def candidate_has_source_object_ref(candidate: Mapping[str, Any]) -> bool:
    source_ref = candidate.get("source_object_ref")
    if not isinstance(source_ref, Mapping):
        return False
    return bool(
        str(source_ref.get("bucket") or "").strip() and str(source_ref.get("key") or "").strip()
    )


def candidate_source_ref_matches_attachment(
    *,
    source_object_ref: Mapping[str, Any],
    attachment: Mapping[str, Any],
) -> bool:
    if not has_object_bytes(attachment):
        return False
    source_key = str(source_object_ref.get("key") or "").strip()
    attachment_key = str(attachment.get("object_key") or "").strip()
    if not source_key or source_key != attachment_key:
        return False
    source_bucket = str(source_object_ref.get("bucket") or "").strip()
    attachment_bucket = str(attachment.get("bucket") or "").strip()
    return not attachment_bucket or source_bucket == attachment_bucket


def candidates_for_attachment(
    candidates: Sequence[Mapping[str, Any]],
    *,
    attachment_ref_id: str,
    single_attachment: bool,
) -> tuple[Mapping[str, Any], ...]:
    rows: list[Mapping[str, Any]] = []
    for candidate in candidates:
        media_ref_id = candidate_media_ref_id(candidate)
        if media_ref_id == attachment_ref_id or (single_attachment and not media_ref_id):
            rows.append(candidate)
    return tuple(rows)


def candidate_media_ref_id(candidate: Mapping[str, Any]) -> str:
    for key in ("media_ref_id", "attachment_ref_id"):
        value = str(candidate.get(key) or "").strip()
        if value:
            return value
    attachment_ref = candidate.get("attachment_ref")
    if isinstance(attachment_ref, Mapping):
        return str(attachment_ref.get("attachment_ref_id") or "").strip()
    return ""


def fetch_manifest_findings(
    requests: Sequence[Mapping[str, Any]],
    *,
    source_ref_index: Mapping[tuple[str, str, str], Mapping[str, Any]],
) -> tuple[dict[str, Any], ...]:
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for request in requests:
        site_id = str(request.get("site_id") or "")
        notice_id = str(request.get("notice_id") or "")
        ref_id = str(request.get("attachment_ref_id") or "")
        key = (site_id, notice_id, ref_id)
        if key in seen:
            findings.append(
                finding(
                    severity=FINDING_MEDIUM,
                    code="duplicate_fetch_request",
                    source_notice_id=notice_id,
                    attachment_ref_id=ref_id,
                    title="",
                    detail="fetch request manifest contains duplicate attachment request",
                )
            )
        seen.add(key)
        policy = str(request.get("attachment_capture_policy") or "")
        source_ref = source_ref_for_request(
            source_ref_index,
            site_id=site_id,
            notice_id=notice_id,
            attachment_ref_id=ref_id,
        )
        source_policy = str((source_ref or {}).get("attachment_capture_policy") or "")
        source_is_terminal = source_ref is not None and (
            is_terminal_unavailable_attachment(source_ref)
            or is_skip_terminal_attachment(source_ref)
        )
        if (
            str(request.get("attachment_capture_state") or "") == "terminal_missing"
            or str(request.get("terminal_reason") or "").strip()
            or str(request.get("last_error_class") or "") == "terminal_unavailable"
            or policy == "terminal_unavailable"
            or source_is_terminal
        ):
            findings.append(
                finding(
                    severity=FINDING_HIGH,
                    code="fetch_request_for_terminal_attachment",
                    source_notice_id=notice_id,
                    attachment_ref_id=ref_id,
                    title="",
                    detail="fetch request manifest must not request terminal_unavailable attachments",
                )
            )
        if source_ref is not None and not source_is_terminal and source_policy != policy:
            findings.append(
                finding(
                    severity=FINDING_HIGH,
                    code="fetch_request_source_ref_policy_mismatch",
                    source_notice_id=notice_id,
                    attachment_ref_id=ref_id,
                    title="",
                    detail=(
                        "fetch request policy must match the canonical source-truth attachment ref"
                    ),
                )
            )
        if policy not in _FETCH_POLICIES:
            findings.append(
                finding(
                    severity=FINDING_HIGH,
                    code="non_fetch_policy_in_manifest",
                    source_notice_id=notice_id,
                    attachment_ref_id=ref_id,
                    title="",
                    detail="fetch request manifest contains a non-fetch policy",
                )
            )
    return tuple(findings)


def fetch_request_keys(
    requests: Sequence[Mapping[str, Any]],
) -> set[tuple[str, str, str]]:
    return {
        (
            str(request.get("site_id") or ""),
            str(request.get("notice_id") or ""),
            str(request.get("attachment_ref_id") or ""),
        )
        for request in requests
        if str(request.get("notice_id") or "") and str(request.get("attachment_ref_id") or "")
    }


def source_attachment_ref_index(
    units: Sequence[Mapping[str, Any]],
) -> dict[tuple[str, str, str], Mapping[str, Any]]:
    index: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    for unit in units:
        site_id = str(unit.get("site_id") or "")
        notice_id = str(unit.get("source_notice_id") or "")
        if not notice_id:
            continue
        for attachment_ref in mapping_rows(unit.get("attachment_refs")):
            ref_id = str(attachment_ref.get("attachment_ref_id") or "")
            if ref_id:
                index[(site_id, notice_id, ref_id)] = attachment_ref
                index.setdefault(("", notice_id, ref_id), attachment_ref)
    return index


def source_ref_for_request(
    source_ref_index: Mapping[tuple[str, str, str], Mapping[str, Any]],
    *,
    site_id: str,
    notice_id: str,
    attachment_ref_id: str,
) -> Mapping[str, Any] | None:
    return source_ref_index.get((site_id, notice_id, attachment_ref_id)) or source_ref_index.get(
        ("", notice_id, attachment_ref_id)
    )


def has_fetch_request(
    fetch_request_keys: set[tuple[str, str, str]],
    *,
    site_id: str,
    notice_id: str,
    attachment_ref_id: str,
) -> bool:
    return (site_id, notice_id, attachment_ref_id) in fetch_request_keys or (
        "",
        notice_id,
        attachment_ref_id,
    ) in fetch_request_keys


def finding(
    *,
    severity: str,
    code: str,
    source_notice_id: str,
    title: str,
    detail: str,
    attachment_ref_id: str | None = None,
    candidate_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "severity": severity,
        "code": code,
        "source_notice_id": source_notice_id,
        "title": title,
        "detail": detail,
    }
    if attachment_ref_id:
        payload["attachment_ref_id"] = attachment_ref_id
    if candidate_id:
        payload["candidate_id"] = candidate_id
    return payload


def has_object_bytes(attachment: Mapping[str, Any]) -> bool:
    return bool(
        str(attachment.get("object_key") or "").strip()
        and str(attachment.get("content_sha256") or attachment.get("sha256") or "").strip()
        and str(attachment.get("storage_provider") or "").strip() != "reference_only"
        and str(attachment.get("ingest_status") or "").strip() in {"downloaded", "uploaded"}
    )


def is_terminal_unavailable_attachment(attachment: Mapping[str, Any]) -> bool:
    return (
        str(attachment.get("attachment_capture_policy") or "") == "terminal_unavailable"
        or str(attachment.get("attachment_capture_state") or "") == "terminal_missing"
        or str(attachment.get("last_error_class") or "") == "terminal_unavailable"
        or bool(str(attachment.get("terminal_reason") or "").strip())
    )


def is_skip_terminal_attachment(attachment: Mapping[str, Any]) -> bool:
    return str(attachment.get("attachment_capture_policy") or "") in {
        "skip_unsupported",
        "skip_too_large",
    }


def candidates_by_unit_id(
    candidates: Sequence[Mapping[str, Any]],
) -> dict[str, tuple[Mapping[str, Any], ...]]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        grouped[str(candidate.get("unit_id") or "")].append(candidate)
    return {key: tuple(value) for key, value in grouped.items()}


def mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    return tuple(row for row in value or () if isinstance(row, Mapping))


def load_json_object(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def count_by(rows: Sequence[Mapping[str, Any]], key: str) -> dict[str, int]:
    return dict(sorted(Counter(str(row.get(key) or "") for row in rows).items()))


def sum_nested_counts(values: Sequence[object]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for value in values:
        if not isinstance(value, Mapping):
            continue
        for key, count in value.items():
            counts[str(key)] += int(count or 0)
    return dict(sorted(counts.items()))


def severity_rank(severity: str) -> int:
    return {FINDING_HIGH: 0, FINDING_MEDIUM: 1, FINDING_LOW: 2}.get(severity, 3)


def has_medium_or_high(findings: Sequence[Mapping[str, Any]]) -> bool:
    return any(
        str(item.get("severity") or "") in {FINDING_HIGH, FINDING_MEDIUM} for item in findings
    )


__all__ = [
    "candidate_has_source_object_ref",
    "candidate_media_ref_id",
    "candidate_source_ref_matches_attachment",
    "candidates_by_unit_id",
    "candidates_for_attachment",
    "count_by",
    "fetch_manifest_findings",
    "fetch_request_keys",
    "finding",
    "has_fetch_request",
    "has_medium_or_high",
    "has_object_bytes",
    "is_terminal_unavailable_attachment",
    "load_json_object",
    "mapping_rows",
    "severity_rank",
    "source_attachment_ref_index",
    "sum_nested_counts",
]
