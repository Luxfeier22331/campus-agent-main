from __future__ import annotations

from tests.ingestion.registry_models_test_support import *


class RegistryModelsEnvAndPostgresSuite(unittest.TestCase):
    def test_build_document_registry_from_env_uses_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresDocumentRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_document_registry_from_env(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://registry.example/postgres")

    def test_build_document_registry_from_env_falls_back_to_shared_postgres_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresDocumentRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_document_registry_from_env(
                {"CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://shared.example/postgres")

    def test_build_document_registry_from_env_prefers_operator_database_url_when_requested(
        self,
    ) -> None:
        with patch("campus_ingestion_core.registry.PostgresDocumentRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_document_registry_from_env(
                {
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL": "postgresql://operator.example/postgres",
                },
                prefer_operator=True,
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with(
                "postgresql://operator.example/postgres?__campus_connection_mode=operator_session"
            )

    def test_build_document_registry_from_env_requires_operator_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_OPERATOR_URL.*prefer_operator=True",
        ):
            build_document_registry_from_env(
                {
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_operator=True,
            )

    def test_build_document_registry_from_env_rejects_supabase_direct_connection(self) -> None:
        with (
            patch.object(
                PostgresDocumentRegistry,
                "_ensure_schema",
                return_value=None,
            ),
            self.assertRaisesRegex(ValueError, "session pooler"),
        ):
            build_document_registry_from_env(
                {
                    "DOCUMENT_REGISTRY_DATABASE_URL": (
                        "postgresql://postgres:secret@"
                        "db.project-ref.supabase.co:5432/postgres?sslmode=require"
                    )
                }
            )

    def test_build_raw_asset_registry_from_env_uses_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://registry.example/postgres")

    def test_build_raw_asset_registry_from_env_prefers_dedicated_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://document-registry.example/postgres",
                }
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://raw-registry.example/postgres")

    def test_build_raw_asset_registry_from_env_falls_back_to_shared_postgres_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {"CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://shared.example/postgres")

    def test_build_raw_asset_registry_from_env_prefers_operator_database_url_when_requested(
        self,
    ) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL": "postgresql://operator.example/postgres",
                },
                prefer_operator=True,
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with(
                "postgresql://operator.example/postgres?__campus_connection_mode=operator_session"
            )

    def test_build_raw_asset_registry_from_env_requires_operator_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_OPERATOR_URL.*prefer_operator=True",
        ):
            build_raw_asset_registry_from_env(
                {
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_operator=True,
            )

    def test_build_raw_asset_registry_from_env_rejects_supabase_transaction_pooler(self) -> None:
        with (
            patch.object(
                PostgresRawAssetRegistry,
                "_ensure_schema",
                return_value=None,
            ),
            self.assertRaisesRegex(ValueError, "session pooler"),
        ):
            build_raw_asset_registry_from_env(
                {
                    "RAW_ASSET_REGISTRY_DATABASE_URL": (
                        "postgresql://postgres:secret@"
                        "db.project-ref.supabase.co:6543/postgres?sslmode=require"
                    )
                }
            )

    def test_build_raw_asset_registry_from_env_accepts_dedicated_database_url_without_document_registry(
        self,
    ) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {"RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://raw-registry.example/postgres")

    def test_build_closeout_store_from_env_rejects_supabase_direct_connection(self) -> None:
        with (
            patch.object(
                PostgresAuthenticatedNoticeCloseoutStore,
                "_ensure_schema",
                return_value=None,
            ),
            self.assertRaisesRegex(ValueError, "session pooler"),
        ):
            build_authenticated_notice_closeout_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL": (
                        "postgresql://postgres:secret@"
                        "db.project-ref.supabase.co:5432/postgres?sslmode=require"
                    )
                }
            )

    def test_build_closeout_store_from_env_prefers_operator_database_url_when_requested(
        self,
    ) -> None:
        with patch(
            "campus_ingestion_core.authenticated_notice_closeout_store.PostgresAuthenticatedNoticeCloseoutStore"
        ) as store_cls:
            instance = store_cls.return_value

            store = build_authenticated_notice_closeout_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "AUTHENTICATED_NOTICE_CLOSEOUT_OPERATOR_DATABASE_URL": "postgresql://operator.example/postgres",
                },
                prefer_operator=True,
            )

            self.assertIs(store, instance)
            store_cls.assert_called_once_with(
                "postgresql://operator.example/postgres?__campus_connection_mode=operator_session"
            )

    def test_build_closeout_store_from_env_requires_operator_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_OPERATOR_URL.*prefer_operator=True",
        ):
            build_authenticated_notice_closeout_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_operator=True,
            )

    def test_build_source_truth_inventory_store_from_env_prefers_operator_database_url_when_requested(
        self,
    ) -> None:
        with patch(
            "campus_ingestion_core.authenticated_notice_source_truth_inventory.PostgresAuthenticatedNoticeSourceTruthInventoryStore"
        ) as store_cls:
            instance = store_cls.return_value

            store = build_authenticated_notice_source_truth_inventory_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_OPERATOR_DATABASE_URL": "postgresql://operator.example/postgres",
                },
                prefer_operator=True,
            )

            self.assertIs(store, instance)
            store_cls.assert_called_once_with(
                database_url=(
                    "postgresql://operator.example/postgres"
                    "?__campus_connection_mode=operator_session"
                )
            )

    def test_build_source_truth_inventory_store_from_env_requires_operator_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_OPERATOR_URL.*prefer_operator=True",
        ):
            build_authenticated_notice_source_truth_inventory_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_operator=True,
            )

    def test_build_file_release_inventory_store_from_env_prefers_operator_database_url_when_requested(
        self,
    ) -> None:
        with patch(
            "campus_ingestion_core.authenticated_notice_file_release_inventory.PostgresAuthenticatedNoticeFileReleaseInventoryStore"
        ) as store_cls:
            instance = store_cls.return_value

            store = build_authenticated_notice_file_release_inventory_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_FILE_RELEASE_INVENTORY_DATABASE_URL": "postgresql://runtime.example/postgres",
                    "AUTHENTICATED_NOTICE_FILE_RELEASE_INVENTORY_OPERATOR_DATABASE_URL": "postgresql://operator.example/postgres",
                },
                prefer_operator=True,
            )

            self.assertIs(store, instance)
            store_cls.assert_called_once_with(
                database_url=(
                    "postgresql://operator.example/postgres"
                    "?__campus_connection_mode=operator_session"
                )
            )

    def test_build_file_release_inventory_store_from_env_requires_operator_database_url_when_requested(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "CAMPUS_SHARED_POSTGRES_OPERATOR_URL.*prefer_operator=True",
        ):
            build_authenticated_notice_file_release_inventory_store_from_env(
                {
                    "AUTHENTICATED_NOTICE_FILE_RELEASE_INVENTORY_DATABASE_URL": "postgresql://runtime.example/postgres",
                },
                prefer_operator=True,
            )

    def test_postgres_document_registry_delete_document_targets_document_id(self) -> None:
        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")
        with patch.object(registry, "_execute") as execute:
            registry.delete_document("handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675")

        execute.assert_called_once_with(
            "delete from ingestion_registry.document_registry_records where document_id = %s",
            ("handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",),
        )

    def test_postgres_document_registry_current_version_does_not_fallback_to_latest(self) -> None:
        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with (
            patch.object(registry, "_fetchone", return_value=None),
            patch.object(
                registry,
                "latest_versions",
                return_value=(
                    replace(
                        _handbook_document_record(
                            version_id="v2:test-001",
                            content_hash="sha256:test-002",
                            ingestion_timestamp="2026-03-23T10:00:00+00:00",
                        ),
                        is_current=False,
                    ),
                ),
            ) as latest_versions,
        ):
            self.assertIsNone(registry.current_version("handbook:test-001"))
            latest_versions.assert_not_called()

    def test_postgres_document_registry_list_by_scope_canonicalizes_legacy_authz_projection_keys(
        self,
    ) -> None:
        legacy_payload = {
            "document_id": "official_web:test-001",
            "revision_track": "source-faithful",
            "version_id": "owdocver:test-001",
            "source_uri": "https://www.example.edu/test-001.htm",
            "content_hash": "sha256:test-001",
            "corpus": "official_web",
            "collection": "muc_public_pages",
            "cleaning_policy_version": "official_web_cleaning_v2",
            "acl_level": "restricted",
            "acl_groups": ["legacy-staff"],
            "campus_scope": "south",
            "status": "active",
            "ingestion_timestamp": "2026-04-04T10:00:00+00:00",
            "parser_version": "official_web_projection_replay.v1",
            "embedding_model": "",
            "source_channel": "official_web",
            "import_source": "official_web_source_truth_replay",
        }

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with patch.object(registry, "_fetchall", return_value=((json.dumps(legacy_payload),),)):
            records = registry.list_by_scope("official_web", "muc_public_pages")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].entitlement_groups, ("legacy-staff",))
        self.assertEqual(records[0].visibility_scope, "south")
        self.assertEqual(records[0].visibility_level, "restricted")
        self.assertEqual(records[0].policy_projection_version, DEFAULT_POLICY_PROJECTION_VERSION)

    def test_postgres_document_registry_list_by_scope_paginates_large_scope_reads(self) -> None:
        first = _handbook_document_record(
            version_id="v1:test-001",
            content_hash="sha256:test-001",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
        )
        second = replace(
            _handbook_document_record(
                version_id="v1:test-002",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            ),
            document_id="handbook:test-002",
            version_id="v1:test-002",
            source_uri="campusrag://canonical/regulations/student_rules/docs/test-002.md",
            content_hash="sha256:test-002",
            document_units_object_key=HANDBOOK_DOC_UNITS_KEY.replace("test-001", "test-002"),
            provider_response_object_key=HANDBOOK_PROVIDER_KEY.replace("raw-001", "raw-002"),
            canonical_markdown_object_key=HANDBOOK_CANONICAL_KEY.replace("test-001", "test-002"),
            processed_object_keys=(
                HANDBOOK_PROVIDER_KEY.replace("raw-001", "raw-002"),
                HANDBOOK_CANONICAL_KEY.replace("test-001", "test-002"),
                HANDBOOK_DOC_UNITS_KEY.replace("test-001", "test-002"),
            ),
        )
        page_rows = (
            ((json.dumps(asdict(first), ensure_ascii=False),),),
            ((json.dumps(asdict(second), ensure_ascii=False),),),
            (),
        )
        fetchall_calls: list[tuple[str, tuple[object, ...]]] = []

        def _fetchall(query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
            fetchall_calls.append((query, params))
            return page_rows[len(fetchall_calls) - 1]

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with (
            patch("campus_ingestion_core.registry.DEFAULT_DOCUMENT_REGISTRY_SCAN_PAGE_SIZE", 1),
            patch.object(registry, "_fetchall", side_effect=_fetchall),
        ):
            records = registry.list_by_scope("regulations", "student_rules")

        self.assertEqual(records, (first, second))
        self.assertEqual(len(fetchall_calls), 3)
        self.assertIn("limit %s", fetchall_calls[0][0].lower())
        self.assertEqual(fetchall_calls[0][1], ("regulations", "student_rules", 1))
        self.assertIn(
            "(document_id, revision_track, version_id) > (%s, %s, %s)",
            fetchall_calls[1][0],
        )
        self.assertEqual(
            fetchall_calls[1][1],
            (
                "regulations",
                "student_rules",
                first.document_id,
                first.revision_track,
                first.version_id,
                1,
            ),
        )

    def test_postgres_document_registry_get_canonicalizes_legacy_authz_projection_keys(
        self,
    ) -> None:
        legacy_payload = {
            "document_id": "official_web:test-001",
            "revision_track": "source-faithful",
            "version_id": "owdocver:test-001",
            "source_uri": "https://www.example.edu/test-001.htm",
            "content_hash": "sha256:test-001",
            "corpus": "official_web",
            "collection": "muc_public_pages",
            "cleaning_policy_version": "official_web_cleaning_v2",
            "acl_level": "restricted",
            "acl_groups": ["legacy-staff"],
            "campus_scope": "south",
            "status": "active",
            "ingestion_timestamp": "2026-04-04T10:00:00+00:00",
            "parser_version": "official_web_projection_replay.v1",
            "embedding_model": "",
            "source_channel": "official_web",
            "import_source": "official_web_source_truth_replay",
        }

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with patch.object(registry, "_fetchone", return_value=(json.dumps(legacy_payload),)):
            record = registry.get("official_web:test-001", "source-faithful", "owdocver:test-001")

        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.entitlement_groups, ("legacy-staff",))
        self.assertEqual(record.visibility_scope, "south")
        self.assertEqual(record.visibility_level, "restricted")
        self.assertEqual(record.policy_projection_version, DEFAULT_POLICY_PROJECTION_VERSION)

    def test_postgres_document_registry_latest_versions_canonicalizes_legacy_authz_projection_keys(
        self,
    ) -> None:
        legacy_payload = {
            "document_id": "official_web:test-003",
            "revision_track": "source-faithful",
            "version_id": "owdocver:test-003",
            "source_uri": "https://www.example.edu/test-003.htm",
            "content_hash": "sha256:test-003",
            "corpus": "official_web",
            "collection": "muc_public_pages",
            "cleaning_policy_version": "official_web_cleaning_v2",
            "acl_level": "restricted",
            "acl_groups": ["legacy-editors"],
            "campus_scope": "north",
            "status": "active",
            "ingestion_timestamp": "2026-04-04T10:00:00+00:00",
            "parser_version": "official_web_projection_replay.v1",
            "embedding_model": "",
            "source_channel": "official_web",
            "import_source": "official_web_source_truth_replay",
        }

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with patch.object(registry, "_fetchone", return_value=(json.dumps(legacy_payload),)):
            records = registry.latest_versions("official_web:test-003", "source-faithful")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].entitlement_groups, ("legacy-editors",))
        self.assertEqual(records[0].visibility_scope, "north")
        self.assertEqual(records[0].visibility_level, "restricted")
        self.assertEqual(records[0].policy_projection_version, DEFAULT_POLICY_PROJECTION_VERSION)

    def test_postgres_document_registry_current_version_canonicalizes_legacy_authz_projection_keys(
        self,
    ) -> None:
        legacy_payload = {
            "document_id": "official_web:test-002",
            "revision_track": "source-faithful",
            "version_id": "owdocver:test-002",
            "source_uri": "https://www.example.edu/test-002.htm",
            "content_hash": "sha256:test-002",
            "corpus": "official_web",
            "collection": "muc_public_pages",
            "cleaning_policy_version": "official_web_cleaning_v2",
            "acl_level": "restricted",
            "acl_groups": ["legacy-operators"],
            "campus_scope": "main",
            "status": "active",
            "ingestion_timestamp": "2026-04-04T10:00:00+00:00",
            "parser_version": "official_web_projection_replay.v1",
            "embedding_model": "",
            "source_channel": "official_web",
            "is_current": True,
            "import_source": "official_web_source_truth_replay",
        }

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")

        with patch.object(registry, "_fetchone", return_value=(json.dumps(legacy_payload),)):
            record = registry.current_version("official_web:test-002")

        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.entitlement_groups, ("legacy-operators",))
        self.assertEqual(record.visibility_scope, "main")
        self.assertEqual(record.visibility_level, "restricted")
        self.assertEqual(record.policy_projection_version, DEFAULT_POLICY_PROJECTION_VERSION)

    def test_postgres_raw_asset_registry_list_by_scope_paginates_large_scope_reads(self) -> None:
        first = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:001",
            raw_version_id="sha256:001",
        )
        second = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:002",
            raw_version_id="sha256:002",
            content_hash="raw-002",
            object_key="official_pdf/student-handbook/undated/sha256/raw-002/capture/student-handbook.pdf",
        )
        page_rows = (
            ((json.dumps(asdict(first), ensure_ascii=False),),),
            ((json.dumps(asdict(second), ensure_ascii=False),),),
            (),
        )
        fetchall_calls: list[tuple[str, tuple[object, ...]]] = []

        def _fetchall(query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
            fetchall_calls.append((query, params))
            return page_rows[len(fetchall_calls) - 1]

        with patch.object(PostgresRawAssetRegistry, "_ensure_schema", return_value=None):
            registry = PostgresRawAssetRegistry("postgresql://registry.example/postgres")

        with (
            patch("campus_ingestion_core.registry.DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE", 1),
            patch.object(registry, "_fetchall", side_effect=_fetchall),
        ):
            records = registry.list_by_scope("regulations", "student_rules")

        self.assertEqual(records, (first, second))
        self.assertEqual(len(fetchall_calls), 3)
        self.assertIn("limit %s", fetchall_calls[0][0].lower())
        self.assertEqual(fetchall_calls[0][1], ("regulations", "student_rules", 1))
        self.assertIn("(raw_asset_id, raw_version_id) > (%s, %s)", fetchall_calls[1][0])
        self.assertEqual(
            fetchall_calls[1][1],
            (
                "regulations",
                "student_rules",
                first.raw_asset_id,
                first.raw_version_id,
                1,
            ),
        )

    def test_postgres_document_registry_replace_scope_uses_bulk_recordset_insert(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.execute_calls: list[tuple[str, tuple[object, ...] | None]] = []
                self.executemany_calls: list[tuple[str, tuple[tuple[object, ...], ...]]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.execute_calls.append((sql, params))

            def executemany(self, sql: str, params_seq) -> None:
                self.executemany_calls.append((sql, tuple(params_seq)))

        class _CursorContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self.cursor = cursor

            def __enter__(self) -> _RecordingCursor:
                return self.cursor

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _ConnectionContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self._cursor = cursor

            def __enter__(self) -> _ConnectionContext:
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def cursor(self) -> _CursorContext:
                return _CursorContext(self._cursor)

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")
        cursor = _RecordingCursor()
        handbook_record = _handbook_document_record(
            version_id="v2:test-001",
            content_hash="sha256:test-002",
            ingestion_timestamp="2026-03-23T10:00:00+00:00",
        )
        curriculum_record = _curriculum_document_record()

        with patch(
            "campus_ingestion_core.registry._postgres_connection",
            return_value=_ConnectionContext(cursor),
        ):
            registry.replace_scope(
                "regulations",
                "student_rules",
                (handbook_record, curriculum_record),
            )

        self.assertEqual(cursor.executemany_calls, [])
        self.assertTrue(any("jsonb_to_recordset" in sql for sql, _params in cursor.execute_calls))

    def test_postgres_raw_asset_registry_upsert_many_uses_bulk_recordset_insert(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.execute_calls: list[tuple[str, tuple[object, ...] | None]] = []
                self.executemany_calls: list[tuple[str, tuple[tuple[object, ...], ...]]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.execute_calls.append((sql, params))

            def executemany(self, sql: str, params_seq) -> None:
                self.executemany_calls.append((sql, tuple(params_seq)))

        class _CursorContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self.cursor = cursor

            def __enter__(self) -> _RecordingCursor:
                return self.cursor

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _ConnectionContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self._cursor = cursor

            def __enter__(self) -> _ConnectionContext:
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def cursor(self) -> _CursorContext:
                return _CursorContext(self._cursor)

        with patch.object(PostgresRawAssetRegistry, "_ensure_schema", return_value=None):
            registry = PostgresRawAssetRegistry("postgresql://registry.example/postgres")
        cursor = _RecordingCursor()
        first = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:001",
            raw_version_id="sha256:001",
        )
        second = replace(
            _curriculum_raw_asset_record(),
            raw_asset_id="asset:002",
            raw_version_id="sha256:002",
        )

        with patch(
            "campus_ingestion_core.registry._postgres_connection",
            return_value=_ConnectionContext(cursor),
        ):
            registry.upsert_many((first, second))

        self.assertEqual(cursor.executemany_calls, [])
        self.assertTrue(any("jsonb_to_recordset" in sql for sql, _params in cursor.execute_calls))

    def test_attachment_fetch_status_store_repairs_legacy_fetch_status_check(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.execute_calls: list[tuple[str, tuple[object, ...] | None]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.execute_calls.append((sql, params))

            def fetchall(self) -> list[tuple[str]]:
                return [("authenticated_notice_attachment_fetch_status_fetch_status_check",)]

        class _CursorContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self.cursor = cursor

            def __enter__(self) -> _RecordingCursor:
                return self.cursor

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _ConnectionContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self._cursor = cursor

            def __enter__(self) -> _ConnectionContext:
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def cursor(self) -> _CursorContext:
                return _CursorContext(self._cursor)

        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.authenticated_notice_attachment_fetch_status_store._patched_postgres_connection",
            return_value=_ConnectionContext(cursor),
        ):
            PostgresAuthenticatedNoticeAttachmentFetchStatusStore(
                "postgresql://registry.example/postgres"
            )

        statements = [sql for sql, _params in cursor.execute_calls]
        self.assertTrue(
            any(
                'drop constraint if exists "authenticated_notice_attachment_fetch_status_fetch_status_check"'
                in sql
                for sql in statements
            )
        )
        self.assertTrue(any("'reference_only'" in sql for sql in statements))
