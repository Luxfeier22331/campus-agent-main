from __future__ import annotations

import base64

import hashlib

import json

import unittest

import zipfile

from dataclasses import replace

from io import BytesIO

from pathlib import Path

from tempfile import TemporaryDirectory

from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)

from campus_ingestion_core.authenticated_notice_source_projections import (
    AuthenticatedNoticeSourceProjectionRequest,
    _build_attachment_title,
    _classify_attachment_ref,
    build_authenticated_notice_attachment_projection_plans,
    load_authenticated_notice_source_projections_config,
    rebuild_authenticated_notice_source_projections,
)

from campus_ingestion_core.authenticated_notice_source_truth import (
    build_authenticated_notice_attachment_capture_key,
)

from campus_ingestion_core.file_asset_contract import (
    ArtifactProvenance,
    ExtractionOutcome,
    FileAssetDescriptor,
    parse_file_asset_extraction_record,
)

from campus_ingestion_core.models import DocumentRegistryRecord

from campus_ingestion_core.process import build_indexable_chunks_from_jsonl

from campus_ingestion_core.raw_ingestion import OnlineOcrProviderResult

from campus_ingestion_core.settings import ObjectStoreSettings

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

SOURCE_BUCKET = "campus-rag-source"

DERIVED_BUCKET = "campus-rag-derived"


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.uploads: list[tuple[str, str]] = []
        self.downloads: list[tuple[str, str, str]] = []

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        del content_type
        self.objects[(bucket, key)] = data
        self.uploads.append((bucket, key))

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def download_file(self, *, bucket: str, key: str, file_path: str) -> None:
        Path(file_path).write_bytes(self.objects[(bucket, key)])
        self.downloads.append((bucket, key, file_path))


def _build_mineru_archive_bytes() -> bytes:
    content_items = [
        {
            "type": "text",
            "text": "中央民族大学附件 OCR 标题",
            "text_level": 1,
            "bbox": [10, 20, 300, 80],
            "page_idx": 0,
        },
        {
            "type": "text",
            "text": "图片附件 OCR 正文 第一行",
            "text_level": 0,
            "bbox": [10, 90, 500, 140],
            "page_idx": 0,
        },
        {
            "type": "table",
            "table_body": (
                "<table><tr><td>字段</td><td>值</td></tr>"
                "<tr><td>校区</td><td>丰台校区</td></tr></table>"
            ),
            "bbox": [10, 150, 900, 900],
            "page_idx": 0,
        },
    ]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("sample_content_list.json", json.dumps(content_items, ensure_ascii=False))
        archive.writestr(
            "full.md",
            "# 中央民族大学附件 OCR 标题\n\n图片附件 OCR 正文 第一行\n\n| 字段 | 值 |\n| --- | --- |\n| 校区 | 丰台校区 |\n",
        )
    return buffer.getvalue()


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
                                    "tableCells": [
                                        ["时间", "地点"],
                                        ["08:00", "海淀校区"],
                                        ["17:30", "丰台校区"],
                                    ],
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


class _FakeAttachmentMineruOcrClient:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def parse_pdf(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(f"pdf:{file_path.name}")
        return OnlineOcrProviderResult(provider_result_bytes=_build_mineru_archive_bytes())

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path.name)
        return OnlineOcrProviderResult(provider_result_bytes=_build_mineru_archive_bytes())


class _FailingAttachmentMineruOcrClient:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def parse_pdf(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(f"pdf:{file_path.name}")
        raise RuntimeError(f"mineru failed for {file_path.name}")

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path.name)
        raise RuntimeError(f"mineru failed for {file_path.name}")


class _FailingAttachmentOcrClient:
    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        raise RuntimeError(f"provider contract breach for {file_path.name}")


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


def _build_minimal_xlsx_bytes() -> bytes:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>
"""
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
"""
    workbook = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="报名表" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
"""
    workbook_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>
"""
    shared_strings = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>姓名</t></si>
  <si><t>学号</t></si>
  <si><t>张三</t></si>
  <si><t>2026001</t></si>
</sst>
"""
    worksheet = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2" t="s"><v>3</v></c>
    </row>
  </sheetData>
</worksheet>
"""
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/sharedStrings.xml", shared_strings)
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    return buffer.getvalue()


def _build_minimal_png_bytes() -> bytes:
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0eQAAAAASUVORK5CYII="
    )


def _build_minimal_gif_bytes() -> bytes:
    return base64.b64decode("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")


def _build_minimal_pdf_bytes() -> bytes:
    return b"%PDF-1.4 internal notice attachment\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def _attachment_object_key(content_sha256: str, filename: str) -> str:
    return build_authenticated_notice_attachment_capture_key(
        content_sha256=content_sha256,
        filename=filename,
        year="2026",
    )


def _env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
    }


__all__ = [name for name in globals() if not name.startswith("__")]
