from __future__ import annotations

from tests.ingestion.registry_models_test_support import *


class RegistryModelsRecordSuite(unittest.TestCase):
    def test_registry_defaults_are_schema_qualified_under_ingestion_registry(self) -> None:
        self.assertEqual(
            DEFAULT_DOCUMENT_REGISTRY_TABLE,
            "ingestion_registry.document_registry_records",
        )
        self.assertEqual(
            DEFAULT_RAW_ASSET_REGISTRY_TABLE,
            "ingestion_registry.raw_asset_registry_records",
        )

    def test_document_registry_record_serializes_required_fields(self) -> None:
        record = _handbook_document_record(
            version_id="v1:test-001",
            content_hash="sha256:test-001",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
        )

        payload = asdict(record)

        self.assertEqual(payload["document_id"], "handbook:test-001")
        self.assertEqual(payload["revision_track"], "source-faithful")
        self.assertEqual(payload["corpus"], "regulations")
        self.assertEqual(payload["collection"], "student_rules")
        self.assertEqual(payload["cleaning_policy_version"], "student_rules_cleaning_v1")
        self.assertEqual(payload["entitlement_groups"], ("students",))
        self.assertEqual(payload["visibility_scope"], None)
        self.assertEqual(payload["visibility_level"], "restricted")
        self.assertEqual(
            payload["policy_projection_version"],
            "phase1-authorization-projection-v1",
        )
        self.assertEqual(payload["status"], "active")
        self.assertEqual(payload["import_source"], "raw_online_ocr")
        self.assertEqual(payload["source_channel"], "pdf_ocr")
        self.assertEqual(payload["raw_asset"]["raw_asset_id"], "asset:synthetic-student-handbook")
        self.assertEqual(payload["raw_asset"]["raw_version_id"], "sha256:raw-001")
        self.assertEqual(payload["raw_asset"]["page_start"], 10)
        self.assertEqual(payload["raw_asset"]["page_end"], 12)
        self.assertEqual(
            payload["canonical_markdown_object_key"],
            HANDBOOK_CANONICAL_KEY,
        )

    def test_document_registry_record_defaults_to_public_without_projection(self) -> None:
        record = DocumentRegistryRecord(
            document_id="curriculum:plan-legacy",
            revision_track="source-faithful",
            version_id="sha256:raw-legacy",
            source_uri="https://campus.example/curriculum/legacy",
            content_hash="sha256:legacy",
            corpus="curriculum",
            collection="curriculum_plan",
            status="active",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
            parser_version="curriculum-plan-ocr-v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            import_source="raw_online_ocr",
        )

        self.assertEqual(record.entitlement_groups, ())
        self.assertIsNone(record.visibility_scope)
        self.assertEqual(record.visibility_level, "public")
        self.assertEqual(
            record.policy_projection_version,
            "phase1-authorization-projection-v1",
        )

    def test_document_registry_record_uses_canonical_projection_fields(self) -> None:
        record = DocumentRegistryRecord(
            document_id="curriculum:plan-authz",
            revision_track="source-faithful",
            version_id="sha256:raw-authz",
            source_uri="https://campus.example/curriculum/authz",
            content_hash="sha256:authz",
            corpus="curriculum",
            collection="curriculum_plan",
            entitlement_groups=("students",),
            visibility_scope="main",
            status="active",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
            parser_version="curriculum-plan-ocr-v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            import_source="raw_online_ocr",
        )

        self.assertEqual(record.entitlement_groups, ("students",))
        self.assertEqual(record.visibility_scope, "main")
        self.assertEqual(record.visibility_level, "restricted")

    def test_file_document_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )

            registry.upsert(record)
            loaded = registry.get("handbook:test-001", "source-faithful", "v1:test-001")

            self.assertEqual(loaded, record)

    def test_file_document_registry_roundtrips_source_observations(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            record = replace(
                record,
                source_observations=(
                    SourceObservation(
                        source_channel="pdf_ocr",
                        source_uri="campus-agent://canonical/regulations/student_rules/docs/test-001.md",
                        raw_asset=record.raw_asset,
                        is_primary=False,
                        import_source="raw_online_ocr",
                    ),
                    SourceObservation(
                        source_channel="official_web",
                        source_uri="https://campus.example/policies/test-001",
                        raw_asset=None,
                        is_primary=True,
                        import_source="official_web_sync",
                    ),
                ),
                source_uri="https://campus.example/policies/test-001",
                source_channel="official_web",
                raw_asset=None,
            )

            registry.upsert(record)
            loaded = registry.get("handbook:test-001", "source-faithful", "v1:test-001")

            self.assertEqual(loaded, record)

    def test_file_document_registry_lists_by_corpus_and_latest_versions(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            v1 = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            v2 = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )

            registry.upsert(v1)
            registry.upsert(v2)

            records = registry.list_by_scope("regulations", "student_rules")
            latest = registry.latest_versions("handbook:test-001")

            self.assertEqual(records, (v1, v2))
            self.assertEqual(latest, (v2,))

    def test_file_document_registry_current_version_requires_explicit_current_record(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            stale_record = replace(
                _handbook_document_record(
                    version_id="v2:test-001",
                    content_hash="sha256:test-002",
                    ingestion_timestamp="2026-03-23T10:00:00+00:00",
                ),
                is_current=False,
            )

            registry.upsert(stale_record)

            self.assertIsNone(registry.current_version("handbook:test-001"))

    def test_file_document_registry_upsert_many_persists_all_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            handbook_record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()

            registry.upsert_many((handbook_record, curriculum_record))

            self.assertEqual(
                registry.get("handbook:test-001", "source-faithful", "v1:test-001"),
                handbook_record,
            )
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_replace_scope_replaces_only_target_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryDocumentRegistry(backing_path=Path(temp_dir) / "registry.json")
            handbook_old = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            handbook_new = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_old)
            registry.upsert(curriculum_record)

            registry.replace_scope("regulations", "student_rules", (handbook_new,))

            self.assertEqual(
                registry.list_by_scope("regulations", "student_rules"),
                (handbook_new,),
            )
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_delete_by_corpus_removes_only_matching_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            registry = InMemoryDocumentRegistry(backing_path=path)
            handbook_record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.delete_by_scope("regulations", "student_rules")

            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v1:test-001"))
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_delete_document_removes_all_versions_for_document(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            registry = InMemoryDocumentRegistry(backing_path=path)
            handbook_v1 = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            handbook_v2 = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_v1)
            registry.upsert(handbook_v2)
            registry.upsert(curriculum_record)

            registry.delete_document("handbook:test-001")

            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v1:test-001"))
            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v2:test-001"))
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_requires_explicit_artifact_keys_in_payload(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            path.write_text(
                json.dumps(
                    {
                        "handbook:test-001::source-faithful::v1:test-001": {
                            "document_id": "handbook:test-001",
                            "revision_track": "source-faithful",
                            "version_id": "v1:test-001",
                            "source_uri": "campus-agent://canonical/regulations/student_rules/docs/test-001.md",
                            "content_hash": "sha256:test-001",
                            "corpus": "regulations",
                            "collection": "student_rules",
                            "cleaning_policy_version": "student_rules_cleaning_v1",
                            "entitlement_groups": ["students"],
                            "visibility_scope": None,
                            "status": "active",
                            "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                            "parser_version": "campusrag-import-v1",
                            "embedding_model": "Qwen3-Embedding-4B",
                            "source_channel": "pdf_ocr",
                            "raw_asset": None,
                            "processed_object_keys": [
                                "student_rules/documents/handbook/test-001/tracks/source-faithful/v1/test-001/provider-response.jsonl",
                                "student_rules/documents/handbook/test-001/tracks/source-faithful/v1/test-001/canonical.md",
                                "student_rules/documents/handbook/test-001/tracks/source-faithful/v1/test-001/document-units.jsonl",
                            ],
                            "import_source": "raw_online_ocr",
                        }
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            loaded = InMemoryDocumentRegistry.from_json_file(path).get(
                "handbook:test-001", "source-faithful", "v1:test-001"
            )

            self.assertIsNone(loaded.provider_response_object_key)
            self.assertEqual(loaded.corpus, "regulations")
            self.assertEqual(loaded.collection, "student_rules")
            self.assertEqual(loaded.cleaning_policy_version, "student_rules_cleaning_v1")
            self.assertIsNone(loaded.canonical_markdown_object_key)
            self.assertIsNone(loaded.document_units_object_key)
            self.assertEqual(len(loaded.source_observations), 1)
            self.assertTrue(loaded.source_observations[0].is_primary)
            self.assertEqual(loaded.source_observations[0].source_channel, "pdf_ocr")

    def test_file_document_registry_rejects_unsupported_authz_payload_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            path.write_text(
                json.dumps(
                    {
                        "handbook:test-001::source-faithful::v1:test-001": {
                            "document_id": "handbook:test-001",
                            "revision_track": "source-faithful",
                            "version_id": "v1:test-001",
                            "source_uri": "campus-agent://canonical/regulations/student_rules/docs/test-001.md",
                            "content_hash": "sha256:test-001",
                            "corpus": "regulations",
                            "collection": "student_rules",
                            "cleaning_policy_version": "student_rules_cleaning_v1",
                            "acl_groups": ["students"],
                            "campus_scope": "main",
                            "status": "active",
                            "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                            "parser_version": "campusrag-import-v1",
                            "embedding_model": "Qwen3-Embedding-4B",
                            "source_channel": "pdf_ocr",
                            "raw_asset": None,
                            "processed_object_keys": [
                                "student_rules/documents/handbook/test-001/tracks/source-faithful/v1/test-001/document-units.jsonl"
                            ],
                            "import_source": "raw_online_ocr",
                        }
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "unsupported authorization projection keys"):
                InMemoryDocumentRegistry.from_json_file(path)

    def test_document_registry_payload_prefers_canonical_projection_over_conflicting_legacy_fields(
        self,
    ) -> None:
        record = _document_record_from_dict(
            {
                "document_id": "handbook:test-001",
                "revision_track": "source-faithful",
                "version_id": "v1:test-001",
                "source_uri": "campus-agent://canonical/regulations/student_rules/docs/test-001.md",
                "content_hash": "sha256:test-001",
                "corpus": "regulations",
                "collection": "student_rules",
                "cleaning_policy_version": "student_rules_cleaning_v1",
                "entitlement_groups": ["students"],
                "visibility_scope": "main",
                "visibility_level": "restricted",
                "status": "active",
                "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                "parser_version": "campusrag-import-v1",
                "embedding_model": "Qwen3-Embedding-4B",
                "source_channel": "pdf_ocr",
                "raw_asset": None,
                "processed_object_keys": (),
                "import_source": "raw_online_ocr",
            }
        )

        self.assertEqual(record.entitlement_groups, ("students",))
        self.assertEqual(record.visibility_scope, "main")
        self.assertEqual(record.visibility_level, "restricted")

    def test_document_registry_payload_rejects_unsupported_authz_projection_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported authorization projection keys"):
            _document_record_from_dict(
                {
                    "document_id": "handbook:test-001",
                    "revision_track": "source-faithful",
                    "version_id": "v1:test-001",
                    "source_uri": "campus-agent://canonical/regulations/student_rules/docs/test-001.md",
                    "content_hash": "sha256:test-001",
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "cleaning_policy_version": "student_rules_cleaning_v1",
                    "entitlement_groups": ["students"],
                    "visibility_scope": "main",
                    "visibility_level": "restricted",
                    "acl_groups": ["legacy-staff"],
                    "campus_scope": "south",
                    "status": "active",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "parser_version": "campusrag-import-v1",
                    "embedding_model": "Qwen3-Embedding-4B",
                    "source_channel": "pdf_ocr",
                    "raw_asset": None,
                    "processed_object_keys": (),
                    "import_source": "raw_online_ocr",
                }
            )

    def test_document_registry_payload_requires_explicit_corpus_collection_and_source_channel(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "source_channel"):
            _document_record_from_dict(
                {
                    "document_id": "handbook:test-001",
                    "revision_track": "source-faithful",
                    "version_id": "v1:test-001",
                    "source_uri": "campus-agent://canonical/regulations/student_rules/docs/test-001.md",
                    "content_hash": "sha256:test-001",
                    "corpus": "regulations",
                    "status": "active",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "parser_version": "campusrag-import-v1",
                    "embedding_model": "Qwen3-Embedding-4B",
                    "import_source": "raw_online_ocr",
                }
            )

        with self.assertRaisesRegex(KeyError, "revision_track"):
            _document_record_from_dict(
                {
                    "document_id": "handbook:test-001",
                    "version_id": "v1:test-001",
                    "source_uri": "campus-agent://canonical/regulations/student_rules/docs/test-001.md",
                    "content_hash": "sha256:test-001",
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "status": "active",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "parser_version": "campusrag-import-v1",
                    "embedding_model": "Qwen3-Embedding-4B",
                    "source_channel": "pdf_ocr",
                    "import_source": "raw_online_ocr",
                }
            )

        with self.assertRaisesRegex(ValueError, "collection"):
            _document_record_from_dict(
                {
                    "document_id": "handbook:test-001",
                    "revision_track": "source-faithful",
                    "version_id": "v1:test-001",
                    "source_uri": "campus-agent://canonical/regulations/student_rules/docs/test-001.md",
                    "content_hash": "sha256:test-001",
                    "corpus": "regulations",
                    "status": "active",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "parser_version": "campusrag-import-v1",
                    "embedding_model": "Qwen3-Embedding-4B",
                    "source_channel": "pdf_ocr",
                    "import_source": "raw_online_ocr",
                }
            )

    def test_raw_asset_registry_payload_requires_explicit_corpus_and_collection(self) -> None:
        with self.assertRaisesRegex(ValueError, "collection"):
            _raw_asset_record_from_dict(
                {
                    "raw_asset_id": "asset:synthetic-student-handbook",
                    "raw_version_id": "sha256:raw-001",
                    "corpus": "regulations",
                    "raw_source_uri": "campus-agent://raw/regulations/student_rules/student-handbook.pdf",
                    "content_hash": "raw-001",
                    "source_filename": "student-handbook.pdf",
                    "object_key": "official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf",
                    "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                    "import_source": "raw_online_ocr",
                }
            )

    def test_raw_asset_registry_payload_backfills_missing_typed_metadata_fields(self) -> None:
        record = _raw_asset_record_from_dict(
            {
                "raw_asset_id": "asset:synthetic-student-handbook",
                "raw_version_id": "sha256:raw-001",
                "corpus": "regulations",
                "collection": "student_rules",
                "raw_source_uri": "campus-agent://raw/regulations/student_rules/student-handbook.pdf",
                "content_hash": "raw-001",
                "source_filename": "student-handbook.pdf",
                "object_key": "official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf",
                "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                "import_source": "raw_online_ocr",
            }
        )

        self.assertIsNone(record.content_type)
        self.assertEqual(record.file_extension, "")
        self.assertIsNone(record.byte_size)
        self.assertIsNone(record.page_count)
        self.assertIsNone(record.image_width)
        self.assertIsNone(record.image_height)
        self.assertEqual(record.asset_kind, "")
        self.assertEqual(record.asset_subkind, "")
        self.assertIsNone(record.classification_confidence)

    def test_file_raw_asset_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = InMemoryRawAssetRegistry(backing_path=Path(temp_dir) / "raw-assets.json")
            record = _handbook_raw_asset_record()

            registry.upsert(record)

            self.assertEqual(
                registry.get("asset:synthetic-student-handbook", "sha256:raw-001"),
                record,
            )

    def test_file_raw_asset_registry_delete_by_corpus_removes_only_matching_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "raw-assets.json"
            registry = InMemoryRawAssetRegistry(backing_path=path)
            handbook_record = _handbook_raw_asset_record()
            curriculum_record = _curriculum_raw_asset_record()
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.delete_by_scope("regulations", "student_rules")

            self.assertIsNone(registry.get("asset:synthetic-student-handbook", "sha256:raw-001"))
            self.assertEqual(
                registry.get("asset:curriculum-plan-master-pdf", "sha256:raw-002"),
                curriculum_record,
            )

    def test_file_raw_asset_registry_replace_scope_replaces_only_target_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "raw-assets.json"
            registry = InMemoryRawAssetRegistry(backing_path=path)
            handbook_record = _handbook_raw_asset_record()
            curriculum_record = _curriculum_raw_asset_record()
            handbook_replacement = RawAssetRecord(
                raw_asset_id="asset:synthetic-student-handbook-v2",
                raw_version_id="sha256:raw-003",
                corpus="regulations",
                collection="student_rules",
                raw_source_uri="campus-agent://raw/regulations/student_rules/student-handbook-v2.pdf",
                content_hash="raw-003",
                source_filename="student-handbook-v2.pdf",
                object_key="official_pdf/student-handbook/undated/sha256/raw-003/capture/student-handbook-v2.pdf",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
                import_source="raw_online_ocr",
            )
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.replace_scope("regulations", "student_rules", (handbook_replacement,))

            self.assertEqual(
                registry.list_by_scope("regulations", "student_rules"),
                (handbook_replacement,),
            )
            self.assertEqual(
                registry.list_by_scope("curriculum", "curriculum_plan"),
                (curriculum_record,),
            )

    def test_curriculum_plan_records_are_supported(self) -> None:
        document_record = _curriculum_document_record()
        raw_asset_record = _curriculum_raw_asset_record()

        self.assertEqual(document_record.corpus, "curriculum")
        self.assertEqual(document_record.collection, "curriculum_plan")
        self.assertEqual(raw_asset_record.corpus, "curriculum")
        self.assertEqual(raw_asset_record.collection, "curriculum_plan")
