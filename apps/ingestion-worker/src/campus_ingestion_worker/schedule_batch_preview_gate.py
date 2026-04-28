from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "schedule_batch_preview_gate.v1"

BUCKET_AUTO_STAGE = "auto_stage_candidate"
BUCKET_MANUAL_REVIEW = "manual_review"
BUCKET_GUIDE_ADJACENT_SPLIT = "guide_adjacent_split"
BUCKET_OPERATIONAL_ONLY = "operational_only"
BUCKET_ALREADY_STAGED = "already_staged"
BUCKET_RESTAGE_NEEDED = "restage_needed"
BUCKET_BLOCKED = "blocked"

_BUCKETS = (
    BUCKET_AUTO_STAGE,
    BUCKET_MANUAL_REVIEW,
    BUCKET_GUIDE_ADJACENT_SPLIT,
    BUCKET_OPERATIONAL_ONLY,
    BUCKET_ALREADY_STAGED,
    BUCKET_RESTAGE_NEEDED,
    BUCKET_BLOCKED,
)
_SELECTION_FILE_BY_BUCKET = {
    BUCKET_AUTO_STAGE: "auto-stage-candidate-selection.json",
    BUCKET_MANUAL_REVIEW: "manual-review-selection.json",
    BUCKET_GUIDE_ADJACENT_SPLIT: "guide-adjacent-split-selection.json",
    BUCKET_OPERATIONAL_ONLY: "operational-only-selection.json",
    BUCKET_RESTAGE_NEEDED: "restage-needed-selection.json",
    BUCKET_BLOCKED: "blocked-selection.json",
}

_CANDIDATE_RE = re.compile(r"^-\s+`(?P<notice_id>[^`]+)`\s+\|\s+`(?P<release_time>[^`]+)`")
_KIND_RE = re.compile(r"^\s*`(?P<kind>[^`]+)`\s*$")
_LEDGER_ROW_RE = re.compile(
    r"^\|\s*`(?P<notice_id>[^`]+)`\s*\|\s*[^|]+\|\s*(?P<kind>[^|]+)\|\s*(?P<state>[^|]+)\|"
)
_ATTACHMENT_IMAGE_RE = re.compile(r"附件\s*/\s*图片：`?(?P<attachments>\d+)\s*/\s*(?P<images>\d+)")
_OPEN_ENDED_SUSPENSION_HINTS = ("本学期", "本年度", "长期", "即日起")
_SUSPENSION_HINTS = ("暂停", "停运", "停止运营", "不运行")


@dataclass(frozen=True, slots=True)
class ScheduleBatchCandidate:
    notice_id: str
    release_time: str
    candidate_kind: str
    title: str = ""
    organization: str = ""
    attachment_count: int = 0
    image_count: int = 0
    has_guide_adjacent_fields: bool = False
    consumption_state: str = ""


@dataclass(frozen=True, slots=True)
class _NoticeOcrEvidence:
    image_count: int = 0
    extractable_schedule_table_count: int = 0
    mixed_schedule_and_guide_count: int = 0
    low_confidence_count: int = 0
    confidence_counts: Mapping[str, int] | None = None
    classification_counts: Mapping[str, int] | None = None


@dataclass(frozen=True, slots=True)
class _NoticeRouterEvidence:
    route_count: int = 0
    body_schedule_count: int = 0
    image_schedule_table_count: int = 0
    visual_or_guide_count: int = 0
    needs_review_count: int = 0
    action_counts: Mapping[str, int] | None = None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a no-write schedule notice batch preview gate report."
    )
    parser.add_argument("--selection-path", required=True)
    parser.add_argument("--ledger-path", required=True)
    parser.add_argument("--ocr-summary-path", required=True)
    parser.add_argument("--router-report-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--generated-at")
    parser.add_argument(
        "--restage-notice-id",
        action="append",
        default=[],
        help="Already staged notice id that must be staged again before an approved release.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    selection_path = Path(args.selection_path)
    ledger_path = Path(args.ledger_path)
    ocr_summary_path = Path(args.ocr_summary_path)
    router_report_path = Path(args.router_report_path)
    output_dir = Path(args.output_dir)
    report = build_schedule_batch_preview_gate_report(
        selection_markdown=selection_path.read_text(encoding="utf-8"),
        ledger_markdown=ledger_path.read_text(encoding="utf-8"),
        ocr_summary_payload=_read_json(ocr_summary_path),
        router_report_payload=_read_json(router_report_path),
        run_id=str(args.run_id),
        generated_at=str(args.generated_at or _default_generated_at()),
        selection_path=str(selection_path),
        ledger_path=str(ledger_path),
        ocr_summary_path=str(ocr_summary_path),
        router_report_path=str(router_report_path),
        restage_notice_ids=tuple(args.restage_notice_id or ()),
    )
    write_schedule_batch_preview_gate_outputs(output_dir=output_dir, report=report)
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2, sort_keys=True))


def build_schedule_batch_preview_gate_report(
    *,
    selection_markdown: str,
    ledger_markdown: str,
    ocr_summary_payload: Mapping[str, Any],
    router_report_payload: Mapping[str, Any],
    run_id: str,
    generated_at: str,
    selection_path: str = "",
    ledger_path: str = "",
    ocr_summary_path: str = "",
    router_report_path: str = "",
    restage_notice_ids: Sequence[str] = (),
) -> dict[str, Any]:
    candidates = parse_schedule_batch_selection_markdown(selection_markdown)
    ledger_states = parse_schedule_consumption_ledger_states(ledger_markdown)
    ocr_by_notice = _ocr_evidence_by_notice(ocr_summary_payload)
    router_by_notice = _router_evidence_by_notice(router_report_payload)
    restage_set = {str(item).strip() for item in restage_notice_ids if str(item).strip()}

    items: list[dict[str, Any]] = []
    for candidate in candidates:
        state = ledger_states.get(candidate.notice_id, candidate.consumption_state)
        item = _classify_candidate(
            candidate=ScheduleBatchCandidate(
                **{
                    **asdict(candidate),
                    "consumption_state": state,
                }
            ),
            ocr_evidence=ocr_by_notice.get(candidate.notice_id, _NoticeOcrEvidence()),
            router_evidence=router_by_notice.get(candidate.notice_id, _NoticeRouterEvidence()),
            restage_notice_ids=restage_set,
        )
        items.append(item)

    buckets = {bucket: [] for bucket in _BUCKETS}
    for item in items:
        buckets[str(item["bucket"])].append(str(item["notice_id"]))
    bucket_counts = {bucket: len(ids) for bucket, ids in buckets.items()}
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": str(run_id),
        "generated_at": str(generated_at),
        "remote_write_status": "not_written_pg_or_object_storage",
        "inputs": {
            "selection_path": selection_path,
            "ledger_path": ledger_path,
            "ocr_summary_path": ocr_summary_path,
            "router_report_path": router_report_path,
        },
        "summary": {
            "candidate_count": len(items),
            "bucket_counts": bucket_counts,
            "auto_stage_candidate_count": bucket_counts[BUCKET_AUTO_STAGE],
            "manual_review_count": bucket_counts[BUCKET_MANUAL_REVIEW],
            "guide_adjacent_split_count": bucket_counts[BUCKET_GUIDE_ADJACENT_SPLIT],
            "operational_only_count": bucket_counts[BUCKET_OPERATIONAL_ONLY],
            "already_staged_count": bucket_counts[BUCKET_ALREADY_STAGED],
            "restage_needed_count": bucket_counts[BUCKET_RESTAGE_NEEDED],
            "blocked_count": bucket_counts[BUCKET_BLOCKED],
        },
        "buckets": buckets,
        "items": items,
    }


def parse_schedule_batch_selection_markdown(markdown: str) -> tuple[ScheduleBatchCandidate, ...]:
    candidates: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in markdown.splitlines():
        candidate_match = _CANDIDATE_RE.match(line)
        if candidate_match:
            if current is not None:
                candidates.append(current)
            current = {
                "notice_id": candidate_match.group("notice_id").strip(),
                "release_time": candidate_match.group("release_time").strip(),
                "candidate_kind": "",
                "title": "",
                "organization": "",
                "attachment_count": 0,
                "image_count": 0,
                "has_guide_adjacent_fields": False,
                "consumption_state": "",
            }
            continue
        if current is None:
            continue
        kind_match = _KIND_RE.match(line)
        if kind_match and not current["candidate_kind"]:
            current["candidate_kind"] = kind_match.group("kind").strip()
            continue
        stripped = line.strip()
        if stripped.startswith("- 标题："):
            current["title"] = stripped.removeprefix("- 标题：").strip()
            continue
        if stripped.startswith("- 来源部门："):
            current["organization"] = stripped.removeprefix("- 来源部门：").strip()
            continue
        attachment_match = _ATTACHMENT_IMAGE_RE.search(stripped)
        if attachment_match:
            current["attachment_count"] = int(attachment_match.group("attachments"))
            current["image_count"] = int(attachment_match.group("images"))
        if "guide-adjacent" in stripped or "预约" in stripped or "扫码" in stripped:
            current["has_guide_adjacent_fields"] = True
    if current is not None:
        candidates.append(current)
    return tuple(
        ScheduleBatchCandidate(
            notice_id=str(item["notice_id"]),
            release_time=str(item["release_time"]),
            candidate_kind=str(item["candidate_kind"]),
            title=str(item["title"]),
            organization=str(item["organization"]),
            attachment_count=int(item["attachment_count"]),
            image_count=int(item["image_count"]),
            has_guide_adjacent_fields=bool(item["has_guide_adjacent_fields"]),
            consumption_state=str(item["consumption_state"]),
        )
        for item in candidates
        if str(item.get("notice_id") or "").strip()
    )


def parse_schedule_consumption_ledger_states(markdown: str) -> dict[str, str]:
    states: dict[str, str] = {}
    for line in markdown.splitlines():
        match = _LEDGER_ROW_RE.match(line)
        if not match:
            continue
        notice_id = match.group("notice_id").strip()
        state = _clean_table_cell(match.group("state"))
        if notice_id and state:
            states[notice_id] = state
    return states


def write_schedule_batch_preview_gate_outputs(
    *, output_dir: Path, report: Mapping[str, Any]
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "schedule-batch-preview-gate.json", report)
    (output_dir / "README.md").write_text(
        render_schedule_batch_preview_gate_markdown(report),
        encoding="utf-8",
    )
    buckets = dict(report.get("buckets") or {})
    for bucket, filename in _SELECTION_FILE_BY_BUCKET.items():
        _write_json(
            output_dir / filename,
            {"selected_notice_ids": [str(item) for item in buckets.get(bucket, [])]},
        )


def render_schedule_batch_preview_gate_markdown(report: Mapping[str, Any]) -> str:
    summary = dict(report.get("summary") or {})
    lines = [
        "---",
        "doc_type: operator-report",
        "status: generated",
        f"created: {report.get('generated_at') or ''!s}",
        "---",
        "",
        "# Schedule Batch Preview Gate",
        "",
        f"- Run id: `{report.get('run_id') or ''!s}`",
        f"- Remote write status: `{report.get('remote_write_status') or ''!s}`",
        f"- Candidate count: `{int(summary.get('candidate_count') or 0)}`",
        "",
        "## Bucket Counts",
        "",
        "| Bucket | Count |",
        "| --- | ---: |",
    ]
    bucket_counts = dict(summary.get("bucket_counts") or {})
    for bucket in _BUCKETS:
        lines.append(f"| `{bucket}` | {int(bucket_counts.get(bucket) or 0)} |")
    lines.extend(
        [
            "",
            "## Items",
            "",
            "<!-- markdownlint-disable MD013 -->",
            "",
            "| Notice id | Bucket | Candidate kind | State | Reasons |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    for item in list(report.get("items") or ()):
        row = dict(item)
        reasons = ", ".join(str(code) for code in row.get("reason_codes") or ())
        lines.append(
            "| "
            f"`{row.get('notice_id') or ''!s}` | "
            f"`{row.get('bucket') or ''!s}` | "
            f"`{row.get('candidate_kind') or ''!s}` | "
            f"{row.get('consumption_state') or ''!s} | "
            f"{reasons} |"
        )
    lines.extend(["", "<!-- markdownlint-enable MD013 -->"])
    return "\n".join(lines) + "\n"


def _classify_candidate(
    *,
    candidate: ScheduleBatchCandidate,
    ocr_evidence: _NoticeOcrEvidence,
    router_evidence: _NoticeRouterEvidence,
    restage_notice_ids: set[str],
) -> dict[str, Any]:
    reason_codes: list[str] = []
    if candidate.has_guide_adjacent_fields:
        reason_codes.append("guide_adjacent_fields_present")
    if ocr_evidence.low_confidence_count:
        reason_codes.append("low_confidence_ocr")
    if ocr_evidence.mixed_schedule_and_guide_count:
        reason_codes.append("mixed_schedule_and_guide_ocr")
    if router_evidence.visual_or_guide_count:
        reason_codes.append("router_visual_or_guide_image")
    if router_evidence.needs_review_count:
        reason_codes.append("router_needs_review")

    normalized_state = candidate.consumption_state.strip().lower()
    if candidate.notice_id in restage_notice_ids:
        bucket = BUCKET_RESTAGE_NEEDED
        reason_codes.append("explicit_restage_required")
    elif normalized_state == "staged selected release":
        bucket = BUCKET_ALREADY_STAGED
        reason_codes.append("already_staged_selected_release")
    elif candidate.candidate_kind == "operational_notice_candidate":
        bucket = BUCKET_OPERATIONAL_ONLY
        reason_codes.append("operational_notice_candidate")
    elif candidate.candidate_kind == "schedule_review_candidate":
        bucket = BUCKET_MANUAL_REVIEW
        reason_codes.append("schedule_review_candidate")
    elif candidate.candidate_kind != "schedule_or_overlay_candidate":
        bucket = BUCKET_BLOCKED
        reason_codes.append("unsupported_candidate_kind")
    elif _is_open_ended_suspension_notice(candidate) and not _has_structured_schedule_evidence(
        ocr_evidence=ocr_evidence,
        router_evidence=router_evidence,
    ):
        bucket = BUCKET_OPERATIONAL_ONLY
        reason_codes.append("open_ended_suspension_notice")
    elif (
        candidate.has_guide_adjacent_fields
        or ocr_evidence.mixed_schedule_and_guide_count
        or router_evidence.visual_or_guide_count
    ):
        bucket = BUCKET_GUIDE_ADJACENT_SPLIT
    elif ocr_evidence.low_confidence_count or router_evidence.needs_review_count:
        bucket = BUCKET_MANUAL_REVIEW
    elif _requires_non_image_attachment_processing(
        candidate=candidate,
        ocr_evidence=ocr_evidence,
        router_evidence=router_evidence,
    ):
        bucket = BUCKET_MANUAL_REVIEW
        reason_codes.append("non_image_attachment_requires_pdf_processing")
    elif _has_sufficient_preview_evidence(
        candidate=candidate,
        ocr_evidence=ocr_evidence,
        router_evidence=router_evidence,
    ):
        bucket = BUCKET_AUTO_STAGE
        reason_codes.append("passes_no_write_preview_gate")
    else:
        bucket = BUCKET_MANUAL_REVIEW
        reason_codes.append("missing_extractable_schedule_evidence")

    return {
        "notice_id": candidate.notice_id,
        "bucket": bucket,
        "candidate_kind": candidate.candidate_kind,
        "consumption_state": candidate.consumption_state,
        "release_time": candidate.release_time,
        "title": candidate.title,
        "organization": candidate.organization,
        "attachment_count": candidate.attachment_count,
        "image_count": candidate.image_count,
        "has_guide_adjacent_fields": candidate.has_guide_adjacent_fields,
        "ocr": {
            "image_count": ocr_evidence.image_count,
            "extractable_schedule_table_count": ocr_evidence.extractable_schedule_table_count,
            "mixed_schedule_and_guide_count": ocr_evidence.mixed_schedule_and_guide_count,
            "low_confidence_count": ocr_evidence.low_confidence_count,
            "confidence_counts": dict(ocr_evidence.confidence_counts or {}),
            "classification_counts": dict(ocr_evidence.classification_counts or {}),
        },
        "router": {
            "route_count": router_evidence.route_count,
            "body_schedule_count": router_evidence.body_schedule_count,
            "image_schedule_table_count": router_evidence.image_schedule_table_count,
            "visual_or_guide_count": router_evidence.visual_or_guide_count,
            "needs_review_count": router_evidence.needs_review_count,
            "action_counts": dict(router_evidence.action_counts or {}),
        },
        "reason_codes": tuple(dict.fromkeys(reason_codes)),
    }


def _has_sufficient_preview_evidence(
    *,
    candidate: ScheduleBatchCandidate,
    ocr_evidence: _NoticeOcrEvidence,
    router_evidence: _NoticeRouterEvidence,
) -> bool:
    if candidate.image_count <= 0:
        return True
    return (
        ocr_evidence.extractable_schedule_table_count > 0
        or router_evidence.body_schedule_count > 0
        or router_evidence.image_schedule_table_count >= candidate.image_count
    )


def _has_structured_schedule_evidence(
    *,
    ocr_evidence: _NoticeOcrEvidence,
    router_evidence: _NoticeRouterEvidence,
) -> bool:
    return (
        ocr_evidence.extractable_schedule_table_count > 0
        or router_evidence.body_schedule_count > 0
        or router_evidence.image_schedule_table_count > 0
    )


def _requires_non_image_attachment_processing(
    *,
    candidate: ScheduleBatchCandidate,
    ocr_evidence: _NoticeOcrEvidence,
    router_evidence: _NoticeRouterEvidence,
) -> bool:
    return (
        candidate.attachment_count > 0
        and candidate.image_count == 0
        and not _has_structured_schedule_evidence(
            ocr_evidence=ocr_evidence,
            router_evidence=router_evidence,
        )
    )


def _is_open_ended_suspension_notice(candidate: ScheduleBatchCandidate) -> bool:
    title = candidate.title
    return any(hint in title for hint in _SUSPENSION_HINTS) and any(
        hint in title for hint in _OPEN_ENDED_SUSPENSION_HINTS
    )


def _ocr_evidence_by_notice(payload: Mapping[str, Any]) -> dict[str, _NoticeOcrEvidence]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for item in _list_of_mappings(payload.get("items")):
        notice_id = str(item.get("notice_id") or "").strip()
        if notice_id:
            grouped[notice_id].append(item)
    result: dict[str, _NoticeOcrEvidence] = {}
    for notice_id, rows in grouped.items():
        classifications = Counter(str(row.get("classification") or "").strip() for row in rows)
        confidences = Counter(str(row.get("confidence") or "").strip() for row in rows)
        result[notice_id] = _NoticeOcrEvidence(
            image_count=len(rows),
            extractable_schedule_table_count=classifications.get("extractable_schedule_table", 0),
            mixed_schedule_and_guide_count=classifications.get("mixed_schedule_and_guide", 0),
            low_confidence_count=confidences.get("low", 0)
            + classifications.get("low_confidence", 0),
            confidence_counts=dict(
                sorted((key, value) for key, value in confidences.items() if key)
            ),
            classification_counts=dict(
                sorted((key, value) for key, value in classifications.items() if key)
            ),
        )
    return result


def _router_evidence_by_notice(payload: Mapping[str, Any]) -> dict[str, _NoticeRouterEvidence]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for item in _list_of_mappings(payload.get("routes")):
        notice_id = str(item.get("notice_id") or "").strip()
        if notice_id:
            grouped[notice_id].append(item)
    result: dict[str, _NoticeRouterEvidence] = {}
    for notice_id, rows in grouped.items():
        actions = Counter(str(row.get("image_action") or "").strip() for row in rows)
        scopes = Counter(str(row.get("notice_scope") or "").strip() for row in rows)
        result[notice_id] = _NoticeRouterEvidence(
            route_count=len(rows),
            body_schedule_count=actions.get("body_schedule", 0),
            image_schedule_table_count=actions.get("image_schedule_table", 0),
            visual_or_guide_count=actions.get("visual_or_guide", 0),
            needs_review_count=actions.get("needs_review", 0) + scopes.get("needs_review", 0),
            action_counts=dict(sorted((key, value) for key, value in actions.items() if key)),
        )
    return result


def _list_of_mappings(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(dict(item) for item in value if isinstance(item, Mapping))


def _clean_table_cell(value: str) -> str:
    return value.strip().strip("`").strip()


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _default_generated_at() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


__all__ = [
    "BUCKET_ALREADY_STAGED",
    "BUCKET_AUTO_STAGE",
    "BUCKET_BLOCKED",
    "BUCKET_GUIDE_ADJACENT_SPLIT",
    "BUCKET_MANUAL_REVIEW",
    "BUCKET_OPERATIONAL_ONLY",
    "BUCKET_RESTAGE_NEEDED",
    "SCHEMA_VERSION",
    "ScheduleBatchCandidate",
    "build_parser",
    "build_schedule_batch_preview_gate_report",
    "main",
    "parse_schedule_batch_selection_markdown",
    "parse_schedule_consumption_ledger_states",
    "render_schedule_batch_preview_gate_markdown",
    "write_schedule_batch_preview_gate_outputs",
]


if __name__ == "__main__":
    main()
