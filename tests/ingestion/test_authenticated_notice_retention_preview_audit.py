from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_policy import (
    resolve_authenticated_notice_routing_decision,
)

_ROOT = Path(__file__).resolve().parents[2]
_PREVIEW_PATH = (
    _ROOT
    / ".planning/workstreams/collected-notice-consumption-replay-closeout/evidence"
    / "phase-04-dry-run-reimport-and-universal-search-preview/searchable-notice-preview.json"
)


class AuthenticatedNoticeRetentionPreviewAuditTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_authenticated_notice_notice_family_config(
            _ROOT
            / "configs/ingestion/campus_notices/internal_notice"
            / "notice-family-classification.v1.json"
        )

    def test_old_process_no_target_preview_units_now_keep_metadata_only(
        self,
    ) -> None:
        if not _PREVIEW_PATH.exists():
            self.skipTest("searchable notice preview evidence is not present")

        payload = json.loads(_PREVIEW_PATH.read_text(encoding="utf-8"))
        units = tuple(
            unit
            for unit in payload["units"]
            if unit["source_surface"] == "notice"
            and unit["classification"]["attachment_processing_policy"] == "process"
            and not unit["classification"]["target_candidates"]
        )

        self.assertEqual(len(units), 83)

        policy_counts: Counter[str] = Counter()
        process_notice_ids: list[str] = []
        for unit in units:
            decision = resolve_authenticated_notice_routing_decision(
                config=self.config,
                family=unit["classification"]["notice_family"],
                admission_policy=unit["classification"]["admission_policy"],
                title=unit["title"],
                body=unit["body_text"],
                attachment_counts={
                    "attachment_ref_count": len(unit["attachment_refs"]),
                    "attachment_document_count": 0,
                    "text_extractable_count": 0,
                    "ocr_required_count": 0,
                    "reference_only_count": 0,
                    "multimodal_processing_required_count": 0,
                },
            )
            policy_counts[decision.attachment_processing_policy] += 1
            if decision.attachment_processing_policy == "process":
                process_notice_ids.append(unit["source_notice_id"])

        self.assertEqual(process_notice_ids, [])
        self.assertEqual(dict(sorted(policy_counts.items())), {"metadata_only": 83})


if __name__ == "__main__":
    unittest.main()
