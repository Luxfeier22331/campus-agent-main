from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from campus_evals.profile_report import load_json_object, required_string, string_tuple

RAG_KNOWN_GAP_SCHEMA_VERSION = "rag-known-gap-cases-v1"
RAG_KNOWN_GAP_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "rag_known_gap_cases.v1.json"
)
_PENDING_AUTHENTICATED_COLLECTION = "pending_authenticated_collection"


@dataclass(frozen=True, slots=True)
class RagKnownGapCase:
    case_id: str
    gap_id: str
    split: str
    surface_key: str
    query: str
    status: str
    missing_canonical_titles: tuple[str, ...]
    nearest_available_titles: tuple[str, ...]
    expected_sources: tuple[object, ...]
    required_behavior: tuple[str, ...]
    notes: str


@dataclass(frozen=True, slots=True)
class RagKnownGapCaseSet:
    schema_version: str
    case_family: str
    cases: tuple[RagKnownGapCase, ...]


def load_rag_known_gap_cases(path: str | Path | None = None) -> RagKnownGapCaseSet:
    source_path = Path(path) if path is not None else RAG_KNOWN_GAP_CASES_PATH
    payload = load_json_object(source_path)
    schema_version = required_string(payload.get("schema_version"), "schema_version")
    if schema_version != RAG_KNOWN_GAP_SCHEMA_VERSION:
        raise ValueError("unsupported RAG known-gap schema_version")
    case_family = required_string(payload.get("case_family"), "case_family")
    if case_family != "rag_known_gap.v1":
        raise ValueError("unsupported RAG known-gap case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("RAG known-gap cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return RagKnownGapCaseSet(
        schema_version=schema_version,
        case_family=case_family,
        cases=cases,
    )


def case_count_by_surface(cases: tuple[RagKnownGapCase, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for case in cases:
        counts[case.surface_key] = counts.get(case.surface_key, 0) + 1
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate RAG known-gap cases.")
    parser.add_argument("--cases-path")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    case_set = load_rag_known_gap_cases(args.cases_path)
    if args.json:
        print(
            json.dumps(
                {
                    "schema_version": case_set.schema_version,
                    "case_family": case_set.case_family,
                    "case_count": len(case_set.cases),
                    "surfaces": case_count_by_surface(case_set.cases),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    return 0


def _parse_case(payload: object) -> RagKnownGapCase:
    if not isinstance(payload, dict):
        raise ValueError("RAG known-gap case must be an object")
    status = required_string(payload.get("status"), "status")
    expected_sources = tuple(payload.get("expected_sources") or ())
    if status == _PENDING_AUTHENTICATED_COLLECTION and expected_sources:
        case_id = required_string(payload.get("case_id"), "case_id")
        raise ValueError(f"case {case_id} status={status} must not define expected_sources")
    missing_titles = string_tuple(payload.get("missing_canonical_titles"))
    if not missing_titles:
        case_id = required_string(payload.get("case_id"), "case_id")
        raise ValueError(f"case {case_id} must define missing_canonical_titles")
    return RagKnownGapCase(
        case_id=required_string(payload.get("case_id"), "case_id"),
        gap_id=required_string(payload.get("gap_id"), "gap_id"),
        split=required_string(payload.get("split"), "split"),
        surface_key=required_string(payload.get("surface_key"), "surface_key"),
        query=required_string(payload.get("query"), "query"),
        status=status,
        missing_canonical_titles=missing_titles,
        nearest_available_titles=string_tuple(payload.get("nearest_available_titles")),
        expected_sources=expected_sources,
        required_behavior=string_tuple(payload.get("required_behavior")),
        notes=str(payload.get("notes") or ""),
    )


def _reject_duplicate_case_ids(case_ids: object) -> None:
    seen: set[str] = set()
    for case_id in case_ids:
        if case_id in seen:
            raise ValueError(f"duplicate RAG known-gap case_id: {case_id}")
        seen.add(str(case_id))


__all__ = [
    "RAG_KNOWN_GAP_CASES_PATH",
    "RAG_KNOWN_GAP_SCHEMA_VERSION",
    "RagKnownGapCase",
    "RagKnownGapCaseSet",
    "case_count_by_surface",
    "load_rag_known_gap_cases",
    "main",
]


if __name__ == "__main__":
    raise SystemExit(main())
