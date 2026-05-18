from __future__ import annotations

import importlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

_MODULE_NAME = "campus_ingestion_worker.repair_rag_release_metadata"


class RepairRagReleaseMetadataWorkerCliTest(unittest.TestCase):
    def test_main_repairs_alias_target_points_from_release_manifest_and_runtime_profile(
        self,
    ) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        profile = _profile("official_web", "stable_reference", "official_web_stable_reference")
        object_store = _FakeReleaseObjectStore(
            {
                "official_web/releases/stable_reference/r1/index-release.json": (
                    _release_manifest(
                        release_id="r1",
                        corpus="official_web",
                        collection="stable_reference",
                        physical_collection_name="official_web_stable_reference__r1",
                        serving_alias="official_web_stable_reference",
                    )
                ),
            }
        )
        qdrant_client = _RepairQdrantClient(point_ids=("p1", "p2"))

        with (
            patch(f"{_MODULE_NAME}.load_worker_env", return_value="/repo/.env"),
            patch(f"{_MODULE_NAME}.RetrievalSettings.from_env") as from_env,
            patch(f"{_MODULE_NAME}._build_qdrant_client", return_value=qdrant_client),
            patch(
                f"{_MODULE_NAME}._build_release_object_store",
                return_value=("available", "", object_store, "campus-rag-derived"),
            ),
            patch(f"{_MODULE_NAME}.load_runtime_profile", return_value=profile),
            patch(
                f"{_MODULE_NAME}.resolve_alias_target",
                return_value="official_web_stable_reference__r1",
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            from_env.return_value = SimpleNamespace(
                qdrant_url="https://qdrant.example.com",
                qdrant_api_key="secret-api-key",
                qdrant_timeout_seconds=10.0,
                embedding_provider="gitee",
                embedding_model="Qwen3-Embedding-4B",
                embedding_dimensions=2560,
                sparse_provider="qdrant",
                sparse_model="qdrant/bm25",
                sparse_tokenizer="multilingual",
                sparse_language="none",
            )

            worker.main(["--scope", "official_web/stable_reference"])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["schema_version"], "rag_release_metadata_repair.v1")
        self.assertEqual(payload["repaired_count"], 2)
        surface = payload["surfaces"][0]
        self.assertEqual(surface["status"], "repaired")
        self.assertEqual(surface["refreshed_point_count"], 2)
        self.assertEqual(
            surface["collection_name"],
            "official_web_stable_reference__r1",
        )
        self.assertEqual(qdrant_client.set_payload_calls, 1)
        release_payload = qdrant_client.last_payload
        self.assertEqual(release_payload["index_release_id"], "r1")
        self.assertEqual(
            release_payload["index_release_manifest_key"],
            "official_web/releases/stable_reference/r1/index-release.json",
        )
        self.assertEqual(release_payload["embedding_provider"], "gitee")
        self.assertEqual(release_payload["sparse_provider"], "qdrant")
        self.assertEqual(release_payload["quality_gate_status"], "passed")
        self.assertRegex(str(release_payload["profile_identity_hash"]), r"^[0-9a-f]{64}$")
        self.assertNotIn("secret-api-key", stdout.getvalue())


class _RepairQdrantClient:
    def __init__(self, *, point_ids: tuple[str, ...]) -> None:
        self.point_ids = point_ids
        self.last_payload: dict[str, object] = {}
        self.set_payload_calls = 0

    def collection_exists(self, collection_name: str) -> bool:
        return True

    def scroll(self, **kwargs: object) -> tuple[list[SimpleNamespace], None]:
        return ([SimpleNamespace(id=point_id) for point_id in self.point_ids], None)

    def set_payload(self, **kwargs: object) -> None:
        self.set_payload_calls += 1
        self.last_payload = dict(kwargs["payload"])


class _FakeReleaseObjectStore:
    def __init__(self, payloads: dict[str, dict[str, object]]) -> None:
        self.payloads = {
            key: (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")
            for key, value in payloads.items()
        }

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        return tuple(sorted(key for key in self.payloads if key.startswith(prefix)))

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.payloads[key]


def _profile(corpus: str, collection: str, alias_name: str) -> SimpleNamespace:
    return SimpleNamespace(
        corpus=corpus,
        collection=collection,
        serving_stage="query_serving",
        query_enabled_by_default=True,
        cleaning_policy_version=f"{collection}_cleaning_v1",
        chunk_profile_version=f"{collection}_semantic_v1",
        dense_prefetch_limit=20,
        sparse_prefetch_limit=20,
        rrf_k=60,
        rrf_dense_weight=1.0,
        rrf_sparse_weight=1.0,
        reranker_enabled_by_default=False,
        reranker_top_n=None,
        reranker_profile_version="",
        reranker_adoption_evidence_id="",
        embedding_query_instruction="Retrieve stable official web reference passages.",
        qdrant_index_binding=SimpleNamespace(
            alias_name=alias_name,
            collection_prefix=alias_name,
            dense_vector_name="dense",
            sparse_vector_name="sparse",
        ),
    )


def _release_manifest(
    *,
    release_id: str,
    corpus: str,
    collection: str,
    physical_collection_name: str,
    serving_alias: str,
) -> dict[str, object]:
    return {
        "release_id": release_id,
        "corpus": corpus,
        "collection": collection,
        "serving_alias": serving_alias,
        "physical_collection_name": physical_collection_name,
        "indexed_at": "2026-05-01T00:00:00+00:00",
        "published_at": "2026-05-01T00:00:00+00:00",
        "validation_status": "passed",
        "chunk_policy_version": "old_chunk_policy",
        "cleaning_policy_version": "old_cleaning_policy",
        "embedding_model": "old-embedding-model",
    }
