from __future__ import annotations

from dataclasses import replace
import base64
import hashlib
import json
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import zipfile

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.raw_ingestion import OnlineOcrProviderResult
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from campus_ingestion_core.authenticated_notice_source_projections import (
    AuthenticatedNoticeSourceProjectionRequest,
    rebuild_authenticated_notice_source_projections,
)

SOURCE_BUCKET = "campus-rag-source"
DERIVED_BUCKET = "campus-rag-derived"


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.uploads: list[tuple[str, str]] = []

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        del content_type
        self.objects[(bucket, key)] = data
        self.uploads.append((bucket, key))

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


class _FakeAttachmentOcrClient:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path.name)
        payload = {
            "result": {
                "layoutParsingResults": [
                    {"markdown": {"text": "图片附件 OCR 正文 第一行\n图片附件 OCR 正文 第二行"}},
                ]
            }
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"),
        )


class _FakeAttachmentNoTextOcrClient:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path.name)
        payload = {
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "vertical_text",
                                    "block_content": "",
                                }
                            ]
                        },
                        "markdown": {"text": ""},
                    },
                ]
            }
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"),
        )


class _FakeAttachmentStructuredOcrClient:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path.name)
        payload = {
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "width": 1024,
                            "height": 1448,
                            "parsing_res_list": [
                                {
                                    "block_id": "heading-1",
                                    "block_label": "paragraph_title",
                                    "block_content": "班车时间安排",
                                    "block_order": 1,
                                    "block_bbox": [0, 0, 512, 40],
                                },
                                {
                                    "block_id": "paragraph-1",
                                    "block_label": "text",
                                    "block_content": "工作日按以下时间发车。",
                                    "block_order": 2,
                                    "block_bbox": [0, 50, 512, 100],
                                },
                                {
                                    "block_id": "table-1",
                                    "block_label": "table",
                                    "block_content": "时间 地点 08:00 海淀校区 17:30 丰台校区",
                                    "block_order": 3,
                                    "block_bbox": [0, 120, 512, 360],
                                    "tableCells": [["时间", "地点"], ["08:00", "海淀校区"], ["17:30", "丰台校区"]],
                                    "markdown": {
                                        "text": "时间 | 地点\n08:00 | 海淀校区\n17:30 | 丰台校区",
                                        "html": "<table><tr><th>时间</th><th>地点</th></tr><tr><td>08:00</td><td>海淀校区</td></tr><tr><td>17:30</td><td>丰台校区</td></tr></table>",
                                    },
                                },
                            ],
                        },
                        "markdown": {
                            "text": "班车时间安排\n工作日按以下时间发车。\n时间 | 地点\n08:00 | 海淀校区\n17:30 | 丰台校区"
                        },
                    }
                ]
            }
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"),
        )


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _sample_export_manifest() -> dict[str, object]:
    return {
        "schema_version": "v3",
        "exported_at": "2026-04-02T23:59:19.838Z",
        "export_date": "20260403",
        "export_scope": "run-14",
        "filters": {
            "run_id": 14,
            "since": None,
            "until": None,
        },
        "run": {
            "id": 14,
            "mode": "backfill",
            "status": "success",
            "started_at": "2026-04-02T23:50:17.023Z",
            "finished_at": "2026-04-02T23:57:57.563Z",
            "pages_fetched": 337,
            "items_seen": 6694,
            "items_inserted": 6454,
            "items_updated": 0,
            "errors": 0,
            "error_message": None,
        },
    }


def _build_minimal_docx_bytes(*, paragraphs: tuple[str, ...]) -> bytes:
    document_xml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        "<w:body>",
    ]
    for paragraph in paragraphs:
        document_xml.append(f"<w:p><w:r><w:t>{paragraph}</w:t></w:r></w:p>")
    document_xml.extend(["<w:sectPr/>", "</w:body>", "</w:document>"])

    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/document.xml", "\n".join(document_xml))
    return buffer.getvalue()


def _build_minimal_png_bytes() -> bytes:
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0eQAAAAASUVORK5CYII="
    )


def _build_minimal_gif_bytes() -> bytes:
    return base64.b64decode("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")


def _attachment_object_key(content_sha256: str, filename: str) -> str:
    return f"attachments/{content_sha256[:2]}/{content_sha256}/{filename}"


def _sample_notice_bundle(*, docx_bytes: bytes, png_bytes: bytes) -> list[dict[str, object]]:
    docx_sha256 = hashlib.sha256(docx_bytes).hexdigest()
    png_sha256 = hashlib.sha256(png_bytes).hexdigest()
    docx_key = _attachment_object_key(docx_sha256, "application.docx")
    png_key = _attachment_object_key(png_sha256, "notice.png")
    return [
        {
            "notice_id": 355119,
            "notice": {
                "notice_id": 355119,
                "notice_title": "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知",
                "organization_name": "教务处",
                "organization_id": "00001",
                "notice_release_time": "2026-04-02 18:49",
                "notice_create_time": "2026-04-02 18:40",
                "notice_first_time": "2026-04-02 18:40",
                "notice_content": (
                    "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                    "<p>请同学们于4月10日前完成报名。</p>"
                    "<p>附件1：报名表.docx</p>"
                    "<p>附件2：通知配图.png</p>"
                    "<p>附件3：补充材料.pdf</p>"
                ),
                "notice_link": "https://portal.example.edu/notice/355119",
                "notice_source": 1,
                "notice_link_state": 0,
                "notice_state": 1,
                "notice_stick": 0,
                "categories": [
                    {
                        "notice_id": 355119,
                        "notice_type": "6",
                        "notice_type_name": "教学通知",
                        "category_first_seen_at": "2026-04-02T18:49:00.000Z",
                        "category_last_seen_at": "2026-04-02T18:49:00.000Z",
                        "category_last_run_id": 14,
                    }
                ],
            },
            "links": [
                {
                    "id": 34,
                    "notice_id": 355119,
                    "run_id": 14,
                    "source": "content",
                    "content_kind": "attachment_list",
                    "url": "https://portal.example.edu/files/application.docx",
                    "url_scheme": "https",
                    "link_host": "portal.example.edu",
                    "link_scope": "internal",
                    "collect_policy": "fetch",
                    "skip_reason": None,
                    "link_text": "报名表.docx",
                    "final_url": "https://portal.example.edu/files/application.docx",
                    "title": None,
                    "status_code": 200,
                    "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "downloaded": True,
                    "download_path": None,
                    "file_size": len(docx_bytes),
                    "fetched_at": "2026-04-02T23:58:26.053Z",
                    "error_message": None,
                },
                {
                    "id": 35,
                    "notice_id": 355119,
                    "run_id": 14,
                    "source": "content",
                    "content_kind": "attachment_list",
                    "url": "https://portal.example.edu/files/notice.png",
                    "url_scheme": "https",
                    "link_host": "portal.example.edu",
                    "link_scope": "internal",
                    "collect_policy": "fetch",
                    "skip_reason": None,
                    "link_text": "通知配图.png",
                    "final_url": "https://portal.example.edu/files/notice.png",
                    "title": None,
                    "status_code": 200,
                    "content_type": "image/png",
                    "downloaded": True,
                    "download_path": None,
                    "file_size": len(png_bytes),
                    "fetched_at": "2026-04-02T23:58:26.053Z",
                    "error_message": None,
                },
                {
                    "id": 36,
                    "notice_id": 355119,
                    "run_id": 14,
                    "source": "content",
                    "content_kind": "attachment_list",
                    "url": "https://portal.example.edu/files/supplement.pdf",
                    "url_scheme": "https",
                    "link_host": "portal.example.edu",
                    "link_scope": "internal",
                    "collect_policy": "reference_only",
                    "skip_reason": None,
                    "link_text": "补充材料.pdf",
                    "final_url": "https://portal.example.edu/files/supplement.pdf",
                    "title": None,
                    "status_code": None,
                    "content_type": "application/pdf",
                    "downloaded": False,
                    "download_path": None,
                    "file_size": None,
                    "fetched_at": "2026-04-02T23:58:26.053Z",
                    "error_message": None,
                },
            ],
            "notice_attachments": [
                {
                    "notice_id": 355119,
                    "attachment_id": 1,
                    "link_id": 34,
                    "relation_source": "content",
                    "resource_role": "attachment",
                    "anchor_text": "报名表.docx",
                    "discovered_at": "2026-04-02T23:58:26.053Z",
                },
                {
                    "notice_id": 355119,
                    "attachment_id": 2,
                    "link_id": 35,
                    "relation_source": "content",
                    "resource_role": "inline_image",
                    "anchor_text": "通知配图.png",
                    "discovered_at": "2026-04-02T23:58:26.053Z",
                },
                {
                    "notice_id": 355119,
                    "attachment_id": 3,
                    "link_id": 36,
                    "relation_source": "content",
                    "resource_role": "attachment",
                    "anchor_text": "补充材料.pdf",
                    "discovered_at": "2026-04-02T23:58:26.053Z",
                },
            ],
            "attachments": [
                {
                    "attachment_id": 1,
                    "source_url": "https://portal.example.edu/files/application.docx",
                    "normalized_source_url": "https://portal.example.edu/files/application.docx",
                    "final_url": "https://portal.example.edu/files/application.docx",
                    "original_filename": "application.docx",
                    "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "byte_size": len(docx_bytes),
                    "sha256": docx_sha256,
                    "storage_provider": "local",
                    "bucket": None,
                    "object_key": docx_key,
                    "etag": None,
                    "version_id": None,
                    "origin_url_scheme": "https",
                    "origin_host": "portal.example.edu",
                    "origin_scope": "internal",
                    "provenance_status": "collected_internal",
                    "ingest_status": "downloaded",
                    "local_path": None,
                    "downloaded_at": "2026-04-02T23:58:26.053Z",
                    "uploaded_at": None,
                    "last_error": None,
                    "created_at": "2026-04-02T23:58:26.053Z",
                    "updated_at": "2026-04-02T23:58:26.053Z",
                },
                {
                    "attachment_id": 2,
                    "source_url": "https://portal.example.edu/files/notice.png",
                    "normalized_source_url": "https://portal.example.edu/files/notice.png",
                    "final_url": "https://portal.example.edu/files/notice.png",
                    "original_filename": "notice.png",
                    "mime_type": "image/png",
                    "byte_size": len(png_bytes),
                    "sha256": png_sha256,
                    "storage_provider": "local",
                    "bucket": None,
                    "object_key": png_key,
                    "etag": None,
                    "version_id": None,
                    "origin_url_scheme": "https",
                    "origin_host": "portal.example.edu",
                    "origin_scope": "internal",
                    "provenance_status": "collected_internal",
                    "ingest_status": "downloaded",
                    "local_path": None,
                    "downloaded_at": "2026-04-02T23:58:26.053Z",
                    "uploaded_at": None,
                    "last_error": None,
                    "created_at": "2026-04-02T23:58:26.053Z",
                    "updated_at": "2026-04-02T23:58:26.053Z",
                },
                {
                    "attachment_id": 3,
                    "source_url": "https://portal.example.edu/files/supplement.pdf",
                    "normalized_source_url": "https://portal.example.edu/files/supplement.pdf",
                    "final_url": "https://portal.example.edu/files/supplement.pdf",
                    "original_filename": "supplement.pdf",
                    "mime_type": "application/pdf",
                    "byte_size": None,
                    "sha256": None,
                    "storage_provider": "reference_only",
                    "bucket": None,
                    "object_key": None,
                    "etag": None,
                    "version_id": None,
                    "origin_url_scheme": "https",
                    "origin_host": "portal.example.edu",
                    "origin_scope": "internal",
                    "provenance_status": "reference_only",
                    "ingest_status": "reference_only",
                    "local_path": None,
                    "downloaded_at": None,
                    "uploaded_at": None,
                    "last_error": None,
                    "created_at": "2026-04-02T23:58:26.053Z",
                    "updated_at": "2026-04-02T23:58:26.053Z",
                },
            ],
        }
    ]


def _sample_notice_bundle_with_decorative_gif(
    *,
    docx_bytes: bytes,
    gif_bytes: bytes,
) -> list[dict[str, object]]:
    bundle = json.loads(
        json.dumps(
            _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=gif_bytes),
            ensure_ascii=False,
        )
    )
    gif_sha256 = hashlib.sha256(gif_bytes).hexdigest()
    gif_key = _attachment_object_key(gif_sha256, "spacer.gif")
    decorative_url = "https://my.muc.edu.cn/static/index/UEditor/themes/default/images/spacer.gif"

    notice = bundle[0]["notice"]
    assert isinstance(notice, dict)
    notice["notice_content"] = (
        "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
        "<p>请同学们于4月10日前完成报名。</p>"
        "<p>附件1：报名表.docx</p>"
        '<p><img src="/static/index/UEditor/themes/default/images/spacer.gif" /></p>'
        "<p>附件3：补充材料.pdf</p>"
    )

    link = bundle[0]["links"][1]
    assert isinstance(link, dict)
    link["url"] = decorative_url
    link["final_url"] = decorative_url
    link["link_text"] = "spacer.gif"
    link["content_type"] = "image/gif"
    link["file_size"] = len(gif_bytes)

    notice_attachment = bundle[0]["notice_attachments"][1]
    assert isinstance(notice_attachment, dict)
    notice_attachment["anchor_text"] = None
    notice_attachment["resource_role"] = "inline_image"

    attachment = bundle[0]["attachments"][1]
    assert isinstance(attachment, dict)
    attachment["source_url"] = decorative_url
    attachment["normalized_source_url"] = decorative_url
    attachment["final_url"] = decorative_url
    attachment["original_filename"] = "spacer.gif"
    attachment["mime_type"] = "image/gif"
    attachment["byte_size"] = len(gif_bytes)
    attachment["sha256"] = gif_sha256
    attachment["object_key"] = gif_key
    attachment["origin_host"] = "my.muc.edu.cn"
    return bundle


def _env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
    }


class AuthenticatedNoticeSourceProjectionsTest(unittest.TestCase):
    def test_rebuild_authenticated_notice_source_projections_replaces_scope_and_materializes_attachment_children(self) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_minimal_png_bytes()
        bundle = _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(backing_path=root / "registry" / "raw-assets.json")
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=docx_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=png_bytes,
                content_type="image/png",
            )

            parent_record = document_registry.list_by_scope("campus_notices", "internal_notice")[0]
            document_registry.upsert(
                replace(
                    parent_record,
                    document_id="notice_attachment:muc_internal_portal:355119:stale",
                    version_id="sha256:stale",
                    content_hash="stale",
                    source_uri="https://portal.example.edu/files/stale.png",
                    document_units_object_key=(
                        "campus_notices/documents/internal_notice/"
                        "notice-attachment-stale/source-faithful/2026/document-units.jsonl"
                    ),
                    provider_response_object_key=None,
                    canonical_markdown_object_key=None,
                    processed_object_keys=(
                        "campus_notices/documents/internal_notice/"
                        "notice-attachment-stale/source-faithful/2026/document-units.jsonl",
                    ),
                    import_source="authenticated_notice_source_projection",
                )
            )

            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=_FakeAttachmentOcrClient(),
            )

        self.assertEqual(report.parent_notice_count, 1)
        self.assertEqual(report.attachment_ref_count, 3)
        self.assertEqual(report.projected_attachment_count, 2)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.ocr_no_text_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(report.errors, ())

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
                "notice_attachment:muc_internal_portal:355119:attachment-0002",
            },
        )

        parent = next(record for record in records if record.document_id == "notice:muc_internal_portal:355119")
        parent_units = [
            json.loads(line)
            for line in object_store.get_bytes(bucket=DERIVED_BUCKET, key=str(parent.document_units_object_key))
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertNotIn("attachment_ref", [row["unit_type"] for row in parent_units])

        docx_child = next(
            record
            for record in records
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0001"
        )
        docx_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(docx_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("projection_name: internal_notice_attachment_documents", docx_markdown)
        self.assertIn("parent_document_id: notice:muc_internal_portal:355119", docx_markdown)
        self.assertIn("报名表正文第一段", docx_markdown)

        image_child = next(
            record
            for record in records
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0002"
        )
        image_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(image_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("图片附件 OCR 正文 第一行", image_markdown)

    def test_rebuild_authenticated_notice_source_projections_keeps_ocr_no_text_as_relation_only(self) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_minimal_png_bytes()
        bundle = _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(backing_path=root / "registry" / "raw-assets.json")
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=docx_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=png_bytes,
                content_type="image/png",
            )

            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=_FakeAttachmentNoTextOcrClient(),
            )

        self.assertEqual(report.parent_notice_count, 1)
        self.assertEqual(report.attachment_ref_count, 3)
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.ocr_no_text_attachment_count, 1)
        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(report.errors, ())

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
            },
        )

    def test_rebuild_authenticated_notice_source_projections_materializes_structured_ocr_artifacts(self) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_minimal_png_bytes()
        bundle = _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(backing_path=root / "registry" / "raw-assets.json")
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=docx_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=png_bytes,
                content_type="image/png",
            )

            rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=_FakeAttachmentStructuredOcrClient(),
            )

        image_child = next(
            record
            for record in document_registry.list_by_scope("campus_notices", "internal_notice")
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0002"
        )
        self.assertIsNotNone(image_child.provider_response_object_key)
        self.assertIsNotNone(image_child.layout_elements_object_key)
        self.assertIsNotNone(image_child.canonical_markdown_object_key)

        layout_rows = [
            json.loads(line)
            for line in object_store.get_bytes(
                bucket=DERIVED_BUCKET,
                key=str(image_child.layout_elements_object_key),
            )
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertTrue(any(row["row_type"] == "table" for row in layout_rows))
        self.assertTrue(any(row.get("table_cells") == [["时间", "地点"], ["08:00", "海淀校区"], ["17:30", "丰台校区"]] for row in layout_rows))

        image_units = [
            json.loads(line)
            for line in object_store.get_bytes(bucket=DERIVED_BUCKET, key=str(image_child.document_units_object_key))
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertIn("section_text", {row["unit_type"] for row in image_units})
        self.assertIn("table_unit", {row["unit_type"] for row in image_units})
        self.assertFalse(
            any("<table" in str(row.get("clean_text") or "") or "<div" in str(row.get("clean_text") or "") for row in image_units)
        )

        image_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(image_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("班车时间安排", image_markdown)
        self.assertIn("08:00", image_markdown)
        self.assertNotIn("<table", image_markdown)

    def test_rebuild_authenticated_notice_source_projections_skips_decorative_editor_assets(self) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        gif_bytes = _build_minimal_gif_bytes()
        bundle = _sample_notice_bundle_with_decorative_gif(
            docx_bytes=docx_bytes,
            gif_bytes=gif_bytes,
        )

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(backing_path=root / "registry" / "raw-assets.json")
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=docx_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=gif_bytes,
                content_type="image/gif",
            )

            ocr_client = _FakeAttachmentOcrClient()
            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=ocr_client,
            )

        self.assertEqual(report.parent_notice_count, 1)
        self.assertEqual(report.attachment_ref_count, 3)
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.ocr_no_text_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.errors, ())
        self.assertEqual(ocr_client.calls, [])

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
            },
        )

    def test_internal_notice_chunking_skips_attachment_ref_units(self) -> None:
        record = DocumentRegistryRecord(
            document_id="notice:muc_internal_portal:355119",
            revision_track="source-faithful",
            version_id="sha256:test-version",
            source_uri="https://portal.example.edu/notice/355119",
            content_hash="content-hash",
            corpus="campus_notices",
            collection="internal_notice",
            cleaning_policy_version="authenticated_notice_projection_v1",
            entitlement_groups=("campus_members",),
            visibility_scope="campus",
            visibility_level="restricted",
            ingestion_timestamp="2026-04-05T00:00:00+00:00",
            parser_version="authenticated_notice_import_v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="authenticated_notice_portal",
            is_current=False,
            document_units_object_key="campus_notices/documents/internal_notice/test/source-faithful/2026/document-units.jsonl",
            processed_object_keys=(
                "campus_notices/documents/internal_notice/test/source-faithful/2026/document-units.jsonl",
            ),
            import_source="authenticated_notice_bootstrap_import",
        )

        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "body-001",
                    "root_unit_id": "body-001",
                    "unit_type": "paragraph",
                    "text": "请同学们于4月10日前完成报名。",
                    "raw_text": "请同学们于4月10日前完成报名。",
                    "clean_text": "请同学们于4月10日前完成报名。",
                    "anchor": {"source_uri": record.source_uri},
                    "metadata": {"block_role": "paragraph"},
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-0001",
                    "root_unit_id": "attachment-0001",
                    "unit_type": "attachment_ref",
                    "text": "报名表.docx",
                    "raw_text": "报名表.docx",
                    "clean_text": "报名表.docx",
                    "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
                    "metadata": {"block_role": "attachment_ref"},
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        self.assertEqual(len(chunks), 1)
        self.assertNotIn("attachment_ref", [chunk.metadata["unit_type"] for chunk in chunks])

    def test_internal_notice_chunking_splits_large_table_unit_without_row_lines(self) -> None:
        record = DocumentRegistryRecord(
            document_id="notice:muc_internal_portal:355120",
            revision_track="source-faithful",
            version_id="sha256:test-version-2",
            source_uri="https://portal.example.edu/notice/355120",
            content_hash="content-hash-2",
            corpus="campus_notices",
            collection="internal_notice",
            cleaning_policy_version="authenticated_notice_projection_v1",
            entitlement_groups=("campus_members",),
            visibility_scope="campus",
            visibility_level="restricted",
            ingestion_timestamp="2026-04-05T00:00:00+00:00",
            parser_version="authenticated_notice_import_v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="authenticated_notice_portal",
            is_current=False,
            document_units_object_key="campus_notices/documents/internal_notice/test/source-faithful/2026/document-units-large-table.jsonl",
            processed_object_keys=(
                "campus_notices/documents/internal_notice/test/source-faithful/2026/document-units-large-table.jsonl",
            ),
            import_source="authenticated_notice_bootstrap_import",
        )

        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "body-001",
                    "root_unit_id": "body-001",
                    "unit_type": "paragraph",
                    "text": "关于考试安排的补充说明。",
                    "raw_text": "关于考试安排的补充说明。",
                    "clean_text": "关于考试安排的补充说明。",
                    "anchor": {"source_uri": record.source_uri},
                    "metadata": {"block_role": "paragraph"},
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "table-001",
                    "root_unit_id": "table-001",
                    "unit_type": "table_unit",
                    "text": "\n".join(f"第{index}行 | {'甲' * 24}" for index in range(1, 40)),
                    "raw_text": "\n".join(f"第{index}行 | {'甲' * 24}" for index in range(1, 40)),
                    "clean_text": "\n".join(f"第{index}行 | {'甲' * 24}" for index in range(1, 40)),
                    "anchor": {"source_uri": record.source_uri},
                    "metadata": {"block_role": "table"},
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        table_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "table_unit"]
        self.assertGreater(len(table_chunks), 1)
        self.assertTrue(all(chunk.metadata["split_reason"] == "token_guardrail" for chunk in table_chunks))
        self.assertTrue(all(chunk.metadata["final_token_count"] <= 320 for chunk in table_chunks))
        self.assertTrue(all(chunk.metadata["strategy_name"] == "internal_notice_notice_body_v2" for chunk in table_chunks))


if __name__ == "__main__":
    unittest.main()
