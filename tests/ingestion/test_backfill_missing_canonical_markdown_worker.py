from __future__ import annotations

import importlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.document_canonical_markdown_backfill import (
    DocumentCanonicalMarkdownBackfillReport,
)
from campus_ingestion_core.models import DocumentRegistryRecord

_MODULE_NAME = "campus_ingestion_worker.backfill_missing_canonical_markdown_from_document_units"


class BackfillMissingCanonicalMarkdownWorkerTest(unittest.TestCase):
    def test_main_selects_releasable_records_and_prints_report(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        record = _make_record()

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(f"{_MODULE_NAME}.ObjectStoreSettings.from_env") as from_env,
            patch(f"{_MODULE_NAME}.S3ObjectStoreAdmin") as object_store_admin,
            patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
            patch(f"{_MODULE_NAME}.load_runtime_profile") as load_profile,
            patch(f"{_MODULE_NAME}.select_releasable_registry_records") as select_records,
            patch(
                f"{_MODULE_NAME}.backfill_missing_canonical_markdown_from_document_units"
            ) as backfill,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            settings = SimpleNamespace(bucket_derived="campus-rag-derived")
            object_store = object()
            registry = SimpleNamespace(list_by_scope=lambda _corpus, _collection: (record,))
            runtime_profile = load_runtime_profile("regulations", "institutional_rules")
            report = DocumentCanonicalMarkdownBackfillReport(
                selected_record_count=1,
                backfilled_count=1,
                skipped_existing_count=0,
                backfilled_documents=(),
                skipped_existing_documents=(),
            )
            from_env.return_value = settings
            object_store_admin.return_value = object_store
            build_registry.return_value = registry
            load_profile.return_value = runtime_profile
            select_records.return_value = (record,)
            backfill.return_value = report

            worker.main(["--scope", "regulations/institutional_rules"])

        select_records.assert_called_once_with(records=(record,), runtime_profile=runtime_profile)
        backfill.assert_called_once_with(
            bucket="campus-rag-derived",
            object_store=object_store,
            records=(record,),
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["selected_record_count"], 1)
        self.assertEqual(payload["backfilled_count"], 1)


def _make_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="institutional_regulation:muc:中央民族大学丰台校区就医管理办法-暂行:ff711d1185f9",
        revision_track="current-effective",
        version_id="sha256:ff711d1185f9:effective-undated:revision-none",
        source_uri="campus-agent://regulations/institutional_rules/test",
        content_hash="sha256:ff711d1185f9",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        visibility_level="public",
        status="active",
        ingestion_timestamp="2026-05-18T00:00:00+00:00",
        parser_version="collected_notice_regulation_canonical_cleaning_v9",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=(
            "regulations/documents/institutional_rules/"
            "中央民族大学丰台校区就医管理办法-暂行--ff711d11/"
            "current-effective/undated/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            "regulations/documents/institutional_rules/"
            "中央民族大学丰台校区就医管理办法-暂行--ff711d11/"
            "current-effective/undated/canonical.md"
        ),
        import_source="index_release_registry_restore",
    )


if __name__ == "__main__":
    unittest.main()
