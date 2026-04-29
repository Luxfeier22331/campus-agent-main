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
    _sample_inline_image_notice_bundle,
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
        self.assertEqual(unit["multimodal_status"], "pending")
        self.assertIn("报名表.docx", unit["search_text"])
        self.assertEqual(object_store.puts, [])

    def test_preview_reports_invalid_runs_and_multimodal_candidates(self) -> None:
        attachment_bytes = b"fake-image"
        object_store = _ReadOnlyObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "runs/inline-image-bundle.json"
        manifest_key = "runs/export-manifest.json"
        bundle = _sample_inline_image_notice_bundle(attachment_bytes=attachment_bytes)
        manifest = _sample_export_manifest()
        object_store.add_json(bucket=bucket, key=bundle_key, payload=bundle)
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
        self.assertEqual(unit["source_notice_id"], "351118")
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
