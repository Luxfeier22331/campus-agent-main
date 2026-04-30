from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from itertools import pairwise
from typing import Any, Protocol

from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_ingestion_core.curriculum_chunk_units import (
    _leading_curriculum_heading_lines,
    _looks_like_curriculum_structure_heading,
    _looks_like_curriculum_version_note,
    _normalize_curriculum_structural_path,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.scope_catalog import QdrantIndexBinding

_CURRICULUM_COURSE_MAP_HEADING = "六、课程地图"
_OFFICIAL_WEB_MIN_RELEASE_DOCUMENTS = 2
_OFFICIAL_WEB_DISALLOWED_PAGE_FAMILIES = frozenset(
    {"listing_page", "generic_content_page", "dynamic_shell_page", "structural_shell_page"}
)


class IndexReleaseWriter(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class IndexReleaseDocumentRef:
    document_id: str
    revision_track: str
    version_id: str
    document_units_object_key: str | None
    document_units_sha256: str | None = None


@dataclass(frozen=True, slots=True)
class IndexReleaseValidationResult:
    status: str
    summary: dict[str, object]


@dataclass(frozen=True, slots=True)
class IndexReleaseManifest:
    release_id: str
    corpus: str
    collection: str
    serving_alias: str
    physical_collection_name: str
    previous_physical_collection_name: str | None
    cleaning_policy_version: str
    chunk_policy_version: str
    embedding_model: str
    indexed_at: str
    published_at: str | None
    document_count: int
    point_count: int
    document_version_ids_hash: str
    document_units_keys_hash: str
    validation_status: str
    validation_summary_object_key: str | None
    documents: tuple[IndexReleaseDocumentRef, ...] = field(default_factory=tuple)
    embedding_provider: str = ""
    embedding_dimensions: int | None = None
    document_units_content_hash: str = ""
    chunk_fingerprint_hash: str = ""


@dataclass(frozen=True, slots=True)
class IndexReleaseArtifacts:
    manifest: IndexReleaseManifest
    manifest_object_key: str
    validation_summary_object_key: str | None


def default_release_id(*, now: datetime | None = None) -> str:
    runtime_now = now or datetime.now(UTC)
    return f"{runtime_now.strftime('r%Y%m%d_%H%M%S_%f')}_{uuid.uuid4().hex[:8]}"


def resolve_alias_target(
    *,
    qdrant_client: QdrantClient,
    alias_name: str,
) -> str | None:
    aliases = qdrant_client.get_aliases().aliases or []
    for alias in aliases:
        if alias.alias_name == alias_name:
            return alias.collection_name
    return None


def publish_release_alias(
    *,
    qdrant_client: QdrantClient,
    binding: QdrantIndexBinding,
    physical_collection_name: str,
) -> str | None:
    previous_collection_name = resolve_alias_target(
        qdrant_client=qdrant_client,
        alias_name=binding.alias_name,
    )
    if previous_collection_name == physical_collection_name:
        return previous_collection_name
    operations: list[qdrant_models.AliasOperations] = []
    if previous_collection_name is not None:
        operations.append(
            qdrant_models.DeleteAliasOperation(
                delete_alias=qdrant_models.DeleteAlias(alias_name=binding.alias_name)
            )
        )
    operations.append(
        qdrant_models.CreateAliasOperation(
            create_alias=qdrant_models.CreateAlias(
                collection_name=physical_collection_name,
                alias_name=binding.alias_name,
            )
        )
    )
    qdrant_client.update_collection_aliases(operations)
    return previous_collection_name


def unpublish_release_alias(
    *,
    qdrant_client: QdrantClient,
    binding: QdrantIndexBinding,
) -> str | None:
    previous_collection_name = resolve_alias_target(
        qdrant_client=qdrant_client,
        alias_name=binding.alias_name,
    )
    if previous_collection_name is None:
        return None
    qdrant_client.update_collection_aliases(
        [
            qdrant_models.DeleteAliasOperation(
                delete_alias=qdrant_models.DeleteAlias(alias_name=binding.alias_name)
            )
        ]
    )
    return previous_collection_name


def rollback_release_alias(
    *,
    qdrant_client: QdrantClient,
    binding: QdrantIndexBinding,
    target_collection_name: str,
) -> None:
    publish_release_alias(
        qdrant_client=qdrant_client,
        binding=binding,
        physical_collection_name=target_collection_name,
    )


def reset_index_binding(
    *,
    qdrant_client: QdrantClient,
    binding: QdrantIndexBinding,
) -> tuple[str, ...]:
    deleted: list[str] = []
    unpublish_release_alias(
        qdrant_client=qdrant_client,
        binding=binding,
    )
    for collection in qdrant_client.get_collections().collections or []:
        name = str(collection.name or "")
        if not name:
            continue
        if name == binding.alias_name or name.startswith(f"{binding.collection_prefix}__"):
            qdrant_client.delete_collection(name)
            deleted.append(name)
    return tuple(deleted)


def build_index_release_manifest(
    *,
    release_id: str,
    corpus: str,
    collection: str,
    binding: QdrantIndexBinding,
    physical_collection_name: str,
    previous_physical_collection_name: str | None,
    records: Sequence[DocumentRegistryRecord],
    chunks: Sequence[IndexableChunk],
    validation: IndexReleaseValidationResult,
    indexed_at: str,
    published_at: str | None,
    validation_summary_object_key: str | None,
    embedding_provider: str = "",
    embedding_dimensions: int | None = None,
    document_units_sha256_by_key: dict[str, str] | None = None,
) -> IndexReleaseManifest:
    if not chunks:
        raise ValueError("chunks must not be empty")
    runtime_document_units_sha256_by_key = dict(document_units_sha256_by_key or {})
    document_refs = tuple(
        IndexReleaseDocumentRef(
            document_id=record.document_id,
            revision_track=record.revision_track,
            version_id=record.version_id,
            document_units_object_key=record.document_units_object_key,
            document_units_sha256=(
                runtime_document_units_sha256_by_key.get(record.document_units_object_key or "")
                if record.document_units_object_key
                else None
            ),
        )
        for record in sorted(
            records, key=lambda item: (item.document_id, item.revision_track, item.version_id)
        )
    )
    return IndexReleaseManifest(
        release_id=release_id,
        corpus=corpus,
        collection=collection,
        serving_alias=binding.alias_name,
        physical_collection_name=physical_collection_name,
        previous_physical_collection_name=previous_physical_collection_name,
        cleaning_policy_version=str(chunks[0].metadata.get("cleaning_policy_version") or ""),
        chunk_policy_version=str(chunks[0].metadata.get("chunk_policy_version") or ""),
        embedding_model=_single_embedding_model(chunks),
        indexed_at=indexed_at,
        published_at=published_at,
        document_count=len(document_refs),
        point_count=len(chunks),
        document_version_ids_hash=_hash_values(
            f"{item.document_id}|{item.revision_track}|{item.version_id}" for item in document_refs
        ),
        document_units_keys_hash=_hash_values(
            item.document_units_object_key or "" for item in document_refs
        ),
        validation_status=validation.status,
        validation_summary_object_key=validation_summary_object_key,
        documents=document_refs,
        embedding_provider=embedding_provider,
        embedding_dimensions=(
            embedding_dimensions
            if embedding_dimensions is not None
            else _resolve_chunk_embedding_dimensions(chunks)
        ),
        document_units_content_hash=_hash_values(
            f"{item.document_id}|{item.revision_track}|{item.version_id}|{item.document_units_sha256 or ''}"
            for item in document_refs
        )
        if runtime_document_units_sha256_by_key
        else "",
        chunk_fingerprint_hash=_hash_chunk_fingerprint(chunks),
    )


def write_index_release_artifacts(
    *,
    writer: IndexReleaseWriter,
    bucket: str,
    manifest: IndexReleaseManifest,
    validation_summary: dict[str, object] | None,
) -> IndexReleaseArtifacts:
    validation_summary_object_key: str | None = None
    if validation_summary is not None:
        validation_summary_object_key = build_index_release_artifact_key(
            corpus=manifest.corpus,
            collection=manifest.collection,
            release_id=manifest.release_id,
            filename="validation-summary.json",
        )
        writer.put_bytes(
            bucket=bucket,
            key=validation_summary_object_key,
            data=(json.dumps(validation_summary, ensure_ascii=False, indent=2) + "\n").encode(
                "utf-8"
            ),
            content_type="application/json",
        )
    runtime_manifest = manifest
    if validation_summary_object_key != manifest.validation_summary_object_key:
        runtime_manifest = IndexReleaseManifest(
            release_id=manifest.release_id,
            corpus=manifest.corpus,
            collection=manifest.collection,
            serving_alias=manifest.serving_alias,
            physical_collection_name=manifest.physical_collection_name,
            previous_physical_collection_name=manifest.previous_physical_collection_name,
            cleaning_policy_version=manifest.cleaning_policy_version,
            chunk_policy_version=manifest.chunk_policy_version,
            embedding_model=manifest.embedding_model,
            indexed_at=manifest.indexed_at,
            published_at=manifest.published_at,
            document_count=manifest.document_count,
            point_count=manifest.point_count,
            document_version_ids_hash=manifest.document_version_ids_hash,
            document_units_keys_hash=manifest.document_units_keys_hash,
            validation_status=manifest.validation_status,
            validation_summary_object_key=validation_summary_object_key,
            documents=manifest.documents,
            embedding_provider=manifest.embedding_provider,
            embedding_dimensions=manifest.embedding_dimensions,
            document_units_content_hash=manifest.document_units_content_hash,
            chunk_fingerprint_hash=manifest.chunk_fingerprint_hash,
        )
    manifest_object_key = build_index_release_artifact_key(
        corpus=runtime_manifest.corpus,
        collection=runtime_manifest.collection,
        release_id=runtime_manifest.release_id,
        filename="index-release.json",
    )
    writer.put_bytes(
        bucket=bucket,
        key=manifest_object_key,
        data=(json.dumps(asdict(runtime_manifest), ensure_ascii=False, indent=2) + "\n").encode(
            "utf-8"
        ),
        content_type="application/json",
    )
    return IndexReleaseArtifacts(
        manifest=runtime_manifest,
        manifest_object_key=manifest_object_key,
        validation_summary_object_key=validation_summary_object_key,
    )


def build_release_metadata_payload(
    *,
    manifest: IndexReleaseManifest,
    manifest_object_key: str,
) -> dict[str, object]:
    return {
        "index_release_id": manifest.release_id,
        "index_release_manifest_key": manifest_object_key,
        "index_release_alias": manifest.serving_alias,
        "index_physical_collection_name": manifest.physical_collection_name,
        "chunk_policy_version": manifest.chunk_policy_version,
        "cleaning_policy_version": manifest.cleaning_policy_version,
        "index_validation_status": manifest.validation_status,
        "embedding_provider": manifest.embedding_provider,
        "embedding_model": manifest.embedding_model,
        "embedding_dimensions": manifest.embedding_dimensions,
        "document_units_content_hash": manifest.document_units_content_hash,
        "chunk_fingerprint_hash": manifest.chunk_fingerprint_hash,
    }


def validate_scope_release(
    *,
    corpus: str,
    collection: str,
    chunks: Sequence[IndexableChunk],
) -> IndexReleaseValidationResult:
    if collection == "curriculum_plan":
        return _validate_curriculum_release(chunks)
    if corpus == "official_web":
        return _validate_official_web_release(chunks)
    return _validate_default_release(chunks)


def _validate_default_release(chunks: Sequence[IndexableChunk]) -> IndexReleaseValidationResult:
    token_counts = [int(chunk.metadata.get("final_token_count") or 0) for chunk in chunks]
    summary = {
        "chunk_count": len(chunks),
        "unit_type_counts": _count_by_value(
            str(chunk.metadata.get("unit_type") or "unknown") for chunk in chunks
        ),
        "token_summary": {
            "min": min(token_counts) if token_counts else 0,
            "max": max(token_counts) if token_counts else 0,
            "avg": round(sum(token_counts) / len(token_counts), 2) if token_counts else 0.0,
        },
    }
    return IndexReleaseValidationResult(status="passed", summary=summary)


def _validate_official_web_release(
    chunks: Sequence[IndexableChunk],
) -> IndexReleaseValidationResult:
    token_counts = [int(chunk.metadata.get("final_token_count") or 0) for chunk in chunks]
    page_family_counts = _count_by_value(
        str(chunk.metadata.get("page_family") or "unknown") for chunk in chunks
    )
    serving_intent_counts = _count_by_value(
        str(chunk.metadata.get("serving_intent") or "unknown") for chunk in chunks
    )
    disallowed_page_family_chunks = sum(
        count
        for page_family, count in page_family_counts.items()
        if page_family in _OFFICIAL_WEB_DISALLOWED_PAGE_FAMILIES
    )
    audit_only_chunks = int(serving_intent_counts.get("audit_only") or 0)
    promotable_chunks = int(serving_intent_counts.get("promotable") or 0)
    non_promotable_serving_intent_chunks = max(len(chunks) - promotable_chunks, 0)
    unknown_serving_intent_chunks = int(serving_intent_counts.get("unknown") or 0)
    missing_page_family_chunks = int(page_family_counts.get("unknown") or 0)
    document_count = len({chunk.document_id for chunk in chunks})
    summary = {
        "chunk_count": len(chunks),
        "document_count": document_count,
        "documents_below_minimum": 1 if document_count < _OFFICIAL_WEB_MIN_RELEASE_DOCUMENTS else 0,
        "disallowed_page_family_chunks": disallowed_page_family_chunks,
        "audit_only_chunks": audit_only_chunks,
        "non_promotable_serving_intent_chunks": non_promotable_serving_intent_chunks,
        "unknown_serving_intent_chunks": unknown_serving_intent_chunks,
        "missing_page_family_chunks": missing_page_family_chunks,
        "page_family_counts": page_family_counts,
        "serving_intent_counts": serving_intent_counts,
        "unit_type_counts": _count_by_value(
            str(chunk.metadata.get("unit_type") or "unknown") for chunk in chunks
        ),
        "token_summary": {
            "min": min(token_counts) if token_counts else 0,
            "max": max(token_counts) if token_counts else 0,
            "avg": round(sum(token_counts) / len(token_counts), 2) if token_counts else 0.0,
        },
    }
    status = (
        "passed"
        if summary["documents_below_minimum"] == 0
        and disallowed_page_family_chunks == 0
        and non_promotable_serving_intent_chunks == 0
        and missing_page_family_chunks == 0
        else "failed"
    )
    return IndexReleaseValidationResult(status=status, summary=summary)


def _validate_curriculum_release(chunks: Sequence[IndexableChunk]) -> IndexReleaseValidationResult:
    rows: list[dict[str, object]] = []
    for chunk in chunks:
        lines = [line.strip() for line in chunk.text.splitlines() if line.strip()]
        leading = _leading_curriculum_heading_lines(lines)
        structural = _normalize_curriculum_structural_path(
            list(chunk.anchor.get("section_path") or [])
        )
        first_heading = leading[0] if leading else None
        rows.append(
            {
                "tokens": int(chunk.metadata.get("final_token_count") or 0),
                "duplicated_heading": any(a == b for a, b in pairwise(leading)),
                "path_mismatch": (
                    chunk.metadata.get("unit_type") == "section_text"
                    and bool(leading)
                    and not _curriculum_has_heading_overlap(structural, leading)
                ),
                "first_heading_mismatch": bool(
                    chunk.metadata.get("unit_type") == "section_text"
                    and first_heading
                    and structural
                    and first_heading != structural[0]
                ),
                "multiple_top_level_heading_chunks": bool(
                    sum(
                        1
                        for heading in leading
                        if heading and heading[:1] in "一二三四五六七八九十" and "、" in heading
                    )
                    >= 2
                ),
                "allowed_tiny_chunk": _curriculum_is_allowed_tiny_chunk(
                    chunk=chunk,
                    lines=lines,
                    leading=leading,
                    structural=structural,
                ),
                "course_map_chunk": bool(
                    (chunk.anchor.get("section_path") or [])[-1:]
                    == [_CURRICULUM_COURSE_MAP_HEADING]
                ),
                "topology_leak": "拓扑图" in chunk.text
                and (chunk.anchor.get("section_path") or [])[-1:]
                != [_CURRICULUM_COURSE_MAP_HEADING],
            }
        )
    summary = {
        "chunk_count": len(chunks),
        "duplicated_heading_chunks": sum(1 for row in rows if row["duplicated_heading"]),
        "path_mismatch_chunks": sum(1 for row in rows if row["path_mismatch"]),
        "first_heading_mismatch_chunks": sum(1 for row in rows if row["first_heading_mismatch"]),
        "multiple_top_level_heading_chunks": sum(
            1 for row in rows if row["multiple_top_level_heading_chunks"]
        ),
        "tiny_chunks_lt24": sum(
            1 for row in rows if int(row["tokens"]) < 24 and not row["allowed_tiny_chunk"]
        ),
        "course_map_chunks": sum(1 for row in rows if row["course_map_chunk"]),
        "topology_leaks": sum(1 for row in rows if row["topology_leak"]),
    }
    status = (
        "passed"
        if all(
            int(value) == 0
            for key, value in summary.items()
            if key not in {"chunk_count", "course_map_chunks"}
        )
        else "failed"
    )
    return IndexReleaseValidationResult(status=status, summary=summary)


def _curriculum_has_heading_overlap(structural_path: list[str], leading: list[str]) -> bool:
    if not leading:
        return True
    for start in range(len(leading)):
        max_overlap = min(len(structural_path), len(leading) - start)
        for overlap in range(max_overlap, 0, -1):
            if leading[start : start + overlap] == structural_path[-overlap:]:
                return True
    return False


def _curriculum_is_allowed_tiny_chunk(
    *,
    chunk: IndexableChunk,
    lines: list[str],
    leading: list[str],
    structural: list[str],
) -> bool:
    if int(chunk.metadata.get("final_token_count") or 0) >= 24:
        return False
    if chunk.metadata.get("unit_type") != "section_text":
        return False
    if any("|" in line for line in lines):
        return False
    if (chunk.anchor.get("section_path") or [])[-1:] == [_CURRICULUM_COURSE_MAP_HEADING]:
        if not lines or len(lines) > 3:
            return False
        remainder = lines[len(leading) :] if leading else lines
        if not remainder:
            return True
        if any(
            _looks_like_curriculum_structure_heading(line)
            and line != _CURRICULUM_COURSE_MAP_HEADING
            for line in remainder
        ):
            return False
        return all(len(line) <= 32 for line in remainder)
    if "拓扑图" in chunk.text:
        return False
    if not lines or len(lines) > 4:
        return False
    if leading and len(leading) == len(lines):
        return True
    if structural and len(lines) == 1 and lines[0] == structural[-1]:
        return True
    if (
        structural
        and lines[0] == structural[-1]
        and all(_looks_like_curriculum_version_note(line) for line in lines[1:])
    ):
        return True
    if not leading:
        return False
    remainder = lines[len(leading) :]
    if not remainder or len(remainder) > 2:
        return False
    heading_remainder = [
        line for line in remainder if _looks_like_curriculum_structure_heading(line)
    ]
    if heading_remainder:
        non_heading_remainder = [
            line for line in remainder if not _looks_like_curriculum_structure_heading(line)
        ]
        return (
            len(heading_remainder) == 1
            and len(non_heading_remainder) == 1
            and len(non_heading_remainder[0]) <= 8
            and len(heading_remainder[0]) <= 16
        )
    return all(len(line) <= 32 for line in remainder)


def _count_by_value(values: Sequence[str] | Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts


def _hash_values(values: Sequence[str] | Any) -> str:
    digest = hashlib.sha256()
    for value in sorted(str(item) for item in values):
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _single_embedding_model(chunks: Sequence[IndexableChunk]) -> str:
    models = {chunk.embedding_model for chunk in chunks if chunk.embedding_model.strip()}
    if not models:
        return ""
    if len(models) != 1:
        raise ValueError("index release chunks must use a single embedding model")
    return next(iter(models))


def _resolve_chunk_embedding_dimensions(chunks: Sequence[IndexableChunk]) -> int | None:
    dimensions = {len(chunk.embedding) for chunk in chunks if chunk.embedding is not None}
    if not dimensions:
        return None
    if len(dimensions) != 1:
        raise ValueError("index release chunks must use one dense embedding dimension")
    return next(iter(dimensions))


def _hash_chunk_fingerprint(chunks: Sequence[IndexableChunk]) -> str:
    digest = hashlib.sha256()
    for chunk in sorted(chunks, key=lambda item: item.chunk_id):
        payload = {
            "chunk_id": chunk.chunk_id,
            "document_id": chunk.document_id,
            "revision_track": chunk.revision_track,
            "version_id": chunk.version_id,
            "chunk_order": chunk.chunk_order,
            "source_chunk_id": chunk.source_chunk_id,
            "text_sha256": hashlib.sha256(chunk.text.encode("utf-8")).hexdigest(),
            "embedding_model": chunk.embedding_model,
            "metadata": chunk.metadata,
        }
        digest.update(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()
