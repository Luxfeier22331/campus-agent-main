from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import VersionQuery
from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry


def _record(
    *,
    version_id: str,
    ingestion_timestamp: str,
    is_current: bool = False,
    effective_date: str | None = None,
    published_date: str | None = None,
    supersedes_version_id: str | None = None,
    revision_track: str = "source-faithful",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-001",
        revision_track=revision_track,
        version_id=version_id,
        source_uri="campusrag://canonical/regulations/student_rules/docs/test-001.md",
        content_hash=f"sha256:{version_id}",
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope=None,
        status="active",
        ingestion_timestamp=ingestion_timestamp,
        parser_version="campusrag-import-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        is_current=is_current,
        effective_date=effective_date,
        published_date=published_date,
        supersedes_version_id=supersedes_version_id,
        import_source="raw_online_ocr",
    )


class VersionResolutionTest(unittest.TestCase):
    def test_resolve_current_version_prefers_current_record(self) -> None:
        from campus_ingestion_core.version_resolution import resolve_version_query

        registry = InMemoryDocumentRegistry(
            (
                _record(
                    version_id="v1:test-001",
                    ingestion_timestamp="2026-01-01T00:00:00+00:00",
                    effective_date="2026-01-01",
                ),
                _record(
                    version_id="v2:test-001",
                    ingestion_timestamp="2026-02-01T00:00:00+00:00",
                    effective_date="2026-02-01",
                    is_current=True,
                    supersedes_version_id="v1:test-001",
                ),
            )
        )

        resolution = resolve_version_query(
            registry,
            document_id="handbook:test-001",
            version_query=VersionQuery(mode="current"),
        )

        self.assertEqual(resolution.status, "resolved")
        self.assertEqual(resolution.primary_selection.version_id, "v2:test-001")
        self.assertEqual(resolution.primary_selection.anchor, "current")

    def test_resolve_historical_version_defaults_to_previous_version(self) -> None:
        from campus_ingestion_core.version_resolution import resolve_version_query

        registry = InMemoryDocumentRegistry(
            (
                _record(
                    version_id="v1:test-001",
                    ingestion_timestamp="2026-01-01T00:00:00+00:00",
                    effective_date="2026-01-01",
                ),
                _record(
                    version_id="v2:test-001",
                    ingestion_timestamp="2026-02-01T00:00:00+00:00",
                    effective_date="2026-02-01",
                ),
                _record(
                    version_id="v3:test-001",
                    ingestion_timestamp="2026-03-01T00:00:00+00:00",
                    effective_date="2026-03-01",
                    is_current=True,
                    supersedes_version_id="v2:test-001",
                ),
            )
        )

        resolution = resolve_version_query(
            registry,
            document_id="handbook:test-001",
            version_query=VersionQuery(mode="historical"),
        )

        self.assertEqual(resolution.status, "resolved")
        self.assertEqual(resolution.primary_selection.version_id, "v2:test-001")
        self.assertEqual(resolution.primary_selection.anchor, "previous")

    def test_resolve_historical_version_accepts_exact_version_anchor(self) -> None:
        from campus_ingestion_core.version_resolution import resolve_version_query

        registry = InMemoryDocumentRegistry(
            (
                _record(
                    version_id="v1:test-001",
                    ingestion_timestamp="2026-01-01T00:00:00+00:00",
                    effective_date="2026-01-01",
                ),
                _record(
                    version_id="v2:test-001",
                    ingestion_timestamp="2026-02-01T00:00:00+00:00",
                    effective_date="2026-02-01",
                    is_current=True,
                    supersedes_version_id="v1:test-001",
                ),
            )
        )

        resolution = resolve_version_query(
            registry,
            document_id="handbook:test-001",
            version_query=VersionQuery(mode="historical", version_id="v1:test-001"),
        )

        self.assertEqual(resolution.status, "resolved")
        self.assertEqual(resolution.primary_selection.version_id, "v1:test-001")
        self.assertEqual(resolution.primary_selection.anchor, "exact")

    def test_resolve_as_of_version_uses_effective_date_when_available(self) -> None:
        from campus_ingestion_core.version_resolution import resolve_version_query

        registry = InMemoryDocumentRegistry(
            (
                _record(
                    version_id="v1:test-001",
                    ingestion_timestamp="2026-01-05T00:00:00+00:00",
                    effective_date="2026-01-10",
                ),
                _record(
                    version_id="v2:test-001",
                    ingestion_timestamp="2026-02-05T00:00:00+00:00",
                    effective_date="2026-02-10",
                    is_current=True,
                    supersedes_version_id="v1:test-001",
                ),
            )
        )

        resolution = resolve_version_query(
            registry,
            document_id="handbook:test-001",
            version_query=VersionQuery(mode="as_of", as_of="2026-01-15"),
        )

        self.assertEqual(resolution.status, "resolved")
        self.assertEqual(resolution.primary_selection.version_id, "v1:test-001")
        self.assertEqual(resolution.primary_selection.anchor, "as_of")

    def test_resolve_compare_defaults_to_previous_versus_current(self) -> None:
        from campus_ingestion_core.version_resolution import resolve_version_query

        registry = InMemoryDocumentRegistry(
            (
                _record(
                    version_id="v1:test-001",
                    ingestion_timestamp="2026-01-01T00:00:00+00:00",
                    effective_date="2026-01-01",
                ),
                _record(
                    version_id="v2:test-001",
                    ingestion_timestamp="2026-02-01T00:00:00+00:00",
                    effective_date="2026-02-01",
                ),
                _record(
                    version_id="v3:test-001",
                    ingestion_timestamp="2026-03-01T00:00:00+00:00",
                    effective_date="2026-03-01",
                    is_current=True,
                    supersedes_version_id="v2:test-001",
                ),
            )
        )

        resolution = resolve_version_query(
            registry,
            document_id="handbook:test-001",
            version_query=VersionQuery(mode="compare"),
        )

        self.assertEqual(resolution.status, "resolved")
        self.assertEqual(resolution.primary_selection.version_id, "v2:test-001")
        self.assertEqual(resolution.primary_selection.anchor, "previous")
        self.assertEqual(resolution.comparison_selection.version_id, "v3:test-001")
        self.assertEqual(resolution.comparison_selection.anchor, "current")

    def test_resolve_compare_accepts_exact_compare_pair(self) -> None:
        from campus_ingestion_core.version_resolution import resolve_version_query

        registry = InMemoryDocumentRegistry(
            (
                _record(
                    version_id="v1:test-001",
                    ingestion_timestamp="2026-01-01T00:00:00+00:00",
                    effective_date="2026-01-01",
                ),
                _record(
                    version_id="v2:test-001",
                    ingestion_timestamp="2026-02-01T00:00:00+00:00",
                    effective_date="2026-02-01",
                ),
                _record(
                    version_id="v3:test-001",
                    ingestion_timestamp="2026-03-01T00:00:00+00:00",
                    effective_date="2026-03-01",
                    is_current=True,
                    supersedes_version_id="v2:test-001",
                ),
            )
        )

        resolution = resolve_version_query(
            registry,
            document_id="handbook:test-001",
            version_query=VersionQuery(
                mode="compare",
                version_id="v1:test-001",
                compare_to_version_id="v2:test-001",
            ),
        )

        self.assertEqual(resolution.status, "resolved")
        self.assertEqual(resolution.primary_selection.version_id, "v1:test-001")
        self.assertEqual(resolution.primary_selection.anchor, "exact")
        self.assertEqual(resolution.comparison_selection.version_id, "v2:test-001")
        self.assertEqual(resolution.comparison_selection.anchor, "exact")

    def test_resolve_compare_without_previous_version_fails_closed(self) -> None:
        from campus_ingestion_core.version_resolution import resolve_version_query

        registry = InMemoryDocumentRegistry(
            (
                _record(
                    version_id="v1:test-001",
                    ingestion_timestamp="2026-03-01T00:00:00+00:00",
                    effective_date="2026-03-01",
                    is_current=True,
                ),
            )
        )

        resolution = resolve_version_query(
            registry,
            document_id="handbook:test-001",
            version_query=VersionQuery(mode="compare"),
        )

        self.assertEqual(resolution.status, "unresolved")
        self.assertEqual(resolution.unresolved_reason, "compare_pair_unresolved")

    def test_resolve_version_query_prefers_requested_revision_track(self) -> None:
        from campus_ingestion_core.version_resolution import resolve_version_query

        source_faithful_current = _record(
            version_id="v2:source",
            ingestion_timestamp="2026-02-01T00:00:00+00:00",
            effective_date="2026-02-01",
            is_current=True,
            supersedes_version_id="v1:source",
        )
        source_faithful_previous = replace(
            source_faithful_current,
            version_id="v1:source",
            ingestion_timestamp="2026-01-01T00:00:00+00:00",
            is_current=False,
            supersedes_version_id=None,
        )
        editorial_current = _record(
            version_id="v2:editorial",
            ingestion_timestamp="2026-02-02T00:00:00+00:00",
            effective_date="2026-02-02",
            is_current=True,
            supersedes_version_id="v1:editorial",
            revision_track="editorial",
        )
        editorial_previous = replace(
            editorial_current,
            version_id="v1:editorial",
            ingestion_timestamp="2026-01-02T00:00:00+00:00",
            is_current=False,
            supersedes_version_id=None,
        )
        registry = InMemoryDocumentRegistry(
            (
                source_faithful_previous,
                source_faithful_current,
                editorial_previous,
                editorial_current,
            )
        )

        resolution = resolve_version_query(
            registry,
            document_id="handbook:test-001",
            version_query=VersionQuery(mode="historical"),
            preferred_revision_tracks=("editorial", "source-faithful"),
        )

        self.assertEqual(resolution.status, "resolved")
        self.assertEqual(resolution.primary_selection.revision_track, "editorial")
        self.assertEqual(resolution.primary_selection.version_id, "v1:editorial")
