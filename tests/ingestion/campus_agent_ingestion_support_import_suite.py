from __future__ import annotations

from tests.ingestion.campus_agent_ingestion_support_test_support import *


class CampusragIngestionImportSuite(_CampusragIngestionSupportBase):
    def test_collect_import_document_stats_batches_incremental_upserts_after_single_prefetch(
        self,
    ) -> None:
        doc_a = _document_input(
            document_id="handbook:doc-a",
            version_id="v1:doc-a",
            body='{"type":"paragraph","text":"A"}\n',
        )
        doc_b = _document_input(
            document_id="handbook:doc-b",
            version_id="v1:doc-b",
            body='{"type":"paragraph","text":"B"}\n',
        )
        registry = _SpyDocumentRegistry(records=())

        stats = collect_import_document_stats(
            documents=[doc_a, doc_b],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_rules_cleaning_v1",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 2)
        self.assertEqual(registry.list_by_scope_calls, [("regulations", "student_rules")])
        self.assertEqual(len(registry.upsert_calls), 0)
        self.assertEqual(len(registry.upsert_many_calls), 1)
        self.assertEqual(
            tuple(record.document_id for record in registry.upsert_many_calls[0]),
            ("handbook:doc-a", "handbook:doc-b"),
        )

    def test_collect_import_document_stats_can_replace_scope_after_single_prefetch(self) -> None:
        doc_keep = _document_input(
            document_id="handbook:doc-keep",
            version_id="v1:doc-keep",
            body='{"type":"paragraph","text":"keep"}\n',
        )
        doc_new = _document_input(
            document_id="handbook:doc-new",
            version_id="v2:doc-new",
            body='{"type":"paragraph","text":"new"}\n',
        )
        keep_hash = hashlib.sha256(doc_keep.document_units_bytes).hexdigest()
        old_hash = hashlib.sha256(b"old\n").hexdigest()
        existing_keep = _record(
            document_id="handbook:doc-keep",
            version_id="v1:doc-keep",
            content_hash=keep_hash,
        )
        existing_old = _record(
            document_id="handbook:doc-new",
            version_id="v1:doc-new",
            content_hash=old_hash,
        )
        stale_orphan = _record(
            document_id="handbook:doc-orphan",
            version_id="v1:doc-orphan",
            content_hash=hashlib.sha256(b"orphan\n").hexdigest(),
        )
        registry = _SpyDocumentRegistry(records=(existing_keep, existing_old, stale_orphan))

        stats = collect_import_document_stats(
            documents=[doc_keep, doc_new],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_rules_cleaning_v1",
            default_visibility_scope=None,
            scope_refresh=("regulations", "student_rules"),
        )

        self.assertEqual(stats.success_count, 1)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(stats.updated_document_ids, ("handbook:doc-new",))
        self.assertEqual(stats.skipped_document_ids, ("handbook:doc-keep",))
        self.assertEqual(registry.list_by_scope_calls, [("regulations", "student_rules")])
        self.assertEqual(len(registry.upsert_calls), 0)
        self.assertEqual(len(registry.upsert_many_calls), 0)
        self.assertEqual(len(registry.replace_scope_calls), 1)
        self.assertEqual(
            tuple(record.document_id for record in registry.replace_scope_calls[0][2]),
            ("handbook:doc-keep", "handbook:doc-new"),
        )

    def test_collect_import_document_stats_scope_refresh_rejects_legacy_registry_rows(
        self,
    ) -> None:
        doc_keep = _document_input(
            document_id="handbook:doc-keep",
            version_id="v1:doc-keep",
            body='{"type":"paragraph","text":"keep"}\n',
        )
        doc_new = _document_input(
            document_id="handbook:doc-new",
            version_id="v2:doc-new",
            body='{"type":"paragraph","text":"new"}\n',
        )
        registry = _LegacyProjectionBlockedScopeRefreshRegistry(records=())

        with self.assertRaisesRegex(ValueError, "unsupported authorization projection keys"):
            collect_import_document_stats(
                documents=[doc_keep, doc_new],
                registry=registry,
                raw_asset_registry=_FakeRawAssetRegistry(),
                writer=_FakeWriter(),
                object_store=self.object_store,
                parser_version="campusrag-import-v1",
                embedding_model="Qwen3-Embedding-4B",
                cleaning_policy_version="student_rules_cleaning_v1",
                default_visibility_scope=None,
                scope_refresh=("regulations", "student_rules"),
            )

        self.assertEqual(registry.list_by_scope_calls, [("regulations", "student_rules")])
        self.assertEqual(len(registry.replace_scope_calls), 0)

    def test_collect_import_document_stats_prefers_importable_scope_prefetch(self) -> None:
        doc_new = _document_input(
            document_id="handbook:doc-new",
            version_id="v1:doc-new",
            body='{"type":"paragraph","text":"new"}\n',
        )
        registry = _ImportablePrefetchRegistry(records=())

        stats = collect_import_document_stats(
            documents=[doc_new],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_rules_cleaning_v1",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 1)
        self.assertEqual(registry.importable_scope_calls, [("regulations", "student_rules")])
        self.assertEqual(registry.list_by_scope_calls, [])

    def test_collect_import_document_stats_demotes_prior_current_version_when_new_current_is_imported(
        self,
    ) -> None:
        doc_new_current = _document_input(
            document_id="handbook:doc-current",
            version_id="v2:doc-current",
            body='{"type":"paragraph","text":"new"}\n',
            revision_track="current-effective",
            is_current=True,
        )
        existing_current = _record(
            document_id="handbook:doc-current",
            version_id="v1:doc-current",
            content_hash=hashlib.sha256(b"old\n").hexdigest(),
            revision_track="current-effective",
            is_current=True,
        )
        registry = _SpyDocumentRegistry(records=(existing_current,))

        stats = collect_import_document_stats(
            documents=[doc_new_current],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_rules_cleaning_v1",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 1)
        self.assertEqual(len(registry.upsert_many_calls), 1)
        upserted = registry.upsert_many_calls[0]
        self.assertEqual(len(upserted), 2)
        self.assertEqual(
            tuple(record.version_id for record in upserted if record.is_current),
            ("v2:doc-current",),
        )

    def test_collect_import_document_stats_merges_equivalent_web_source_without_creating_new_version(
        self,
    ) -> None:
        source_uri = "https://www.example.edu/news/doc-a.htm"
        document = _document_input(
            document_id="official_web:doc-a",
            version_id="owdocver:doc-a",
            body='{"type":"paragraph","text":"same"}\n',
            revision_track="current-effective",
            is_current=True,
            source_channel="official_web",
            source_url=source_uri,
            import_source="official_web_source_truth_replay",
        )
        existing = _record(
            document_id="official_web:doc-a",
            version_id="owdocver:doc-a",
            content_hash=hashlib.sha256(document.document_units_bytes).hexdigest(),
            revision_track="current-effective",
            is_current=True,
            source_channel="pdf_ocr",
            source_uri="https://pdf.example/doc-a.pdf",
            import_source="raw_online_ocr",
        )
        registry = _SpyDocumentRegistry(records=(existing,))

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="official_web_projection_replay.v1",
            embedding_model="",
            cleaning_policy_version="official_web_cleaning_v2",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(len(registry.upsert_many_calls), 1)
        merged = registry.upsert_many_calls[0][0]
        self.assertEqual(merged.source_channel, "official_web")
        self.assertEqual(merged.source_uri, source_uri)
        self.assertEqual(len(merged.source_observations), 2)

    def test_collect_import_document_stats_merges_equivalent_official_web_scope_record_with_different_document_id(
        self,
    ) -> None:
        body = (
            '{"doc_id":"official_web:example_public:article_detail:news-doc","version_id":"owdocver:news-doc",'
            '"chunk_id":"news-doc:0001","clean_text":"示例大学与北京丰台人才集团共建就业实习实践基地。",'
            '"anchor":{"section_path":["新闻"],"page_start":1,"page_end":1},'
            '"source_url":"https://news.example.edu/info/1011/61874.htm",'
            '"metadata":{"title":"示例大学与北京丰台人才集团共建就业实习实践基地",'
            '"page_family":"article_detail","serving_intent":"promotable","content_role":"primary_content"},'
            '"acl":{"level":"public","allow_groups":[]}}\n'
        )
        semantic_hash = hashlib.sha256(b"official-web-semantic-duplicate").hexdigest()
        existing = DocumentRegistryRecord(
            document_id="official_web:example_public:article_detail:news-doc",
            version_id="owdocver:news-doc",
            revision_track="source-faithful",
            source_uri="https://news.example.edu/info/1011/61874.htm",
            content_hash=semantic_hash,
            corpus="official_web",
            collection="muc_public_pages",
            cleaning_policy_version="official_web_cleaning_v2",
            entitlement_groups=(),
            visibility_scope=None,
            status="active",
            ingestion_timestamp="2026-04-03T00:00:00+00:00",
            parser_version="official_web_projection_replay.v1",
            embedding_model="",
            is_current=True,
            source_channel="official_web",
            document_units_object_key=(
                "official_web/documents/muc_public_pages/news-doc/source-faithful/undated/document-units.jsonl"
            ),
            processed_object_keys=(
                "official_web/documents/muc_public_pages/news-doc/source-faithful/undated/document-units.jsonl",
            ),
            import_source="official_web_source_truth_replay",
        )
        incoming = DocumentImportInput(
            source_label="official_web:example_public:article_detail:xxgk-doc",
            document_units_bytes=body.encode("utf-8"),
            provider_response_bytes=None,
            canonical_markdown_bytes=None,
            metadata={
                "document_id": "official_web:example_public:article_detail:xxgk-doc",
                "version_id": "owdocver:xxgk-doc",
                "acl_groups": (),
                "source_url": "https://info.example.edu/info/1362/28641.htm",
                "title": "示例大学与北京丰台人才集团共建就业实习实践基地",
                "page_family": "article_detail",
                "serving_intent": "promotable",
                "content_role": "primary_content",
                "semantic_content_hash": semantic_hash,
            },
            import_source="official_web_source_truth_replay",
            revision_track="source-faithful",
            source_channel="official_web",
            is_current=True,
            corpus="official_web",
            collection="muc_public_pages",
            title="示例大学与北京丰台人才集团共建就业实习实践基地",
        )
        registry = _SpyDocumentRegistry(records=(existing,))

        stats = collect_import_document_stats(
            documents=[incoming],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="official_web_projection_replay.v1",
            embedding_model="",
            cleaning_policy_version="official_web_cleaning_v2",
            default_visibility_scope=None,
            scope_refresh=("official_web", "muc_public_pages"),
        )

        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(len(registry.replace_scope_calls), 1)
        refreshed_records = registry.replace_scope_calls[0][2]
        self.assertEqual(len(refreshed_records), 1)
        merged = refreshed_records[0]
        self.assertEqual(merged.document_id, "official_web:example_public:article_detail:news-doc")
        self.assertEqual(merged.version_id, "owdocver:news-doc")
        self.assertEqual(len(merged.source_observations), 2)
        self.assertEqual(
            {observation.source_uri for observation in merged.source_observations},
            {
                "https://news.example.edu/info/1011/61874.htm",
                "https://info.example.edu/info/1362/28641.htm",
            },
        )

    def test_collect_import_document_stats_rewrites_missing_processed_artifacts_for_matching_content(
        self,
    ) -> None:
        document = _document_input(
            document_id="handbook:doc-a",
            version_id="v1:doc-a",
            body='{"type":"paragraph","text":"A"}\n',
        )
        content_hash = hashlib.sha256(document.document_units_bytes).hexdigest()
        existing = _record(
            document_id="handbook:doc-a",
            version_id="v1:doc-a",
            content_hash=content_hash,
        )
        registry = _SpyDocumentRegistry(records=(existing,))
        writer = _FakeWriter()

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=writer,
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_rules_cleaning_v1",
            default_visibility_scope=None,
        )

        expected_key = (
            "regulations/documents/student_rules/doc-a--doc-a/"
            "source-faithful/2026/document-units.jsonl"
        )
        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(stats.updated_document_ids, ())
        self.assertEqual(stats.skipped_document_ids, ("handbook:doc-a",))
        self.assertIn((self.object_store.bucket_derived, expected_key), writer.puts)
        self.assertEqual(len(registry.upsert_many_calls), 1)

    def test_collect_import_document_stats_rewrites_changed_processed_artifacts_for_matching_content(
        self,
    ) -> None:
        document = _document_input(
            document_id="handbook:doc-b",
            version_id="v1:doc-b",
            body='{"type":"paragraph","text":"new"}\n',
        )
        document.metadata["semantic_content_hash"] = "semantic-doc-b"
        existing = _record(
            document_id="handbook:doc-b",
            version_id="v1:doc-b",
            content_hash="semantic-doc-b",
        )
        registry = _SpyDocumentRegistry(records=(existing,))
        expected_key = (
            "regulations/documents/student_rules/doc-b--doc-b/"
            "source-faithful/2026/document-units.jsonl"
        )
        writer = _FakeWriter(existing_objects=((self.object_store.bucket_derived, expected_key),))
        writer.objects[(self.object_store.bucket_derived, expected_key)] = (
            b'{"type":"paragraph","text":"old"}\n'
        )

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=writer,
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_rules_cleaning_v1",
            default_visibility_scope=None,
        )

        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.skipped_count, 1)
        self.assertEqual(stats.skipped_document_ids, ("handbook:doc-b",))
        self.assertIn((self.object_store.bucket_derived, expected_key), writer.puts)
        self.assertEqual(
            writer.objects[(self.object_store.bucket_derived, expected_key)],
            document.document_units_bytes,
        )
        self.assertEqual(len(registry.upsert_many_calls), 1)

    def test_persist_import_documents_forwards_scope_refresh_to_collect_stats(self) -> None:
        document = _document_input(
            document_id="handbook:doc-a",
            version_id="v1:doc-a",
            body='{"type":"paragraph","text":"A"}\n',
        )
        registry = _SpyDocumentRegistry(records=())
        writer = _FakeWriter()

        with patch(
            "campus_ingestion_core.campus_agent_ingestion_support.collect_import_document_stats"
        ) as collect_stats:
            collect_stats.return_value = Mock(
                success_count=1,
                skipped_count=0,
                failed_count=0,
                raw_uploaded_count=0,
                raw_reused_count=0,
                document_ids=("handbook:doc-a",),
                created_document_ids=("handbook:doc-a",),
                updated_document_ids=(),
                skipped_document_ids=(),
                unresolved_source_pdfs=(),
                errors=(),
                timestamp="2026-04-03T00:00:00+00:00",
            )
            persist_import_documents(
                documents=[document],
                registry=registry,
                raw_asset_registry=_FakeRawAssetRegistry(),
                writer=writer,
                object_store=self.object_store,
                parser_version="campusrag-import-v1",
                embedding_model="Qwen3-Embedding-4B",
                cleaning_policy_version="student_rules_cleaning_v1",
                default_visibility_scope=None,
                import_mode="test",
                report_dir=Path("/tmp/test-import-report"),
                report_prefix="test-import",
                scope_refresh=("regulations", "student_rules"),
            )

        self.assertEqual(
            collect_stats.call_args.kwargs["scope_refresh"],
            ("regulations", "student_rules"),
        )

    def test_collect_import_document_stats_prefers_new_authorization_projection_metadata(
        self,
    ) -> None:
        document = _document_input(
            document_id="handbook:doc-authz",
            version_id="v1:doc-authz",
            body='{"type":"paragraph","text":"Authz"}\n',
        )
        document.metadata.update(
            {
                "entitlement_groups": ["students"],
                "visibility_scope": "main",
                "visibility_level": "restricted",
            }
        )
        registry = _SpyDocumentRegistry(records=())

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_rules_cleaning_v1",
            default_visibility_scope="shared-campus",
        )

        self.assertEqual(stats.success_count, 1)
        self.assertEqual(len(registry.upsert_many_calls), 1)
        created_record = registry.upsert_many_calls[0][0]
        self.assertEqual(created_record.entitlement_groups, ("students",))
        self.assertEqual(created_record.visibility_scope, "main")
        self.assertEqual(created_record.visibility_level, "restricted")
        self.assertEqual(
            created_record.policy_projection_version,
            DEFAULT_POLICY_PROJECTION_VERSION,
        )

    def test_collect_import_document_stats_rejects_unsupported_authorization_metadata_keys(
        self,
    ) -> None:
        document = _document_input(
            document_id="handbook:doc-authz",
            version_id="v1:doc-authz",
            body='{"type":"paragraph","text":"Authz"}\n',
        )
        document.metadata.update(
            {
                "acl_level": "restricted",
                "acl_groups": ["legacy-staff"],
                "campus_scope": "south",
            }
        )
        registry = _SpyDocumentRegistry(records=())

        stats = collect_import_document_stats(
            documents=[document],
            registry=registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            writer=_FakeWriter(),
            object_store=self.object_store,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            cleaning_policy_version="student_rules_cleaning_v1",
            default_visibility_scope="shared-campus",
        )

        self.assertEqual(stats.success_count, 0)
        self.assertEqual(stats.failed_count, 1)
        self.assertEqual(len(registry.upsert_many_calls), 0)
        self.assertRegex(
            stats.errors[0],
            "unsupported authorization metadata keys",
        )


class CampusragIngestionAuthorizationSuite(unittest.TestCase):
    def test_apply_authorization_projection_metadata_writes_canonical_projection_fields(
        self,
    ) -> None:
        metadata = {
            "document_id": "handbook:doc-authz",
            "version_id": "v1:doc-authz",
        }

        apply_authorization_projection_metadata(
            metadata,
            entitlement_groups=("students",),
            visibility_scope="main",
            visibility_level="restricted",
        )

        self.assertEqual(metadata["entitlement_groups"], ["students"])
        self.assertEqual(metadata["visibility_scope"], "main")
        self.assertEqual(metadata["visibility_level"], "restricted")
        self.assertEqual(
            metadata["policy_projection_version"],
            DEFAULT_POLICY_PROJECTION_VERSION,
        )

    def test_apply_authorization_projection_metadata_rejects_unsupported_authorization_metadata_keys(
        self,
    ) -> None:
        metadata = {
            "document_id": "handbook:doc-authz",
            "version_id": "v1:doc-authz",
            "acl_level": "public",
            "acl_groups": ["legacy-staff"],
            "campus_scope": "south",
        }

        with self.assertRaisesRegex(ValueError, "unsupported authorization metadata keys"):
            apply_authorization_projection_metadata(
                metadata,
                entitlement_groups=("students",),
                visibility_scope="main",
                visibility_level="restricted",
            )

    def test_load_metadata_from_bytes_reads_canonical_row_authorization_projection(self) -> None:
        metadata = load_metadata_from_bytes(
            b'{"doc_id":"handbook:doc-authz","version_id":"v1:doc-authz",'
            b'"entitlement_groups":["students"],'
            b'"visibility_scope":"main",'
            b'"visibility_level":"restricted",'
            b'"policy_projection_version":"phase1-authorization-projection-v1"}\n'
        )

        self.assertEqual(metadata["entitlement_groups"], ("students",))
        self.assertEqual(metadata["visibility_scope"], "main")
        self.assertEqual(metadata["visibility_level"], "restricted")
        self.assertEqual(
            metadata["policy_projection_version"],
            "phase1-authorization-projection-v1",
        )
        self.assertNotIn("acl_level", metadata)
        self.assertNotIn("acl_groups", metadata)

    def test_load_metadata_from_bytes_rejects_legacy_acl_row_metadata(self) -> None:
        with self.assertRaisesRegex(ValueError, "legacy row authorization metadata is not allowed"):
            load_metadata_from_bytes(
                b'{"doc_id":"handbook:doc-authz","version_id":"v1:doc-authz",'
                b'"entitlement_groups":["students"],'
                b'"visibility_scope":"main",'
                b'"visibility_level":"restricted",'
                b'"acl":{"level":"public","allow_groups":["legacy-staff"]}}\n'
            )
