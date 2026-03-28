from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path

from campus_ingestion_core.scope_catalog import assert_known_scope


@dataclass(frozen=True, slots=True)
class SplitManifestDocument:
    document_id: str
    title: str
    page_start: int
    page_end: int
    source_uri: str | None = None
    handbook_section: str | None = None
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    campus_scope: str | None = None
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
            acl_groups=tuple(
                _optional_string(value) or "" for value in list(item.get("acl_groups") or []) if _optional_string(value)
            ),
            campus_scope=_optional_string(item.get("campus_scope")),
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
    if manifest.collection == "student_handbook":
        for document in manifest.documents:
            if not document.handbook_section:
                raise ValueError("student_handbook split manifest requires handbook_section")
            if not document.source_uri:
                raise ValueError("student_handbook split manifest requires source_uri")
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


def _validate_non_overlapping_page_ranges(documents: tuple[SplitManifestDocument, ...]) -> None:
    sorted_documents = sorted(documents, key=lambda item: (item.page_start, item.page_end, item.document_id))
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
