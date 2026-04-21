from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .official_web_projection_import_worker_test_support import (
    _bundle_payload,
    _document_units_row,
    _FakeObjectStore,
    _object_store_settings,
    _projection_report,
    _write_json,
    _write_jsonl,
    worker,
)


class OfficialWebProjectionImportCoreTest(unittest.TestCase):
    def test_import_projection_output_prefers_local_provider_artifact_when_present(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            projection_report = _projection_report()
            canonical_path = projection_dir / "canonical.md"
            document_units_path = projection_dir / "document-units.jsonl"
            projection_report["documents"][0]["canonical_markdown_path"] = str(canonical_path)
            projection_report["documents"][0]["document_units_path"] = str(document_units_path)
            _write_json(projection_dir / "projection-report.json", projection_report)
            canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            _write_jsonl(document_units_path, [_document_units_row()])
            _write_json(replay_input_dir / "source-truth-bundle.json", _bundle_payload())
            provider_path = (
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json"
            )
            _write_json(provider_path, {"title": "学校简介", "source": "local"})
            object_store = _FakeObjectStore()

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=InMemoryDocumentRegistry(),
                raw_asset_registry=InMemoryRawAssetRegistry(),
                object_store_settings=_object_store_settings(),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)

    def test_import_projection_output_rejects_non_promotable_documents_when_required(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            projection_report = _projection_report()
            projection_report["documents"][0]["serving_intent"] = "pending_review"
            projection_report["documents"][0]["promotion_block_reason"] = "manual_review_pending"
            canonical_path = projection_dir / "canonical.md"
            document_units_path = projection_dir / "document-units.jsonl"
            projection_report["documents"][0]["canonical_markdown_path"] = str(canonical_path)
            projection_report["documents"][0]["document_units_path"] = str(document_units_path)
            _write_json(projection_dir / "projection-report.json", projection_report)
            canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            _write_jsonl(document_units_path, [_document_units_row()])
            _write_json(replay_input_dir / "source-truth-bundle.json", _bundle_payload())
            object_store = _FakeObjectStore()

            with self.assertRaisesRegex(ValueError, "non-promotable"):
                worker.import_projection_output(
                    work_dir=work_dir,
                    projection_output_dir=projection_dir,
                    replay_input_dir=replay_input_dir,
                    source_object_store=object_store,
                    derived_object_store=object_store,
                    document_registry=InMemoryDocumentRegistry(),
                    raw_asset_registry=InMemoryRawAssetRegistry(),
                    object_store_settings=_object_store_settings(),
                    scope_refresh=("official_web", "muc_public_pages"),
                    require_promotable=True,
                )
