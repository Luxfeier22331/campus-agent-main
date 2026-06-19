from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path

DATASET_MANIFEST_SCHEMA_VERSION = "langfuse_dataset_manifest.v1"


def build_langfuse_dataset_items(
    dataset: Mapping[str, object],
    fixture_path: Path,
    fixture_hash: str,
    source_git_head: str,
) -> list[dict[str, object]]:
    payload = _load_json_object(fixture_path)
    kind = _required_string(dataset.get("kind"), "kind")
    if kind == "rag_qrels":
        return _rag_qrels_items(dataset, fixture_path, fixture_hash, source_git_head, payload)
    if kind == "answer_quality":
        return _answer_quality_items(dataset, fixture_path, fixture_hash, source_git_head, payload)
    if kind == "release_acceptance":
        return _release_acceptance_items(
            dataset, fixture_path, fixture_hash, source_git_head, payload
        )
    if kind == "online_answer_path":
        return _online_answer_path_items(
            dataset, fixture_path, fixture_hash, source_git_head, payload
        )
    if kind == "known_gap_review_seed":
        return _known_gap_review_seed_items(
            dataset, fixture_path, fixture_hash, source_git_head, payload
        )
    raise ValueError(f"unsupported dataset kind: {kind}")


def _rag_qrels_items(
    dataset: Mapping[str, object],
    fixture_path: Path,
    fixture_hash: str,
    source_git_head: str,
    payload: Mapping[str, object],
) -> list[dict[str, object]]:
    raw_cases = _mapping_list(payload.get("cases"), "cases")
    return [
        _dataset_item(
            dataset=dataset,
            case_id=_required_string(case.get("case_id"), "case_id"),
            fixture_path=fixture_path,
            fixture_hash=fixture_hash,
            source_git_head=source_git_head,
            input_payload=_query_input(dataset, case),
            expected_payload={
                "split": _optional_string(case.get("split")),
                "expected_doc_ids": [
                    _required_string(source.get("doc_id"), "expected_sources[].doc_id")
                    for source in _mapping_list(
                        case.get("expected_sources") or [], "expected_sources"
                    )
                ],
                "forbidden_doc_ids": [
                    _required_string(source.get("doc_id"), "forbidden_sources[].doc_id")
                    for source in _mapping_list(
                        case.get("forbidden_sources") or [], "forbidden_sources"
                    )
                ],
            },
        )
        for case in raw_cases
    ]


def _answer_quality_items(
    dataset: Mapping[str, object],
    fixture_path: Path,
    fixture_hash: str,
    source_git_head: str,
    payload: Mapping[str, object],
) -> list[dict[str, object]]:
    raw_cases = _mapping_list(payload.get("cases"), "cases")
    return [
        _dataset_item(
            dataset=dataset,
            case_id=_required_string(case.get("case_id"), "case_id"),
            fixture_path=fixture_path,
            fixture_hash=fixture_hash,
            source_git_head=source_git_head,
            input_payload={
                "case_id": _required_string(case.get("case_id"), "case_id"),
                "surface_key": _required_string(dataset.get("surface_key"), "surface_key"),
            },
            expected_payload={
                "split": _optional_string(case.get("split")),
                "required_facts": _string_list(case.get("required_facts")),
                "forbidden_claims": _string_list(case.get("forbidden_claims")),
            },
        )
        for case in raw_cases
    ]


def _release_acceptance_items(
    dataset: Mapping[str, object],
    fixture_path: Path,
    fixture_hash: str,
    source_git_head: str,
    payload: Mapping[str, object],
) -> list[dict[str, object]]:
    raw_cases = _mapping_list(payload.get("cases"), "cases")
    return [
        _dataset_item(
            dataset=dataset,
            case_id=_required_string(case.get("case_id"), "case_id"),
            fixture_path=fixture_path,
            fixture_hash=fixture_hash,
            source_git_head=source_git_head,
            input_payload=_query_input(dataset, case),
            expected_payload={
                "split": _optional_string(case.get("split")),
                "expected_document_ids": _string_list(case.get("expected_document_ids")),
                "top_k": case.get("top_k"),
            },
        )
        for case in raw_cases
    ]


def _online_answer_path_items(
    dataset: Mapping[str, object],
    fixture_path: Path,
    fixture_hash: str,
    source_git_head: str,
    payload: Mapping[str, object],
) -> list[dict[str, object]]:
    raw_cases = _mapping_list(payload.get("cases"), "cases")
    return [
        _dataset_item(
            dataset=dataset,
            case_id=_required_string(case.get("case_id"), "case_id"),
            fixture_path=fixture_path,
            fixture_hash=fixture_hash,
            source_git_head=source_git_head,
            input_payload=_user_goal_input(dataset, case),
            expected_payload=_online_answer_expected(case),
        )
        for case in raw_cases
    ]


def _known_gap_review_seed_items(
    dataset: Mapping[str, object],
    fixture_path: Path,
    fixture_hash: str,
    source_git_head: str,
    payload: Mapping[str, object],
) -> list[dict[str, object]]:
    raw_cases = _mapping_list(payload.get("cases"), "cases")
    return [
        _dataset_item(
            dataset=dataset,
            case_id=_required_string(case.get("case_id"), "case_id"),
            fixture_path=fixture_path,
            fixture_hash=fixture_hash,
            source_git_head=source_git_head,
            input_payload=_query_input(dataset, case),
            expected_payload={
                "split": _optional_string(case.get("split")),
                "gap_id": _optional_string(case.get("gap_id")),
                "status": _optional_string(case.get("status")),
                "required_behavior": _string_list(case.get("required_behavior")),
                "expected_doc_ids": [
                    _required_string(source.get("doc_id"), "expected_sources[].doc_id")
                    for source in _mapping_list(
                        case.get("expected_sources") or [], "expected_sources"
                    )
                ],
            },
        )
        for case in raw_cases
    ]


def _dataset_item(
    *,
    dataset: Mapping[str, object],
    case_id: str,
    fixture_path: Path,
    fixture_hash: str,
    source_git_head: str,
    input_payload: Mapping[str, object],
    expected_payload: Mapping[str, object],
) -> dict[str, object]:
    slug = _required_string(dataset.get("slug"), "slug")
    surface_key = _required_string(dataset.get("surface_key"), "surface_key")
    return {
        "datasetName": _required_string(dataset.get("name"), "name"),
        "id": _dataset_item_id(slug, case_id),
        "input": dict(input_payload),
        "expectedOutput": dict(expected_payload),
        "metadata": {
            "dataset_slug": slug,
            "case_id": case_id,
            "source_fixture_path": str(fixture_path),
            "source_git_head": source_git_head,
            "fixture_hash": fixture_hash,
            "surface_key": surface_key,
            "schema_version": DATASET_MANIFEST_SCHEMA_VERSION,
        },
        "status": "ACTIVE",
    }


def _query_input(dataset: Mapping[str, object], case: Mapping[str, object]) -> dict[str, object]:
    return {
        "case_id": _required_string(case.get("case_id"), "case_id"),
        "query_sha256": _sha256_text(_required_string(case.get("query"), "query")),
        "surface_key": _required_string(dataset.get("surface_key"), "surface_key"),
    }


def _user_goal_input(
    dataset: Mapping[str, object], case: Mapping[str, object]
) -> dict[str, object]:
    user_goal = _optional_string(case.get("user_goal")) or _required_string(
        case.get("user_utterance"), "user_goal"
    )
    return {
        "case_id": _required_string(case.get("case_id"), "case_id"),
        "user_goal_sha256": _sha256_text(user_goal),
        "surface_key": _required_string(dataset.get("surface_key"), "surface_key"),
    }


def _online_answer_expected(case: Mapping[str, object]) -> dict[str, object]:
    expected = _mapping(case.get("expected"), "expected")
    trace_contract = _mapping_or_empty(expected.get("trace_contract"))
    response_contract = _mapping_or_empty(expected.get("response_contract"))
    answer_contract = _mapping_or_empty(expected.get("answer_contract"))
    return {
        "split": _optional_string(case.get("split")),
        "selected_capability": _optional_string(expected.get("selected_capability")),
        "terminal_outcome": _optional_string(expected.get("terminal_outcome")),
        "trace_contract_required_stages": _string_list(trace_contract.get("required_stages")),
        "trace_contract_forbidden_stages": _string_list(trace_contract.get("forbidden_stages")),
        "response_contract_keys": sorted(str(key) for key in response_contract),
        "answer_contract_keys": sorted(str(key) for key in answer_contract),
    }


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _mapping(value: object, field: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field} must be a JSON object")
    return value


def _mapping_or_empty(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _mapping_list(value: object, field: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    result: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, Mapping):
            raise ValueError(f"{field} items must be objects")
        result.append(dict(item))
    return result


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _required_string(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _dataset_item_id(dataset_slug: str, case_id: str) -> str:
    return f"campus:{_slug_hash(dataset_slug)}:{_slug(case_id)}"


def _slug_hash(value: str) -> str:
    return _sha256_text(value)[:12]


def _slug(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


__all__ = ["build_langfuse_dataset_items"]
