from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass

from .models import NormalizedProviderGroundingSupport


def serialize_prompt_payload(value: object) -> str:
    payload = _normalize_prompt_payload(value)
    return json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )


def normalize_provider_grounding_supports(
    payload: object,
) -> tuple[NormalizedProviderGroundingSupport, ...]:
    normalized = tuple(_iter_provider_grounding_supports(payload))
    deduped: list[NormalizedProviderGroundingSupport] = []
    seen: set[tuple[str, str, str]] = set()
    for support in normalized:
        key = (
            support.claim_text,
            support.support_source_doc_id,
            support.support_snippet,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(support)
    return tuple(deduped)


def _iter_provider_grounding_supports(
    payload: object,
) -> tuple[NormalizedProviderGroundingSupport, ...]:
    if isinstance(payload, dict):
        extracted = _extract_provider_grounding_support_record(payload)
        if extracted is not None:
            return (extracted,)
        supports: list[NormalizedProviderGroundingSupport] = []
        for value in payload.values():
            supports.extend(_iter_provider_grounding_supports(value))
        return tuple(supports)
    if isinstance(payload, (list, tuple)):
        supports: list[NormalizedProviderGroundingSupport] = []
        for item in payload:
            supports.extend(_iter_provider_grounding_supports(item))
        return tuple(supports)
    return ()


def _extract_provider_grounding_support_record(
    record: dict[str, object],
) -> NormalizedProviderGroundingSupport | None:
    claim_text = _first_non_empty_string(
        record,
        "claim_text",
        "claimText",
        "claim",
        "text",
    )
    if not claim_text:
        return None
    return NormalizedProviderGroundingSupport(
        claim_text=claim_text,
        support_source_doc_id=_first_non_empty_string(
            record,
            "support_source_doc_id",
            "supportSourceDocId",
            "source_doc_id",
            "sourceDocId",
            "doc_id",
            "docId",
            "document_id",
            "documentId",
        ),
        support_snippet=_first_non_empty_string(
            record,
            "support_snippet",
            "supportSnippet",
            "snippet",
            "quote",
            "support_text",
            "supportText",
        ),
    )


def _first_non_empty_string(record: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_prompt_payload(value: object) -> object:
    if is_dataclass(value):
        return {key: _normalize_prompt_payload(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {str(key): _normalize_prompt_payload(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_normalize_prompt_payload(item) for item in value]
    if isinstance(value, list):
        return [_normalize_prompt_payload(item) for item in value]
    return value
