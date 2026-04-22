from __future__ import annotations

import unittest
from types import SimpleNamespace

from campus_ingestion_core.collection_runtime_audit import (
    summarize_qdrant_family,
    summarize_release_family,
)


class CollectionRuntimeAuditTest(unittest.TestCase):
    def test_summarize_release_family_counts_release_manifests_under_the_prefix(self) -> None:
        summary = summarize_release_family(
            collection="student_rules",
            corpus="regulations",
            keys=(
                "regulations/releases/student_rules/r20260419_031500/index-release.json",
                "regulations/releases/student_rules/r20260419_031500/validation-summary.json",
                "regulations/releases/student_rules/r20260420_031500/index-release.json",
                "regulations/releases/student_handbook/r20260331_210128/index-release.json",
            ),
        )

        self.assertEqual(summary.collection, "student_rules")
        self.assertEqual(summary.manifest_count, 2)
        self.assertEqual(
            summary.release_ids,
            ("r20260419_031500", "r20260420_031500"),
        )

    def test_summarize_qdrant_family_reports_alias_target_and_prefixed_collections(self) -> None:
        summary = summarize_qdrant_family(
            alias_name="institutional_rules",
            aliases=(
                SimpleNamespace(
                    alias_name="institutional_rules",
                    collection_name="institutional_rules__r20260422_101500",
                ),
                SimpleNamespace(alias_name="student_rules", collection_name="student_rules__r1"),
            ),
            collection_names=(
                "institutional_rules__r20260422_101500",
                "institutional_rules__r20260420_090000",
                "student_rules__r20260419_031500",
            ),
            collection_prefix="institutional_rules",
        )

        self.assertEqual(summary.alias_name, "institutional_rules")
        self.assertEqual(
            summary.alias_target,
            "institutional_rules__r20260422_101500",
        )
        self.assertEqual(
            summary.physical_collections,
            (
                "institutional_rules__r20260420_090000",
                "institutional_rules__r20260422_101500",
            ),
        )


if __name__ == "__main__":
    unittest.main()
