from __future__ import annotations

import unittest

from campus_ingestion_core.source_handoff_no_serving_gate import (
    NoServingOpeningViolation,
    validate_no_serving_opening_gate,
)


class SourceHandoffNoServingGateTest(unittest.TestCase):
    def test_gate_passes_operator_only_payload(self) -> None:
        result = validate_no_serving_opening_gate(
            [
                {
                    "schema_version": "source_handoff_operator_projection.v1",
                    "records": [],
                    "query_enabled": False,
                }
            ]
        )

        self.assertEqual(result["verdict"], "passed")
        self.assertEqual(result["finding_count"], 0)

    def test_gate_fails_query_enabled_or_serving_alias_drift(self) -> None:
        with self.assertRaises(NoServingOpeningViolation) as raised:
            validate_no_serving_opening_gate(
                [
                    {
                        "collection": "campus_notices/internal_notice",
                        "query_enabled": True,
                    },
                    {
                        "serving": {
                            "serving_alias_published": True,
                        }
                    },
                ]
            )

        self.assertIn("query_enabled", str(raised.exception))
        self.assertIn("serving_alias_published", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
