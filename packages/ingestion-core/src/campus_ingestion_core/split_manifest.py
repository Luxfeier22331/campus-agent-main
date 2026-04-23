from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from campus_ingestion_core.scope_catalog import assert_known_scope

SplitManifestValidator = Callable[["SplitManifest"], None]


@dataclass(frozen=True, slots=True)
class SplitManifestDocument:
    document_id: str
    title: str
    page_start: int
    page_end: int
    source_uri: str | None = None
    handbook_section: str | None = None
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_scope: str | None = None
    visibility_level: str = ""
    status: str = "active"

    def __post_init__(self) -> None:
        if not self.document_id:
            raise ValueError("document_id is required")
        if not self.title:
            raise ValueError("title is required")
        if self.page_start <= 0:
            raise ValueError("page_start must be greater than zero")
        if self.page_end < self.page_start:
            raise ValueError("page_end must be greater than or equal to page_start")
        if self.source_uri is not None and not self.source_uri.strip():
            raise ValueError("source_uri must not be blank")
        if not self.status:
            raise ValueError("status is required")
        visibility_level = self.visibility_level.strip() or (
            "restricted" if self.entitlement_groups else "public"
        )
        if visibility_level != self.visibility_level:
            object.__setattr__(self, "visibility_level", visibility_level)

    def resolved_entitlement_groups(self) -> tuple[str, ...]:
        return self.entitlement_groups

    def resolved_visibility_scope(self, default_scope: str | None = None) -> str | None:
        if self.visibility_scope is not None:
            return self.visibility_scope
        if not self.entitlement_groups:
            return None
        return default_scope

    def resolved_visibility_level(self) -> str:
        return self.visibility_level


@dataclass(frozen=True, slots=True)
class SplitManifest:
    manifest_version: str
    corpus: str
    collection: str
    raw_asset_id: str
    documents: tuple[SplitManifestDocument, ...]

    def __post_init__(self) -> None:
        if not self.manifest_version:
            raise ValueError("manifest_version is required")
        assert_known_scope(self.corpus, self.collection)
        if not self.raw_asset_id:
            raise ValueError("raw_asset_id is required")
        if not self.documents:
            raise ValueError("documents must not be empty")
        _validate_non_overlapping_page_ranges(self.documents)


def load_split_manifest(
    path: Path,
    *,
    expected_corpus: str | None = None,
    expected_collection: str | None = None,
) -> SplitManifest:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    _assert_manifest_uses_canonical_authorization_projection(payload)
    corpus = str(payload.get("corpus") or "")
    collection = str(payload.get("collection") or "")
    documents = tuple(
        SplitManifestDocument(
            document_id=_required_string(item, "document_id"),
            title=_required_string(item, "title"),
            page_start=int(item["page_start"]),
            page_end=int(item["page_end"]),
            source_uri=_optional_string(item.get("source_uri")),
            handbook_section=_optional_string(item.get("handbook_section")),
            entitlement_groups=_resolved_manifest_entitlement_groups(item),
            visibility_scope=_resolved_manifest_visibility_scope(item),
            visibility_level=_optional_string(item.get("visibility_level")) or "",
            status=_optional_string(item.get("status")) or "active",
        )
        for item in list(payload.get("documents") or [])
    )
    manifest = SplitManifest(
        manifest_version=str(payload.get("manifest_version") or ""),
        corpus=corpus,
        collection=collection,
        raw_asset_id=str(payload.get("raw_asset_id") or ""),
        documents=documents,
    )
    validator = _SPLIT_MANIFEST_VALIDATORS.get((manifest.corpus, manifest.collection))
    if validator is not None:
        validator(manifest)
    if expected_corpus is not None and manifest.corpus != expected_corpus:
        raise ValueError(
            f"split manifest corpus mismatch: expected {expected_corpus}, got {manifest.corpus}"
        )
    if expected_collection is not None and manifest.collection != expected_collection:
        raise ValueError(
            "split manifest collection mismatch: "
            f"expected {expected_collection}, got {manifest.collection}"
        )
    return manifest


def _assert_manifest_uses_canonical_authorization_projection(payload: dict[str, object]) -> None:
    documents = payload.get("documents") or []
    if not isinstance(documents, list):
        return
    for item in documents:
        if not isinstance(item, dict):
            continue
        unsupported_keys = _collect_unsupported_authorization_projection_keys(item)
        if unsupported_keys:
            joined = ", ".join(unsupported_keys)
            raise ValueError(
                f"split manifest contains unsupported authorization projection keys: {joined}"
            )


def _collect_unsupported_authorization_projection_keys(
    payload: dict[str, object],
) -> tuple[str, ...]:
    supported_keys = {
        "entitlement_groups",
        "visibility_scope",
        "visibility_level",
        "policy_projection_version",
    }
    return tuple(
        key
        for key in payload
        if _looks_like_authorization_projection_key(key) and key not in supported_keys
    )


def _looks_like_authorization_projection_key(key: str) -> bool:
    return (
        key.startswith(("entitlement_", "visibility_", "policy_projection_"))
        or key.endswith(("_groups", "_scope", "_level"))
    )


def _validate_non_overlapping_page_ranges(documents: tuple[SplitManifestDocument, ...]) -> None:
    sorted_documents = sorted(
        documents, key=lambda item: (item.page_start, item.page_end, item.document_id)
    )
    seen_document_ids: set[str] = set()
    current_end = 0
    for document in sorted_documents:
        if document.document_id in seen_document_ids:
            raise ValueError(f"duplicate document_id in split manifest: {document.document_id}")
        seen_document_ids.add(document.document_id)
        if document.page_start <= current_end:
            raise ValueError("split manifest page ranges overlap")
        current_end = document.page_end


def _required_string(payload: dict[str, object], field_name: str) -> str:
    value = _optional_string(payload.get(field_name))
    if value is None:
        raise ValueError(f"{field_name} is required")
    return value


def _optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    normalized: list[str] = []
    for item in value:
        text = _optional_string(item)
        if text is not None:
            normalized.append(text)
    return tuple(normalized)


def _resolved_manifest_entitlement_groups(item: dict[str, object]) -> tuple[str, ...]:
    return _string_tuple(item.get("entitlement_groups"))


def _resolved_manifest_visibility_scope(item: dict[str, object]) -> str | None:
    return _optional_string(item.get("visibility_scope"))


def _validate_student_handbook_manifest(manifest: SplitManifest) -> None:
    for document in manifest.documents:
        if not document.handbook_section:
            raise ValueError("student_rules split manifest requires handbook_section")
        if not document.source_uri:
            raise ValueError("student_rules split manifest requires source_uri")


_SPLIT_MANIFEST_VALIDATORS: dict[tuple[str, str], SplitManifestValidator] = {
    ("regulations", "student_rules"): _validate_student_handbook_manifest,
}
