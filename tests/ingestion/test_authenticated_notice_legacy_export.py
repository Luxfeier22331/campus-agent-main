from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_legacy_export import (
    AUTHENTICATED_NOTICE_LEGACY_EXPORT_CONTRACT_VERSION,
    AUTHENTICATED_NOTICE_LEGACY_NORMALIZED_SCHEMA,
    build_notice_type_policy_snapshot_from_legacy_config,
    load_authenticated_notice_selection_notice_ids,
    normalize_authenticated_notice_legacy_export,
)


def _sample_bundle() -> list[dict[str, object]]:
    return [
        {
            "notice_id": 355282,
            "notice": {
                "notice_id": 355282,
                "notice_title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                "notice_content": "<p>指导意见正文</p>",
                "categories": [
                    {
                        "notice_type": "6",
                        "notice_type_name": "教学通知",
                    }
                ],
            },
            "links": [],
            "notice_attachments": [],
            "attachments": [],
        },
        {
            "notice_id": 351119,
            "notice": {
                "notice_id": 351119,
                "notice_title": "关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知",
                "notice_content": "<p>管理办法正文</p>",
                "categories": [
                    {
                        "notice_type": "5",
                        "notice_type_name": "办公通知",
                    }
                ],
            },
            "links": [],
            "notice_attachments": [],
            "attachments": [],
        },
    ]


def _sample_manifest() -> dict[str, object]:
    return {
        "schema_version": "v3",
        "exported_at": "2026-04-02T23:59:19.838Z",
        "export_date": "20260403",
        "export_scope": "run-14",
        "filters": {"run_id": 14},
        "run": {
            "id": 14,
            "mode": "backfill",
            "status": "success",
            "started_at": "2026-04-02T23:50:17.023Z",
            "finished_at": "2026-04-02T23:57:57.563Z",
            "pages_fetched": 337,
            "items_seen": 6694,
            "items_inserted": 6454,
            "errors": 0,
        },
        "counts": {"notices": 6694},
    }


class AuthenticatedNoticeLegacyExportNormalizationTest(unittest.TestCase):
    def test_normalize_legacy_export_filters_selected_notice_ids_and_builds_typed_manifest(
        self,
    ) -> None:
        notice_type_policy = build_notice_type_policy_snapshot_from_legacy_config(
            [
                {
                    "type": "5",
                    "name": "办公通知",
                    "enabled": True,
                    "incrementalPages": 3,
                    "incrementalPageSize": 20,
                    "backfillPages": 108,
                    "backfillPageSize": 20,
                },
                {
                    "type": "6",
                    "name": "教学通知",
                    "enabled": True,
                    "incrementalPages": 3,
                    "incrementalPageSize": 20,
                    "backfillPages": 120,
                    "backfillPageSize": 20,
                },
            ]
        )
        result = normalize_authenticated_notice_legacy_export(
            bundle_records=_sample_bundle(),
            legacy_manifest=_sample_manifest(),
            site_id="muc_internal_portal",
            source_home_url="https://my.muc.edu.cn",
            selected_notice_ids=("355282",),
            notice_type_policy=notice_type_policy,
            export_scope="run14-policy-regulation-core",
            exported_at="2026-04-09T10:00:00+00:00",
        )

        self.assertEqual(result.selected_notice_ids, ("355282",))
        self.assertEqual(result.missing_notice_ids, ())
        self.assertEqual(len(result.bundle_records), 1)
        self.assertEqual(
            result.bundle_records[0]["notice"]["notice_title"],
            "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
        )

        manifest = result.normalized_manifest
        self.assertEqual(
            manifest["schema_version"],
            AUTHENTICATED_NOTICE_LEGACY_NORMALIZED_SCHEMA,
        )
        self.assertEqual(manifest["source_channel"], "authenticated_notice_portal")
        self.assertEqual(manifest["site_id"], "muc_internal_portal")
        self.assertEqual(
            manifest["collector"]["export_contract_version"],
            AUTHENTICATED_NOTICE_LEGACY_EXPORT_CONTRACT_VERSION,
        )
        self.assertEqual(manifest["filters"]["notice_types"], ["6"])
        self.assertEqual(manifest["filters"]["selected_notice_ids"], ["355282"])
        self.assertEqual(len(manifest["notice_type_policy"]), 1)
        self.assertEqual(manifest["run"]["items_inserted"], 1)
        self.assertEqual(manifest["legacy_source"]["schema_version"], "v3")

    def test_normalize_legacy_export_requires_source_manifest(self) -> None:
        with self.assertRaisesRegex(ValueError, "legacy authenticated notice manifest is required"):
            normalize_authenticated_notice_legacy_export(
                bundle_records=_sample_bundle(),
                legacy_manifest={},
                site_id="muc_internal_portal",
                source_home_url="https://my.muc.edu.cn",
            )

    def test_load_selected_notice_ids_from_json_batch_file(self) -> None:
        with TemporaryDirectory() as temp_dir:
            batch_path = Path(temp_dir) / "batch.json"
            batch_path.write_text(
                json.dumps(
                    {
                        "selected_notice_ids": ["355282", "351119"],
                        "notices": [
                            {"notice_id": "ignored"},
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            selected = load_authenticated_notice_selection_notice_ids(batch_path)

        self.assertEqual(selected, ("355282", "351119"))
