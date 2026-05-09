from __future__ import annotations

import argparse
import json
from collections.abc import Sequence

from campus_ingestion_core.index_release import (
    build_release_metadata_payload,
    load_index_release_manifest,
    write_index_release_artifacts,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.registry_scope_release import audit_published_scope_release
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_retrieval_core.backend_qdrant_runtime import _build_qdrant_client
from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Re-run post-publish audit for an existing regulation RAG release and rewrite audit artifacts."
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--release-id", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    object_store_settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(object_store_settings)
    manifest = load_index_release_manifest(
        reader=object_store,
        bucket=object_store_settings.bucket_derived,
        corpus=args.corpus,
        collection=args.collection,
        release_id=args.release_id,
    )
    manifest_object_key = (
        f"{args.corpus}/releases/{args.collection}/{args.release_id}/index-release.json"
    )
    qdrant_client = _build_qdrant_client(RetrievalSettings.from_env())
    prepublish_expected_metadata = build_release_metadata_payload(
        manifest=manifest,
        manifest_object_key=manifest_object_key,
    )
    audit = audit_published_scope_release(
        qdrant_client=qdrant_client,
        object_store=object_store,
        bucket=object_store_settings.bucket_derived,
        manifest=manifest,
        manifest_object_key=manifest_object_key,
        expected_release_metadata=prepublish_expected_metadata,
    )
    validation_summary = _load_optional_json(
        object_store=object_store,
        bucket=object_store_settings.bucket_derived,
        key=manifest.validation_summary_object_key,
    )
    retrieval_acceptance_summary = _load_optional_json(
        object_store=object_store,
        bucket=object_store_settings.bucket_derived,
        key=manifest.retrieval_acceptance_summary_object_key,
    )
    quality_gate_summary = _load_optional_json(
        object_store=object_store,
        bucket=object_store_settings.bucket_derived,
        key=manifest.quality_gate_summary_object_key,
    )
    component_eval_summary = _load_optional_json(
        object_store=object_store,
        bucket=object_store_settings.bucket_derived,
        key=manifest.component_eval_summary_object_key,
    )
    artifacts = write_index_release_artifacts(
        writer=object_store,
        bucket=object_store_settings.bucket_derived,
        manifest=manifest,
        validation_summary=validation_summary,
        retrieval_acceptance_summary=retrieval_acceptance_summary,
        quality_gate_summary=quality_gate_summary,
        component_eval_summary=component_eval_summary,
        post_publish_audit_summary=audit.summary,
    )
    payload = {
        "audit": audit.summary,
        "manifest_object_key": artifacts.manifest_object_key,
        "post_publish_audit_summary_object_key": artifacts.manifest.post_publish_audit_summary_object_key,
        "post_publish_audit_status": artifacts.manifest.post_publish_audit_status,
        "component_eval_status": artifacts.manifest.component_eval_status,
        "release_id": artifacts.manifest.release_id,
        "physical_collection_name": artifacts.manifest.physical_collection_name,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


def _load_optional_json(*, object_store, bucket: str, key: str | None) -> dict[str, object] | None:
    if not key:
        return None
    payload = json.loads(object_store.get_bytes(bucket=bucket, key=key).decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"artifact {key} must decode to a JSON object")
    return payload


if __name__ == "__main__":
    main()
