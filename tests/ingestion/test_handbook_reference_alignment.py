from __future__ import annotations

from collections import Counter
from pathlib import Path
import unittest

from campus_ingestion_core.handbook_cleanup import build_handbook_doc_id
from campus_ingestion_core.split_manifest import load_split_manifest


MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "regulations"
    / "student_handbook"
    / "split-manifest.v1.json"
)

REFERENCE_DOCS = {
    "普通高等学校学生管理规定": {
        "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
        "handbook_section": "国家高等教育管理有关规定",
        "page_start": 2,
        "page_end": 17,
    },
    "高等学校学生行为准则": {
        "document_id": "handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
        "handbook_section": "国家高等教育管理有关规定",
        "page_start": 18,
        "page_end": 19,
    },
    "高等学校校园秩序管理若干规定": {
        "document_id": "handbook:6d77f946c626910853345180b95700217078b1a1",
        "handbook_section": "国家高等教育管理有关规定",
        "page_start": 20,
        "page_end": 23,
    },
    "中央民族大学优秀本科毕业生评选办法": {
        "document_id": "handbook:0f8b6739e24d38d9d2d274f1566623f019c79747",
        "handbook_section": "中央民族大学学生奖励管理规定",
        "page_start": 200,
        "page_end": 203,
    },
    "中央民族大学关于学生宿舍照明的管理规定": {
        "document_id": "handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",
        "handbook_section": "中央民族大学公寓及公费医疗管理规定",
        "page_start": 256,
        "page_end": 256,
    },
    "中央民族大学关于加强学生宿舍电器使用管理的规定": {
        "document_id": "handbook:a633b4ce84d8d92e1d98f97c57491ec24e8be834",
        "handbook_section": "中央民族大学公寓及公费医疗管理规定",
        "page_start": 257,
        "page_end": 258,
    },
    "中央民族大学学生公费医疗管理办法": {
        "document_id": "handbook:b85de1cb327a26dc63488e247403ae3126d524be",
        "handbook_section": "中央民族大学公寓及公费医疗管理规定",
        "page_start": 259,
        "page_end": 260,
    },
}

REFERENCE_SECTION_COUNTS = {
    "国家高等教育管理有关规定": 4,
    "中央民族大学学生教学管理规定": 10,
    "中央民族大学学生日常管理规定": 12,
    "中央民族大学学生奖励管理规定": 8,
    "中央民族大学学生资助管理规定": 9,
    "中央民族大学公寓及公费医疗管理规定": 3,
}


class HandbookReferenceAlignmentTest(unittest.TestCase):
    def test_student_handbook_manifest_matches_reference_page_ranges(self) -> None:
        manifest = load_split_manifest(
            MANIFEST_PATH,
            expected_corpus="regulations",
            expected_collection="student_handbook",
        )

        self.assertEqual(len(manifest.documents), 46)
        by_title = {document.title: document for document in manifest.documents}
        self.assertEqual(set(REFERENCE_DOCS), set(REFERENCE_DOCS) & set(by_title))
        for title, expected in REFERENCE_DOCS.items():
            document = by_title[title]
            self.assertEqual(document.document_id, expected["document_id"])
            self.assertEqual(document.handbook_section, expected["handbook_section"])
            self.assertEqual(document.page_start, expected["page_start"])
            self.assertEqual(document.page_end, expected["page_end"])
            self.assertEqual(document.document_id, build_handbook_doc_id(title))

    def test_student_handbook_manifest_preserves_reference_section_distribution(self) -> None:
        manifest = load_split_manifest(
            MANIFEST_PATH,
            expected_corpus="regulations",
            expected_collection="student_handbook",
        )

        self.assertEqual(
            Counter(document.handbook_section for document in manifest.documents),
            Counter(REFERENCE_SECTION_COUNTS),
        )
        self.assertEqual(manifest.documents[0].page_start, 2)
        self.assertEqual(manifest.documents[-1].page_end, 260)
        self.assertTrue(
            all(
                document.source_uri == f"campus-agent://regulations/student_handbook/docs/{document.document_id}"
                for document in manifest.documents
            )
        )


if __name__ == "__main__":
    unittest.main()
