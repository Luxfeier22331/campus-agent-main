from __future__ import annotations

from collections.abc import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from llama_index.core.schema import MetadataMode
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.backend_qdrant_registry import (
    get_current_registry_version,
    get_registry_record,
)
from campus_retrieval_core.backend_qdrant_source_metadata import (
    _coerce_dict,
    _coerce_structural_path,
    _optional_bool,
    _optional_text,
    _record_to_text_node,
    _resolve_action_type,
    _resolve_article_no,
    _resolve_audience_scope,
    _resolve_canonical_source_id,
    _resolve_canonical_source_title,
    _resolve_claim_type,
    _resolve_clause_no,
    _resolve_content_kind,
    _resolve_content_role,
    _resolve_detail_label,
    _resolve_is_answer_bearing,
    _resolve_polarity,
    _resolve_section_kind,
    _resolve_semantic_role,
    _resolve_source_title,
    _resolve_source_unit_key,
    _resolve_source_unit_kind,
)

DEFAULT_LATEST_REVISION_TRACKS = ("current-effective", "editorial", "source-faithful")


def build_evidence_sources(
    backend,
    points: Sequence[qdrant_models.ScoredPoint],
) -> tuple[EvidenceSource, ...]:
    sources: list[EvidenceSource] = []
    for point in points:
        payload = dict(point.payload or {})
        node = _record_to_text_node(point.id, payload)
        if node is None:
            continue
        metadata = dict(node.metadata)
        document_id = str(metadata.get("document_id") or "")
        revision_track = str(metadata.get("revision_track") or "")
        version_id = str(metadata.get("version_id") or "")
        if not document_id or not revision_track or not version_id:
            continue
        anchor = _coerce_dict(metadata.get("anchor"))
        canonical_url = _optional_text(metadata.get("canonical_url")) or _optional_text(
            metadata.get("source_uri")
        )
        latest_url = _optional_text(metadata.get("latest_url")) or canonical_url
        source_channel = _optional_text(metadata.get("source_channel"))
        collection = _optional_text(metadata.get("collection"))
        is_current = _optional_bool(metadata.get("is_current"))
        if (
            canonical_url is None
            or latest_url is None
            or source_channel is None
            or collection is None
            or is_current is None
        ):
            record = get_registry_record(backend, document_id, revision_track, version_id)
            if record is None:
                continue
            runtime_profile = load_runtime_profile(record.corpus, record.collection)
            latest_record = get_current_registry_version(
                backend,
                document_id,
                preferred_revision_tracks=runtime_profile.serving_revision_tracks
                or DEFAULT_LATEST_REVISION_TRACKS,
            )
            canonical_url = canonical_url or record.source_uri
            latest_url = latest_url or (
                latest_record.source_uri if latest_record is not None else record.source_uri
            )
            source_channel = source_channel or record.source_channel
            collection = collection or record.collection
            if is_current is None:
                is_current = record.is_current
        source_title = _resolve_source_title(metadata, document_id=document_id, anchor=anchor)
        sources.append(
            EvidenceSource(
                doc_id=document_id,
                revision_track=revision_track,
                version_id=version_id,
                chunk_id=str(metadata.get("chunk_id") or node.node_id),
                anchor=anchor,
                canonical_url=canonical_url,
                latest_url=latest_url,
                source_channel=source_channel,
                collection=collection,
                is_current=is_current,
                snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                score=float(point.score),
                source_title=source_title,
                structural_path=_coerce_structural_path(anchor.get("section_path")),
                content_kind=_resolve_content_kind(
                    metadata,
                    collection=collection,
                    snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                    anchor=anchor,
                ),
                content_role=_resolve_content_role(
                    metadata,
                    collection=collection,
                    snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                    anchor=anchor,
                ),
                detail_label=_resolve_detail_label(metadata, anchor=anchor),
                semantic_role=_resolve_semantic_role(metadata),
                polarity=_resolve_polarity(metadata),
                action_type=_resolve_action_type(metadata),
                claim_type=_resolve_claim_type(metadata),
                audience_scope=_resolve_audience_scope(metadata),
                article_no=_resolve_article_no(metadata, anchor=anchor),
                clause_no=_resolve_clause_no(metadata, anchor=anchor),
                section_kind=_resolve_section_kind(metadata),
                is_answer_bearing=_resolve_is_answer_bearing(
                    metadata,
                    collection=collection,
                    snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                    anchor=anchor,
                ),
                canonical_source_id=_resolve_canonical_source_id(metadata),
                canonical_source_title=_resolve_canonical_source_title(metadata),
                source_unit_kind=_resolve_source_unit_kind(
                    metadata,
                    collection=collection,
                    anchor=anchor,
                ),
                source_unit_key=_resolve_source_unit_key(
                    metadata,
                    collection=collection,
                ),
            )
        )
    return tuple(sources)


def build_evidence_sources_from_records(
    backend,
    records: Sequence[qdrant_models.Record],
    *,
    default_score: float,
) -> tuple[EvidenceSource, ...]:
    return build_evidence_sources(
        backend,
        tuple(
            qdrant_models.ScoredPoint(
                id=record.id,
                version=0,
                score=default_score,
                payload=record.payload,
                vector=record.vector,
                shard_key=record.shard_key,
                order_value=record.order_value,
            )
            for record in records
        ),
    )


__all__ = [
    "build_evidence_sources",
    "build_evidence_sources_from_records",
]
