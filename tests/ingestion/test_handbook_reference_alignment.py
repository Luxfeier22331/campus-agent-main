from __future__ import annotations

import unittest
from collections import Counter
from pathlib import Path

from campus_ingestion_core.split_manifest import load_split_manifest

MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "regulations"
    / "student_rules"
    / "split-manifest.v1.json"
)

REFERENCE_DOCS = {
    "Synthetic student status rule": {
        "document_id": "handbook:synthetic-student-status-rule",
        "handbook_section": "Synthetic student rules",
        "page_start": 1,
        "page_end": 2,
    },
    "Synthetic scholarship review rule": {
        "document_id": "handbook:synthetic-scholarship-rule",
        "handbook_section": "Synthetic student rules",
        "page_start": 3,
        "page_end": 4,
    },
    "Synthetic student card rule": {
        "document_id": "handbook:synthetic-student-card-rule",
        "handbook_section": "Synthetic student rules",
        "page_start": 5,
        "page_end": 5,
    },
    "Synthetic appeal procedure": {
        "document_id": "handbook:synthetic-appeal-procedure",
        "handbook_section": "Synthetic student procedures",
        "page_start": 6,
        "page_end": 6,
    },
    "Synthetic dormitory management rule": {
        "document_id": "handbook:synthetic-dormitory-rule",
        "handbook_section": "Synthetic student rules",
        "page_start": 7,
        "page_end": 7,
    },
}

REFERENCE_SECTION_COUNTS = {
    "Synthetic student rules": 4,
    "Synthetic student procedures": 1,
}


class HandbookReferenceAlignmentTest(unittest.TestCase):
    def test_student_handbook_manifest_matches_public_synthetic_reference_shape(self) -> None:
        manifest = load_split_manifest(
            MANIFEST_PATH,
            expected_corpus="regulations",
            expected_collection="student_rules",
        )

        self.assertEqual(len(manifest.documents), 5)
        by_title = {document.title: document for document in manifest.documents}
        self.assertEqual(set(REFERENCE_DOCS), set(by_title))
        for title, expected in REFERENCE_DOCS.items():
            document = by_title[title]
            self.assertEqual(document.document_id, expected["document_id"])
            self.assertEqual(document.handbook_section, expected["handbook_section"])
            self.assertEqual(document.page_start, expected["page_start"])
            self.assertEqual(document.page_end, expected["page_end"])

    def test_student_handbook_manifest_preserves_public_synthetic_section_distribution(
        self,
    ) -> None:
        manifest = load_split_manifest(
            MANIFEST_PATH,
            expected_corpus="regulations",
            expected_collection="student_rules",
        )

        self.assertEqual(
            Counter(document.handbook_section for document in manifest.documents),
            Counter(REFERENCE_SECTION_COUNTS),
        )
        self.assertEqual(manifest.documents[0].page_start, 1)
        self.assertEqual(manifest.documents[-1].page_end, 7)
        self.assertTrue(
            all(
                document.source_uri
                == f"campus-agent://synthetic/regulations/student_rules/docs/{document.document_id.removeprefix('handbook:')}"
                for document in manifest.documents
            )
        )


if __name__ == "__main__":
    unittest.main()
