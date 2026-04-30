from __future__ import annotations

import hashlib
import json
import unittest

from campus_ingestion_core.collected_notice_reimport_preview import (
    CollectedNoticeCapturedRunRef,
    build_collected_notice_reimport_preview,
    select_collected_notice_reimport_run_refs,
)

from tests.ingestion.authenticated_notice_import_test_support import (
    _sample_export_manifest,
    _sample_notice_bundle,
)


class _ReadOnlyObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.gets: list[tuple[str, str]] = []
        self.puts: list[tuple[str, str]] = []

    def add_json(self, *, bucket: str, key: str, payload: object) -> None:
        self.objects[(bucket, key)] = (
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        ).encode("utf-8")

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.gets.append((bucket, key))
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.puts.append((bucket, key))
        raise AssertionError("preview must not write object-store bytes")


def _notice_bundle_record(
    *,
    notice_id: int,
    title: str,
    body_html: str,
    notice_type_name: str = "通知公告",
) -> dict[str, object]:
    return {
        "notice_id": notice_id,
        "notice": {
            "notice_id": notice_id,
            "notice_title": title,
            "organization_name": "测试部门",
            "organization_id": "00001",
            "notice_release_time": "2026-04-29 09:00",
            "notice_create_time": "2026-04-29 08:50",
            "notice_first_time": "2026-04-29 08:50",
            "notice_content": body_html,
            "notice_link": f"https://portal.example.edu/notice/{notice_id}",
            "notice_source": 1,
            "notice_link_state": 0,
            "notice_state": 1,
            "notice_stick": 0,
            "categories": [
                {
                    "notice_id": notice_id,
                    "notice_type": "1",
                    "notice_type_name": notice_type_name,
                    "category_first_seen_at": "2026-04-29T09:00:00.000Z",
                    "category_last_seen_at": "2026-04-29T09:00:00.000Z",
                    "category_last_run_id": 1,
                }
            ],
        },
        "links": [],
        "notice_attachments": [],
        "attachments": [],
    }


def _transport_schedule_image_bundle_without_body_times() -> list[dict[str, object]]:
    notice_id = 355867
    image_urls = (
        "http://my.muc.edu.cn/upload/ueditor/2026425/first-day.png",
        "http://my.muc.edu.cn/upload/ueditor/2026425/bus-schedule.png",
        "http://my.muc.edu.cn/upload/ueditor/2026425/shuttle-schedule.png",
    )
    body_html = (
        "<p>根据学校近期相关安排，现将4月27日-5月5日期间两校区班车及地铁接驳车运营安排通知如下：</p>"
        "<p>一、4月27日两校区班车安排</p>"
        f'<p><img src="{image_urls[0]}" title="" alt="image.png"/></p>'
        "<p>二、4月28日-5月5日两校区班车及地铁接驳车安排</p>"
        "<p>（一）两校区班车</p>"
        f'<p><img src="{image_urls[1]}" title="" alt="image.png"/></p>'
        "<p>（二）地铁接驳车</p>"
        f'<p><img src="{image_urls[2]}" title="" alt="image.png"/></p>'
    )
    links = []
    notice_attachments = []
    attachments = []
    for index, url in enumerate(image_urls, start=1):
        content = f"fake-image-{index}".encode()
        digest = hashlib.sha256(content).hexdigest()
        filename = url.rsplit("/", 1)[-1]
        links.append(
            {
                "id": index,
                "notice_id": notice_id,
                "run_id": 14,
                "source": "content",
                "content_kind": "inline_image",
                "url": url,
                "url_scheme": "http",
                "link_host": "my.muc.edu.cn",
                "link_scope": "internal",
                "collect_policy": "reference_only",
                "skip_reason": None,
                "link_text": "image.png",
                "final_url": url,
                "title": None,
                "status_code": 200,
                "content_type": "image/png",
                "downloaded": True,
                "download_path": None,
                "file_size": len(content),
                "fetched_at": "2026-04-28T18:19:53.007Z",
                "error_message": None,
            }
        )
        notice_attachments.append(
            {
                "notice_id": notice_id,
                "attachment_id": index,
                "link_id": index,
                "relation_source": "content",
                "resource_role": "inline_image",
                "anchor_text": "image.png",
                "discovered_at": "2026-04-28T18:19:53.007Z",
            }
        )
        attachments.append(
            {
                "attachment_id": index,
                "source_url": url,
                "normalized_source_url": url,
                "final_url": url,
                "original_filename": filename,
                "mime_type": "image/png",
                "byte_size": len(content),
                "sha256": digest,
                "storage_provider": "object_store",
                "bucket": "campus-rag-source",
                "object_key": f"authenticated_notice_portal/attachment-{index}/capture/{filename}",
                "etag": f"fake-etag-{index}",
                "version_id": None,
                "origin_url_scheme": "http",
                "origin_host": "my.muc.edu.cn",
                "origin_scope": "internal",
                "provenance_status": "collected_internal",
                "ingest_status": "uploaded",
                "local_path": None,
                "downloaded_at": "2026-04-28T18:19:53.007Z",
                "uploaded_at": "2026-04-28T18:19:53.007Z",
                "last_error": None,
                "created_at": "2026-04-28T18:19:53.007Z",
                "updated_at": "2026-04-28T18:19:53.007Z",
            }
        )
    return [
        {
            "notice_id": notice_id,
            "notice": {
                "notice_id": notice_id,
                "notice_title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                "organization_name": "丰台校区管理委员会",
                "organization_id": "00054",
                "notice_release_time": "2026-04-25 13:11",
                "notice_create_time": "2026-04-25 11:17",
                "notice_first_time": "2026-04-25 13:11",
                "notice_content": body_html,
                "notice_link": None,
                "notice_source": 0,
                "notice_link_state": 0,
                "notice_state": 1,
                "notice_stick": 0,
                "categories": [
                    {
                        "notice_id": notice_id,
                        "notice_type": "5",
                        "notice_type_name": "办公通知",
                        "category_first_seen_at": "2026-04-28T18:19:53.007Z",
                        "category_last_seen_at": "2026-04-28T18:19:53.007Z",
                        "category_last_run_id": 14,
                    }
                ],
            },
            "links": links,
            "notice_attachments": notice_attachments,
            "attachments": attachments,
        }
    ]


class CollectedNoticeReimportPreviewTests(unittest.TestCase):
    def test_preview_builds_searchable_unit_for_valid_notice_without_writes(self) -> None:
        object_store = _ReadOnlyObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "runs/notices-bundle.json"
        manifest_key = "runs/export-manifest.json"
        bundle = _sample_notice_bundle()
        manifest = _sample_export_manifest()
        object_store.add_json(bucket=bucket, key=bundle_key, payload=bundle)
        object_store.add_json(bucket=bucket, key=manifest_key, payload=manifest)

        preview = build_collected_notice_reimport_preview(
            run_refs=(
                CollectedNoticeCapturedRunRef(
                    run_id="muc_internal_portal:notice:test",
                    source_surface="notice",
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://my.muc.edu.cn",
                    notices_collected=1,
                ),
            ),
            env={},
            object_store=object_store,
        )

        self.assertFalse(preview.reimport_plan["write_enabled"])
        self.assertEqual(preview.reimport_plan["mode"], "dry_run")
        self.assertEqual(preview.coverage_report["verdict"], "passed")
        self.assertEqual(preview.coverage_report["missing_searchable_unit_count"], 0)
        self.assertEqual(preview.source_truth_preview["candidate_count"], 1)
        self.assertEqual(preview.searchable_notice_preview["unit_count"], 1)
        unit = preview.searchable_notice_preview["units"][0]
        self.assertEqual(unit["schema_version"], "collected_notice_searchable_unit.v1")
        self.assertEqual(unit["source_notice_id"], "355119")
        self.assertEqual(
            unit["title"],
            "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知",
        )
        self.assertEqual(unit["published_at"], "2026-04-02 18:49")
        self.assertEqual(unit["source_url"], "https://portal.example.edu/notice/355119")
        self.assertIn("请同学们于4月10日前完成报名。", unit["body_text"])
        self.assertGreaterEqual(len(unit["source_object_refs"]), 2)
        self.assertEqual(unit["multimodal_status"], "not_required")
        self.assertIn("报名表.docx", unit["search_text"])
        self.assertEqual(object_store.puts, [])

    def test_preview_does_not_repair_empty_notice_discover_only_attachment_body(
        self,
    ) -> None:
        object_store = _ReadOnlyObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "runs/empty-form-notice.json"
        manifest_key = "runs/export-manifest.json"
        bundle = _sample_notice_bundle()
        bundle[0]["notice"]["notice_content"] = ""
        bundle[0]["notice"]["notice_title"] = "中央民族大学学生证补办申请表"
        object_store.add_json(bucket=bucket, key=bundle_key, payload=bundle)
        object_store.add_json(bucket=bucket, key=manifest_key, payload=_sample_export_manifest())

        preview = build_collected_notice_reimport_preview(
            run_refs=(
                CollectedNoticeCapturedRunRef(
                    run_id="muc_internal_portal:notice:empty-form",
                    source_surface="notice",
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://my.muc.edu.cn",
                    notices_collected=1,
                ),
            ),
            env={},
            object_store=object_store,
        )

        unit = preview.searchable_notice_preview["units"][0]
        self.assertEqual(unit["classification"]["primary_route"], "notice_level_query")
        self.assertEqual(unit["classification"]["target_candidates"], [])
        self.assertEqual(unit["multimodal_status"], "not_required")
        self.assertEqual(
            preview.invalid_defer_multimodal_report["needs_multimodal_count"],
            0,
        )

    def test_preview_applies_notice_first_source_retention_to_notice_level_query_attachments(
        self,
    ) -> None:
        object_store = _ReadOnlyObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "runs/notices-bundle.json"
        manifest_key = "runs/export-manifest.json"
        object_store.add_json(bucket=bucket, key=bundle_key, payload=_sample_notice_bundle())
        object_store.add_json(bucket=bucket, key=manifest_key, payload=_sample_export_manifest())

        preview = build_collected_notice_reimport_preview(
            run_refs=(
                CollectedNoticeCapturedRunRef(
                    run_id="muc_internal_portal:notice:retention",
                    source_surface="notice",
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://my.muc.edu.cn",
                    notices_collected=1,
                ),
            ),
            env={},
            object_store=object_store,
        )

        unit = preview.searchable_notice_preview["units"][0]
        self.assertEqual(unit["classification"]["primary_route"], "notice_level_query")
        self.assertEqual(
            unit["source_retention"]["notice_capture_route"],
            "notice_level_query_only",
        )
        self.assertEqual(
            unit["source_retention"]["attachment_capture_policy_counts"],
            {"metadata_only": 1},
        )
        self.assertEqual(unit["multimodal_status"], "not_required")
        attachment = unit["attachment_refs"][0]
        self.assertEqual(attachment["attachment_capture_policy"], "metadata_only")
        self.assertEqual(attachment["attachment_capture_state"], "metadata_recorded")
        self.assertEqual(attachment["retention_class"], "metadata_only")
        self.assertFalse(attachment["byte_fetch_required"])
        self.assertFalse(attachment["required_source_object"])
        self.assertNotIn(
            "application.docx",
            "\n".join(str(ref.get("key") or "") for ref in unit["source_object_refs"]),
        )

    def test_preview_marks_transport_schedule_images_fetch_to_quarantine_when_body_lacks_times(
        self,
    ) -> None:
        object_store = _ReadOnlyObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "runs/transport-schedule-images.json"
        manifest_key = "runs/export-manifest.json"
        object_store.add_json(
            bucket=bucket,
            key=bundle_key,
            payload=_transport_schedule_image_bundle_without_body_times(),
        )
        object_store.add_json(bucket=bucket, key=manifest_key, payload=_sample_export_manifest())

        preview = build_collected_notice_reimport_preview(
            run_refs=(
                CollectedNoticeCapturedRunRef(
                    run_id="muc_internal_portal:notice:transport-schedule",
                    source_surface="notice",
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://my.muc.edu.cn",
                    notices_collected=1,
                ),
            ),
            env={},
            object_store=object_store,
        )

        unit = preview.searchable_notice_preview["units"][0]
        self.assertEqual(unit["classification"]["primary_route"], "service_status_candidate")
        self.assertEqual(unit["classification"]["target_candidates"], ["transport_schedule"])
        self.assertEqual(
            unit["source_retention"]["notice_capture_route"],
            "candidate_service_fact",
        )
        self.assertEqual(
            unit["source_retention"]["attachment_capture_policy_counts"],
            {"fetch_to_quarantine": 3},
        )
        self.assertEqual(unit["source_retention"]["quarantine_attachment_ref_count"], 3)
        self.assertEqual(unit["multimodal_status"], "pending")
        for attachment in unit["attachment_refs"]:
            with self.subTest(attachment_ref_id=attachment["attachment_ref_id"]):
                self.assertEqual(
                    attachment["attachment_capture_policy"],
                    "fetch_to_quarantine",
                )
                self.assertEqual(attachment["attachment_capture_state"], "uploaded_quarantine")
                self.assertEqual(attachment["retention_class"], "quarantine_candidate")
                self.assertFalse(attachment["byte_fetch_required"])
                self.assertFalse(attachment["required_source_object"])
                self.assertEqual(
                    attachment["byte_fetch_required_reason"],
                    "service_fact_missing_required_fact",
                )

    def test_preview_reports_invalid_runs_and_multimodal_candidates(self) -> None:
        object_store = _ReadOnlyObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "runs/transport-schedule-images.json"
        manifest_key = "runs/export-manifest.json"
        manifest = _sample_export_manifest()
        object_store.add_json(
            bucket=bucket,
            key=bundle_key,
            payload=_transport_schedule_image_bundle_without_body_times(),
        )
        object_store.add_json(bucket=bucket, key=manifest_key, payload=manifest)

        selected, rejected = select_collected_notice_reimport_run_refs(
            {
                "runs": [
                    {
                        "run_id": "muc_internal_portal:notice:valid",
                        "source_surface": "notice",
                        "status": "success",
                        "verification_status": "verified",
                        "source_bucket": bucket,
                        "bundle_object_key": bundle_key,
                        "manifest_object_key": manifest_key,
                        "site_id": "muc_internal_portal",
                        "source_home_url": "https://my.muc.edu.cn",
                        "notices_collected": 1,
                    },
                    {
                        "run_id": "muc_internal_portal:notice:invalid",
                        "source_surface": "notice",
                        "status": "failed",
                        "verification_status": "missing_required_objects",
                        "failure_reason": "auth_expired",
                    },
                ]
            },
            source_surfaces=("notice",),
        )

        preview = build_collected_notice_reimport_preview(
            run_refs=selected,
            rejected_run_refs=rejected,
            env={},
            object_store=object_store,
        )

        self.assertEqual(preview.invalid_defer_multimodal_report["invalid_capture_count"], 1)
        self.assertEqual(preview.invalid_defer_multimodal_report["needs_multimodal_count"], 1)
        unit = preview.searchable_notice_preview["units"][0]
        self.assertEqual(unit["source_notice_id"], "355867")
        self.assertEqual(unit["multimodal_status"], "pending")
        self.assertIn("image_attachment_pending_text_extraction", unit["reason_codes"])

    def test_preview_dedupes_repeated_source_identity_across_runs(self) -> None:
        object_store = _ReadOnlyObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "runs/notices-bundle.json"
        manifest_key = "runs/export-manifest.json"
        object_store.add_json(bucket=bucket, key=bundle_key, payload=_sample_notice_bundle())
        object_store.add_json(bucket=bucket, key=manifest_key, payload=_sample_export_manifest())

        preview = build_collected_notice_reimport_preview(
            run_refs=(
                CollectedNoticeCapturedRunRef(
                    run_id="muc_internal_portal:notice:20260428T181953007Z",
                    source_surface="notice",
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://my.muc.edu.cn",
                ),
                CollectedNoticeCapturedRunRef(
                    run_id="muc_internal_portal:notice:20260428T181954007Z",
                    source_surface="notice",
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://my.muc.edu.cn",
                ),
            ),
            env={},
            object_store=object_store,
        )

        self.assertEqual(preview.searchable_notice_preview["unit_count"], 1)
        self.assertEqual(
            preview.reimport_plan["counts"]["duplicate_source_identity_skipped_count"],
            1,
        )
        self.assertEqual(
            preview.reimport_plan["planned_skips"][0]["reason_codes"],
            ["duplicate_source_identity"],
        )

    def test_select_run_refs_keeps_verified_surfaces_and_checksum_metadata(self) -> None:
        bundle_bytes = b"[]\n"
        manifest_bytes = b"{}\n"
        selected, rejected = select_collected_notice_reimport_run_refs(
            {
                "runs": [
                    {
                        "run_id": "run-1",
                        "source_surface": "notice",
                        "status": "success",
                        "verification_status": "verified",
                        "source_bucket": "campus-rag-source",
                        "bundle_object_key": "bundle.json",
                        "manifest_object_key": "manifest.json",
                        "bundle_content_sha256": hashlib.sha256(bundle_bytes).hexdigest(),
                        "bundle_byte_size": len(bundle_bytes),
                        "manifest_content_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
                        "manifest_byte_size": len(manifest_bytes),
                    },
                    {
                        "run_id": "run-2",
                        "source_surface": "wechat_public_notice",
                        "status": "success",
                        "verification_status": "verified",
                    },
                ]
            },
            source_surfaces=("notice", "file_release"),
        )

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0].run_id, "run-1")
        self.assertEqual(selected[0].bundle_byte_size, len(bundle_bytes))
        self.assertEqual(rejected[0]["reason_codes"], ["unsupported_source_surface"])

    def test_preview_uses_notice_family_classification_instead_of_keyword_targets(self) -> None:
        object_store = _ReadOnlyObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "runs/classification-bundle.json"
        manifest_key = "runs/export-manifest.json"
        object_store.add_json(
            bucket=bucket,
            key=bundle_key,
            payload=[
                _notice_bundle_record(
                    notice_id=354925,
                    title="关于办理2025年度个人所得税综合所得年度汇算的通知",
                    body_html=(
                        "<p>根据《个人所得税综合所得汇算清缴管理办法》有关要求，"
                        "请师生按期办理。</p>"
                    ),
                ),
                _notice_bundle_record(
                    notice_id=355005,
                    title="关于举办2026年中央民族大学“石榴籽杯”体育舞蹈比赛通知",
                    body_html="<p>比赛办法、报名办法和赛程安排详见通知正文。</p>",
                ),
                _notice_bundle_record(
                    notice_id=355283,
                    title="校医院五一假期门诊服务时间调整的通知",
                    body_html="<p>五一假期门诊服务时间调整为上午8:30至11:30。</p>",
                ),
            ],
        )
        object_store.add_json(bucket=bucket, key=manifest_key, payload=_sample_export_manifest())

        preview = build_collected_notice_reimport_preview(
            run_refs=(
                CollectedNoticeCapturedRunRef(
                    run_id="muc_internal_portal:notice:classification",
                    source_surface="notice",
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://my.muc.edu.cn",
                    notices_collected=3,
                ),
            ),
            env={},
            object_store=object_store,
        )

        units = {
            unit["source_notice_id"]: unit for unit in preview.searchable_notice_preview["units"]
        }
        self.assertEqual(
            units["354925"]["classification"]["notice_family"],
            "operational_procedure",
        )
        self.assertEqual(
            units["354925"]["classification"]["primary_route"],
            "notice_level_query",
        )
        self.assertEqual(units["354925"]["target_hints"]["candidate_targets"], [])

        self.assertEqual(
            units["355005"]["classification"]["notice_family"],
            "competition_event",
        )
        self.assertEqual(units["355005"]["classification"]["primary_route"], "notice_level_query")
        self.assertEqual(units["355005"]["target_hints"]["candidate_targets"], [])

        self.assertEqual(
            units["355283"]["classification"]["notice_family"],
            "service_status_override",
        )
        self.assertEqual(
            units["355283"]["classification"]["primary_route"],
            "service_status_candidate",
        )
        self.assertEqual(units["355283"]["target_hints"]["candidate_targets"], ["service_status"])


if __name__ == "__main__":
    unittest.main()
