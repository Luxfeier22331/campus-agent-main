from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.split_manifest import load_split_manifest


class SplitManifestTest(unittest.TestCase):
    def test_load_split_manifest_reads_curriculum_plan_documents(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.v1.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 12,
                                "source_uri": "https://campus.example/curriculum/plan-001",
                            },
                            {
                                "document_id": "curriculum:plan-002",
                                "title": "Plan 002",
                                "page_start": 13,
                                "page_end": 20,
                                "source_uri": "https://campus.example/curriculum/plan-002",
                                "acl_groups": ["students"],
                                "campus_scope": "main",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            manifest = load_split_manifest(path, expected_corpus="curriculum_plan")

            self.assertEqual(manifest.corpus, "curriculum_plan")
            self.assertEqual(manifest.raw_asset_id, "asset:curriculum-plan-master-pdf")
            self.assertEqual(len(manifest.documents), 2)
            self.assertEqual(manifest.documents[1].acl_groups, ("students",))
            self.assertEqual(manifest.documents[1].campus_scope, "main")

    def test_load_split_manifest_rejects_overlapping_page_ranges(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.v1.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 12,
                                "source_uri": "https://campus.example/curriculum/plan-001",
                            },
                            {
                                "document_id": "curriculum:plan-002",
                                "title": "Plan 002",
                                "page_start": 12,
                                "page_end": 20,
                                "source_uri": "https://campus.example/curriculum/plan-002",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "overlap"):
                load_split_manifest(path, expected_corpus="curriculum_plan")


if __name__ == "__main__":
    unittest.main()
