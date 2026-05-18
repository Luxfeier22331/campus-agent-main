from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ingestion_core.document_artifact_restore import (
    restore_document_units_artifacts_from_local_evidence,
)
from campus_ingestion_core.models import DocumentRegistryRecord


class FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.writes: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.writes[(bucket, key)] = data


class DocumentArtifactRestoreTest(unittest.TestCase):
    def test_restore_uploads_missing_document_units_to_registry_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            record = _record(
                document_id="institutional_regulation:muc:中央民族大学本科教学事故认定与处理办法:9ff43316b979",
                version_id="sha256:d1c5e76658bdd5ce035190a6be8b61a22a711a6cb945742c7b9f137c279a76de:effective-undated:revision-none",
                units_key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学本科教学事故认定与处理办法--9ff43316/"
                    "current-effective/undated/document-units.jsonl"
                ),
            )
            source_path = root / "prepared-documents" / "doc-a" / "document-units.jsonl"
            source_path.parent.mkdir(parents=True)
            source_path.write_text(_document_units_jsonl(record), encoding="utf-8")
            object_store = FakeObjectStore()

            report = restore_document_units_artifacts_from_local_evidence(
                bucket="campus-rag-derived",
                evidence_roots=(root,),
                object_store=object_store,
                records=(record,),
                execute=True,
            )

            self.assertEqual(report.record_count, 1)
            self.assertEqual(report.planned_restore_count, 1)
            self.assertEqual(report.restored_count, 1)
            self.assertEqual(report.skipped_existing_count, 0)
            self.assertEqual(report.missing_source_count, 0)
            self.assertEqual(report.restored_object_keys, (record.document_units_object_key,))
            self.assertEqual(
                object_store.writes[("campus-rag-derived", record.document_units_object_key or "")],
                source_path.read_bytes(),
            )

    def test_restore_prefers_exact_object_store_mirror_when_multiple_sources_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            record = _record(
                document_id="institutional_regulation:muc:中央民族大学丰台校区就医管理办法-暂行:ff711d1185f9",
                version_id="sha256:2162cb0d7461352edce991fd4a2dbff029a7f39f6ff9593d5ac87eb9a1d32ce0:effective-undated:revision-none",
                units_key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学丰台校区就医管理办法-暂行--ff711d11/"
                    "current-effective/undated/document-units.jsonl"
                ),
            )
            prepared_path = root / "prepared-documents" / "doc-a" / "document-units.jsonl"
            prepared_path.parent.mkdir(parents=True)
            prepared_path.write_text(
                _document_units_jsonl(record, text="prepared"), encoding="utf-8"
            )
            mirror_path = (
                root
                / "object-store"
                / "campus-rag-derived"
                / (record.document_units_object_key or "")
            )
            mirror_path.parent.mkdir(parents=True)
            mirror_path.write_text(_document_units_jsonl(record, text="mirror"), encoding="utf-8")
            object_store = FakeObjectStore()

            report = restore_document_units_artifacts_from_local_evidence(
                bucket="campus-rag-derived",
                evidence_roots=(root,),
                object_store=object_store,
                records=(record,),
                execute=True,
            )

            self.assertEqual(report.restored_count, 1)
            self.assertEqual(report.source_artifact_paths, (str(mirror_path),))
            self.assertEqual(
                object_store.writes[("campus-rag-derived", record.document_units_object_key or "")],
                mirror_path.read_bytes(),
            )

    def test_restore_dry_run_does_not_upload_and_keeps_existing_objects(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            missing_record = _record(
                document_id="institutional_regulation:muc:missing:1234",
                version_id="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:effective-undated:revision-none",
                units_key="regulations/documents/institutional_rules/missing/document-units.jsonl",
            )
            existing_record = _record(
                document_id="institutional_regulation:muc:existing:1234",
                version_id="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:effective-undated:revision-none",
                units_key="regulations/documents/institutional_rules/existing/document-units.jsonl",
            )
            source_path = root / "prepared-documents" / "missing" / "document-units.jsonl"
            source_path.parent.mkdir(parents=True)
            source_path.write_text(_document_units_jsonl(missing_record), encoding="utf-8")
            object_store = FakeObjectStore(
                {("campus-rag-derived", existing_record.document_units_object_key or ""): b"exists"}
            )

            report = restore_document_units_artifacts_from_local_evidence(
                bucket="campus-rag-derived",
                evidence_roots=(root,),
                object_store=object_store,
                records=(missing_record, existing_record),
                execute=False,
            )

            self.assertEqual(report.planned_restore_count, 1)
            self.assertEqual(report.restored_count, 0)
            self.assertEqual(report.skipped_existing_count, 1)
            self.assertEqual(object_store.writes, {})

    def test_restore_fails_closed_when_missing_source_artifact(self) -> None:
        record = _record(
            document_id="institutional_regulation:muc:missing:1234",
            version_id="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:effective-undated:revision-none",
            units_key="regulations/documents/institutional_rules/missing/document-units.jsonl",
        )

        with (
            tempfile.TemporaryDirectory() as tmpdir,
            self.assertRaisesRegex(ValueError, "missing local document-units evidence"),
        ):
            restore_document_units_artifacts_from_local_evidence(
                bucket="campus-rag-derived",
                evidence_roots=(Path(tmpdir),),
                object_store=FakeObjectStore(),
                records=(record,),
                execute=True,
            )


def _record(*, document_id: str, version_id: str, units_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=version_id,
        source_uri="https://my.muc.edu.cn/comsys-prompt-portlet-web/file/test.pdf",
        content_hash=version_id.split(":", 2)[1],
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-05-03T11:11:56+00:00",
        parser_version="collected_notice_regulation_canonical_backfill_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        processed_object_keys=(units_key,),
        import_source="test",
    )


def _document_units_jsonl(record: DocumentRegistryRecord, *, text: str = "正文") -> str:
    return (
        json.dumps(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": f"{record.document_id}:unit-0001",
                "row_id": f"{record.document_id}:unit-0001",
                "row_type": "paragraph",
                "clean_text": text,
                "visibility_level": record.visibility_level,
                "visibility_scope": record.visibility_scope,
                "entitlement_groups": list(record.entitlement_groups),
                "metadata": {
                    "title": "测试制度",
                    "cleaning_policy_version": record.cleaning_policy_version,
                    "normalization_quality": {"quality_verdict": "passed"},
                },
            },
            ensure_ascii=False,
        )
        + "\n"
    )


if __name__ == "__main__":
    unittest.main()
