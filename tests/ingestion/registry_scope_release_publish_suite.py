from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.registry_scope_chunk_preparation import (
    prepare_registry_scope_chunks,
)
from campus_ingestion_core.registry_scope_release import (
    publish_scope_release,
    release_registry_scope,
)
from campus_ingestion_core.regulation_rag_release_admission import (
    build_regulation_rag_release_admission_manifest,
    write_regulation_rag_release_admission_manifest,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from qdrant_client import QdrantClient

from tests.ingestion.registry_scope_release_test_support import (
    _FakeObjectStore,
    _make_document_units_bytes,
    _make_indexable_chunk,
    _make_record,
    _make_regulation_record,
    _OrderedObjectStore,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry


class RegistryScopeReleasePublishSuite:
    def test_publish_scope_release_writes_prepublish_manifest_before_alias(self) -> None:
        events: list[tuple[str, str | None]] = []
        object_store = _OrderedObjectStore(events=events)
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = False
        first_record = _make_record(
            document_id="official_web:muc_public_pages:news-001",
            version_id="owver:news-001",
            object_key="official_web/news-001/document-units.jsonl",
        )
        second_record = _make_record(
            document_id="official_web:muc_public_pages:news-002",
            version_id="owver:news-002",
            object_key="official_web/news-002/document-units.jsonl",
        )
        chunks = (
            _make_indexable_chunk(
                record=first_record,
                chunk_id=f"{first_record.document_id}:chunk-0001",
                text="中央民族大学官网新闻正文。",
            ),
            _make_indexable_chunk(
                record=second_record,
                chunk_id=f"{second_record.document_id}:chunk-0001",
                text="中央民族大学官网第二条新闻正文。",
            ),
        )

        with (
            patch(
                "campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant",
                side_effect=lambda **kwargs: events.append(("upsert", None)),
            ),
            patch(
                "campus_ingestion_core.registry_scope_release.publish_release_alias",
                side_effect=lambda **kwargs: events.append(("alias", None)),
            ),
        ):
            publish_scope_release(
                corpus="official_web",
                collection="muc_public_pages",
                records=(first_record, second_record),
                chunks=chunks,
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                    bucket_derived="campus-rag-derived",
                ),
                runtime_profile=load_runtime_profile("official_web", "muc_public_pages"),
                sparse_embedding_model=object(),
                publish_alias=True,
                upsert_batch_size=128,
            )

        manifest_events = [
            (index, event)
            for index, event in enumerate(events)
            if event[0] == "put" and str(event[1]).endswith("index-release.json")
        ]
        alias_index = next(index for index, event in enumerate(events) if event[0] == "alias")
        self.assertLess(manifest_events[0][0], alias_index)
        first_manifest = json.loads(object_store.manifest_payloads[0].decode("utf-8"))
        final_manifest = json.loads(object_store.manifest_payloads[-1].decode("utf-8"))
        self.assertIsNone(first_manifest["published_at"])
        self.assertIsNotNone(final_manifest["published_at"])

    def test_release_registry_scope_rejects_embedding_model_env_drift(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key_1 = (
                "official_web/documents/muc_public_pages/"
                "news-001--news001/source-faithful/undated/document-units.jsonl"
            )
            object_key_2 = (
                "official_web/documents/muc_public_pages/"
                "news-002--news002/source-faithful/undated/document-units.jsonl"
            )
            registry = InMemoryDocumentRegistry(
                (
                    _make_record(
                        document_id="official_web:muc_public_pages:news-001",
                        version_id="owver:news-001",
                        object_key=object_key_1,
                    ),
                    _make_record(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        object_key=object_key_2,
                    ),
                ),
                backing_path=root / "registry.json",
            )
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key_1): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-001",
                        version_id="owver:news-001",
                        text="中央民族大学官网新闻正文。",
                    ),
                    ("campus-rag-derived", object_key_2): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        text="中央民族大学法学院新闻正文。",
                    ),
                }
            )

            with self.assertRaisesRegex(ValueError, "embedding model mismatch"):
                release_registry_scope(
                    corpus="official_web",
                    collection="muc_public_pages",
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_MODEL": "different-query-model",
                        "EMBEDDING_PROVIDER": "mock",
                        "SPARSE_PROVIDER": "mock",
                    },
                    registry=registry,
                    object_store=object_store,
                    qdrant_client=QdrantClient(location=":memory:"),
                    publish_alias=True,
                )

    def test_release_registry_scope_requires_admission_for_query_enabled_regulation(self) -> None:
        record = _make_regulation_record()

        with self.assertRaisesRegex(ValueError, "release admission manifest key is required"):
            release_registry_scope(
                corpus="regulations",
                collection="institutional_rules",
                preparation_run_id="prep-001",
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=InMemoryDocumentRegistry((record,)),
                object_store=_FakeObjectStore(),
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=True,
            )

    def test_release_registry_scope_requires_component_eval_summary_for_query_enabled_regulation_publish(
        self,
    ) -> None:
        record = _make_regulation_record()
        registry = InMemoryDocumentRegistry((record,))
        env = {
            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
            "OBJECT_STORE_SECRET_KEY": "minioadmin",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            "EMBEDDING_PROVIDER": "mock",
            "EMBEDDING_MODEL": "mock-embedding-8d",
            "SPARSE_PROVIDER": "mock",
        }
        object_store = _FakeObjectStore()

        with (
            patch(
                "campus_ingestion_core.registry_scope_release.require_verified_chunk_preparation"
            ) as require_preparation,
            patch(
                "campus_ingestion_core.registry_scope_release.assert_regulation_rag_release_admission_allows_release"
            ) as assert_admission,
            patch(
                "campus_ingestion_core.registry_scope_release.build_indexable_chunks_from_record"
            ) as build_chunks,
            self.assertRaisesRegex(
                ValueError,
                "component eval summary is required before query-enabled regulation release publish",
            ),
        ):
            require_preparation.return_value = object()
            assert_admission.return_value = SimpleNamespace(admission_status="passed")
            build_chunks.side_effect = lambda **_kwargs: self.fail(
                "component eval summary must be checked before chunk building"
            )
            release_registry_scope(
                corpus="regulations",
                collection="institutional_rules",
                preparation_run_id="prep-001",
                release_admission_manifest_key="admission.json",
                env=env,
                registry=registry,
                object_store=object_store,
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=True,
            )

    def test_release_registry_scope_allows_query_enabled_regulation_with_matching_admission(
        self,
    ) -> None:
        record = _make_regulation_record()
        document_units_bytes = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": f"{record.document_id}:unit:0001",
                    "clean_text": "第一条 为规范学生社团管理，制定本办法。",
                    "anchor": {"section_path": ["第一章 总则"]},
                    "acl": {"level": "restricted", "allow_groups": ["campus_members"]},
                    "metadata": {
                        "unit_type": "article",
                        "chunk_lane": "formal_regulation",
                        "promotion_class": "formal_regulation",
                        "root_unit_id": f"{record.document_id}:root",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "normalizer_version": REGULATION_CANONICAL_NORMALIZER_VERSION,
                        "normalization_quality": {
                            "quality_verdict": "passed",
                            "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        },
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")
        registry = InMemoryDocumentRegistry((record,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", record.document_units_object_key or ""): document_units_bytes
            }
        )
        env = {
            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
            "OBJECT_STORE_SECRET_KEY": "minioadmin",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            "EMBEDDING_PROVIDER": "mock",
            "EMBEDDING_MODEL": "mock-embedding-8d",
            "SPARSE_PROVIDER": "mock",
        }
        preparation_report = prepare_registry_scope_chunks(
            corpus="regulations",
            collection="institutional_rules",
            preparation_run_id="prep-001",
            env=env,
            registry=registry,
            object_store=object_store,
            require_current_cleaning_provenance=True,
        )
        preparation_manifest = json.loads(
            object_store.objects[
                ("campus-rag-derived", preparation_report.manifest_object_key)
            ].decode("utf-8")
        )
        admission_manifest = build_regulation_rag_release_admission_manifest(
            admission_run_id="admit-001",
            corpus="regulations",
            collection="institutional_rules",
            records=(record,),
            runtime_profile=load_runtime_profile("regulations", "institutional_rules"),
            preparation_manifest=SimpleNamespace(
                documents=[
                    SimpleNamespace(**document) for document in preparation_manifest["documents"]
                ]
            ),
            admitted_at="2026-05-02T10:00:00+00:00",
            semantic_oracle_status="passed",
        )
        admission_key = write_regulation_rag_release_admission_manifest(
            writer=object_store,
            bucket="campus-rag-derived",
            manifest=admission_manifest,
        )

        report = release_registry_scope(
            corpus="regulations",
            collection="institutional_rules",
            preparation_run_id="prep-001",
            release_admission_manifest_key=admission_key,
            env=env,
            registry=registry,
            object_store=object_store,
            qdrant_client=QdrantClient(location=":memory:"),
            publish_alias=False,
        )

        self.assertEqual(report.release_admission_status, "")
        self.assertIsNone(report.published_at)

        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "regulation-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "cases": [
                            {
                                "case_id": "institutional-rule-smoke",
                                "corpus": "regulations",
                                "collection": "institutional_rules",
                                "query": "学生社团管理办法",
                                "entitlement_groups": ["campus_members"],
                                "visibility_level": "restricted",
                                "visibility_scope": "campus",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            published_report = release_registry_scope(
                corpus="regulations",
                collection="institutional_rules",
                preparation_run_id="prep-001",
                release_admission_manifest_key=admission_key,
                env={
                    **env,
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                    "QDRANT_URL": ":memory:",
                },
                registry=registry,
                object_store=object_store,
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=True,
                acceptance_case_path=str(qrels_path),
                component_eval_summary={
                    "schema_version": 1,
                    "case_family": "answer_ready_component_eval.v1",
                    "summary": {
                        "overall_passed": True,
                        "failed": 0,
                        "primary_failure_stage_counts": {},
                        "secondary_failure_stage_counts": {},
                    },
                    "results": [],
                },
                qrels_coverage_issues=(),
            )

        self.assertEqual(published_report.release_admission_status, "passed")
        self.assertEqual(published_report.release_admission_manifest_key, admission_key)

    def test_prepare_registry_scope_accepts_official_web_regulation_provenance(self) -> None:
        record = _make_regulation_record(
            document_id="official_web_regulation:001",
            version_id="owregver:001",
            object_key=(
                "regulations/documents/institutional_rules/official-web-rule-001/"
                "current-effective/2026/document-units.jsonl"
            ),
            source_channel="official_web",
            import_source="official_web_regulation_source_truth_materialization",
        )
        document_units_bytes = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": f"{record.document_id}:unit:0001",
                    "clean_text": "第一条 为规范校园一卡通管理，制定本规定。",
                    "anchor": {"section_path": ["第一章 总则"]},
                    "acl": {"level": "public", "allow_groups": []},
                    "metadata": {
                        "unit_type": "regulation_body",
                        "chunk_lane": "formal_regulation",
                        "promotion_class": "formal_regulation",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "normalizer_version": REGULATION_CANONICAL_NORMALIZER_VERSION,
                        "normalization_quality": {
                            "quality_verdict": "passed",
                            "cleaning_policy_version": "institutional_rules_cleaning_v1",
                            "normalizer_version": REGULATION_CANONICAL_NORMALIZER_VERSION,
                        },
                        "content_role": "regulation_body",
                        "is_answer_bearing": True,
                        "source_channel": "official_web",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")
        registry = InMemoryDocumentRegistry((record,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", record.document_units_object_key or ""): document_units_bytes
            }
        )
        env = {
            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
            "OBJECT_STORE_SECRET_KEY": "minioadmin",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            "EMBEDDING_PROVIDER": "mock",
            "EMBEDDING_MODEL": "mock-embedding-8d",
            "SPARSE_PROVIDER": "mock",
        }

        report = prepare_registry_scope_chunks(
            corpus="regulations",
            collection="institutional_rules",
            preparation_run_id="prep-official-web-001",
            env=env,
            registry=registry,
            object_store=object_store,
            require_current_cleaning_provenance=True,
        )

        self.assertEqual(report.validation_status, "passed")
        self.assertEqual(report.document_count, 1)

    def test_release_registry_scope_writes_manifest_without_publishing_alias(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key_1 = (
                "official_web/documents/muc_public_pages/"
                "news-001--news001/source-faithful/undated/document-units.jsonl"
            )
            object_key_2 = (
                "official_web/documents/muc_public_pages/"
                "news-002--news002/source-faithful/undated/document-units.jsonl"
            )
            registry = InMemoryDocumentRegistry(
                (
                    _make_record(
                        document_id="official_web:muc_public_pages:news-001",
                        version_id="owver:news-001",
                        object_key=object_key_1,
                    ),
                    _make_record(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        object_key=object_key_2,
                    ),
                ),
                backing_path=root / "registry.json",
            )
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key_1): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-001",
                        version_id="owver:news-001",
                        text="中央民族大学官网新闻正文。",
                    ),
                    ("campus-rag-derived", object_key_2): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        text="中央民族大学法学院新闻正文。",
                    ),
                }
            )
            qdrant_client = QdrantClient(location=":memory:")

            report = release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=registry,
                object_store=object_store,
                qdrant_client=qdrant_client,
                publish_alias=False,
            )

        self.assertEqual(report.corpus, "official_web")
        self.assertEqual(report.collection, "muc_public_pages")
        self.assertEqual(report.serving_alias, "muc_public_pages")
        self.assertTrue(report.physical_collection_name.startswith("muc_public_pages__r"))
        self.assertIsNone(report.published_at)
        self.assertEqual(report.document_count, 2)
        self.assertGreater(report.point_count, 0)
        self.assertEqual(
            resolve_alias_target(qdrant_client=qdrant_client, alias_name="muc_public_pages"),
            None,
        )
        self.assertEqual(
            object_store.reads,
            [
                ("campus-rag-derived", object_key_1),
                ("campus-rag-derived", object_key_2),
            ],
        )
        upload_keys = [str(item["key"]) for item in object_store.uploads]
        self.assertIn(report.manifest_object_key, upload_keys)
        self.assertIn(str(report.validation_summary_object_key), upload_keys)

    def test_release_registry_scope_reports_embedding_cache_hits_on_repeated_release(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key_1 = (
                "official_web/documents/muc_public_pages/"
                "news-001--news001/source-faithful/undated/document-units.jsonl"
            )
            object_key_2 = (
                "official_web/documents/muc_public_pages/"
                "news-002--news002/source-faithful/undated/document-units.jsonl"
            )
            registry = InMemoryDocumentRegistry(
                (
                    _make_record(
                        document_id="official_web:muc_public_pages:news-001",
                        version_id="owver:news-001",
                        object_key=object_key_1,
                    ),
                    _make_record(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        object_key=object_key_2,
                    ),
                ),
                backing_path=root / "registry.json",
            )
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key_1): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-001",
                        version_id="owver:news-001",
                        text="中央民族大学官网新闻正文。",
                    ),
                    ("campus-rag-derived", object_key_2): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        text="中央民族大学法学院新闻正文。",
                    ),
                }
            )
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
                "INGESTION_EMBEDDING_CACHE_ENABLED": "true",
            }

            first_report = release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env=env,
                registry=registry,
                object_store=object_store,
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=False,
            )
            for upload in object_store.uploads:
                object_store.objects[(str(upload["bucket"]), str(upload["key"]))] = upload["data"]
            second_report = release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env=env,
                registry=registry,
                object_store=object_store,
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=False,
            )

        self.assertGreater(first_report.embedding_cache_miss_count, 0)
        self.assertEqual(first_report.embedding_cache_hit_count, 0)
        self.assertGreater(second_report.embedding_cache_hit_count, 0)
        self.assertEqual(second_report.embedding_provider_call_count, 0)

    def test_release_registry_scope_publishes_alias_for_active_records_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            active_key = (
                "official_web/documents/muc_public_pages/"
                "news-002--news002/source-faithful/undated/document-units.jsonl"
            )
            active_key_two = (
                "official_web/documents/muc_public_pages/"
                "news-004--news004/source-faithful/undated/document-units.jsonl"
            )
            superseded_key = (
                "official_web/documents/muc_public_pages/"
                "news-003--news003/source-faithful/undated/document-units.jsonl"
            )
            registry = InMemoryDocumentRegistry(
                (
                    _make_record(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        object_key=active_key,
                        status="active",
                        is_current=True,
                    ),
                    _make_record(
                        document_id="official_web:muc_public_pages:news-004",
                        version_id="owver:news-004",
                        object_key=active_key_two,
                        status="active",
                        is_current=True,
                    ),
                    _make_record(
                        document_id="official_web:muc_public_pages:news-003",
                        version_id="owver:news-003",
                        object_key=superseded_key,
                        status="superseded",
                        is_current=False,
                    ),
                ),
                backing_path=root / "registry.json",
            )
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", active_key): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-002",
                        version_id="owver:news-002",
                        text="官方网页采集正文。",
                    ),
                    ("campus-rag-derived", active_key_two): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-004",
                        version_id="owver:news-004",
                        text="官方网页第二条正文。",
                    ),
                    ("campus-rag-derived", superseded_key): _make_document_units_bytes(
                        document_id="official_web:muc_public_pages:news-003",
                        version_id="owver:news-003",
                        text="旧版本网页正文。",
                    ),
                }
            )
            qdrant_client = QdrantClient(location=":memory:")

            report = release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=registry,
                object_store=object_store,
                qdrant_client=qdrant_client,
                publish_alias=True,
            )

        self.assertEqual(report.document_count, 2)
        self.assertEqual(
            resolve_alias_target(qdrant_client=qdrant_client, alias_name="muc_public_pages"),
            report.physical_collection_name,
        )
        manifest_payload = next(
            json.loads(item["data"].decode("utf-8"))
            for item in object_store.uploads
            if item["key"] == report.manifest_object_key
        )
        self.assertEqual(len(manifest_payload["documents"]), 2)
        self.assertEqual(
            [document["document_id"] for document in manifest_payload["documents"]],
            [
                "official_web:muc_public_pages:news-002",
                "official_web:muc_public_pages:news-004",
            ],
        )

    def test_release_registry_scope_fails_closed_when_scope_has_no_releasable_records(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "no releasable registry records found for official_web/muc_public_pages",
        ):
            release_registry_scope(
                corpus="official_web",
                collection="muc_public_pages",
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=InMemoryDocumentRegistry(),
                object_store=_FakeObjectStore(),
                qdrant_client=QdrantClient(location=":memory:"),
            )
