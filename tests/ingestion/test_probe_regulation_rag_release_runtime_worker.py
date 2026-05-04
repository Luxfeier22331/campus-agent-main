from __future__ import annotations

import importlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

_MODULE_NAME = "campus_ingestion_worker.probe_regulation_rag_release_runtime"


class ProbeRegulationRagReleaseRuntimeWorkerCliTest(unittest.TestCase):
    def test_main_reports_all_current_rag_surfaces_and_release_guard_status(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        profiles = {
            ("regulations", "student_rules"): _profile(
                "regulations",
                "student_rules",
                "student_rules",
            ),
            ("regulations", "institutional_rules"): _profile(
                "regulations",
                "institutional_rules",
                "institutional_rules",
            ),
            ("curriculum", "curriculum_plan"): _profile(
                "curriculum",
                "curriculum_plan",
                "curriculum_plan",
            ),
            ("official_web", "stable_reference"): _profile(
                "official_web",
                "stable_reference",
                "official_web_stable_reference",
            ),
        }
        collection_info = SimpleNamespace(points_count=1747, vectors_count=None)
        qdrant_client = SimpleNamespace(
            get_collection=Mock(return_value=collection_info),
            scroll=Mock(return_value=([], None)),
        )
        object_store = _FakeReleaseObjectStore(
            {
                "regulations/releases/student_rules/r1/index-release.json": _release_manifest(
                    release_id="r1",
                    corpus="regulations",
                    collection="student_rules",
                    physical_collection_name="student_rules__r1",
                    serving_alias="student_rules",
                ),
                "regulations/releases/institutional_rules/r1/index-release.json": (
                    _release_manifest(
                        release_id="r1",
                        corpus="regulations",
                        collection="institutional_rules",
                        physical_collection_name="institutional_rules__r1",
                        serving_alias="institutional_rules",
                    )
                ),
                "curriculum/releases/curriculum_plan/r1/index-release.json": _release_manifest(
                    release_id="r1",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    physical_collection_name="curriculum_plan__r1",
                    serving_alias="curriculum_plan",
                ),
                "curriculum/releases/curriculum_plan/r2/index-release.json": _release_manifest(
                    release_id="r2",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    physical_collection_name="curriculum_plan__r2",
                    serving_alias="curriculum_plan",
                    published_at="2026-05-01T00:00:00+00:00",
                ),
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

        with (
            patch(f"{_MODULE_NAME}.load_worker_env") as load_env,
            patch(f"{_MODULE_NAME}.RetrievalSettings.from_env") as from_env,
            patch(f"{_MODULE_NAME}._build_qdrant_client") as build_client,
            patch(
                f"{_MODULE_NAME}._build_release_object_store",
                return_value=("available", "", object_store, "campus-rag-derived"),
            ),
            patch(f"{_MODULE_NAME}.load_runtime_profile") as load_profile,
            patch(f"{_MODULE_NAME}.resolve_alias_target") as resolve_alias,
            patch(f"{_MODULE_NAME}.validate_alias_release_metadata") as validate_release,
            patch(f"{_MODULE_NAME}._check_qdrant_endpoint") as check_endpoint,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            load_env.return_value = "/repo/.env"
            from_env.return_value = SimpleNamespace(
                qdrant_url="https://secret-qdrant.example.com",
                qdrant_api_key="secret-api-key",
                embedding_provider="gitee",
                embedding_model="Qwen3-Embedding-4B",
                embedding_api_key="secret-embedding-key",
                embedding_base_url="https://secret-embedding.example.com",
                embedding_dimensions=2560,
                qdrant_timeout_seconds=10.0,
            )
            build_client.return_value = qdrant_client
            load_profile.side_effect = lambda corpus, collection: profiles[(corpus, collection)]
            resolve_alias.side_effect = lambda *, qdrant_client, alias_name: f"{alias_name}__r1"
            validate_release.side_effect = [
                Exception("release metadata drift for student_rules/r1: sample 1: missing release metadata fields: profile_identity_hash, quality_gate_status"),
                None,
                None,
                Exception("release metadata drift for curriculum_plan/r1: sample 1: missing release metadata fields: sparse_provider"),
                Exception("missing release metadata for query-serving alias official_web_stable_reference"),
            ]
            check_endpoint.side_effect = [
                {"status": 200, "body_prefix": "all shards are ready"},
                {"status": 200, "body_prefix": "healthz check passed"},
                {"status": 200, "body_prefix": '{"result":{"collections":[]}}'},
            ]

            worker.main([])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(
            payload["schema_version"],
            "rag_retrieval_runtime_readiness.v1",
        )
        self.assertEqual(payload["loaded_env_path"], "/repo/.env")
        self.assertTrue(payload["qdrant_url_present"])
        self.assertEqual(payload["qdrant_scheme"], "https")
        self.assertEqual(payload["qdrant_host"], "secret-qdrant.example.com")
        self.assertTrue(payload["qdrant_api_key_present"])
        self.assertEqual(payload["qdrant_ready"], "ready")
        self.assertEqual(payload["embedding_provider"], "gitee")
        self.assertEqual(payload["embedding_model"], "Qwen3-Embedding-4B")
        self.assertTrue(payload["embedding_api_key_present"])
        self.assertTrue(payload["embedding_base_url_present"])
        surfaces = {surface["scope"]: surface for surface in payload["surfaces"]}
        self.assertEqual(set(surfaces), set(worker.DEFAULT_RAG_SURFACE_SCOPES))
        self.assertEqual(
            surfaces["regulations/institutional_rules"]["release_metadata_guard_status"],
            "passed",
        )
        self.assertEqual(
            surfaces["regulations/student_rules"]["release_metadata_guard_status"],
            "failed",
        )
        self.assertEqual(surfaces["regulations/student_rules"]["readiness_status"], "blocked")
        self.assertEqual(
            surfaces["regulations/student_rules"]["readiness_blocker"],
            "latest_release_metadata_guard_failed",
        )
        self.assertIn(
            "profile_identity_hash",
            surfaces["regulations/student_rules"]["release_metadata_guard_message"],
        )
        self.assertEqual(
            surfaces["regulations/student_rules"]["release_metadata_guard_missing_fields"],
            ["profile_identity_hash", "quality_gate_status"],
        )
        self.assertEqual(
            surfaces["curriculum/curriculum_plan"]["release_metadata_guard_missing_fields"],
            [],
        )
        self.assertEqual(
            surfaces["curriculum/curriculum_plan"]["alias_target_guard_missing_fields"],
            ["sparse_provider"],
        )
        self.assertEqual(
            surfaces["curriculum/curriculum_plan"][
                "release_family_latest_physical_collection_name"
            ],
            "curriculum_plan__r2",
        )
        self.assertEqual(
            surfaces["curriculum/curriculum_plan"]["release_freshness_status"],
            "stale_alias",
        )
        self.assertEqual(
            surfaces["curriculum/curriculum_plan"]["readiness_blocker"],
            "stale_alias",
        )
        self.assertEqual(
            surfaces["official_web/stable_reference"]["release_metadata_guard_status"],
            "failed",
        )
        self.assertEqual(
            surfaces["official_web/stable_reference"]["alias_target"],
            "official_web_stable_reference__r1",
        )
        self.assertEqual(surfaces["official_web/stable_reference"]["points_count"], 1747)
        self.assertEqual(payload["object_store_status"], "available")
        self.assertEqual(payload["object_store_bucket_derived"], "campus-rag-derived")
        self.assertTrue(payload["secrets_redacted"])
        self.assertNotIn("secret-api-key", stdout.getvalue())
        self.assertNotIn("secret-embedding-key", stdout.getvalue())
        self.assertNotIn("secret-embedding.example.com", stdout.getvalue())
        self.assertNotIn("6333", stdout.getvalue())
        load_env.assert_called_once_with()
        check_endpoint.assert_any_call(
            settings=from_env.return_value,
            path="/readyz",
        )
        check_endpoint.assert_any_call(
            settings=from_env.return_value,
            path="/livez",
        )
        check_endpoint.assert_any_call(
            settings=from_env.return_value,
            path="/collections",
        )

    def test_main_can_probe_one_explicit_scope(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        profile = _profile("regulations", "institutional_rules", "institutional_rules")

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(f"{_MODULE_NAME}.RetrievalSettings.from_env") as from_env,
            patch(f"{_MODULE_NAME}._build_qdrant_client") as build_client,
            patch(
                f"{_MODULE_NAME}._build_release_object_store",
                return_value=("unavailable", "missing object store", None, None),
            ),
            patch(f"{_MODULE_NAME}.load_runtime_profile", return_value=profile) as load_profile,
            patch(f"{_MODULE_NAME}.resolve_alias_target", return_value="institutional_rules__r1"),
            patch(f"{_MODULE_NAME}.validate_alias_release_metadata"),
            patch(f"{_MODULE_NAME}._check_qdrant_endpoint") as check_endpoint,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            from_env.return_value = SimpleNamespace(
                qdrant_url=":memory:",
                qdrant_api_key=None,
                qdrant_timeout_seconds=10.0,
                embedding_provider="mock",
                embedding_model="mock-embedding",
                embedding_api_key="",
                embedding_base_url=None,
                embedding_dimensions=8,
            )
            build_client.return_value = SimpleNamespace(
                get_collection=Mock(return_value=SimpleNamespace(points_count=3)),
            )
            check_endpoint.return_value = {"status": "skipped", "reason": "memory_qdrant"}

            worker.main(["--scope", "regulations/institutional_rules"])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(len(payload["surfaces"]), 1)
        self.assertEqual(payload["surfaces"][0]["scope"], "regulations/institutional_rules")
        self.assertEqual(payload["surfaces"][0]["release_freshness_status"], "unavailable")
        self.assertEqual(payload["surfaces"][0]["readiness_blocker"], "unavailable")
        load_profile.assert_called_once_with("regulations", "institutional_rules")


if __name__ == "__main__":
    unittest.main()


def _profile(corpus: str, collection: str, alias_name: str) -> SimpleNamespace:
    return SimpleNamespace(
        corpus=corpus,
        collection=collection,
        retrieval_enabled=True,
        query_enabled_by_default=True,
        qdrant_index_binding=SimpleNamespace(alias_name=alias_name),
    )


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


def _release_manifest(
    *,
    release_id: str,
    corpus: str,
    collection: str,
    physical_collection_name: str,
    serving_alias: str,
    published_at: str = "2026-04-30T00:00:00+00:00",
) -> dict[str, object]:
    return {
        "release_id": release_id,
        "corpus": corpus,
        "collection": collection,
        "serving_alias": serving_alias,
        "physical_collection_name": physical_collection_name,
        "indexed_at": published_at,
        "published_at": published_at,
    }
