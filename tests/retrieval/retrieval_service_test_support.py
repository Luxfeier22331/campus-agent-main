from __future__ import annotations

from campus_contracts import EvidenceSource


def _make_source(
    *,
    chunk_id: str,
    version_id: str = "v1:test",
    snippet: str,
    doc_id: str = "handbook:national-scholarship",
    collection: str = "student_rules",
    source_channel: str = "pdf_ocr",
    canonical_url: str = "https://example.edu/handbook/national-scholarship",
    latest_url: str = "https://example.edu/handbook/national-scholarship/latest",
    source_title: str = "国家奖学金评审办法",
    score: float = 0.91,
    content_role: str = "",
    content_kind: str = "",
    detail_label: str = "",
    is_answer_bearing: bool = False,
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page_start": 1, "page_end": 1},
        canonical_url=canonical_url,
        latest_url=latest_url,
        source_channel=source_channel,
        collection=collection,
        is_current=version_id.startswith("v2:"),
        snippet=snippet,
        score=score,
        source_title=source_title,
        content_role=content_role,
        content_kind=content_kind,
        detail_label=detail_label,
        is_answer_bearing=is_answer_bearing,
    )
