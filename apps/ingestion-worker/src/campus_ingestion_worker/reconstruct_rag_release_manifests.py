from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.index_release_hashing import hash_values
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_retrieval_core.backend_qdrant_runtime import _build_qdrant_client
from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.probe_regulation_rag_release_runtime import (
    DEFAULT_RAG_SURFACE_SCOPES,
    _parse_scope,
)

_SAMPLE_LIMIT = 256
_REQUIRED_PAYLOAD_FIELDS = (
    "index_release_id",
    "index_release_manifest_key",
    "index_release_alias",
    "index_physical_collection_name",
    "chunk_policy_version",
    "cleaning_policy_version",
    "index_validation_status",
    "embedding_provider",
    "embedding_model",
    "embedding_dimensions",
)
_OPTIONAL_COPY_FIELDS = (
    "document_units_content_hash",
    "chunk_fingerprint_hash",
    "retrieval_acceptance_status",
    "retrieval_acceptance_summary_object_key",
    "sparse_provider",
    "sparse_model",
    "sparse_tokenizer",
    "sparse_language",
    "dense_vector_name",
    "sparse_vector_name",
    "dense_prefetch_limit",
    "sparse_prefetch_limit",
    "rrf_k",
    "rrf_dense_weight",
    "rrf_sparse_weight",
    "reranker_enabled_by_default",
    "reranker_top_n",
    "reranker_profile_version",
    "reranker_adoption_evidence_id",
    "embedding_query_instruction_hash",
    "hybrid_query_profile_hash",
    "profile_identity_hash",
    "quality_gate_status",
    "quality_gate_summary_object_key",
    "chunk_quality_status",
    "qrels_coverage_status",
    "release_metadata_consistency_status",
    "release_admission_manifest_key",
    "release_admission_status",
    "component_eval_status",
    "component_eval_summary_object_key",
)


class ObjectStoreWriter(Protocol):
    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


@dataclass(frozen=True, slots=True)
class ReconstructedReleaseManifest:
    release_id: str
    corpus: str
    collection: str
    serving_alias: str
    physical_collection_name: str
    previous_physical_collection_name: None
    cleaning_policy_version: str
    chunk_policy_version: str
    embedding_model: str
    indexed_at: str
    published_at: str
    document_count: int
    point_count: int
    document_version_ids_hash: str
    document_units_keys_hash: str
    validation_status: str
    validation_summary_object_key: None
    documents: tuple[dict[str, object | None], ...]
    embedding_provider: str
    embedding_dimensions: int | None
    document_units_content_hash: str
    chunk_fingerprint_hash: str
    retrieval_acceptance_status: str
    retrieval_acceptance_summary_object_key: str | None
    sparse_provider: str
    sparse_model: str
    sparse_tokenizer: str
    sparse_language: str
    dense_vector_name: str
    sparse_vector_name: str
    dense_prefetch_limit: int
    sparse_prefetch_limit: int
    rrf_k: int
    rrf_dense_weight: float
    rrf_sparse_weight: float
    reranker_enabled_by_default: bool
    reranker_top_n: int | None
    reranker_profile_version: str
    reranker_adoption_evidence_id: str
    embedding_query_instruction_hash: str
    hybrid_query_profile_hash: str
    profile_identity_hash: str
    quality_gate_status: str
    quality_gate_summary_object_key: str | None
    chunk_quality_status: str
    qrels_coverage_status: str
    release_metadata_consistency_status: str
    release_admission_manifest_key: str | None
    release_admission_status: str
    component_eval_status: str
    component_eval_summary_object_key: str | None
    post_publish_audit_status: str
    post_publish_audit_summary_object_key: None
    reconstruction_source: dict[str, object]


@dataclass(frozen=True, slots=True)
class ReconstructionResult:
    scope: str
    corpus: str
    collection: str
    status: str
    action: str
    release_id: str
    alias_name: str
    physical_collection_name: str
    manifest_object_key: str
    point_count: int
    document_count: int
    snapshot_manifest_path: str
    wrote_object: bool


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Reconstruct missing RAG index-release manifests from live Qdrant release payloads and native filesystem snapshot manifests."
    )
    parser.add_argument(
        "--scope",
        action="append",
        default=None,
        help="Optional corpus/collection scope. Defaults to all current RAG consumption surfaces.",
    )
    parser.add_argument(
        "--backup-root",
        required=True,
        help="Native Qdrant snapshot backup root containing */backup-manifest.json files.",
    )
    parser.add_argument(
        "--report-path", required=True, help="Path for reconstruction evidence JSON."
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write reconstructed manifests to the derived object-store bucket. Omit for dry-run.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    loaded_env_path = load_worker_env()
    settings = RetrievalSettings.from_env()
    qdrant_client = _build_qdrant_client(settings)
    object_store_settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(object_store_settings)
    report = reconstruct_release_manifests(
        scopes=tuple(args.scope or DEFAULT_RAG_SURFACE_SCOPES),
        backup_root=Path(args.backup_root),
        report_path=Path(args.report_path),
        write=bool(args.write),
        qdrant_client=qdrant_client,
        object_store=object_store,
        bucket=object_store_settings.bucket_derived,
        loaded_env_path=str(loaded_env_path) if loaded_env_path else None,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def reconstruct_release_manifests(
    *,
    scopes: Sequence[str],
    backup_root: Path,
    report_path: Path,
    write: bool,
    qdrant_client: Any,
    object_store: ObjectStoreWriter,
    bucket: str,
    loaded_env_path: str | None = None,
) -> dict[str, object]:
    if not scopes:
        raise ValueError("at least one scope is required")
    if not bucket.strip():
        raise ValueError("derived object-store bucket is required")
    backup_root = backup_root.resolve()
    if not backup_root.exists() or not backup_root.is_dir():
        raise ValueError(f"backup root does not exist or is not a directory: {backup_root}")
    results = [
        _reconstruct_scope(
            corpus=corpus,
            collection=collection,
            backup_root=backup_root,
            write=write,
            qdrant_client=qdrant_client,
            object_store=object_store,
            bucket=bucket,
        )
        for corpus, collection in (_parse_scope(scope) for scope in scopes)
    ]
    report = {
        "schema_version": "rag_release_manifest_reconstruction.v1",
        "loaded_env_path": loaded_env_path,
        "mode": "write" if write else "dry_run",
        "backup_root": str(backup_root),
        "object_store_bucket_derived": bucket,
        "surfaces": [asdict(item) for item in results],
        "reconstructed_count": len(results),
        "written_count": len([item for item in results if item.wrote_object]),
        "secrets_redacted": True,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return report


def _reconstruct_scope(
    *,
    corpus: str,
    collection: str,
    backup_root: Path,
    write: bool,
    qdrant_client: Any,
    object_store: ObjectStoreWriter,
    bucket: str,
) -> ReconstructionResult:
    profile = load_runtime_profile(corpus, collection)
    alias_name = profile.qdrant_index_binding.alias_name
    physical_collection_name = resolve_alias_target(
        qdrant_client=qdrant_client, alias_name=alias_name
    )
    if not physical_collection_name:
        raise ValueError(f"alias_not_found:{corpus}/{collection}:{alias_name}")
    point_count = _collection_points_count(
        qdrant_client=qdrant_client, collection_name=physical_collection_name
    )
    if point_count <= 0:
        raise ValueError(f"collection_empty:{physical_collection_name}")
    payloads = _sample_payloads(
        qdrant_client=qdrant_client,
        collection_name=physical_collection_name,
        sample_limit=min(max(point_count, 1), _SAMPLE_LIMIT),
    )
    if not payloads:
        raise ValueError(f"collection_payload_sample_empty:{physical_collection_name}")
    sample_payload = _validate_consistent_payloads(
        payloads=payloads,
        corpus=corpus,
        collection=collection,
        alias_name=alias_name,
        physical_collection_name=physical_collection_name,
    )
    release_id = _required_text(sample_payload, "index_release_id")
    manifest_key = build_index_release_artifact_key(
        corpus=corpus, collection=collection, release_id=release_id, filename="index-release.json"
    )
    payload_manifest_key = _required_text(sample_payload, "index_release_manifest_key")
    if payload_manifest_key != manifest_key:
        raise ValueError(
            f"payload_manifest_key_mismatch:{corpus}/{collection}:{payload_manifest_key}!={manifest_key}"
        )
    snapshot_manifest_path, snapshot_manifest = _find_snapshot_manifest(
        backup_root=backup_root,
        corpus=corpus,
        collection=collection,
        release_id=release_id,
        physical_collection_name=physical_collection_name,
        alias_name=alias_name,
        manifest_key=manifest_key,
        point_count=point_count,
    )
    documents = _derive_documents(payloads)
    manifest = _build_manifest(
        corpus=corpus,
        collection=collection,
        alias_name=alias_name,
        physical_collection_name=physical_collection_name,
        release_id=release_id,
        manifest_key=manifest_key,
        point_count=point_count,
        documents=documents,
        sample_payload=sample_payload,
        snapshot_manifest_path=snapshot_manifest_path,
        snapshot_manifest=snapshot_manifest,
    )
    if write:
        object_store.put_bytes(
            bucket=bucket,
            key=manifest_key,
            data=(
                json.dumps(asdict(manifest), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
            ).encode("utf-8"),
            content_type="application/json",
        )
    return ReconstructionResult(
        scope=f"{corpus}/{collection}",
        corpus=corpus,
        collection=collection,
        status="reconstructed",
        action="write" if write else "dry_run",
        release_id=release_id,
        alias_name=alias_name,
        physical_collection_name=physical_collection_name,
        manifest_object_key=manifest_key,
        point_count=point_count,
        document_count=len(documents),
        snapshot_manifest_path=str(snapshot_manifest_path),
        wrote_object=write,
    )


def _collection_points_count(*, qdrant_client: Any, collection_name: str) -> int:
    info = qdrant_client.get_collection(collection_name=collection_name)
    points_count = getattr(info, "points_count", None)
    if points_count is None:
        raise ValueError(f"collection_points_count_missing:{collection_name}")
    return int(points_count)


def _sample_payloads(
    *, qdrant_client: Any, collection_name: str, sample_limit: int
) -> tuple[dict[str, object], ...]:
    records, _ = qdrant_client.scroll(
        collection_name=collection_name,
        limit=max(sample_limit, 1),
        with_payload=True,
        with_vectors=False,
    )
    payloads = []
    for record in records or ():
        payload = getattr(record, "payload", None)
        payloads.append(dict(payload or {}) if isinstance(payload, Mapping) else {})
    return tuple(payloads)


def _validate_consistent_payloads(
    *,
    payloads: Sequence[Mapping[str, object]],
    corpus: str,
    collection: str,
    alias_name: str,
    physical_collection_name: str,
) -> Mapping[str, object]:
    first = payloads[0]
    missing = [field for field in _REQUIRED_PAYLOAD_FIELDS if _text(first.get(field)) == ""]
    if missing:
        raise ValueError(f"missing_payload_fields:{corpus}/{collection}:" + ",".join(missing))
    expected = {
        field: _normalize_payload_value(first.get(field))
        for field in (*_REQUIRED_PAYLOAD_FIELDS, *_OPTIONAL_COPY_FIELDS)
        if field in first
    }
    for index, payload in enumerate(payloads, start=1):
        for field in _REQUIRED_PAYLOAD_FIELDS:
            if _text(payload.get(field)) == "":
                raise ValueError(
                    f"sample_{index}_missing_payload_field:{corpus}/{collection}:{field}"
                )
        for field, expected_value in expected.items():
            if field in payload and _normalize_payload_value(payload.get(field)) != expected_value:
                raise ValueError(
                    f"sample_{index}_payload_metadata_mismatch:{corpus}/{collection}:{field}"
                )
    if _text(first.get("index_release_alias")) != alias_name:
        raise ValueError(f"payload_alias_mismatch:{corpus}/{collection}")
    if _text(first.get("index_physical_collection_name")) != physical_collection_name:
        raise ValueError(f"payload_physical_collection_mismatch:{corpus}/{collection}")
    return first


def _find_snapshot_manifest(
    *,
    backup_root: Path,
    corpus: str,
    collection: str,
    release_id: str,
    physical_collection_name: str,
    alias_name: str,
    manifest_key: str,
    point_count: int,
) -> tuple[Path, Mapping[str, object]]:
    candidates = sorted(
        (backup_root / corpus / collection / release_id).glob("*/backup-manifest.json")
    )
    if not candidates:
        raise ValueError(f"missing_snapshot_manifest:{corpus}/{collection}/{release_id}")
    matched: list[tuple[Path, Mapping[str, object]]] = []
    errors: list[str] = []
    for path in candidates:
        payload = json.loads(path.read_text(encoding="utf-8"))
        issues = []
        if _text(payload.get("physical_collection_name")) != physical_collection_name:
            issues.append("physical_collection_name")
        if _text(payload.get("release_id")) != release_id:
            issues.append("release_id")
        if _text(payload.get("serving_alias")) != alias_name:
            issues.append("serving_alias")
        if _text(payload.get("index_release_manifest_key")) != manifest_key:
            issues.append("index_release_manifest_key")
        if int(payload.get("point_count") or -1) != point_count:
            issues.append("point_count")
        if issues:
            errors.append(f"{path}:" + ",".join(issues))
            continue
        matched.append((path, payload))
    if len(matched) != 1:
        detail = ";".join(errors)
        raise ValueError(
            f"snapshot_manifest_match_count:{corpus}/{collection}/{release_id}:{len(matched)}:{detail}"
        )
    return matched[0]


def _derive_documents(
    payloads: Sequence[Mapping[str, object]],
) -> tuple[dict[str, object | None], ...]:
    documents: dict[tuple[str, str, str], dict[str, object | None]] = {}
    for payload in payloads:
        document_id = _first_text(payload, "document_id", "source_document_id", "doc_id")
        version_id = _first_text(payload, "version_id", "document_version_id", "source_version_id")
        revision_track = (
            _first_text(payload, "revision_track", "document_revision_track") or "current"
        )
        if not document_id or not version_id:
            continue
        key = (document_id, revision_track, version_id)
        documents.setdefault(
            key,
            {
                "document_id": document_id,
                "revision_track": revision_track,
                "version_id": version_id,
                "document_units_object_key": _first_text(
                    payload, "document_units_object_key", "source_document_units_object_key"
                )
                or None,
                "document_units_sha256": _first_text(
                    payload, "document_units_sha256", "source_document_units_sha256"
                )
                or None,
            },
        )
    if not documents:
        raise ValueError("document_refs_unavailable_from_qdrant_payload")
    return tuple(documents[key] for key in sorted(documents))


def _build_manifest(
    *,
    corpus: str,
    collection: str,
    alias_name: str,
    physical_collection_name: str,
    release_id: str,
    manifest_key: str,
    point_count: int,
    documents: Sequence[Mapping[str, object | None]],
    sample_payload: Mapping[str, object],
    snapshot_manifest_path: Path,
    snapshot_manifest: Mapping[str, object],
) -> ReconstructedReleaseManifest:
    document_version_ids_hash = hash_values(
        f"{item['document_id']}|{item['revision_track']}|{item['version_id']}" for item in documents
    )
    document_units_keys_hash = hash_values(
        str(item.get("document_units_object_key") or "") for item in documents
    )
    return ReconstructedReleaseManifest(
        release_id=release_id,
        corpus=corpus,
        collection=collection,
        serving_alias=alias_name,
        physical_collection_name=physical_collection_name,
        previous_physical_collection_name=None,
        cleaning_policy_version=_required_text(sample_payload, "cleaning_policy_version"),
        chunk_policy_version=_required_text(sample_payload, "chunk_policy_version"),
        embedding_model=_required_text(sample_payload, "embedding_model"),
        indexed_at=_required_snapshot_text(snapshot_manifest, "captured_at"),
        published_at=_required_snapshot_text(snapshot_manifest, "captured_at"),
        document_count=len(documents),
        point_count=point_count,
        document_version_ids_hash=document_version_ids_hash,
        document_units_keys_hash=document_units_keys_hash,
        validation_status=_required_text(sample_payload, "index_validation_status"),
        validation_summary_object_key=None,
        documents=tuple(dict(item) for item in documents),
        embedding_provider=_required_text(sample_payload, "embedding_provider"),
        embedding_dimensions=_optional_int(sample_payload.get("embedding_dimensions")),
        document_units_content_hash=_optional_text(sample_payload, "document_units_content_hash"),
        chunk_fingerprint_hash=_optional_text(sample_payload, "chunk_fingerprint_hash"),
        retrieval_acceptance_status=_optional_text(sample_payload, "retrieval_acceptance_status"),
        retrieval_acceptance_summary_object_key=_optional_text_or_none(
            sample_payload, "retrieval_acceptance_summary_object_key"
        ),
        sparse_provider=_optional_text(sample_payload, "sparse_provider"),
        sparse_model=_optional_text(sample_payload, "sparse_model"),
        sparse_tokenizer=_optional_text(sample_payload, "sparse_tokenizer"),
        sparse_language=_optional_text(sample_payload, "sparse_language"),
        dense_vector_name=_optional_text(sample_payload, "dense_vector_name"),
        sparse_vector_name=_optional_text(sample_payload, "sparse_vector_name"),
        dense_prefetch_limit=_optional_int(sample_payload.get("dense_prefetch_limit")) or 0,
        sparse_prefetch_limit=_optional_int(sample_payload.get("sparse_prefetch_limit")) or 0,
        rrf_k=_optional_int(sample_payload.get("rrf_k")) or 0,
        rrf_dense_weight=_optional_float(sample_payload.get("rrf_dense_weight")),
        rrf_sparse_weight=_optional_float(sample_payload.get("rrf_sparse_weight")),
        reranker_enabled_by_default=bool(
            sample_payload.get("reranker_enabled_by_default") or False
        ),
        reranker_top_n=_optional_int(sample_payload.get("reranker_top_n")),
        reranker_profile_version=_optional_text(sample_payload, "reranker_profile_version"),
        reranker_adoption_evidence_id=_optional_text(
            sample_payload, "reranker_adoption_evidence_id"
        ),
        embedding_query_instruction_hash=_optional_text(
            sample_payload, "embedding_query_instruction_hash"
        ),
        hybrid_query_profile_hash=_optional_text(sample_payload, "hybrid_query_profile_hash"),
        profile_identity_hash=_optional_text(sample_payload, "profile_identity_hash"),
        quality_gate_status=_optional_text(sample_payload, "quality_gate_status"),
        quality_gate_summary_object_key=_optional_text_or_none(
            sample_payload, "quality_gate_summary_object_key"
        ),
        chunk_quality_status=_optional_text(sample_payload, "chunk_quality_status"),
        qrels_coverage_status=_optional_text(sample_payload, "qrels_coverage_status")
        or "not_applicable",
        release_metadata_consistency_status=_optional_text(
            sample_payload, "release_metadata_consistency_status"
        ),
        release_admission_manifest_key=_optional_text_or_none(
            sample_payload, "release_admission_manifest_key"
        ),
        release_admission_status=_optional_text(sample_payload, "release_admission_status"),
        component_eval_status=_optional_text(sample_payload, "component_eval_status"),
        component_eval_summary_object_key=_optional_text_or_none(
            sample_payload, "component_eval_summary_object_key"
        ),
        post_publish_audit_status="",
        post_publish_audit_summary_object_key=None,
        reconstruction_source={
            "schema_version": "rag_release_manifest_reconstruction_source.v1",
            "source": "live_qdrant_payload_and_native_snapshot_manifest",
            "manifest_object_key": manifest_key,
            "snapshot_manifest_path": str(snapshot_manifest_path),
            "snapshot_backup_id": _optional_text(snapshot_manifest, "backup_id"),
            "sample_limit": _SAMPLE_LIMIT,
            "derived_hashes": {
                "document_version_ids_hash": "qdrant_payload_document_refs",
                "document_units_keys_hash": "qdrant_payload_document_refs",
            },
        },
    )


def _required_text(payload: Mapping[str, object], field: str) -> str:
    value = _text(payload.get(field))
    if not value:
        raise ValueError(f"missing_required_field:{field}")
    return value


def _required_snapshot_text(payload: Mapping[str, object], field: str) -> str:
    value = _text(payload.get(field))
    if not value:
        raise ValueError(f"missing_snapshot_field:{field}")
    return value


def _optional_text(payload: Mapping[str, object], field: str) -> str:
    return _text(payload.get(field))


def _optional_text_or_none(payload: Mapping[str, object], field: str) -> str | None:
    value = _text(payload.get(field))
    return value or None


def _optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _optional_float(value: object) -> float:
    if value is None or value == "":
        return 0.0
    return float(value)


def _first_text(payload: Mapping[str, object], *fields: str) -> str:
    for field in fields:
        value = _text(payload.get(field))
        if value:
            return value
    return ""


def _text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _normalize_payload_value(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


__all__ = ["build_parser", "main", "reconstruct_release_manifests"]


if __name__ == "__main__":
    main()
