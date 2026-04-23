from __future__ import annotations

import json
from typing import Protocol

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION


class _DocumentAuthorizationProtocol(Protocol):
    visibility_scope: str | None
    status: str


def load_metadata_from_bytes(file_bytes: bytes) -> dict[str, object]:
    first_line = file_bytes.decode("utf-8").splitlines()[0]
    raw = json.loads(first_line)
    document_id = str(raw.get("doc_id") or "")
    version_id = str(raw.get("version_id") or "")
    if not document_id or not version_id:
        raise ValueError("doc_id and version_id are required in OCR JSONL")
    assert_canonical_row_authorization_metadata(raw)
    source = raw.get("source") or {}
    nested_metadata = raw.get("metadata") or {}
    nested_metadata_dict = nested_metadata if isinstance(nested_metadata, dict) else {}
    source_url = raw.get("source_url")
    if not isinstance(source_url, str) or not source_url.strip():
        source_url = nested_metadata_dict.get("source_url")
    entitlement_groups = resolve_row_entitlement_groups(raw)
    visibility_scope = normalize_optional_text(raw.get("visibility_scope"))
    visibility_level = resolve_row_visibility_level(
        raw=raw,
        entitlement_groups=entitlement_groups,
    )
    policy_projection_version = (
        normalize_optional_text(raw.get("policy_projection_version"))
        or DEFAULT_POLICY_PROJECTION_VERSION
    )
    return {
        "document_id": document_id,
        "version_id": version_id,
        "revision_track": str(raw.get("revision_track") or "source-faithful"),
        "source_url": source_url,
        "source_md": raw.get("source_md"),
        "source_id": source.get("id"),
        "source_pdf": normalize_optional_text(raw.get("source_pdf")),
        "raw_page_start": normalize_optional_int(raw.get("page_start")),
        "raw_page_end": normalize_optional_int(raw.get("page_end")),
        "semantic_content_hash": normalize_optional_text(
            nested_metadata_dict.get("semantic_content_hash")
        ),
        "title": normalize_optional_text(nested_metadata_dict.get("title")),
        "page_family": normalize_optional_text(nested_metadata_dict.get("page_family")),
        "serving_intent": normalize_optional_text(nested_metadata_dict.get("serving_intent")),
        "content_role": normalize_optional_text(nested_metadata_dict.get("content_role")),
        "entitlement_groups": entitlement_groups,
        "visibility_scope": visibility_scope,
        "visibility_level": visibility_level,
        "policy_projection_version": policy_projection_version,
    }


def apply_authorization_projection_metadata(
    metadata: dict[str, object],
    *,
    entitlement_groups: tuple[str, ...] | list[str],
    visibility_scope: str | None,
    visibility_level: str | None = None,
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION,
) -> None:
    assert_canonical_authorization_metadata(metadata)
    normalized_groups = normalize_group_values(entitlement_groups)
    normalized_scope = normalize_optional_text(visibility_scope)
    normalized_visibility_level = normalize_optional_text(visibility_level)
    resolved_visibility_level = normalized_visibility_level or (
        "restricted" if normalized_groups else "public"
    )
    normalized_policy_projection_version = (
        normalize_optional_text(policy_projection_version) or DEFAULT_POLICY_PROJECTION_VERSION
    )

    metadata["entitlement_groups"] = list(normalized_groups)
    metadata["visibility_scope"] = normalized_scope
    metadata["visibility_level"] = resolved_visibility_level
    metadata["policy_projection_version"] = normalized_policy_projection_version


def resolve_entitlement_groups(metadata: dict[str, object]) -> tuple[str, ...]:
    return normalize_group_values(metadata.get("entitlement_groups"))


def resolve_visibility_scope(
    *,
    metadata: dict[str, object],
    document: _DocumentAuthorizationProtocol,
    default_visibility_scope: str | None,
) -> str | None:
    metadata_scope = normalize_optional_text(metadata.get("visibility_scope"))
    if metadata_scope is not None:
        return metadata_scope
    if document.visibility_scope is not None:
        return document.visibility_scope
    return default_visibility_scope


def resolve_visibility_level(
    *,
    metadata: dict[str, object],
    entitlement_groups: tuple[str, ...],
) -> str:
    metadata_visibility_level = normalize_optional_text(metadata.get("visibility_level"))
    if metadata_visibility_level is not None:
        return metadata_visibility_level
    return "restricted" if entitlement_groups else "public"


def resolve_policy_projection_version(metadata: dict[str, object]) -> str:
    return (
        normalize_optional_text(metadata.get("policy_projection_version"))
        or DEFAULT_POLICY_PROJECTION_VERSION
    )


def normalize_group_values(value: object) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        return ()
    normalized: list[str] = []
    for item in value:
        text = normalize_optional_text(item)
        if text is not None:
            normalized.append(text)
    return tuple(normalized)


def resolve_row_entitlement_groups(raw: dict[str, object]) -> tuple[str, ...]:
    return normalize_group_values(raw.get("entitlement_groups"))


def resolve_row_visibility_level(
    *,
    raw: dict[str, object],
    entitlement_groups: tuple[str, ...],
) -> str:
    visibility_level = normalize_optional_text(raw.get("visibility_level"))
    if visibility_level is not None:
        return visibility_level
    return "restricted" if entitlement_groups else "public"


def assert_canonical_row_authorization_metadata(raw: dict[str, object]) -> None:
    if raw.get("acl") is not None:
        raise ValueError("legacy row authorization metadata is not allowed: acl")


def assert_canonical_authorization_metadata(metadata: dict[str, object]) -> None:
    unsupported_keys = tuple(
        key
        for key in metadata
        if looks_like_authorization_projection_key(key)
        and key not in SUPPORTED_AUTHORIZATION_METADATA_KEYS
    )
    if unsupported_keys:
        joined = ", ".join(unsupported_keys)
        raise ValueError(f"unsupported authorization metadata keys are not allowed: {joined}")


SUPPORTED_AUTHORIZATION_METADATA_KEYS = frozenset(
    {
        "entitlement_groups",
        "visibility_scope",
        "visibility_level",
        "policy_projection_version",
    }
)


def looks_like_authorization_projection_key(key: str) -> bool:
    return (
        key.startswith(("entitlement_", "visibility_", "policy_projection_"))
        or key.endswith(("_groups", "_scope", "_level"))
    )


def normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def resolve_campus_scope(
    *,
    metadata: dict[str, object],
    document: _DocumentAuthorizationProtocol,
    default_visibility_scope: str | None,
) -> str | None:
    return resolve_visibility_scope(
        metadata=metadata,
        document=document,
        default_visibility_scope=default_visibility_scope,
    )


def resolve_status(*, metadata: dict[str, object], document: _DocumentAuthorizationProtocol) -> str:
    metadata_status = normalize_optional_text(metadata.get("status"))
    if metadata_status is not None:
        return metadata_status
    return document.status


def normalize_optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("boolean is not a valid page number")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    raise ValueError(f"invalid integer value: {value!r}")
