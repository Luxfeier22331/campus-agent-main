from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path

from campus_contracts import ALLOWED_CORPORA


@dataclass(frozen=True, slots=True)
class SplitManifestDocument:
    document_id: str
    title: str
    page_start: int
    page_end: int
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
        if not self.status:
            raise ValueError("status is required")


@dataclass(frozen=True, slots=True)
class SplitManifest:
    manifest_version: str
    corpus: str
    raw_asset_id: str
    documents: tuple[SplitManifestDocument, ...]

    def __post_init__(self) -> None:
        if not self.manifest_version:
            raise ValueError("manifest_version is required")
        if self.corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported corpus: {self.corpus}")
        if not self.raw_asset_id:
            raise ValueError("raw_asset_id is required")
        if not self.documents:
            raise ValueError("documents must not be empty")
        _validate_non_overlapping_page_ranges(self.documents)


def load_split_manifest(path: Path, *, expected_corpus: str | None = None) -> SplitManifest:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    documents = tuple(
        SplitManifestDocument(
            document_id=str(item["document_id"]),
            title=str(item["title"]),
            page_start=int(item["page_start"]),
            page_end=int(item["page_end"]),
            acl_groups=tuple(str(value) for value in list(item.get("acl_groups") or [])),
            campus_scope=str(item["campus_scope"]) if item.get("campus_scope") is not None else None,
            status=str(item.get("status") or "active"),
        )
        for item in list(payload.get("documents") or [])
    )
    manifest = SplitManifest(
        manifest_version=str(payload.get("manifest_version") or ""),
        corpus=str(payload.get("corpus") or ""),
        raw_asset_id=str(payload.get("raw_asset_id") or ""),
        documents=documents,
    )
    if expected_corpus is not None and manifest.corpus != expected_corpus:
        raise ValueError(
            f"split manifest corpus mismatch: expected {expected_corpus}, got {manifest.corpus}"
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
