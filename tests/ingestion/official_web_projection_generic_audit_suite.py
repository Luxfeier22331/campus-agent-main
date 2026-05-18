from __future__ import annotations

import unittest

from .official_web_projection_test_support import *


class OfficialWebProjectionGenericAuditTest(unittest.TestCase):
    def test_replay_official_web_source_truth_local_marks_emitted_generic_pages_audit_only(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_generic_org_001",
                            raw_version_id="owver_generic_org_001",
                            normalized_canonical_url="https://xiaoyou.example.edu/jjh/zzjg.htm",
                            page_family="generic_content_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xiaoyou.example.edu",
                raw_asset_id="owasset_generic_org_001",
                raw_version_id="owver_generic_org_001",
                normalized_canonical_url="https://xiaoyou.example.edu/jjh/zzjg.htm",
                page_title="组织机构",
                page_family="generic_content_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_generic_org_001",
                        raw_version_id="owver_generic_org_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="组织机构",
                    ),
                    _block(
                        raw_asset_id="owasset_generic_org_001",
                        raw_version_id="owver_generic_org_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="组织机构\n理事长：姚佳琳\n秘书长：白勇",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(report.counts["emitted_documents"], 1)
        self.assertEqual(report.documents[0]["page_family"], "generic_content_page")
        self.assertEqual(report.documents[0]["serving_intent"], "audit_only")
        self.assertEqual(
            report.documents[0]["promotion_block_reason"],
            "generic_content_page_audit_only",
        )
        self.assertEqual(units[0]["metadata"]["serving_intent"], "audit_only")
        self.assertEqual(
            units[0]["metadata"]["promotion_block_reason"],
            "generic_content_page_audit_only",
        )


if __name__ == "__main__":
    unittest.main()
