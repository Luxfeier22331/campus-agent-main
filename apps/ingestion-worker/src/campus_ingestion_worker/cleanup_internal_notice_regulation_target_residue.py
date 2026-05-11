from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import boto3
import botocore
import psycopg
from campus_ingestion_core.internal_notice_regulation_target_residue_cleanup import (
    RegulationTargetResidueCleanupRequest,
    cleanup_internal_notice_regulation_target_residue,
    regulation_target_residue_payload_matches,
)
from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreSettings
from psycopg.rows import dict_row
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backup and optionally delete exact target-side residue for a notice-derived regulation"
    )
    parser.add_argument("--notice-id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--version-id", required=True)
    parser.add_argument("--bucket", default="")
    parser.add_argument(
        "--qdrant-collection", action="append", dest="qdrant_collections", default=[]
    )
    parser.add_argument("--target-surface", default="")
    parser.add_argument("--target-key", action="append", dest="target_keys", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--apply", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    env = dict(os.environ)
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    bucket = args.bucket or env.get("OBJECT_STORE_BUCKET_DERIVED") or "campus-rag-derived"
    report = cleanup_internal_notice_regulation_target_residue(
        request=RegulationTargetResidueCleanupRequest(
            notice_id=args.notice_id,
            title=args.title,
            collection=args.collection,
            document_id=args.document_id,
            version_id=args.version_id,
            bucket=bucket,
            target_keys=tuple(args.target_keys),
            qdrant_collections=tuple(args.qdrant_collections),
            target_surface=args.target_surface,
            output_dir=Path(args.output_dir),
            apply=args.apply,
        ),
        registry=PostgresRegulationTargetResidueRegistry(_postgres_url(env)),
        object_store=S3RegulationTargetResidueObjectStore(env),
        vector_index=QdrantRegulationTargetResidueVectorIndex(env),
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


class PostgresRegulationTargetResidueRegistry:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def find_exact(
        self, *, collection: str, document_id: str, version_id: str
    ) -> list[dict[str, Any]]:
        with (
            psycopg.connect(self.database_url, row_factory=dict_row) as conn,
            conn.cursor() as cur,
        ):
            cur.execute(
                """
                select collection, document_id, version_id
                from ingestion_registry.document_registry_records
                where collection = %(collection)s
                  and document_id = %(document_id)s
                  and version_id = %(version_id)s
                order by collection, document_id, version_id
                """,
                {
                    "collection": collection,
                    "document_id": document_id,
                    "version_id": version_id,
                },
            )
            return [dict(row) for row in cur.fetchall()]

    def delete_exact(
        self,
        *,
        collection: str,
        document_id: str,
        version_id: str,
    ) -> list[dict[str, Any]]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    delete from ingestion_registry.document_registry_records
                    where collection = %(collection)s
                      and document_id = %(document_id)s
                      and version_id = %(version_id)s
                    returning collection, document_id, version_id
                    """,
                    {
                        "collection": collection,
                        "document_id": document_id,
                        "version_id": version_id,
                    },
                )
                deleted = [dict(row) for row in cur.fetchall()]
            conn.commit()
            return deleted

    def find_title_matches(self, *, title: str) -> list[dict[str, Any]]:
        with (
            psycopg.connect(self.database_url, row_factory=dict_row) as conn,
            conn.cursor() as cur,
        ):
            cur.execute(
                """
                select collection, document_id, version_id
                from ingestion_registry.document_registry_records
                where document_id like %(needle)s or version_id like %(needle)s
                order by collection, document_id, version_id
                """,
                {"needle": f"%{title}%"},
            )
            return [dict(row) for row in cur.fetchall()]


class S3RegulationTargetResidueObjectStore:
    def __init__(self, env: dict[str, str]) -> None:
        self.env = env
        self.settings = ObjectStoreSettings.from_env(env)
        self.client_factory = S3ObjectStoreClientFactory(self.settings)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        obj = self._client(bucket).get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()

    def exists(self, bucket: str, key: str) -> bool:
        try:
            self._client(bucket).head_object(Bucket=bucket, Key=key)
            return True
        except botocore.exceptions.ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            code = exc.response.get("Error", {}).get("Code")
            if status == 404 or code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise

    def delete_keys(self, *, bucket: str, keys: tuple[str, ...]) -> list[str]:
        if not keys:
            return []
        self._client(bucket).delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": key} for key in keys], "Quiet": False},
        )
        return list(keys)

    def list_title_matches(self, *, bucket: str, title: str) -> list[str]:
        matches: list[str] = []
        paginator = self._client(bucket).get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix="regulations/documents/"):
            for item in page.get("Contents") or []:
                key = str(item.get("Key") or "")
                if title in key:
                    matches.append(key)
        return sorted(matches)

    def _client(self, bucket: str):
        return boto3.client("s3", **self.client_factory.client_config(bucket=bucket))


class QdrantRegulationTargetResidueVectorIndex:
    def __init__(self, env: dict[str, str]) -> None:
        self.env = env
        self._runtime_client: QdrantClient | None = None

    def find_exact(
        self,
        *,
        collection_names: tuple[str, ...],
        document_id: str,
        version_id: str,
        notice_id: str,
        target_surface: str,
    ) -> list[dict[str, Any]]:
        matches: list[dict[str, Any]] = []
        for collection_name in collection_names:
            for record in self._scroll_matches(
                collection_name=collection_name,
                document_id=document_id,
                version_id=version_id,
                notice_id=notice_id,
                target_surface=target_surface,
            ):
                payload = record.payload if isinstance(record.payload, dict) else {}
                matches.append(
                    {
                        "collection_name": collection_name,
                        "point_id": str(record.id),
                        "payload": dict(payload),
                    }
                )
        return matches

    def delete_exact(
        self,
        *,
        collection_names: tuple[str, ...],
        document_id: str,
        version_id: str,
        notice_id: str,
        target_surface: str,
    ) -> list[str]:
        deleted: list[str] = []
        for collection_name in collection_names:
            matches = self._scroll_matches(
                collection_name=collection_name,
                document_id=document_id,
                version_id=version_id,
                notice_id=notice_id,
                target_surface=target_surface,
            )
            point_ids = [record.id for record in matches]
            if point_ids:
                self._client().delete(
                    collection_name=collection_name,
                    points_selector=qdrant_models.PointIdsList(points=point_ids),
                    wait=True,
                )
                deleted.extend(str(point_id) for point_id in point_ids)
        return deleted

    def _scroll_matches(
        self,
        *,
        collection_name: str,
        document_id: str,
        version_id: str,
        notice_id: str,
        target_surface: str,
    ) -> list[qdrant_models.Record]:
        client = self._client()
        if not client.collection_exists(collection_name):
            return []
        records: list[qdrant_models.Record] = []
        next_offset: object | None = None
        scroll_filter = qdrant_models.Filter(
            must=[
                qdrant_models.FieldCondition(
                    key="document_id",
                    match=qdrant_models.MatchValue(value=document_id),
                ),
                qdrant_models.FieldCondition(
                    key="version_id",
                    match=qdrant_models.MatchValue(value=version_id),
                ),
            ]
        )
        while True:
            batch, next_offset = client.scroll(
                collection_name=collection_name,
                limit=256,
                offset=next_offset,
                scroll_filter=scroll_filter,
                with_payload=True,
                with_vectors=False,
            )
            records.extend(
                record
                for record in batch or []
                if regulation_target_residue_payload_matches(
                    payload=dict(record.payload or {}) if isinstance(record.payload, dict) else {},
                    document_id=document_id,
                    version_id=version_id,
                    notice_id=notice_id,
                    target_surface=target_surface,
                )
            )
            if not next_offset or not batch:
                break
        return records

    def _client(self) -> QdrantClient:
        if self._runtime_client is None:
            self._runtime_client = QdrantClient(url=_required(self.env, "QDRANT_URL"))
        return self._runtime_client


def _postgres_url(env: dict[str, str]) -> str:
    for key in (
        "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
        "DOCUMENT_REGISTRY_DATABASE_URL",
        "CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
        "CAMPUS_SHARED_POSTGRES_URL",
    ):
        value = (env.get(key) or "").strip()
        if value:
            return value
    raise ValueError("missing document registry postgres url")


def _required(env: dict[str, str], key: str) -> str:
    value = (env.get(key) or "").strip()
    if not value:
        raise ValueError(f"missing required env {key}")
    return value


__all__ = [
    "PostgresRegulationTargetResidueRegistry",
    "QdrantRegulationTargetResidueVectorIndex",
    "S3RegulationTargetResidueObjectStore",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
