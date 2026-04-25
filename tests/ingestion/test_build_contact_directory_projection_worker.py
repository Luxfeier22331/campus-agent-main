from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

worker = importlib.import_module("campus_ingestion_worker.build_contact_directory_projection")


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data


class BuildContactDirectoryProjectionWorkerTest(unittest.TestCase):
    def test_worker_builds_projection_release_from_handbook_document_units(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            document_units_path = root / "document-units.jsonl"
            _write_jsonl(
                document_units_path,
                [
                    {
                        "unit_type": "policy_page",
                        "clean_text": "校园110 68932220\n研究生院(学位办)办公室 68932649",
                        "anchor": {
                            "section_path": ["校级办公与公共服务"],
                            "page_start": 261,
                            "page_end": 261,
                        },
                    }
                ],
            )
            object_store = _FakeObjectStore()

            report = worker.build_contact_directory_projection_release_from_document_units(
                document_units_path=document_units_path,
                work_dir=root / "work",
                release_id="contact-directory-handbook-20260426T100000",
                generated_at="2026-04-26T10:00:00+08:00",
                source_title="中央民族大学校内常用电话",
                source_page_start=261,
                source_page_end=261,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                expected_ready_records=2,
            )

        self.assertEqual(report.release_id, "contact-directory-handbook-20260426T100000")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/contact_directory/current/"
                    "contact-directory-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(len(current_payload["contact_records"]), 2)
        self.assertEqual(current_payload["contact_records"][0]["phones"][0]["number"], "68932220")
        self.assertIn(
            (
                "campus-rag-derived",
                "campus_services/releases/contact_directory/"
                "contact-directory-handbook-20260426T100000/manual-review-report.json",
            ),
            object_store.objects,
        )


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
