from __future__ import annotations

import json
import unittest
from pathlib import Path


class OfficialWebTargetDenominatorAlignmentTest(unittest.TestCase):
    def test_consumer_denominator_matches_target_source_map(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        config_root = repo_root / "configs/sources/official_web/muc_public"
        target_map = json.loads((config_root / "target-source-map.json").read_text(encoding="utf-8"))
        denominator = json.loads(
            (config_root / "consumer-denominator.json").read_text(encoding="utf-8")
        )

        target_by_family = {
            target["consumer_family"]: target for target in target_map["targets"]
        }
        denominator_by_family = {
            family["consumer_family"]: family for family in denominator["consumer_families"]
        }

        self.assertEqual(set(target_by_family), set(denominator_by_family))
        for family, target in target_by_family.items():
            denominator_family = denominator_by_family[family]
            with self.subTest(consumer_family=family):
                self.assertEqual(denominator_family["owner_surface"], target["owner_surface"])
                self.assertEqual(
                    denominator_family["selected_write_target"],
                    target["selected_write_target"],
                )
                self.assertEqual(
                    denominator_family["materialization_policy"],
                    target["materialization_policy"],
                )
                self.assertEqual(denominator_family["review_policy"], target["review_policy"])
                self.assertEqual(
                    set(denominator_family["required_evidence"]),
                    set(target["required_evidence"]),
                )
                self.assertEqual(
                    set(denominator_family["optional_evidence"]),
                    set(target["optional_evidence"]),
                )
                self.assertEqual(
                    set(denominator_family["title_keywords"]),
                    set(target["title_hints"]),
                )
                self.assertEqual(
                    set(denominator_family["path_patterns"]),
                    set(target["url_hints"]),
                )


if __name__ == "__main__":
    unittest.main()
