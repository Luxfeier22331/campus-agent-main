from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from typing import Protocol

from campus_ingestion_core.chunking_tokenizers import DEFAULT_TOKENIZER_NAME
from campus_ingestion_core.corpus_profiles import load_chunk_profile
from campus_ingestion_core.process import IndexableChunk

CHUNKER_IMPLEMENTATION_VERSION = "registry_scope_chunker_v1"


class ChunkPreparationManifestLike(Protocol):
    preparation_run_id: str
    corpus: str
    collection: str
    tokenizer_name: str
    chunker_implementation_version: str
    normalizer_version: str
    document_units_schema_version: str
    chunk_preparation_provenance_hash: str


def hash_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def hash_chunk_profile(*, corpus: str, collection: str) -> str:
    profile = load_chunk_profile(corpus, collection)
    return hashlib.sha256(
        json.dumps(asdict(profile), ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def resolve_chunk_preparation_provenance(*, corpus: str, collection: str) -> dict[str, str]:
    profile = load_chunk_profile(corpus, collection)
    return {
        "tokenizer_name": DEFAULT_TOKENIZER_NAME,
        "tokenizer_package_version": "",
        "chunker_implementation_version": CHUNKER_IMPLEMENTATION_VERSION,
        "normalizer_version": profile.cleaning_policy_version,
        "document_units_schema_version": profile.structured_input,
    }


def hash_chunk_preparation_provenance(provenance: Mapping[str, str]) -> str:
    return hashlib.sha256(
        json.dumps(dict(provenance), ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def verify_chunk_preparation_provenance(manifest: ChunkPreparationManifestLike) -> None:
    expected = resolve_chunk_preparation_provenance(
        corpus=manifest.corpus,
        collection=manifest.collection,
    )
    if not manifest.tokenizer_name:
        raise ValueError(
            "chunk preparation tokenizer identity is missing for "
            f"{manifest.corpus}/{manifest.collection} run {manifest.preparation_run_id}"
        )
    if manifest.tokenizer_name != expected["tokenizer_name"]:
        raise ValueError(
            "chunk preparation tokenizer identity does not match current runtime for "
            f"{manifest.corpus}/{manifest.collection}"
        )
    if manifest.chunker_implementation_version != expected["chunker_implementation_version"]:
        raise ValueError(
            "chunk preparation chunker implementation identity does not match current runtime for "
            f"{manifest.corpus}/{manifest.collection}"
        )
    if manifest.normalizer_version != expected["normalizer_version"]:
        raise ValueError(
            "chunk preparation normalizer identity does not match current runtime for "
            f"{manifest.corpus}/{manifest.collection}"
        )
    if manifest.document_units_schema_version != expected["document_units_schema_version"]:
        raise ValueError(
            "chunk preparation document-units schema identity does not match current runtime for "
            f"{manifest.corpus}/{manifest.collection}"
        )
    expected_hash = hash_chunk_preparation_provenance(expected)
    if manifest.chunk_preparation_provenance_hash != expected_hash:
        raise ValueError(
            "chunk preparation provenance hash does not match current runtime for "
            f"{manifest.corpus}/{manifest.collection}"
        )


def hash_chunk_fingerprint(chunks: Sequence[IndexableChunk]) -> str:
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
            "metadata": chunk.metadata,
        }
        digest.update(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


__all__ = [
    "hash_bytes",
    "hash_chunk_fingerprint",
    "hash_chunk_preparation_provenance",
    "hash_chunk_profile",
    "resolve_chunk_preparation_provenance",
    "verify_chunk_preparation_provenance",
]
