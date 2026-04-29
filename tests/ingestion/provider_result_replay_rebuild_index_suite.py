from __future__ import annotations

import unittest

from .provider_result_replay_rebuild_test_support import *


class ProviderResultReplayIndexTest(unittest.TestCase):
    def test_index_replayed_documents_fails_closed_when_registry_record_is_missing(self) -> None:
        documents = [
            DocumentImportInput(
                source_label="missing-registry-doc",
                document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                provider_response_bytes=None,
                canonical_markdown_bytes=None,
                metadata={
                    "document_id": "handbook:missing-record",
                    "version_id": "v1:missing-record",
                },
                import_source="provider_response_replay",
                corpus="regulations",
                collection="student_rules",
            )
        ]

        with (
            patch(
                "campus_ingestion_core.local_rebuild_indexing.build_embedding_model",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_core.local_rebuild_indexing.build_sparse_embedding_model",
                return_value=object(),
            ),
            self.assertRaisesRegex(
                ValueError,
                "missing registry record for replayed document regulations/student_rules handbook:missing-record@v1:missing-record",
            ),
        ):
            _index_replayed_documents(
                source={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                    "EMBEDDING_PROVIDER": "mock",
                },
                registry=InMemoryDocumentRegistry(),
                documents=documents,
                object_store=_FakeObjectStore(provider_result_bytes=b""),
                qdrant_client=QdrantClient(location=":memory:"),
            )

    def test_index_replayed_documents_fails_closed_when_document_produces_no_chunks(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry.json")
            document_id = "handbook:empty-chunks"
            version_id = "v1:empty-chunks"
            registry.upsert(
                DocumentRegistryRecord(
                    document_id=document_id,
                    revision_track="source-faithful",
                    version_id=version_id,
                    source_uri=f"https://campus.example/{document_id}",
                    content_hash=f"sha256:{document_id}",
                    corpus="regulations",
                    collection="student_rules",
                    entitlement_groups=("students",),
                    status="active",
                    ingestion_timestamp="2026-03-26T10:00:00+00:00",
                    parser_version="paddleocr-vl-1.5",
                    embedding_model="mock-embedding-8d",
                    source_channel="pdf_ocr",
                    document_units_object_key=f"documents/{document_id}.jsonl",
                    processed_object_keys=(f"documents/{document_id}.jsonl",),
                    import_source="provider_response_replay",
                )
            )
            documents = [
                DocumentImportInput(
                    source_label="empty-chunks-doc",
                    document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata={"document_id": document_id, "version_id": version_id},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_rules",
                )
            ]

            with (
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_embedding_model",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_sparse_embedding_model",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_indexable_chunks_from_jsonl",
                    return_value=(),
                ),
                self.assertRaisesRegex(
                    ValueError,
                    "replayed document regulations/student_rules handbook:empty-chunks@v1:empty-chunks produced no chunks",
                ),
            ):
                _index_replayed_documents(
                    source={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                    },
                    registry=registry,
                    documents=documents,
                    object_store=_FakeObjectStore(provider_result_bytes=b""),
                    qdrant_client=QdrantClient(location=":memory:"),
                )

    def test_index_replayed_documents_batches_upserts_and_only_ensures_collection_once(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry.json")
            documents: list[DocumentImportInput] = []
            for index in range(3):
                document_id = f"handbook:test-{index + 1:03d}"
                version_id = f"v1:test-{index + 1:03d}"
                registry.upsert(
                    DocumentRegistryRecord(
                        document_id=document_id,
                        revision_track="source-faithful",
                        version_id=version_id,
                        source_uri=f"https://campus.example/{document_id}",
                        content_hash=f"sha256:{document_id}",
                        corpus="regulations",
                        collection="student_rules",
                        entitlement_groups=("students",),
                        status="active",
                        ingestion_timestamp="2026-03-26T10:00:00+00:00",
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        source_channel="pdf_ocr",
                        document_units_object_key=f"documents/{document_id}.jsonl",
                        processed_object_keys=(f"documents/{document_id}.jsonl",),
                        import_source="provider_response_replay",
                    )
                )
                documents.append(
                    DocumentImportInput(
                        source_label=f"doc-{index + 1}",
                        document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                        provider_response_bytes=None,
                        canonical_markdown_bytes=None,
                        metadata={"document_id": document_id, "version_id": version_id},
                        import_source="provider_response_replay",
                        corpus="regulations",
                        collection="student_rules",
                    )
                )

            built_chunks = {
                str(document.metadata["document_id"]): (
                    IndexableChunk(
                        document_id=str(document.metadata["document_id"]),
                        revision_track="source-faithful",
                        version_id=str(document.metadata["version_id"]),
                        chunk_id=f"{document.metadata['document_id']}:chunk-0001",
                        chunk_order=1,
                        corpus="regulations",
                        collection="student_rules",
                        entitlement_groups=("students",),
                        visibility_scope=None,
                        visibility_level="restricted",
                        source_uri=f"https://campus.example/{document.metadata['document_id']}",
                        source_chunk_id=None,
                        anchor={"page_start": index + 1, "page_end": index + 1},
                        text=f"chunk text {index + 1}",
                        source_channel="pdf_ocr",
                        is_current=False,
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        embedding=(0.1, 0.2),
                    ),
                )
                for index, document in enumerate(documents)
            }
            release_store = _FakeObjectStore(provider_result_bytes=b"")

            with (
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_embedding_model",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_sparse_embedding_model",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_indexable_chunks_from_jsonl",
                    side_effect=lambda **kwargs: built_chunks[kwargs["record"].document_id],
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.index_chunks_to_qdrant"
                ) as index_chunks,
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.publish_release_alias",
                    return_value=None,
                ),
            ):
                _index_replayed_documents(
                    source={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "QDRANT_UPSERT_BATCH_SIZE": "2",
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                    },
                    registry=registry,
                    documents=documents,
                    object_store=release_store,
                    qdrant_client=QdrantClient(location=":memory:"),
                )

        self.assertEqual(index_chunks.call_count, 2)
        first_call = index_chunks.call_args_list[0].kwargs
        second_call = index_chunks.call_args_list[1].kwargs
        self.assertEqual(
            tuple(chunk.document_id for chunk in first_call["chunks"]),
            ("handbook:test-001", "handbook:test-002"),
        )
        self.assertEqual(
            tuple(chunk.document_id for chunk in second_call["chunks"]), ("handbook:test-003",)
        )
        self.assertTrue(first_call["collection_name"].startswith("student_rules__r"))
        self.assertEqual(first_call["collection_name"], second_call["collection_name"])
        self.assertTrue(first_call["ensure_collection"])
        self.assertTrue(first_call["ensure_payload_indexes"])
        self.assertFalse(second_call["ensure_collection"])
        self.assertFalse(second_call["ensure_payload_indexes"])
        self.assertEqual(first_call["extra_payload"]["index_release_alias"], "student_rules")
        self.assertEqual(
            first_call["extra_payload"]["index_release_id"],
            second_call["extra_payload"]["index_release_id"],
        )
        self.assertEqual(
            first_call["extra_payload"]["index_physical_collection_name"],
            first_call["collection_name"],
        )
        upload_keys = [str(upload["key"]) for upload in release_store.uploads]
        self.assertIn(
            f"regulations/releases/student_rules/{first_call['extra_payload']['index_release_id']}/index-release.json",
            upload_keys,
        )
        self.assertIn(
            f"regulations/releases/student_rules/{first_call['extra_payload']['index_release_id']}/validation-summary.json",
            upload_keys,
        )

    def test_index_replayed_documents_routes_projection_documents_to_their_own_collections(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryDocumentRegistry(backing_path=root / "registry.json")
            documents = [
                DocumentImportInput(
                    source_label="handbook",
                    document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata={"document_id": "handbook:test-001", "version_id": "v1:handbook-001"},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_rules",
                ),
                DocumentImportInput(
                    source_label="contact",
                    document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata={
                        "document_id": "campus_services:contact_directory:test-001",
                        "version_id": "v1:contact-001",
                    },
                    import_source="provider_response_replay",
                    corpus="campus_services",
                    collection="contact_directory",
                ),
                DocumentImportInput(
                    source_label="service",
                    document_units_bytes=b'{"doc_id":"placeholder","version_id":"placeholder"}',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=None,
                    metadata={
                        "document_id": "campus_services:service_catalog:test-001",
                        "version_id": "v1:service-001",
                    },
                    import_source="provider_response_replay",
                    corpus="campus_services",
                    collection="service_catalog",
                ),
            ]
            for document in documents:
                registry.upsert(
                    DocumentRegistryRecord(
                        document_id=str(document.metadata["document_id"]),
                        revision_track="source-faithful",
                        version_id=str(document.metadata["version_id"]),
                        source_uri=f"https://campus.example/{document.metadata['document_id']}",
                        content_hash=f"sha256:{document.metadata['document_id']}",
                        corpus=document.corpus,
                        collection=document.collection,
                        entitlement_groups=("students",),
                        status="active",
                        ingestion_timestamp="2026-03-26T10:00:00+00:00",
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        source_channel="pdf_ocr",
                        document_units_object_key=f"documents/{document.metadata['document_id']}.jsonl",
                        processed_object_keys=(
                            f"documents/{document.metadata['document_id']}.jsonl",
                        ),
                        import_source="provider_response_replay",
                    )
                )

            built_chunks = {
                "handbook:test-001": (
                    IndexableChunk(
                        document_id="handbook:test-001",
                        revision_track="source-faithful",
                        version_id="v1:handbook-001",
                        chunk_id="handbook:test-001:chunk-0001",
                        chunk_order=1,
                        corpus="regulations",
                        collection="student_rules",
                        entitlement_groups=("students",),
                        visibility_scope=None,
                        visibility_level="restricted",
                        source_uri="https://campus.example/handbook:test-001",
                        source_chunk_id=None,
                        anchor={"page_start": 1, "page_end": 1},
                        text="handbook chunk",
                        source_channel="pdf_ocr",
                        is_current=False,
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        embedding=(0.1, 0.2),
                    ),
                ),
                "campus_services:contact_directory:test-001": (
                    IndexableChunk(
                        document_id="campus_services:contact_directory:test-001",
                        revision_track="source-faithful",
                        version_id="v1:contact-001",
                        chunk_id="campus_services:contact_directory:test-001:chunk-0001",
                        chunk_order=1,
                        corpus="campus_services",
                        collection="contact_directory",
                        entitlement_groups=("students",),
                        visibility_scope=None,
                        visibility_level="restricted",
                        source_uri="https://campus.example/campus_services:contact_directory:test-001",
                        source_chunk_id=None,
                        anchor={"page_start": 1, "page_end": 1},
                        text="contact chunk",
                        source_channel="pdf_ocr",
                        is_current=False,
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        embedding=(0.1, 0.2),
                    ),
                ),
                "campus_services:service_catalog:test-001": (
                    IndexableChunk(
                        document_id="campus_services:service_catalog:test-001",
                        revision_track="source-faithful",
                        version_id="v1:service-001",
                        chunk_id="campus_services:service_catalog:test-001:chunk-0001",
                        chunk_order=1,
                        corpus="campus_services",
                        collection="service_catalog",
                        entitlement_groups=("students",),
                        visibility_scope=None,
                        visibility_level="restricted",
                        source_uri="https://campus.example/campus_services:service_catalog:test-001",
                        source_chunk_id=None,
                        anchor={"page_start": 1, "page_end": 1},
                        text="service chunk",
                        source_channel="pdf_ocr",
                        is_current=False,
                        parser_version="paddleocr-vl-1.5",
                        embedding_model="mock-embedding-8d",
                        embedding=(0.1, 0.2),
                    ),
                ),
            }
            release_store = _FakeObjectStore(provider_result_bytes=b"")

            with (
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_embedding_model",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_sparse_embedding_model",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_indexable_chunks_from_jsonl",
                    side_effect=lambda **kwargs: built_chunks[kwargs["record"].document_id],
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.index_chunks_to_qdrant"
                ) as index_chunks,
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.publish_release_alias",
                    return_value=None,
                ),
            ):
                _index_replayed_documents(
                    source={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "QDRANT_UPSERT_BATCH_SIZE": "128",
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                    },
                    registry=registry,
                    documents=documents,
                    object_store=release_store,
                    qdrant_client=QdrantClient(location=":memory:"),
                )

        self.assertEqual(index_chunks.call_count, 3)
        self.assertTrue(
            index_chunks.call_args_list[0].kwargs["collection_name"].startswith("student_rules__r")
        )
        self.assertTrue(
            index_chunks.call_args_list[1]
            .kwargs["collection_name"]
            .startswith("contact_directory__r")
        )
        self.assertTrue(
            index_chunks.call_args_list[2]
            .kwargs["collection_name"]
            .startswith("service_catalog__r")
        )
        self.assertEqual(
            index_chunks.call_args_list[0].kwargs["extra_payload"]["index_release_alias"],
            "student_rules",
        )
        self.assertEqual(
            index_chunks.call_args_list[1].kwargs["extra_payload"]["index_release_alias"],
            "contact_directory",
        )
        self.assertEqual(
            index_chunks.call_args_list[2].kwargs["extra_payload"]["index_release_alias"],
            "service_catalog",
        )
        self.assertTrue(index_chunks.call_args_list[0].kwargs["ensure_collection"])
        self.assertTrue(index_chunks.call_args_list[1].kwargs["ensure_collection"])
        self.assertTrue(index_chunks.call_args_list[2].kwargs["ensure_collection"])
        upload_keys = [str(upload["key"]) for upload in release_store.uploads]
        self.assertIn(
            f"regulations/releases/student_rules/{index_chunks.call_args_list[0].kwargs['extra_payload']['index_release_id']}/index-release.json",
            upload_keys,
        )
        self.assertIn(
            f"campus_services/releases/contact_directory/{index_chunks.call_args_list[1].kwargs['extra_payload']['index_release_id']}/index-release.json",
            upload_keys,
        )
        self.assertIn(
            f"campus_services/releases/service_catalog/{index_chunks.call_args_list[2].kwargs['extra_payload']['index_release_id']}/index-release.json",
            upload_keys,
        )
