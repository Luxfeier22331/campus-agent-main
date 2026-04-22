from __future__ import annotations

from tests.ingestion.campusrag_ingestion_support_test_support import *


class CampusragIngestionSourcesSuite(unittest.TestCase):
    def test_document_semantic_hash_prefers_explicit_hash(self) -> None:
        document = _document_input(
            document_id="handbook:doc-semantic",
            version_id="v1:doc-semantic",
            body='{"type":"paragraph","text":"semantic"}\n',
        )
        document.metadata["semantic_content_hash"] = "semantic-doc-semantic"

        self.assertEqual(
            document_semantic_hash(
                document_units_bytes=document.document_units_bytes,
                semantic_content_hash=document.metadata.get("semantic_content_hash"),
            ),
            "semantic-doc-semantic",
        )

    def test_merge_equivalent_source_record_prefers_official_web_for_current_effective_records(
        self,
    ) -> None:
        existing = _record(
            document_id="handbook:doc-merge-helper",
            version_id="v1:doc-merge-helper",
            content_hash=hashlib.sha256(b"same\n").hexdigest(),
            revision_track="current-effective",
            is_current=True,
            source_channel="pdf_ocr",
            source_uri="https://pdf.example/doc-merge-helper",
        )
        candidate = build_source_observation(
            source_channel="official_web",
            source_uri="https://web.example/doc-merge-helper",
            raw_asset=None,
            is_primary=False,
            import_source="official_web_sync",
        )

        merged = merge_equivalent_source_record(
            existing=existing,
            candidate_observation=candidate,
            candidate_is_current=True,
            timestamp="2026-03-25T01:00:00+00:00",
        )

        self.assertEqual(merged.source_channel, "official_web")
        self.assertEqual(merged.source_uri, "https://web.example/doc-merge-helper")
        self.assertEqual(len(merged.source_observations), 2)
        self.assertEqual(
            tuple(
                observation.source_channel
                for observation in merged.source_observations
                if observation.is_primary
            ),
            ("official_web",),
        )


class CampusragIngestionMetadataSuite(unittest.TestCase):
    def test_derive_source_uri_prefers_source_url(self) -> None:
        self.assertEqual(
            derive_source_uri(
                {
                    "source_url": " https://example.edu/source-url ",
                    "source_pdf": "https://example.edu/source.pdf",
                }
            ),
            " https://example.edu/source-url ",
        )

    def test_derive_document_title_and_year_use_metadata_before_fallback(self) -> None:
        metadata = {
            "document_title": " 2026 学生手册 ",
            "published_date": "2026-03-24",
        }

        self.assertEqual(
            derive_document_title(metadata=metadata, document_id="handbook:doc-title"),
            "2026 学生手册",
        )
        self.assertEqual(derive_document_year(metadata=metadata), "2026")

    def test_resolved_raw_asset_reuses_override_and_derives_capture_key(self) -> None:
        with TemporaryDirectory() as tmpdir:
            raw_path = Path(tmpdir) / "guide-2026.pdf"
            raw_path.write_bytes(b"pdf-bytes")

            resolved = resolved_raw_asset(
                raw_path=raw_path,
                raw_source_uri=None,
                corpus="regulations",
                raw_asset_id_override="override-asset",
            )

        assert resolved is not None
        self.assertEqual(resolved.raw_asset_id, "override-asset")
        self.assertEqual(
            resolved.raw_version_id,
            f"sha256:{hashlib.sha256(b'pdf-bytes').hexdigest()}",
        )
        self.assertTrue(resolved.raw_source_uri.endswith("/guide-2026.pdf"))
        self.assertTrue(resolved.object_key.endswith("/capture/guide-2026.pdf"))


class CampusragIngestionRefreshSuite(_CampusragIngestionSupportBase):
    def test_artifact_bucket_for_key_routes_source_truth_keys_to_source_bucket(self) -> None:
        source_key = build_source_truth_artifact_key(
            raw_asset_id="asset:doc-refresh",
            raw_version_id="sha256:doc-refresh",
            filename="provider-response.jsonl",
            year="2026",
        )

        self.assertEqual(
            artifact_bucket_for_key(object_store=self.object_store, key=source_key),
            self.object_store.bucket_source,
        )

    def test_registry_record_needs_refresh_returns_false_when_processed_artifacts_match(
        self,
    ) -> None:
        existing = _record(
            document_id="handbook:doc-refresh",
            version_id="v1:doc-refresh",
            content_hash=hashlib.sha256(b"same\n").hexdigest(),
        )
        writer = _FakeWriter(
            existing_objects=(
                (self.object_store.bucket_derived, existing.document_units_object_key),
            )
        )
        writer.objects[(self.object_store.bucket_derived, existing.document_units_object_key)] = (
            b"same\n"
        )

        self.assertFalse(
            registry_record_needs_refresh(
                existing=existing,
                document_units_bytes=b"same\n",
                document_units_key=existing.document_units_object_key,
                provider_response_bytes=None,
                provider_response_key=existing.provider_response_object_key,
                layout_elements_bytes=None,
                layout_elements_key=existing.layout_elements_object_key,
                canonical_markdown_bytes=None,
                canonical_markdown_key=existing.canonical_markdown_object_key,
                processed_object_keys=existing.processed_object_keys,
                writer=writer,
                object_store=self.object_store,
            )
        )


class CampusragIngestionRegistryStateSuite(unittest.TestCase):
    def test_apply_current_promotion_demotes_prior_current_record(self) -> None:
        prior_current = _record(
            document_id="handbook:doc-current",
            version_id="v1:doc-current",
            content_hash=hashlib.sha256(b"old\n").hexdigest(),
            revision_track="current-effective",
            is_current=True,
        )
        new_current = _record(
            document_id="handbook:doc-current",
            version_id="v2:doc-current",
            content_hash=hashlib.sha256(b"new\n").hexdigest(),
            revision_track="current-effective",
            is_current=True,
        )

        promoted, demoted = apply_current_promotion(
            existing_records_by_lineage={
                ("regulations", "student_rules"): {
                    ("handbook:doc-current", "current-effective"): (prior_current,),
                }
            },
            scope=("regulations", "student_rules"),
            record=new_current,
        )

        self.assertEqual(promoted.supersedes_version_id, "v1:doc-current")
        self.assertEqual(len(demoted), 1)
        self.assertFalse(demoted[0].is_current)
        self.assertEqual(demoted[0].status, "superseded")


class CampusragIngestionArtifactsSuite(_CampusragIngestionSupportBase):
    def test_document_import_stub_round_trips_shared_shape(self) -> None:
        document = DocumentImportInput(
            source_label="notice-1",
            document_units_bytes=b"units",
            provider_response_bytes=b'{"ok":true}\n',
            canonical_markdown_bytes=b"# Title\n",
            metadata=_metadata("notice:1", "sha256:1"),
            import_source="authenticated_notice_source_projection",
            revision_track="source-faithful",
            source_channel="pdf_ocr",
            is_current=True,
            corpus="campus_notices",
            collection="internal_notice",
            visibility_scope="authenticated",
            status="active",
            raw_source_uri="https://portal.example.edu/notice/1",
            raw_asset_id="raw-1",
            raw_version_id="sha256:raw-1",
            provider_response_object_key="derived/provider.json",
            layout_elements_bytes=b'{"layout":true}\n',
            layout_elements_object_key="derived/layout.jsonl",
            additional_processed_object_keys=("source-truth/notice.json", "derived/provider.json"),
            title="测试通知",
            year="2026",
        )

        payload = serialize_document_import_stub(document)
        parsed = parse_document_import_stub(payload)

        self.assertEqual(parsed.source_label, document.source_label)
        self.assertEqual(parsed.metadata, document.metadata)
        self.assertEqual(parsed.import_source, document.import_source)
        self.assertEqual(parsed.provider_response_object_key, "derived/provider.json")
        self.assertEqual(parsed.layout_elements_object_key, "derived/layout.jsonl")
        self.assertEqual(
            parsed.additional_processed_object_keys,
            ("source-truth/notice.json", "derived/provider.json"),
        )
        self.assertEqual(parsed.title, "测试通知")
        self.assertEqual(parsed.year, "2026")
        self.assertEqual(parsed.document_units_bytes, b"")
        self.assertIsNone(parsed.provider_response_bytes)
        self.assertIsNone(parsed.canonical_markdown_bytes)

    def test_build_document_processed_object_keys_dedupes_in_repo_owned_order(self) -> None:
        result = build_document_processed_object_keys(
            document_units_key="derived/document-units.jsonl",
            provider_response_key="derived/provider.json",
            layout_elements_key="derived/layout.jsonl",
            canonical_markdown_key="derived/canonical.md",
            additional_keys=(
                "derived/provider.json",
                "source-truth/notice.json",
                None,
                "derived/document-units.jsonl",
            ),
        )

        self.assertEqual(
            result,
            (
                "derived/provider.json",
                "derived/layout.jsonl",
                "derived/canonical.md",
                "derived/document-units.jsonl",
                "source-truth/notice.json",
            ),
        )

    def test_resolve_document_artifact_keys_reuses_explicit_keys_and_builds_missing_derived_keys(
        self,
    ) -> None:
        document = DocumentImportInput(
            source_label="notice-2",
            document_units_bytes=b"units",
            provider_response_bytes=b'{"ok":true}\n',
            canonical_markdown_bytes=b"# Title\n",
            metadata=_metadata("notice:2", "sha256:2"),
            import_source="provider_response_replay",
            revision_track="source-faithful",
            source_channel="pdf_ocr",
            corpus="regulations",
            collection="student_rules",
            provider_response_object_key="source/provider.json",
            layout_elements_bytes=b'{"layout":true}\n',
            layout_elements_object_key=None,
            title="测试手册",
            year="2026",
        )

        result = resolve_document_artifact_keys(
            document=document,
            document_id="notice:2",
            version_id="sha256:2",
            title="测试手册",
            year="2026",
        )

        self.assertIsInstance(result, ResolvedDocumentArtifactKeys)
        self.assertEqual(result.provider_response_key, "source/provider.json")
        self.assertIsNotNone(result.layout_elements_key)
        self.assertIn("layout-elements.jsonl", str(result.layout_elements_key))
        self.assertIsNotNone(result.canonical_markdown_key)
        self.assertIn("canonical.md", str(result.canonical_markdown_key))
        self.assertIn("document-units.jsonl", result.document_units_key)

    def test_build_registry_record_from_stage_payload_prefers_staged_artifact_keys(self) -> None:
        document = DocumentImportInput(
            source_label="notice-3",
            document_units_bytes=b"units",
            provider_response_bytes=None,
            canonical_markdown_bytes=None,
            metadata={
                **_metadata("notice:3", "sha256:3"),
                "source_url": "https://portal.example.edu/notice/3",
            },
            import_source="authenticated_notice_source_projection",
            revision_track="source-faithful",
            source_channel="authenticated_notice_portal",
            corpus="campus_notices",
            collection="internal_notice",
            visibility_scope="campus",
            provider_response_object_key="source/provider.json",
            layout_elements_object_key="source/layout.jsonl",
            additional_processed_object_keys=("source/notice-manifest.json",),
            title="测试通知",
            year="2026",
        )
        payload = serialize_document_import_stub(document)
        payload.update(
            {
                "document_id": "notice:3",
                "version_id": "sha256:3",
                "parser_version": "parser-v1",
                "embedding_model": "Qwen3-Embedding-4B",
                "cleaning_policy_version": "clean-v1",
            }
        )
        stage_payload = {
            "document": payload,
            "staged_object_keys": {
                "document_units": "stage/document-units.jsonl",
                "provider_response": "stage/provider.json",
                "layout_elements": "stage/layout.jsonl",
                "canonical_markdown": "stage/canonical.md",
            },
            "final_object_keys": {
                "document_units": "final/document-units.jsonl",
            },
            "content_hash": "content-sha",
        }

        record = build_registry_record_from_stage_payload(
            stage_payload,
            artifact_source="staged",
            timestamp="2026-04-19T00:00:00+00:00",
        )

        self.assertEqual(record.document_units_object_key, "stage/document-units.jsonl")
        self.assertEqual(record.provider_response_object_key, "stage/provider.json")
        self.assertEqual(record.layout_elements_object_key, "stage/layout.jsonl")
        self.assertEqual(record.canonical_markdown_object_key, "stage/canonical.md")
        self.assertEqual(
            record.processed_object_keys,
            (
                "stage/provider.json",
                "stage/layout.jsonl",
                "stage/canonical.md",
                "stage/document-units.jsonl",
                "source/notice-manifest.json",
            ),
        )

    def test_build_registry_record_from_stage_payload_prefers_frozen_final_processed_keys(
        self,
    ) -> None:
        document = DocumentImportInput(
            source_label="notice-4",
            document_units_bytes=b"units",
            provider_response_bytes=None,
            canonical_markdown_bytes=None,
            metadata={
                **_metadata("notice:4", "sha256:4"),
                "source_url": "https://portal.example.edu/notice/4",
            },
            import_source="authenticated_notice_source_projection",
            revision_track="source-faithful",
            source_channel="authenticated_notice_portal",
            corpus="campus_notices",
            collection="internal_notice",
            visibility_scope="campus",
            provider_response_object_key="final/provider.json",
            layout_elements_object_key="final/layout.jsonl",
            additional_processed_object_keys=("source/notice-manifest.json",),
            title="测试通知",
            year="2026",
        )
        payload = serialize_document_import_stub(document)
        payload.update(
            {
                "document_id": "notice:4",
                "version_id": "sha256:4",
                "parser_version": "parser-v1",
                "embedding_model": "Qwen3-Embedding-4B",
                "cleaning_policy_version": "clean-v1",
                "processed_object_keys": [
                    "final/provider.json",
                    "final/layout.jsonl",
                    "final/canonical.md",
                    "final/document-units.jsonl",
                ],
            }
        )
        stage_payload = {
            "document": payload,
            "staged_object_keys": {
                "document_units": "stage/document-units.jsonl",
            },
            "final_object_keys": {
                "document_units": "final/document-units.jsonl",
                "canonical_markdown": "final/canonical.md",
            },
            "content_hash": "content-sha",
        }

        record = build_registry_record_from_stage_payload(
            stage_payload,
            artifact_source="final",
            timestamp="2026-04-19T00:00:00+00:00",
        )

        self.assertEqual(record.document_units_object_key, "final/document-units.jsonl")
        self.assertEqual(record.provider_response_object_key, "final/provider.json")
        self.assertEqual(record.layout_elements_object_key, "final/layout.jsonl")
        self.assertEqual(record.canonical_markdown_object_key, "final/canonical.md")
        self.assertEqual(
            record.processed_object_keys,
            (
                "final/provider.json",
                "final/layout.jsonl",
                "final/canonical.md",
                "final/document-units.jsonl",
                "source/notice-manifest.json",
            ),
        )

    def test_s3_object_store_writer_uses_one_shot_client_for_zero_byte_payloads(self) -> None:
        created_clients: list[_FakeS3Client] = []

        class _Factory:
            def __init__(self, settings: ObjectStoreSettings) -> None:
                self.settings = settings

            def create(self) -> _FakeS3Client:
                client = _FakeS3Client(name=f"client-{len(created_clients) + 1}")
                created_clients.append(client)
                return client

        with patch("campus_ingestion_core.object_store.S3ObjectStoreClientFactory", _Factory):
            writer = S3ObjectStoreWriter(self.object_store)
            writer.put_bytes(
                bucket="campus-rag-source",
                key="non-empty-before.json",
                data=b'{"ok": 1}',
                content_type="application/json",
            )
            writer.put_bytes(
                bucket="campus-rag-source",
                key="empty.jsonl",
                data=b"",
                content_type="application/x-ndjson",
            )
            writer.put_bytes(
                bucket="campus-rag-source",
                key="non-empty-after.json",
                data=b'{"ok": 2}',
                content_type="application/json",
            )

        self.assertEqual(len(created_clients), 2)
        self.assertEqual(
            [call["Key"] for call in created_clients[0].put_calls],
            ["non-empty-before.json", "non-empty-after.json"],
        )
        self.assertEqual([call["Key"] for call in created_clients[1].put_calls], ["empty.jsonl"])
        self.assertTrue(created_clients[1].closed)

    def test_s3_object_store_writer_supports_get_bytes(self) -> None:
        class _Factory:
            def __init__(self, settings: ObjectStoreSettings) -> None:
                self.settings = settings

            def create(self) -> _FakeS3Client:
                client = _FakeS3Client(name="reader")
                client.objects[("campus-rag-source", "source-truth/test.json")] = b'{"ok": 1}'
                return client

        with patch("campus_ingestion_core.object_store.S3ObjectStoreClientFactory", _Factory):
            writer = S3ObjectStoreWriter(self.object_store)
            payload = writer.get_bytes(
                bucket="campus-rag-source",
                key="source-truth/test.json",
            )

        self.assertEqual(payload, b'{"ok": 1}')
