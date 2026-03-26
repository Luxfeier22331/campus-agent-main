from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from typing import Iterable, Protocol, Sequence
import uuid

from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.core.schema import NodeRelationship, RelatedNodeInfo, TextNode
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_ingestion_core.chunking import (
    ChunkProfile,
    ChunkTextAssembly,
    ChunkTextContextPlan,
    SemanticChunkPiece,
    StructuredUnitChunkInput,
    TABLE_UNIT_TYPES,
    TEXTUAL_UNIT_TYPES,
    assemble_chunk_text,
    build_student_handbook_chunk_profile,
    build_chunk_text_context,
    chunk_table_unit,
    chunk_structured_unit,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.curriculum_chunk_units import build_curriculum_structured_units, chunk_curriculum_unit
from campus_ingestion_core.models import DocumentRegistryRecord

_NESTED_NUMBERED_LINE_RE = re.compile(r"^(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])")


class ProcessArtifactReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class StructuredUnit:
    unit_index: int
    document_id: str
    version_id: str
    text: str
    source_chunk_id: str | None
    anchor: dict[str, object]
    acl_level: str
    unit_type: str
    root_unit_id: str
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class IndexableChunk:
    document_id: str
    revision_track: str
    version_id: str
    chunk_id: str
    chunk_order: int
    corpus: str
    collection: str
    acl_groups: tuple[str, ...]
    campus_scope: str | None
    source_uri: str
    source_chunk_id: str | None
    acl_level: str
    anchor: dict[str, object]
    text: str
    source_channel: str
    is_current: bool
    parser_version: str
    embedding_model: str
    embedding: tuple[float, ...] | None = None
    metadata: dict[str, object] = field(default_factory=dict)

    def to_node(self) -> TextNode:
        node = TextNode(
            id_=str(uuid.uuid5(uuid.NAMESPACE_URL, self.chunk_id)),
            text=self.text,
            metadata={
                "document_id": self.document_id,
                "revision_track": self.revision_track,
                "representation": self.revision_track,
                "version_id": self.version_id,
                "chunk_id": self.chunk_id,
                "chunk_order": self.chunk_order,
                "corpus": self.corpus,
                "collection": self.collection,
                "acl_groups": list(self.acl_groups),
                "campus_scope": self.campus_scope,
                "source_uri": self.source_uri,
                "source_chunk_id": self.source_chunk_id,
                "acl_level": self.acl_level,
                "anchor": self.anchor,
                "source_channel": self.source_channel,
                "is_current": self.is_current,
                "parser_version": self.parser_version,
                "embedding_model": self.embedding_model,
                **self.metadata,
            },
            relationships={
                NodeRelationship.SOURCE: RelatedNodeInfo(
                    node_id=self.document_id,
                    metadata={
                        "revision_track": self.revision_track,
                        "representation": self.revision_track,
                        "version_id": self.version_id,
                        "source_uri": self.source_uri,
                    },
                )
            },
        )
        if self.embedding is not None:
            node.embedding = list(self.embedding)
        return node


_SHORT_TEXTUAL_DISPLAY_TOKEN_THRESHOLD = 72
_SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD = 0.4
_SHORT_TEXTUAL_TARGET_DISPLAY_TOKENS = 120
_SHORT_TEXTUAL_MAX_MEMBER_COUNT = 4


@dataclass(frozen=True, slots=True)
class _ChunkMember:
    unit: StructuredUnit
    piece: SemanticChunkPiece


@dataclass(frozen=True, slots=True)
class _ChunkCandidate:
    unit_type: str
    root_unit_id: str
    source_chunk_id: str | None
    acl_level: str
    anchor: dict[str, object]
    metadata: dict[str, object]
    piece: SemanticChunkPiece
    chunk_assembly: ChunkTextAssembly
    members: tuple[_ChunkMember, ...]


def build_indexable_chunks_from_jsonl(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
    chunk_profile: ChunkProfile | None = None,
    embedding_model: BaseEmbedding | None = None,
) -> tuple[IndexableChunk, ...]:
    runtime_profile = _resolve_chunk_profile(record=record, chunk_profile=chunk_profile)
    units = _load_structured_units(record=record, structured_jsonl_bytes=structured_jsonl_bytes)
    if not units:
        return ()
    table_roots_with_semantic_units = {
        unit.root_unit_id
        for unit in units
        if unit.unit_type in {"table_row", "table_unit"}
    }
    chunk_candidates = _build_chunk_candidates(
        record=record,
        units=units,
        chunk_profile=runtime_profile,
        table_roots_with_semantic_units=table_roots_with_semantic_units,
    )
    chunk_candidates = _merge_adjacent_short_textual_candidates(
        chunk_candidates=chunk_candidates,
        chunk_profile=runtime_profile,
    )

    chunks: list[IndexableChunk] = []
    chunk_order = 0
    for candidate in chunk_candidates:
        chunk_order += 1
        chunk_id = (
            f"{record.document_id}:{record.revision_track}:{record.version_id}:chunk-{chunk_order:04d}"
        )
        embedding = _embed_text(candidate.chunk_assembly.text, embedding_model)
        chunks.append(
            IndexableChunk(
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                chunk_id=chunk_id,
                chunk_order=chunk_order,
                corpus=record.corpus,
                collection=record.collection,
                acl_groups=record.acl_groups,
                campus_scope=record.campus_scope,
                source_uri=record.source_uri,
                source_chunk_id=candidate.source_chunk_id,
                acl_level=_resolve_effective_acl_level(
                    unit_acl_level=candidate.acl_level,
                    document_acl_groups=record.acl_groups,
                ),
                anchor=candidate.anchor,
                text=candidate.chunk_assembly.text,
                source_channel=record.source_channel,
                is_current=record.is_current,
                parser_version=record.parser_version,
                embedding_model=record.embedding_model,
                embedding=embedding,
                metadata={
                    "unit_type": candidate.piece.unit_type,
                    "root_unit_id": candidate.piece.root_unit_id,
                    "segment_index": candidate.piece.segment_index,
                    "segment_total": candidate.piece.segment_total,
                    "split_reason": candidate.piece.split_reason,
                    "boundary_rule": candidate.piece.boundary_rule,
                    "strategy_name": runtime_profile.strategy_name,
                    "split_strategy": runtime_profile.split_strategy,
                    "chunk_policy_version": runtime_profile.chunk_policy_version,
                    "cleaning_policy_version": runtime_profile.cleaning_policy_version,
                    **candidate.metadata,
                    "display_text": candidate.piece.text,
                    "contextualized_text": candidate.chunk_assembly.header_token_count > 0,
                    "header_mode": candidate.chunk_assembly.header_mode,
                    "header_token_count": candidate.chunk_assembly.header_token_count,
                    "display_token_count": candidate.chunk_assembly.display_token_count,
                    "final_token_count": candidate.chunk_assembly.total_token_count,
                },
            )
        )
    return tuple(chunks)


def _build_chunk_candidates(
    *,
    record: DocumentRegistryRecord,
    units: Sequence[StructuredUnit],
    chunk_profile: ChunkProfile,
    table_roots_with_semantic_units: set[str],
) -> tuple[_ChunkCandidate, ...]:
    candidates: list[_ChunkCandidate] = []
    for unit in units:
        if unit.unit_type == "table":
            if record.collection == "student_handbook":
                continue
            if unit.root_unit_id in table_roots_with_semantic_units:
                continue
        if record.collection == "curriculum_plan":
            pieces = chunk_curriculum_unit(unit=unit, chunk_profile=chunk_profile)
        elif unit.unit_type == "table_unit":
            pieces = chunk_table_unit(
                unit=StructuredUnitChunkInput(
                    unit_type=unit.unit_type,
                    root_unit_id=unit.root_unit_id,
                    text=unit.text,
                    anchor=unit.anchor,
                    metadata=unit.metadata,
                ),
                chunk_profile=chunk_profile,
            )
        else:
            pieces = chunk_structured_unit(
                unit=StructuredUnitChunkInput(
                    unit_type=unit.unit_type,
                    root_unit_id=unit.root_unit_id,
                    text=unit.text,
                    anchor=unit.anchor,
                    metadata=unit.metadata,
                ),
                chunk_profile=chunk_profile,
            )
        context_plan = build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
        for piece in pieces:
            chunk_assembly = _build_chunk_text(
                unit=unit,
                piece=piece,
                chunk_profile=chunk_profile,
                context_plan=context_plan,
            )
            _validate_chunk_budget(piece=piece, chunk_assembly=chunk_assembly, chunk_profile=chunk_profile)
            candidates.append(
                _ChunkCandidate(
                    unit_type=piece.unit_type,
                    root_unit_id=piece.root_unit_id,
                    source_chunk_id=unit.source_chunk_id,
                    acl_level=unit.acl_level,
                    anchor=dict(unit.anchor),
                    metadata=dict(unit.metadata),
                    piece=piece,
                    chunk_assembly=chunk_assembly,
                    members=(_ChunkMember(unit=unit, piece=piece),),
                )
            )
    return tuple(candidates)


def _merge_adjacent_short_textual_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    merged: list[_ChunkCandidate] = []
    pending: _ChunkCandidate | None = None

    for candidate in chunk_candidates:
        if not _is_short_textual_merge_eligible(candidate):
            if pending is not None:
                merged.append(pending)
                pending = None
            merged.append(candidate)
            continue
        if pending is None:
            if _is_short_textual_candidate(candidate):
                pending = candidate
                continue
            merged.append(candidate)
            continue
        if not _is_short_textual_candidate(candidate):
            merged.append(pending)
            pending = None
            merged.append(candidate)
            continue
        next_candidate = _try_merge_short_textual_candidates(
            current=pending,
            incoming=candidate,
            chunk_profile=chunk_profile,
        )
        if next_candidate is None:
            merged.append(pending)
            pending = candidate
            continue
        pending = next_candidate
        if _short_textual_group_is_satisfied(pending):
            merged.append(pending)
            pending = None

    if pending is not None:
        merged.append(pending)
    return _absorb_short_textual_candidates(
        chunk_candidates=tuple(merged),
        chunk_profile=chunk_profile,
    )


def _absorb_short_textual_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    absorbed = list(chunk_candidates)
    changed = True
    while changed:
        changed = False
        index = 0
        while index < len(absorbed):
            candidate = absorbed[index]
            if not _is_absorbable_short_textual_candidate(candidate):
                index += 1
                continue
            if index > 0:
                merged_with_previous = _try_merge_short_textual_candidates(
                    current=absorbed[index - 1],
                    incoming=candidate,
                    chunk_profile=chunk_profile,
                    enforce_member_limit=False,
                )
                if merged_with_previous is not None:
                    absorbed[index - 1] = merged_with_previous
                    del absorbed[index]
                    changed = True
                    index = max(index - 1, 0)
                    continue
            if index + 1 < len(absorbed):
                merged_with_next = _try_merge_short_textual_candidates(
                    current=candidate,
                    incoming=absorbed[index + 1],
                    chunk_profile=chunk_profile,
                    enforce_member_limit=False,
                )
                if merged_with_next is not None:
                    absorbed[index] = merged_with_next
                    del absorbed[index + 1]
                    changed = True
                    continue
            index += 1
    return tuple(absorbed)


def _try_merge_short_textual_candidates(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    chunk_profile: ChunkProfile,
    enforce_member_limit: bool = True,
) -> _ChunkCandidate | None:
    if not _short_textual_candidates_are_compatible(current, incoming):
        return None
    if enforce_member_limit and len(current.members) >= _SHORT_TEXTUAL_MAX_MEMBER_COUNT:
        return None

    members = (*current.members, *incoming.members)
    aggregated_anchor = _build_aggregated_anchor(members)
    aggregated_metadata = _build_aggregated_metadata(current=current, members=members)
    aggregated_display_text = _build_aggregated_display_text(members)
    chunk_assembly = assemble_chunk_text(
        display_text=aggregated_display_text,
        context_plan=build_chunk_text_context(anchor=aggregated_anchor, metadata=aggregated_metadata),
        chunk_profile=chunk_profile,
    )
    if chunk_assembly.total_token_count > chunk_profile.max_chunk_size:
        return None

    return _ChunkCandidate(
        unit_type=current.unit_type,
        root_unit_id=current.root_unit_id,
        source_chunk_id=current.source_chunk_id,
        acl_level=current.acl_level,
        anchor=aggregated_anchor,
        metadata=aggregated_metadata,
        piece=SemanticChunkPiece(
            unit_type=current.piece.unit_type,
            root_unit_id=current.piece.root_unit_id,
            text=aggregated_display_text,
        ),
        chunk_assembly=chunk_assembly,
        members=members,
    )


def _short_textual_candidates_are_compatible(
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    if current.unit_type != incoming.unit_type:
        return False
    if current.acl_level != incoming.acl_level:
        return False
    if current.unit_type == "policy_page" and _policy_page_label_shape_conflicts(current=current, incoming=incoming):
        return False
    if not _short_textual_section_paths_are_compatible(current=current, incoming=incoming):
        return False
    for field_name in ("title", "policy_doc_no"):
        if current.metadata.get(field_name) != incoming.metadata.get(field_name):
            return False
    return True


def _policy_page_label_shape_conflicts(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_has_label = _candidate_has_explicit_member_label(current)
    incoming_has_label = _candidate_has_explicit_member_label(incoming)
    if current_has_label == incoming_has_label:
        return False
    unlabeled = current if not current_has_label else incoming
    labeled = incoming if unlabeled is current else current
    if _normalize_anchor_label(labeled.anchor, "provision_label") is None:
        return False
    return _candidate_contains_nested_numbered_items(unlabeled)


def _candidate_contains_nested_numbered_items(candidate: _ChunkCandidate) -> bool:
    match_count = 0
    for member in candidate.members:
        for line in member.piece.text.splitlines():
            if _NESTED_NUMBERED_LINE_RE.match(line.strip()):
                match_count += 1
                if match_count >= 2:
                    return True
    return False


def _short_textual_section_paths_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_path = _normalize_section_path(current.anchor)
    incoming_path = _normalize_section_path(incoming.anchor)
    if current_path == incoming_path:
        return True
    if (
        current.unit_type == "policy_page"
        and not _candidate_has_explicit_member_label(current)
        and not _candidate_has_explicit_member_label(incoming)
    ):
        return _policy_page_section_paths_are_compatible(current_path=current_path, incoming_path=incoming_path)
    return False


def _candidate_has_explicit_member_label(candidate: _ChunkCandidate) -> bool:
    return _normalize_anchor_label(candidate.anchor, "article_label") is not None or _normalize_anchor_label(
        candidate.anchor,
        "provision_label",
    ) is not None


def _policy_page_section_paths_are_compatible(
    *,
    current_path: tuple[str, ...],
    incoming_path: tuple[str, ...],
) -> bool:
    if not current_path or not incoming_path:
        return False
    if len(current_path) >= 2 and incoming_path[: len(current_path)] == current_path:
        return True
    if len(incoming_path) >= 2 and current_path[: len(incoming_path)] == incoming_path:
        return True
    current_parent = current_path[:-1]
    incoming_parent = incoming_path[:-1]
    if len(current_parent) < 2 or len(incoming_parent) < 2:
        return False
    return current_parent == incoming_parent


def _is_short_textual_merge_eligible(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type not in TEXTUAL_UNIT_TYPES:
        return False
    if candidate.piece.split_reason is not None:
        return False
    if candidate.piece.segment_total != 1:
        return False
    return True


def _is_short_textual_candidate(candidate: _ChunkCandidate) -> bool:
    if candidate.chunk_assembly.display_token_count < _SHORT_TEXTUAL_DISPLAY_TOKEN_THRESHOLD:
        return True
    return _header_ratio(candidate.chunk_assembly) >= _SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD


def _is_absorbable_short_textual_candidate(candidate: _ChunkCandidate) -> bool:
    if not _is_short_textual_merge_eligible(candidate):
        return False
    return _is_short_textual_candidate(candidate)


def _short_textual_group_is_satisfied(candidate: _ChunkCandidate) -> bool:
    if len(candidate.members) >= _SHORT_TEXTUAL_MAX_MEMBER_COUNT:
        return True
    if _header_ratio(candidate.chunk_assembly) >= _SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD:
        return False
    return candidate.chunk_assembly.display_token_count >= _SHORT_TEXTUAL_TARGET_DISPLAY_TOKENS


def _header_ratio(chunk_assembly: ChunkTextAssembly) -> float:
    if chunk_assembly.total_token_count <= 0:
        return 0.0
    return chunk_assembly.header_token_count / chunk_assembly.total_token_count


def _build_aggregated_anchor(members: Sequence[_ChunkMember]) -> dict[str, object]:
    aggregated_anchor = dict(members[0].unit.anchor)
    page_starts = [value for value in (_as_int(member.unit.anchor.get("page_start")) for member in members) if value is not None]
    page_ends = [value for value in (_as_int(member.unit.anchor.get("page_end")) for member in members) if value is not None]
    if page_starts:
        aggregated_anchor["page_start"] = min(page_starts)
    if page_ends:
        aggregated_anchor["page_end"] = max(page_ends)
    common_section_path = _common_section_path(
        _normalize_section_path(member.unit.anchor)
        for member in members
    )
    if common_section_path:
        aggregated_anchor["section_path"] = list(common_section_path)
    else:
        aggregated_anchor.pop("section_path", None)

    article_labels = _collect_member_labels(members, "article_label")
    provision_labels = _collect_member_labels(members, "provision_label")
    if article_labels:
        aggregated_anchor["article_label"] = _collapse_label_range(article_labels)
    else:
        aggregated_anchor.pop("article_label", None)
    if provision_labels:
        aggregated_anchor["provision_label"] = _collapse_label_range(provision_labels)
    else:
        aggregated_anchor.pop("provision_label", None)
    return aggregated_anchor


def _build_aggregated_metadata(
    *,
    current: _ChunkCandidate,
    members: Sequence[_ChunkMember],
) -> dict[str, object]:
    aggregated_metadata = dict(current.metadata)
    for field_name in ("title", "policy_doc_no", "preface_text"):
        shared_value = _shared_metadata_text(members, field_name)
        if shared_value is None:
            aggregated_metadata.pop(field_name, None)
        else:
            aggregated_metadata[field_name] = shared_value
    aggregated_metadata["aggregation_mode"] = "adjacent_short_textual_units"
    aggregated_metadata["member_unit_count"] = len(members)
    aggregated_metadata["member_root_unit_ids"] = [member.piece.root_unit_id for member in members]
    aggregated_metadata["member_source_chunk_ids"] = [
        member.unit.source_chunk_id
        for member in members
        if member.unit.source_chunk_id is not None
    ]
    article_labels = _collect_member_labels(members, "article_label")
    if article_labels:
        aggregated_metadata["member_article_labels"] = article_labels
    provision_labels = _collect_member_labels(members, "provision_label")
    if provision_labels:
        aggregated_metadata["member_provision_labels"] = provision_labels
    return aggregated_metadata


def _build_aggregated_display_text(members: Sequence[_ChunkMember]) -> str:
    return "\n\n".join(_build_member_display_text(member) for member in members).strip()


def _build_member_display_text(member: _ChunkMember) -> str:
    text = member.piece.text.strip()
    label = _resolve_member_label(member)
    if not label or text.startswith(label):
        return text
    separator = " " if not text.startswith(("：", ":")) else ""
    return f"{label}{separator}{text}".strip()


def _resolve_member_label(member: _ChunkMember) -> str | None:
    for field_name in ("article_label", "provision_label"):
        label = _normalize_anchor_label(member.unit.anchor, field_name)
        if label is not None:
            return label
    return None


def _collect_member_labels(members: Sequence[_ChunkMember], field_name: str) -> list[str]:
    labels: list[str] = []
    for member in members:
        value = member.unit.anchor.get(field_name)
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                labels.append(normalized)
    return labels


def _collapse_label_range(labels: Sequence[str]) -> str:
    distinct_labels: list[str] = []
    for label in labels:
        if not distinct_labels or distinct_labels[-1] != label:
            distinct_labels.append(label)
    if not distinct_labels:
        return ""
    if len(distinct_labels) == 1:
        return distinct_labels[0]
    return f"{distinct_labels[0]}-{distinct_labels[-1]}"


def _normalize_section_path(anchor: dict[str, object]) -> tuple[str, ...]:
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list):
        return ()
    return tuple(str(item).strip() for item in section_path if str(item).strip())


def _normalize_anchor_label(anchor: dict[str, object], field_name: str) -> str | None:
    value = anchor.get(field_name)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _shared_metadata_text(members: Sequence[_ChunkMember], field_name: str) -> str | None:
    sentinel = object()
    shared_value: str | None | object = sentinel
    for member in members:
        value = member.unit.metadata.get(field_name)
        normalized = value.strip() if isinstance(value, str) and value.strip() else None
        if shared_value is sentinel:
            shared_value = normalized
            continue
        if shared_value != normalized:
            return None
    return shared_value if isinstance(shared_value, str) else None


def _common_section_path(paths: Iterable[tuple[str, ...]]) -> tuple[str, ...]:
    normalized_paths = [path for path in paths if path]
    if not normalized_paths:
        return ()
    common = list(normalized_paths[0])
    for path in normalized_paths[1:]:
        limit = min(len(common), len(path))
        index = 0
        while index < limit and common[index] == path[index]:
            index += 1
        common = common[:index]
        if not common:
            return ()
    return tuple(common)


def _as_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _validate_chunk_budget(
    *,
    piece: SemanticChunkPiece,
    chunk_assembly: ChunkTextAssembly,
    chunk_profile: ChunkProfile,
) -> None:
    if piece.unit_type in TABLE_UNIT_TYPES:
        return
    if chunk_assembly.total_token_count <= chunk_profile.max_chunk_size:
        return
    raise ValueError(
        "chunk text exceeds max_chunk_size after contextualization: "
        f"{chunk_assembly.total_token_count} > {chunk_profile.max_chunk_size}"
    )


def build_indexable_chunks_from_record(
    *,
    record: DocumentRegistryRecord,
    object_store: ProcessArtifactReader,
    bucket: str,
    chunk_profile: ChunkProfile | None = None,
    embedding_model: BaseEmbedding | None = None,
) -> tuple[IndexableChunk, ...]:
    document_units_key = record.document_units_object_key
    if not document_units_key:
        raise ValueError("document_units_object_key is required to build indexable chunks")
    structured_jsonl_bytes = object_store.get_bytes(bucket=bucket, key=document_units_key)
    return build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=structured_jsonl_bytes,
        chunk_profile=chunk_profile,
        embedding_model=embedding_model,
    )


def index_chunks_to_qdrant(
    *,
    chunks: Sequence[IndexableChunk],
    qdrant_client: QdrantClient,
    collection_name: str,
) -> tuple[str, ...]:
    if not chunks:
        return ()
    vector_store = QdrantVectorStore(
        collection_name=collection_name,
        client=qdrant_client,
        index_doc_id=not _is_local_qdrant_backend(qdrant_client),
    )
    ids = vector_store.add([chunk.to_node() for chunk in chunks])
    _ensure_payload_indexes(qdrant_client=qdrant_client, collection_name=collection_name)
    return tuple(str(item) for item in ids)


def _load_structured_units(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[StructuredUnit, ...]:
    if record.collection == "curriculum_plan":
        return tuple(build_curriculum_structured_units(record=record, structured_jsonl_bytes=structured_jsonl_bytes))
    units: list[StructuredUnit] = []
    for unit_index, line in enumerate(structured_jsonl_bytes.decode("utf-8").splitlines()):
        normalized = line.strip()
        if not normalized:
            continue
        raw = json.loads(normalized)
        if str(raw.get("chunk_id") or "").strip() == "document-0000":
            raise ValueError("structured input must not contain synthetic document-0000 rows")
        doc_id = str(raw.get("doc_id") or "").strip()
        version_id = str(raw.get("version_id") or "").strip()
        if doc_id != record.document_id:
            raise ValueError(
                f"structured doc_id {doc_id!r} does not match registry document_id {record.document_id!r}"
            )
        if version_id != record.version_id:
            raise ValueError(
                f"structured version_id {version_id!r} does not match registry version_id {record.version_id!r}"
            )
        text = _resolve_structured_text(raw)
        units.append(
            StructuredUnit(
                unit_index=unit_index,
                document_id=doc_id,
                version_id=version_id,
                text=text,
                source_chunk_id=_normalize_optional_text(raw.get("chunk_id")),
                anchor=_normalize_anchor(raw.get("anchor")),
                acl_level=_normalize_acl_level(raw.get("acl")),
                unit_type=_normalize_unit_type(raw.get("unit_type")),
                root_unit_id=_normalize_root_unit_id(raw),
                metadata=_normalize_unit_metadata(raw),
            )
        )
    return tuple(units)


def _resolve_chunk_profile(
    *,
    record: DocumentRegistryRecord,
    chunk_profile: ChunkProfile | None,
) -> ChunkProfile:
    if chunk_profile is not None:
        return chunk_profile
    if record.collection == "curriculum_plan":
        raise ValueError("curriculum_plan chunking requires explicit chunk_profile")
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    if record.collection == "student_handbook":
        return build_student_handbook_chunk_profile(
            profile_version=runtime_profile.chunk_profile_version,
            model_name=record.embedding_model,
        )
    return ChunkProfile()


def _resolve_structured_text(raw: dict[str, object]) -> str:
    for field_name in ("clean_text", "raw_text", "text"):
        value = raw.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise ValueError("structured unit must contain clean_text, raw_text, or text")


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_anchor(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _normalize_acl_level(value: object) -> str:
    if not isinstance(value, dict):
        return "public"
    allow_groups = value.get("allow_groups")
    if isinstance(allow_groups, list) and any(isinstance(item, str) and item.strip() for item in allow_groups):
        return "restricted"
    acl_level = value.get("level")
    if not isinstance(acl_level, str) or not acl_level.strip():
        return "public"
    return acl_level.strip()


def _resolve_effective_acl_level(
    *,
    unit_acl_level: str,
    document_acl_groups: tuple[str, ...],
) -> str:
    if document_acl_groups and unit_acl_level == "public":
        return "restricted"
    return unit_acl_level


def _normalize_unit_type(value: object) -> str:
    if not isinstance(value, str):
        return "policy_page"
    normalized = value.strip()
    return normalized or "policy_page"


def _normalize_root_unit_id(raw: dict[str, object]) -> str:
    root_unit_id = raw.get("root_unit_id")
    if isinstance(root_unit_id, str) and root_unit_id.strip():
        return root_unit_id.strip()
    source_chunk_id = raw.get("chunk_id")
    if isinstance(source_chunk_id, str) and source_chunk_id.strip():
        return source_chunk_id.strip()
    return f"{raw.get('doc_id', '')}:{raw.get('version_id', '')}:root"


def _normalize_unit_metadata(raw: dict[str, object]) -> dict[str, object]:
    metadata = raw.get("metadata")
    if not isinstance(metadata, dict):
        return {}
    normalized: dict[str, object] = {}
    for key, value in metadata.items():
        if isinstance(key, str) and key.strip():
            normalized[key.strip()] = value
    return normalized


def _build_chunk_text(
    *,
    unit: StructuredUnit,
    piece: StructuredUnitChunkInput | object,
    chunk_profile: ChunkProfile,
    context_plan: ChunkTextContextPlan | None = None,
) -> ChunkTextAssembly:
    display_text = getattr(piece, "text", "")
    if not isinstance(display_text, str) or not display_text.strip():
        return assemble_chunk_text(
            display_text="",
            context_plan=build_chunk_text_context(),
            chunk_profile=chunk_profile,
        )
    runtime_context_plan = (
        context_plan
        if context_plan is not None
        else build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
    )
    return assemble_chunk_text(
        display_text=display_text,
        context_plan=runtime_context_plan,
        chunk_profile=chunk_profile,
    )


def _embed_text(text: str, embedding_model: BaseEmbedding | None) -> tuple[float, ...] | None:
    if embedding_model is None:
        return None
    return tuple(float(item) for item in embedding_model.get_text_embedding(text))


def _ensure_payload_indexes(*, qdrant_client: QdrantClient, collection_name: str) -> None:
    if not qdrant_client.collection_exists(collection_name):
        return
    if _is_local_qdrant_backend(qdrant_client):
        return
    for field_name in (
        "document_id",
        "revision_track",
        "representation",
        "version_id",
        "corpus",
        "collection",
        "campus_scope",
        "acl_groups",
        "acl_level",
        "source_channel",
        "is_current",
    ):
        qdrant_client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=qdrant_models.PayloadSchemaType.KEYWORD,
            wait=True,
        )


def _is_local_qdrant_backend(qdrant_client: QdrantClient) -> bool:
    client = getattr(qdrant_client, "_client", None)
    return client is not None and type(client).__module__.startswith("qdrant_client.local.")
