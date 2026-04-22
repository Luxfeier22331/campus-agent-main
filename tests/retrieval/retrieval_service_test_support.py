from __future__ import annotations

from campus_contracts import EvidenceSource


def _make_source(
    *,
    chunk_id: str,
    version_id: str,
    snippet: str,
    doc_id: str = "handbook:national-scholarship",
    collection: str = "student_rules",
    source_channel: str = "pdf_ocr",
    canonical_url: str = "https://example.edu/handbook/national-scholarship",
    latest_url: str = "https://example.edu/handbook/national-scholarship/latest",
    source_title: str = "国家奖学金评审办法",
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
        score=0.91,
        source_title=source_title,
    )
