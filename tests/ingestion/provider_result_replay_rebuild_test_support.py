from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput
from campus_ingestion_core.collection_config import CollectionTruthConfig
from campus_ingestion_core.local_rebuild import (
    RebuildRequest,
    _build_replay_documents,
    _index_replayed_documents,
    replay_provider_response_rebuild,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_processed_asset_artifact_key,
    build_source_projection_artifact_key,
)
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.registry import DocumentRegistryRecord
from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument
from qdrant_client import QdrantClient

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

SOURCE_BUCKET = "campus-rag-source"


class _FakeObjectStore:
    def __init__(self, *, provider_result_bytes: bytes) -> None:
        self.provider_result_bytes = provider_result_bytes
        self.uploads: list[dict[str, object]] = []
        self.reads: list[tuple[str, str]] = []
        self.objects: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.reads.append((bucket, key))
        return self.objects.get((bucket, key), self.provider_result_bytes)

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )


def _provider_page(*blocks: dict[str, object]) -> dict[str, object]:
    return {
        "prunedResult": {
            "page_count": 1,
            "width": 828,
            "height": 1151,
            "parsing_res_list": list(blocks),
        }
    }


def _provider_block(
    block_label: str, block_content: str, *, block_id: str, block_order: int
) -> dict[str, object]:
    return {
        "block_id": block_id,
        "block_label": block_label,
        "block_content": block_content,
        "block_order": block_order,
        "block_bbox": [0, 0, 100, 20],
    }


def _provider_batch_line(*pages: dict[str, object]) -> dict[str, object]:
    return {
        "logId": "log-batch-001",
        "result": {
            "dataInfo": {
                "numPages": len(pages),
                "pages": [{"width": 828, "height": 1151} for _ in pages],
                "type": "pdf",
            },
            "layoutParsingResults": list(pages),
        },
    }


__all__ = [name for name in globals() if not name.startswith("__")]
