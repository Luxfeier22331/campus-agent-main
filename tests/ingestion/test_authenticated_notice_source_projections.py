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
    _build_attachment_title,
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


class _FailingAttachmentOcrClient:
    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        raise RuntimeError(f"provider contract breach for {file_path.name}")


class AuthenticatedNoticeAttachmentTitleTest(unittest.TestCase):
    def test_build_attachment_title_prefers_short_anchor_text_without_parent_title(self) -> None:
        title = _build_attachment_title(
            notice_title="关于2025年度研究生课程建设与教改项目拔尖创新人才“证书项目”学生招募报名的通知",
            attachment_ref={
                "ref_order": 1,
                "anchor_text": "中央民族大学拔尖创新人才培养 “证书项目”报名表",
                "final_url": "https://grs.pku.edu.cn/docs/2024-09/20240902093935948023.docx",
            },
            filename="20240902093935948023.docx",
        )

        self.assertEqual(title, "附件 1 / 中央民族大学拔尖创新人才培养 “证书项目”报名表")

    def test_build_attachment_title_drops_url_and_uuid_like_filename(self) -> None:
        title = _build_attachment_title(
            notice_title="【更新】关于举办2025年北京市大学生人文知识竞赛中央民族大学校内选拔赛的通知",
            attachment_ref={
                "ref_order": 4,
                "final_url": (
                    "https://my.muc.edu.cn/comsys-portal-notice-web/upload/ueditor/202599/"
                    "8be77b50-361d-4386-bfd3-281e34f93a9e.png"
                ),
            },
            filename="8be77b50-361d-4386-bfd3-281e34f93a9e.png",
        )

        self.assertEqual(title, "附件 4")


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


def _build_map_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (360, 280), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 360, 48), fill=(169, 215, 128))
    draw.rectangle((24, 64, 208, 248), fill=(88, 157, 229))
    draw.rectangle((232, 72, 336, 132), fill=(59, 167, 135))
    draw.rectangle((232, 152, 336, 212), fill=(59, 167, 135))
    draw.rectangle((96, 144, 128, 176), fill=(239, 124, 52))
    draw.rectangle((136, 144, 168, 176), fill=(239, 124, 52))
    draw.rectangle((176, 144, 208, 176), fill=(239, 124, 52))
    draw.line((212, 60, 212, 252), fill=(255, 255, 255), width=6)
    draw.line((32, 140, 200, 140), fill=(255, 255, 255), width=6)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_qr_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    module_count = 29
    module_size = 8
    image = Image.new(
        "RGB",
        (module_count * module_size, module_count * module_size),
        "white",
    )
    draw = ImageDraw.Draw(image)

    def fill_module(x: int, y: int, *, color: str = "black") -> None:
        draw.rectangle(
            (
                x * module_size,
                y * module_size,
                (x + 1) * module_size - 1,
                (y + 1) * module_size - 1,
            ),
            fill=color,
        )

    def draw_finder(origin_x: int, origin_y: int) -> None:
        for dx in range(7):
            for dy in range(7):
                border = dx in {0, 6} or dy in {0, 6}
                center = 2 <= dx <= 4 and 2 <= dy <= 4
                if border or center:
                    fill_module(origin_x + dx, origin_y + dy)

    reserved: set[tuple[int, int]] = set()
    for origin in ((0, 0), (module_count - 7, 0), (0, module_count - 7)):
        ox, oy = origin
        draw_finder(ox, oy)
        for dx in range(8):
            for dy in range(8):
                reserved.add((ox + dx, oy + dy))

    for x in range(module_count):
        if (x, 6) not in reserved:
            fill_module(x, 6, color="black" if x % 2 == 0 else "white")
            reserved.add((x, 6))
    for y in range(module_count):
        if (6, y) not in reserved:
            fill_module(6, y, color="black" if y % 2 == 0 else "white")
            reserved.add((6, y))

    for x in range(module_count):
        for y in range(module_count):
            if (x, y) in reserved:
                continue
            if ((x * 17) + (y * 31) + (x * y)) % 5 in {0, 1}:
                fill_module(x, y)

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_ui_fragment_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGBA", (720, 48), (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    for index, label_width in enumerate((96, 88, 104, 92)):
        offset_x = 24 + index * 156
        draw.rectangle(
            (offset_x, 12, offset_x + label_width, 34),
            outline=(120, 120, 120, 255),
            fill=(248, 248, 248, 255),
        )
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_certificate_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (960, 640), (252, 248, 240))
    draw = ImageDraw.Draw(image)
    draw.rectangle((18, 18, 942, 622), outline=(148, 48, 48), width=10)
    draw.rectangle((48, 48, 912, 592), outline=(210, 180, 120), width=4)
    draw.rectangle((112, 162, 848, 206), fill=(240, 240, 240))
    draw.rectangle((188, 270, 772, 294), fill=(225, 225, 225))
    draw.rectangle((220, 334, 740, 356), fill=(225, 225, 225))
    draw.ellipse((720, 448, 856, 584), outline=(180, 48, 48), width=10)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_mobile_screenshot_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (360, 780), (248, 242, 232))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 360, 64), fill=(232, 124, 56))
    draw.rectangle((0, 716, 360, 780), fill=(255, 255, 255))
    draw.rounded_rectangle((24, 104, 336, 180), radius=12, fill=(255, 255, 255))
    draw.rounded_rectangle((24, 204, 336, 420), radius=12, fill=(255, 255, 255))
    draw.rounded_rectangle((24, 448, 336, 616), radius=12, fill=(255, 255, 255))
    draw.rounded_rectangle((32, 636, 172, 688), radius=12, fill=(230, 91, 59))
    draw.rounded_rectangle((188, 636, 328, 688), radius=12, fill=(193, 141, 83))
    for top in (124, 146, 228, 252, 276, 476, 500, 524):
        draw.rectangle((48, top, 280, top + 10), fill=(222, 222, 222))
    draw.rectangle((48, 310, 312, 394), fill=(216, 216, 216))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_compact_mobile_screenshot_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (148, 332), (246, 240, 232))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 148, 34), fill=(232, 124, 56))
    draw.rectangle((0, 298, 148, 332), fill=(255, 255, 255))
    draw.rounded_rectangle((10, 48, 138, 84), radius=6, fill=(255, 255, 255))
    draw.rounded_rectangle((10, 96, 138, 196), radius=8, fill=(255, 255, 255))
    draw.rounded_rectangle((10, 206, 138, 274), radius=8, fill=(255, 255, 255))
    draw.rounded_rectangle((14, 280, 66, 314), radius=6, fill=(228, 92, 58))
    draw.rounded_rectangle((82, 280, 134, 314), radius=6, fill=(196, 144, 83))
    for top in (58, 68, 106, 118, 130, 216, 228, 240):
        draw.rectangle((22, top, 118, top + 4), fill=(220, 220, 220))
    draw.rectangle((22, 146, 126, 186), fill=(214, 214, 214))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_small_program_code_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (132, 132), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    for x in range(0, 132, 8):
        draw.rectangle((x, 0, x + 3, 12), fill=(0, 0, 0))
        draw.rectangle((x, 120, x + 3, 132), fill=(0, 0, 0))
    for y in range(12, 120, 8):
        draw.rectangle((0, y, 12, y + 3), fill=(0, 0, 0))
        draw.rectangle((120, y, 132, y + 3), fill=(0, 0, 0))
    draw.ellipse((34, 34, 98, 98), fill=(214, 48, 44))
    draw.ellipse((48, 48, 84, 84), fill=(255, 255, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_tiny_decorative_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (37, 31), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.polygon(((2, 18), (14, 6), (28, 12), (34, 2), (34, 26), (18, 30)), fill=(255, 128, 92))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_promotional_banner_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (960, 540), (171, 18, 24))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 960, 160), fill=(190, 32, 36))
    draw.rectangle((0, 160, 960, 332), fill=(182, 24, 30))
    draw.rectangle((0, 332, 960, 540), fill=(233, 124, 86))
    draw.rectangle((96, 118, 864, 186), fill=(255, 232, 232))
    draw.rectangle((176, 220, 784, 262), fill=(232, 232, 255))
    for offset in range(8):
        center_x = 92 + offset * 108
        draw.ellipse((center_x, 392, center_x + 48, 440), fill=(236, 222, 194))
        draw.rectangle((center_x + 10, 438, center_x + 38, 502), fill=(62, 66, 102))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_table_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (720, 420), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 712, 412), outline=(32, 32, 32), width=3)
    for y in (72, 192, 312):
        draw.line((8, y, 712, y), fill=(32, 32, 32), width=3)
    for x in (160, 420):
        draw.line((x, 72, x, 412), fill=(32, 32, 32), width=3)
    draw.rectangle((248, 22, 472, 40), fill=(220, 220, 220))
    for top in (112, 138, 232, 258, 352, 378):
        draw.rectangle((194, top, 364, top + 12), fill=(214, 214, 214))
    for top in (112, 138, 164, 232, 258, 284, 352, 378):
        draw.rectangle((466, top, 648, top + 12), fill=(214, 214, 214))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


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


def _sample_notice_bundle_with_inline_image_context(
    *,
    docx_bytes: bytes,
    png_bytes: bytes,
    notice_content: str,
    image_link_text: str = "image.png",
    image_url: str = "https://portal.example.edu/files/notice.png",
) -> list[dict[str, object]]:
    bundle = json.loads(
        json.dumps(
            _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes),
            ensure_ascii=False,
        )
    )
    notice = bundle[0]["notice"]
    assert isinstance(notice, dict)
    notice["notice_content"] = notice_content

    image_link = bundle[0]["links"][1]
    assert isinstance(image_link, dict)
    image_link["link_text"] = image_link_text
    image_link["url"] = image_url
    image_link["final_url"] = image_url

    image_relation = bundle[0]["notice_attachments"][1]
    assert isinstance(image_relation, dict)
    image_relation["anchor_text"] = image_link_text

    image_attachment = bundle[0]["attachments"][1]
    assert isinstance(image_attachment, dict)
    image_attachment["source_url"] = image_url
    image_attachment["normalized_source_url"] = image_url
    image_attachment["final_url"] = image_url
    image_attachment["original_filename"] = Path(image_url).name

    return bundle


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

    def test_rebuild_authenticated_notice_source_projections_rejects_sync_provider_on_replay_path(
        self,
    ) -> None:
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

            with self.assertRaisesRegex(
                ValueError,
                r"OCR_PROVIDER_MODE=paddleocr_async_jobs",
            ):
                rebuild_authenticated_notice_source_projections(
                    request=AuthenticatedNoticeSourceProjectionRequest(
                        corpus="campus_notices",
                        collection="internal_notice",
                    ),
                    env={
                        **_env(),
                        "OCR_BASE_URL": "https://example.com/layout-parsing",
                        "OCR_API_KEY": "test-token",
                        "OCR_PROVIDER_MODE": "paddleocr_vl_service",
                    },
                    object_store=object_store,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                )

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

    def test_rebuild_authenticated_notice_source_projections_routes_spatial_inline_images_to_manual_review(self) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_map_like_png_bytes()
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(report.manual_review_attachment_count, 1)
        self.assertEqual(ocr_client.calls, [])

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
            },
        )

    def test_rebuild_authenticated_notice_source_projections_routes_qr_like_inline_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_qr_like_png_bytes()
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
            },
        )

    def test_rebuild_authenticated_notice_source_projections_routes_ui_fragment_inline_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_ui_fragment_png_bytes()
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
            },
        )

    def test_rebuild_authenticated_notice_source_projections_routes_certificate_example_inline_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_certificate_like_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>城市阶段将评选出优秀选手，并颁发荣誉证书。</p>"
                "<p>（下图为示例证书）</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
            ),
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
                data=png_bytes,
                content_type="image/png",
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_promotional_banner_inline_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_promotional_banner_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>第六届活动再次出发，这场文化盛会，期待你的参加。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>活动具体日程如下。</p>"
            ),
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
                data=png_bytes,
                content_type="image/png",
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_mobile_ui_screenshots_to_reference_only_when_body_already_carries_the_instruction(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_mobile_screenshot_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>请通过官方报名小程序完成作品上传。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>提交后等待审核。</p>"
            ),
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
                data=png_bytes,
                content_type="image/png",
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_compact_mobile_ui_screenshots_to_reference_only_when_body_already_carries_the_instruction(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_compact_mobile_screenshot_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>需通过官方报名小程序完成作品上传。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>提交后等待审核。</p>"
            ),
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
                data=png_bytes,
                content_type="image/png",
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_contextual_small_program_codes_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_small_program_code_like_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>扫描下方二维码下载相关文本。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>请按要求完成提交。</p>"
            ),
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
                data=png_bytes,
                content_type="image/png",
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_tiny_decorative_inline_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_tiny_decorative_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>证书与奖励</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>所有城市阶段优秀选手均可获得证书。</p>"
            ),
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
                data=png_bytes,
                content_type="image/png",
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_intro_poster_inline_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_promotional_banner_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>共同开展第六届“用英语讲中国故事大会”中央民族大学专场活动。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>“用英语讲中国故事大会”活动旨在为青年学生搭建深入理解中华文化、与世界文明对话的桥梁。</p>"
            ),
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
                data=png_bytes,
                content_type="image/png",
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_keeps_scoring_table_inline_images_in_ocr_lane(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_table_like_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>5. 评分标准</p>"
                "<p>本阶段注重考察选手的沟通自信与文化自信，综合评价其语言表达能力，具体维度如下：</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="1769304903305.png" /></p>'
                "<p>评审将围绕发音准确性、语调自然度、用词恰当性、表达逻辑性以及整体表现力等方面进行综合评价。</p>"
            ),
            image_link_text="1769304903305.png",
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
                data=png_bytes,
                content_type="image/png",
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
        self.assertEqual(report.projected_attachment_count, 2)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, ["notice.png"])

    def test_rebuild_authenticated_notice_source_projections_surfaces_attachment_context_when_ocr_fails(self) -> None:
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

            with self.assertRaisesRegex(
                RuntimeError,
                r"notice:muc_internal_portal:355119#attachment-0002 attachment OCR failed: "
                r"provider contract breach for",
            ):
                rebuild_authenticated_notice_source_projections(
                    request=AuthenticatedNoticeSourceProjectionRequest(
                        corpus="campus_notices",
                        collection="internal_notice",
                    ),
                    env=_env(),
                    object_store=object_store,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    ocr_client=_FailingAttachmentOcrClient(),
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
