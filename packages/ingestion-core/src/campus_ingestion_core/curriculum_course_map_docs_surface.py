from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.curriculum_course_map_multimodal_probe import (
    CurriculumCourseMapInventoryEntry,
    load_provider_page_heights,
    render_curriculum_course_map_sample,
)

CURRICULUM_COURSE_MAP_DOCS_REVIEW_MANIFEST_VERSION = "curriculum_course_map_docs_review_v1"
DEFAULT_CURRICULUM_COURSE_MAP_DOCS_REVIEW_MANIFEST_PATH = Path(
    "configs/ingestion/curriculum/curriculum_plan/course-map-docs-review.v1.json"
)


class ObjectStoreByteReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class ReviewedCourseMapNode:
    node_label: str
    stage_label: str = ""
    category_label: str = ""

    def __post_init__(self) -> None:
        if not self.node_label.strip():
            raise ValueError("node_label is required")


@dataclass(frozen=True, slots=True)
class ReviewedCourseMapEdge:
    source_label: str
    target_label: str

    def __post_init__(self) -> None:
        if not self.source_label.strip():
            raise ValueError("source_label is required")
        if not self.target_label.strip():
            raise ValueError("target_label is required")


@dataclass(frozen=True, slots=True)
class ReviewedCourseMapEntry:
    slug: str
    review_status: str
    public_title: str
    document_id: str
    document_title: str
    page_number: int
    row_id: str
    parent_heading_hint: str
    source_bucket: str
    source_pdf_key: str
    provider_response_key: str
    raw_asset_id: str
    raw_version_id: str
    bbox_provider: tuple[float, float, float, float]
    display_stage_labels: tuple[str, ...]
    nodes: tuple[ReviewedCourseMapNode, ...]
    edges: tuple[ReviewedCourseMapEdge, ...]
    manual_review_notes: tuple[str, ...]
    reviewed_at: str

    def __post_init__(self) -> None:
        if not self.slug.strip():
            raise ValueError("slug is required")
        if self.review_status != "approved":
            raise ValueError("docs review entry must be approved before publishing")
        if not self.public_title.strip():
            raise ValueError("public_title is required")
        if not self.document_id.strip():
            raise ValueError("document_id is required")
        if not self.document_title.strip():
            raise ValueError("document_title is required")
        if self.page_number <= 0:
            raise ValueError("page_number must be greater than zero")
        if not self.row_id.strip():
            raise ValueError("row_id is required")
        if len(self.bbox_provider) != 4:
            raise ValueError("bbox_provider must contain four numbers")
        if not self.nodes:
            raise ValueError("approved course-map docs entry must contain nodes")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapDocsArtifact:
    slug: str
    public_title: str
    image_bytes: bytes
    data_payload: dict[str, object]
    digest_lines: tuple[str, ...]


def load_curriculum_course_map_docs_review_manifest(
    path: Path = DEFAULT_CURRICULUM_COURSE_MAP_DOCS_REVIEW_MANIFEST_PATH,
) -> tuple[ReviewedCourseMapEntry, ...]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        str(payload.get("manifest_version") or "").strip()
        != CURRICULUM_COURSE_MAP_DOCS_REVIEW_MANIFEST_VERSION
    ):
        raise ValueError("unsupported curriculum course-map docs review manifest version")
    entries = tuple(_coerce_review_entry(item) for item in payload.get("entries") or ())
    if not entries:
        raise ValueError("course-map docs review manifest must contain at least one entry")
    return entries


def materialize_reviewed_curriculum_course_map_doc(
    *,
    entry: ReviewedCourseMapEntry,
    byte_reader: ObjectStoreByteReader,
) -> CurriculumCourseMapDocsArtifact:
    provider_response_bytes = byte_reader.get_bytes(
        bucket=entry.source_bucket,
        key=entry.provider_response_key,
    )
    provider_page_height = float(
        load_provider_page_heights(provider_response_bytes)[entry.page_number]
    )
    pdf_bytes = byte_reader.get_bytes(bucket=entry.source_bucket, key=entry.source_pdf_key)
    rendered = render_curriculum_course_map_sample(
        pdf_bytes=pdf_bytes,
        entry=CurriculumCourseMapInventoryEntry(
            document_id=entry.document_id,
            document_title=entry.document_title,
            page_number=entry.page_number,
            row_id=entry.row_id,
            parent_heading_hint=entry.parent_heading_hint,
            bbox_provider=entry.bbox_provider,
            provider_page_height=provider_page_height,
            raw_asset_id=entry.raw_asset_id,
            raw_version_id=entry.raw_version_id,
            source_pdf_key=entry.source_pdf_key,
            provider_response_key=entry.provider_response_key,
            layout_elements_key="",
        ),
        sample_id=f"docs-course-map-{entry.slug}",
    )
    return CurriculumCourseMapDocsArtifact(
        slug=entry.slug,
        public_title=entry.public_title,
        image_bytes=rendered.crop_png,
        data_payload={
            "title": entry.public_title,
            "documentTitle": entry.document_title,
            "documentId": entry.document_id,
            "pageNumber": entry.page_number,
            "rowId": entry.row_id,
            "parentHeadingHint": entry.parent_heading_hint,
            "displayStageLabels": list(entry.display_stage_labels),
            "nodes": [asdict(node) for node in entry.nodes],
            "edges": [asdict(edge) for edge in entry.edges],
            "manualReviewNotes": list(entry.manual_review_notes),
            "reviewedAt": entry.reviewed_at,
        },
        digest_lines=_build_digest_lines(entry),
    )


def _build_digest_lines(entry: ReviewedCourseMapEntry) -> tuple[str, ...]:
    groups: list[str] = []
    ordered_stage_labels = entry.display_stage_labels or _derive_stage_labels(entry.nodes)
    for stage_label in ordered_stage_labels:
        node_labels = [
            node.node_label
            for node in entry.nodes
            if node.stage_label == stage_label and node.node_label.strip()
        ]
        if not node_labels:
            continue
        groups.append(f"{stage_label}：{'、'.join(node_labels)}")
    return tuple(groups)


def _derive_stage_labels(nodes: tuple[ReviewedCourseMapNode, ...]) -> tuple[str, ...]:
    ordered: list[str] = []
    for node in nodes:
        if node.stage_label and node.stage_label not in ordered:
            ordered.append(node.stage_label)
    return tuple(ordered)


def _coerce_review_entry(payload: object) -> ReviewedCourseMapEntry:
    if not isinstance(payload, dict):
        raise ValueError("course-map docs review entry must be an object")
    return ReviewedCourseMapEntry(
        slug=str(payload.get("slug") or "").strip(),
        review_status=str(payload.get("review_status") or "").strip(),
        public_title=str(payload.get("public_title") or "").strip(),
        document_id=str(payload.get("document_id") or "").strip(),
        document_title=str(payload.get("document_title") or "").strip(),
        page_number=int(payload.get("page_number") or 0),
        row_id=str(payload.get("row_id") or "").strip(),
        parent_heading_hint=str(payload.get("parent_heading_hint") or "").strip(),
        source_bucket=str(payload.get("source_bucket") or "").strip(),
        source_pdf_key=str(payload.get("source_pdf_key") or "").strip(),
        provider_response_key=str(payload.get("provider_response_key") or "").strip(),
        raw_asset_id=str(payload.get("raw_asset_id") or "").strip(),
        raw_version_id=str(payload.get("raw_version_id") or "").strip(),
        bbox_provider=tuple(float(value) for value in payload.get("bbox_provider") or ()),
        display_stage_labels=tuple(
            str(value).strip() for value in payload.get("display_stage_labels") or ()
        ),
        nodes=tuple(
            ReviewedCourseMapNode(
                node_label=str(item.get("node_label") or "").strip(),
                stage_label=str(item.get("stage_label") or "").strip(),
                category_label=str(item.get("category_label") or "").strip(),
            )
            for item in payload.get("nodes") or ()
            if isinstance(item, dict)
        ),
        edges=tuple(
            ReviewedCourseMapEdge(
                source_label=str(item.get("source_label") or "").strip(),
                target_label=str(item.get("target_label") or "").strip(),
            )
            for item in payload.get("edges") or ()
            if isinstance(item, dict)
        ),
        manual_review_notes=tuple(
            str(value).strip() for value in payload.get("manual_review_notes") or ()
        ),
        reviewed_at=str(payload.get("reviewed_at") or "").strip(),
    )
