from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from campus_evals.models import reject_forbidden_workflow_trace_keys

INTENT_SOURCE_METADATA_FIELDS = (
    "source_request_id",
    "trace_id",
    "sampled_at",
    "source_surface",
    "observed_failure_class",
    "expected_fix_reason",
)


def build_quality_feedback_candidate_review_manifest(
    candidates: Iterable[Mapping[str, object]],
    *,
    generated_at: str,
    target_suite: str,
) -> dict[str, object]:
    normalized_target_suite = _required_string(target_suite, "target_suite")
    seen_case_ids: set[str] = set()
    manifest_candidates: list[dict[str, object]] = []
    for raw_candidate in candidates:
        candidate = dict(raw_candidate)
        quality_candidate = {
            key: value for key, value in candidate.items() if key not in {"privacy"}
        }
        reject_forbidden_workflow_trace_keys(quality_candidate, "quality_candidate")
        case_id = _required_string(candidate.get("candidateId"), "candidateId")
        if case_id in seen_case_ids:
            raise ValueError(f"duplicate candidateId: {case_id}")
        seen_case_ids.add(case_id)
        intake = _mapping_field(candidate.get("intake"), "intake")
        feedback = _optional_mapping_field(candidate.get("feedback"), "feedback")
        correlation = _optional_mapping_field(candidate.get("correlation"), "correlation")
        review = _optional_mapping_field(candidate.get("review"), "review")
        links = _optional_mapping_field(candidate.get("links"), "links")
        source_type = _required_string(intake.get("source"), "intake.source")
        sampled_at = (
            _required_string(feedback.get("updatedAt"), "feedback.updatedAt")
            if feedback is not None
            else _required_string(intake.get("createdAt"), "intake.createdAt")
        )

        source = {
            "source_type": source_type,
            "source_request_id": _required_string(candidate.get("requestId"), "requestId"),
            "trace_id": _required_string(candidate.get("traceId"), "traceId"),
            "sampled_at": sampled_at,
            "source_surface": _required_string(candidate.get("surface"), "surface"),
            "observed_failure_class": _required_string(candidate.get("causeClass"), "causeClass"),
            "suggested_eval_family": _required_string(
                intake.get("suggestedEvalFamily"), "intake.suggestedEvalFamily"
            ),
        }
        if feedback is not None:
            source["feedback_id"] = _required_string(
                feedback.get("feedbackId"), "feedback.feedbackId"
            )
        if correlation is not None:
            source.update(
                {
                    "conversation_id": _required_string(
                        correlation.get("conversationId"), "correlation.conversationId"
                    ),
                    "assistant_message_id": _required_string(
                        correlation.get("assistantMessageId"),
                        "correlation.assistantMessageId",
                    ),
                    "answer_kind": _required_string(
                        correlation.get("answerKind"), "correlation.answerKind"
                    ),
                    "citation_posture": _required_string(
                        correlation.get("citationPosture"), "correlation.citationPosture"
                    ),
                }
            )
        if links is not None:
            source.update(
                {
                    "trace_link": _optional_string(links.get("traceLink")),
                    "issue_link": _optional_string(links.get("issueLink")),
                    "issue_fingerprint": _optional_string(links.get("issueFingerprint")),
                }
            )
        manifest_candidates.append(
            {
                "case_id": case_id,
                "source": source,
                "review": {
                    "decision": "pending_review",
                    "suggested_labels": (
                        _string_list_field(review.get("suggestedLabels"), "review.suggestedLabels")
                        if review is not None
                        else []
                    ),
                },
                "quality_candidate": quality_candidate,
            }
        )

    return {
        "schema_version": 1,
        "domain": "quality",
        "target_suite": normalized_target_suite,
        "generated_at": _required_string(generated_at, "generated_at"),
        "candidates": manifest_candidates,
    }


def build_intent_candidate_review_manifest(
    candidates: Iterable[Mapping[str, object]],
    *,
    generated_at: str,
    source: str,
    target_suite: str,
) -> dict[str, object]:
    normalized_source = _required_string(source, "source")
    normalized_target_suite = _required_string(target_suite, "target_suite")
    seen_case_ids: set[str] = set()
    manifest_candidates: list[dict[str, object]] = []
    for raw_candidate in candidates:
        candidate = dict(raw_candidate)
        case_id = _required_string(candidate.get("case_id"), "case_id")
        if case_id in seen_case_ids:
            raise ValueError(f"duplicate candidate case_id: {case_id}")
        seen_case_ids.add(case_id)
        source_metadata = {
            key: _required_string(candidate.get(key), key) for key in INTENT_SOURCE_METADATA_FIELDS
        }
        intent_case = {
            key: value
            for key, value in candidate.items()
            if key != "case_id" and key not in INTENT_SOURCE_METADATA_FIELDS
        }
        manifest_candidates.append(
            {
                "case_id": case_id,
                "source": {"source_type": normalized_source, **source_metadata},
                "review": {"decision": "pending_review"},
                "intent_case": intent_case,
            }
        )

    return {
        "schema_version": 1,
        "domain": "intent",
        "target_suite": normalized_target_suite,
        "generated_at": _required_string(generated_at, "generated_at"),
        "candidates": manifest_candidates,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build eval-owned candidate review manifests.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    intent_candidates = subparsers.add_parser(
        "intent-candidates",
        help="Wrap mined intent candidate JSONL as a pending eval review manifest.",
    )
    intent_candidates.add_argument("--input", required=True, help="Mined IntentCase JSONL path.")
    intent_candidates.add_argument(
        "--output", required=True, help="Review manifest JSON output path."
    )
    intent_candidates.add_argument(
        "--source",
        default="intent_case_miner",
        help="Source type stored on each pending candidate.",
    )
    intent_candidates.add_argument(
        "--target-suite",
        default="observed_regression",
        help="Target suite for accepted candidates.",
    )
    quality_candidates = subparsers.add_parser(
        "quality-candidates",
        help="Wrap app-api operator quality eval candidates as a pending review manifest.",
    )
    quality_candidates.add_argument(
        "--input",
        required=True,
        help="App-api eval candidates export JSON path.",
    )
    quality_candidates.add_argument(
        "--output", required=True, help="Review manifest JSON output path."
    )
    quality_candidates.add_argument(
        "--target-suite",
        default="observed_regression",
        help="Target suite for accepted candidates.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "intent-candidates":
        manifest = build_intent_candidate_review_manifest(
            _load_jsonl(Path(args.input)),
            generated_at=_utc_now_iso(),
            source=args.source,
            target_suite=args.target_suite,
        )
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            "Eval admission manifest: "
            f"domain=intent target_suite={manifest['target_suite']} "
            f"candidates={len(manifest['candidates'])} output={output_path}"
        )
        return 0
    if args.command == "quality-candidates":
        manifest = build_quality_feedback_candidate_review_manifest(
            _load_quality_candidates(Path(args.input)),
            generated_at=_utc_now_iso(),
            target_suite=args.target_suite,
        )
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            "Eval admission manifest: "
            f"domain=quality target_suite={manifest['target_suite']} "
            f"candidates={len(manifest['candidates'])} output={output_path}"
        )
        return 0
    raise ValueError(f"unsupported command: {args.command}")


def _load_jsonl(path: Path) -> tuple[Mapping[str, Any], ...]:
    candidates: list[Mapping[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError(f"candidate JSONL line {line_number} must be an object")
        candidates.append(payload)
    return tuple(candidates)


def _load_quality_candidates(path: Path) -> tuple[Mapping[str, Any], ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw_candidates: object = payload.get("candidates") if isinstance(payload, dict) else payload
    if not isinstance(raw_candidates, list):
        raise ValueError("quality candidate input must be a list or object with candidates")
    candidates: list[Mapping[str, Any]] = []
    for index, item in enumerate(raw_candidates):
        if not isinstance(item, dict):
            raise ValueError(f"quality candidate at index {index} must be an object")
        candidates.append(item)
    return tuple(candidates)


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _mapping_field(value: object, field_name: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} is required")
    return value


def _optional_mapping_field(value: object, field_name: str) -> Mapping[str, object] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} must be an object")
    return value


def _string_list_field(value: object, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} is required")
    return [_required_string(item, field_name) for item in value]


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "INTENT_SOURCE_METADATA_FIELDS",
    "build_intent_candidate_review_manifest",
    "build_parser",
    "build_quality_feedback_candidate_review_manifest",
    "main",
]
