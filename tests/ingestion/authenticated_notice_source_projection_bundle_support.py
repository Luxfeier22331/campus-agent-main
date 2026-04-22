from __future__ import annotations

from .authenticated_notice_source_projection_base_support import *  # noqa: F401,F403
from .authenticated_notice_source_projection_image_fixture_support import *  # noqa: F401,F403


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


def _sample_notice_bundle_with_downloaded_pdf_attachment(
    *,
    docx_bytes: bytes,
    png_bytes: bytes,
    pdf_bytes: bytes,
) -> list[dict[str, object]]:
    bundle = json.loads(
        json.dumps(
            _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes),
            ensure_ascii=False,
        )
    )
    pdf_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    pdf_key = _attachment_object_key(pdf_sha256, "supplement.pdf")

    link = bundle[0]["links"][2]
    assert isinstance(link, dict)
    link["collect_policy"] = "fetch"
    link["status_code"] = 200
    link["downloaded"] = True
    link["file_size"] = len(pdf_bytes)

    attachment = bundle[0]["attachments"][2]
    assert isinstance(attachment, dict)
    attachment["byte_size"] = len(pdf_bytes)
    attachment["sha256"] = pdf_sha256
    attachment["storage_provider"] = "local"
    attachment["object_key"] = pdf_key
    attachment["provenance_status"] = "collected_internal"
    attachment["ingest_status"] = "downloaded"
    attachment["downloaded_at"] = "2026-04-02T23:58:26.053Z"

    return bundle


def _sample_notice_bundle_pair_with_shared_downloaded_pdf_attachment(
    *,
    pdf_bytes: bytes,
) -> list[dict[str, object]]:
    first = _sample_notice_bundle_with_downloaded_pdf_attachment(
        docx_bytes=_build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段")),
        png_bytes=_build_minimal_png_bytes(),
        pdf_bytes=pdf_bytes,
    )[0]
    second = json.loads(json.dumps(first, ensure_ascii=False))

    second["notice_id"] = 355120
    second_notice = second["notice"]
    assert isinstance(second_notice, dict)
    second_notice["notice_id"] = 355120
    second_notice["notice_title"] = "关于第二批材料提交通知"
    second_notice["notice_link"] = "https://portal.example.edu/notice/355120"
    second_notice["notice_content"] = (
        "<h1>关于第二批材料提交通知</h1><p>请按要求提交。</p><p>附件1：共享手册.pdf</p>"
    )
    second_notice["categories"] = [
        {
            "notice_id": 355120,
            "notice_type": "6",
            "notice_type_name": "教学通知",
            "category_first_seen_at": "2026-04-02T18:49:00.000Z",
            "category_last_seen_at": "2026-04-02T18:49:00.000Z",
            "category_last_run_id": 14,
        }
    ]

    second["links"] = [json.loads(json.dumps(first["links"][2], ensure_ascii=False))]
    second_link = second["links"][0]
    assert isinstance(second_link, dict)
    second_link["id"] = 44
    second_link["notice_id"] = 355120
    second_link["url"] = "https://portal.example.edu/files/supplement.pdf"
    second_link["final_url"] = "https://portal.example.edu/files/supplement.pdf"
    second_link["link_text"] = "补充材料.pdf"

    second["notice_attachments"] = [
        {
            "notice_id": 355120,
            "attachment_id": 1,
            "link_id": 44,
            "relation_source": "content",
            "resource_role": "attachment",
            "anchor_text": "补充材料.pdf",
            "discovered_at": "2026-04-02T23:58:26.053Z",
        }
    ]

    second["attachments"] = [json.loads(json.dumps(first["attachments"][2], ensure_ascii=False))]
    second_attachment = second["attachments"][0]
    assert isinstance(second_attachment, dict)
    second_attachment["attachment_id"] = 1
    second_attachment["source_url"] = "https://portal.example.edu/files/supplement.pdf"
    second_attachment["normalized_source_url"] = "https://portal.example.edu/files/supplement.pdf"
    second_attachment["final_url"] = "https://portal.example.edu/files/supplement.pdf"
    second_attachment["original_filename"] = "supplement.pdf"
    second_attachment["object_key"] = _attachment_object_key(
        hashlib.sha256(pdf_bytes).hexdigest(), "supplement.pdf"
    )

    return [first, second]


def _sample_notice_bundle_with_downloaded_spreadsheet_attachment(
    *,
    spreadsheet_bytes: bytes,
    filename: str,
    mime_type: str,
) -> list[dict[str, object]]:
    bundle = json.loads(
        json.dumps(
            _sample_notice_bundle(
                docx_bytes=_build_minimal_docx_bytes(
                    paragraphs=("报名表正文第一段", "报名表正文第二段")
                ),
                png_bytes=_build_minimal_png_bytes(),
            ),
            ensure_ascii=False,
        )
    )
    spreadsheet_sha256 = hashlib.sha256(spreadsheet_bytes).hexdigest()
    spreadsheet_key = _attachment_object_key(spreadsheet_sha256, filename)
    spreadsheet_url = f"https://portal.example.edu/files/{filename}"

    notice = bundle[0]["notice"]
    assert isinstance(notice, dict)
    notice["notice_content"] = (
        "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
        "<p>请同学们于4月10日前完成报名。</p>"
        f"<p>附件1：{filename}</p>"
        "<p>附件2：通知配图.png</p>"
        "<p>附件3：补充材料.pdf</p>"
    )

    link = bundle[0]["links"][0]
    assert isinstance(link, dict)
    link["url"] = spreadsheet_url
    link["final_url"] = spreadsheet_url
    link["link_text"] = filename
    link["content_type"] = mime_type
    link["file_size"] = len(spreadsheet_bytes)

    notice_attachment = bundle[0]["notice_attachments"][0]
    assert isinstance(notice_attachment, dict)
    notice_attachment["anchor_text"] = filename

    attachment = bundle[0]["attachments"][0]
    assert isinstance(attachment, dict)
    attachment["source_url"] = spreadsheet_url
    attachment["normalized_source_url"] = spreadsheet_url
    attachment["final_url"] = spreadsheet_url
    attachment["original_filename"] = filename
    attachment["mime_type"] = mime_type
    attachment["byte_size"] = len(spreadsheet_bytes)
    attachment["sha256"] = spreadsheet_sha256
    attachment["object_key"] = spreadsheet_key
    attachment["provenance_status"] = "collected_internal"
    attachment["ingest_status"] = "downloaded"
    attachment["downloaded_at"] = "2026-04-02T23:58:26.053Z"

    return bundle


__all__ = [name for name in globals() if not name.startswith("__")]
