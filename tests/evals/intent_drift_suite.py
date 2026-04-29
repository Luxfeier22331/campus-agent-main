from __future__ import annotations

import unittest

from campus_evals.intent_drift import (
    build_intent_drift_report,
    load_intent_drift_thresholds,
)


class IntentDriftTest(unittest.TestCase):
    def test_load_default_intent_drift_thresholds(self) -> None:
        thresholds = load_intent_drift_thresholds()

        self.assertEqual(thresholds["schema_version"], "intent-drift-thresholds-v1")
        self.assertIn("go-runtime-policy-v2", thresholds["allowed_classifier_versions"])

    def test_build_report_flags_version_and_behavior_drift_candidates(self) -> None:
        report = build_intent_drift_report(
            (
                {
                    "case_id": "observed-001",
                    "classifier_version": "stale-classifier-v0",
                    "schema_version": "intent-schema-0.9.0",
                    "context_resolution_state": "missing_context",
                    "routing_confidence": "low",
                    "ambiguity_signal": "previous_goal",
                    "scope_reason": "structured_subtype_missing",
                },
                {
                    "case_id": "observed-002",
                    "classifier_version": "go-runtime-policy-v2",
                    "schema_version": "intent-schema-1.0.0",
                    "context_resolution_state": "resolved",
                    "routing_confidence": "high",
                },
            ),
            thresholds={
                "schema_version": "intent-drift-thresholds-v1",
                "allowed_classifier_versions": ("go-runtime-policy-v2",),
                "allowed_intent_schema_versions": ("intent-schema-1.0.0",),
                "max_context_unresolved_rate": 0.25,
                "max_low_confidence_rate": 0.25,
                "max_ambiguity_rate": 0.25,
                "max_structured_subtype_missing_rate": 0.25,
            },
        )

        self.assertFalse(report["passed"])
        self.assertEqual(report["total"], 2)
        self.assertIn("disallowed_classifier_version", _breach_names(report))
        self.assertIn("disallowed_intent_schema_version", _breach_names(report))
        self.assertIn("context_unresolved_rate", _breach_names(report))
        self.assertIn("low_confidence_rate", _breach_names(report))
        self.assertIn("ambiguity_rate", _breach_names(report))
        self.assertIn("structured_subtype_missing_rate", _breach_names(report))
        self.assertEqual(report["candidates"][0]["case_id"], "observed-001")


def _breach_names(report: dict[str, object]) -> set[str]:
    return {str(item["name"]) for item in report["breaches"]}  # type: ignore[index]


if __name__ == "__main__":
    unittest.main()
