from __future__ import annotations

import unittest

from campus_evals.eval_operations_governance import (
    EVAL_OPERATIONS_PROFILE_POLICY_PATH,
    EvalOperationsObservation,
    evaluate_eval_operations_governance,
    load_eval_operations_profile_policy,
)


class EvalOperationsGovernanceTest(unittest.TestCase):
    def test_loads_profile_policy_with_budget_retention_and_schedule(self) -> None:
        policy = load_eval_operations_profile_policy()

        self.assertTrue(EVAL_OPERATIONS_PROFILE_POLICY_PATH.exists())
        self.assertEqual(policy.schema_version, 1)
        self.assertIn("public_chat_product_path", policy.profiles)
        profile = policy.profiles["public_chat_product_path"]
        self.assertGreater(profile.budget.max_cases_per_run, 0)
        self.assertGreater(profile.runtime_timeout_seconds, 0)
        self.assertGreater(profile.retention.artifact_days, 0)
        self.assertIn("manual", profile.allowed_gate_modes)

    def test_accepts_compliant_operations_observations(self) -> None:
        policy = load_eval_operations_profile_policy()
        observations = {
            profile_id: EvalOperationsObservation(
                profile_id=profile_id,
                gate_mode="manual",
                cases_run=profile.budget.max_cases_per_run,
                runtime_seconds=profile.runtime_timeout_seconds,
                retry_count=profile.max_retries,
                artifact_age_days=profile.retention.artifact_days,
                failed_cases=(),
                skipped_cases=(),
                quarantined_cases=(),
                repaired_cases=(),
                version_summary={
                    field_name: f"{field_name}.v1" for field_name in profile.required_version_fields
                },
            )
            for profile_id, profile in policy.profiles.items()
        }

        report = evaluate_eval_operations_governance(policy, observations)

        self.assertTrue(report.passed)
        self.assertEqual(report.passed_count, len(policy.profiles))

    def test_detects_budget_quarantine_retention_and_drift_violations(self) -> None:
        policy = load_eval_operations_profile_policy()
        profile = policy.profiles["public_chat_product_path"]

        report = evaluate_eval_operations_governance(
            policy,
            {
                "public_chat_product_path": EvalOperationsObservation(
                    profile_id="public_chat_product_path",
                    gate_mode="pr_hard_gate",
                    cases_run=profile.budget.max_cases_per_run + 1,
                    runtime_seconds=profile.runtime_timeout_seconds + 1,
                    retry_count=profile.max_retries + 1,
                    artifact_age_days=profile.retention.artifact_days + 1,
                    failed_cases=("case-a",),
                    skipped_cases=("case-b",),
                    quarantined_cases=("case-c",),
                    repaired_cases=("case-d",),
                    version_summary={"case_set_version": "missing-other-fields"},
                )
            },
        )

        self.assertFalse(report.passed)
        result = next(
            item for item in report.results if item.profile_id == "public_chat_product_path"
        )
        self.assertIn("budget_exceeded", result.failure_classes)
        self.assertIn("runtime_policy_violation", result.failure_classes)
        self.assertIn("unsupported_gate_mode", result.failure_classes)
        self.assertIn("missing_failure_disposition", result.failure_classes)
        self.assertIn("invalid_quarantine", result.failure_classes)
        self.assertIn("retention_violation", result.failure_classes)
        self.assertIn("version_drift", result.failure_classes)

    def test_detects_provider_call_budget_violation(self) -> None:
        policy = load_eval_operations_profile_policy()
        profile = policy.profiles["public_chat_product_path"]

        report = evaluate_eval_operations_governance(
            policy,
            {
                "public_chat_product_path": EvalOperationsObservation(
                    profile_id="public_chat_product_path",
                    gate_mode="manual",
                    cases_run=1,
                    provider_calls=profile.budget.max_provider_calls_per_run + 1,
                    runtime_seconds=1,
                    retry_count=0,
                    artifact_age_days=1,
                    version_summary={
                        field_name: f"{field_name}.v1"
                        for field_name in profile.required_version_fields
                    },
                )
            },
        )

        self.assertFalse(report.passed)
        result = next(
            item for item in report.results if item.profile_id == "public_chat_product_path"
        )
        self.assertEqual(result.failure_classes, ("budget_exceeded",))

    def test_requires_quarantine_readmission_rule(self) -> None:
        payload = {
            "schema_version": 1,
            "policy_id": "eval_operations_profile_policy.v1",
            "profiles": [
                {
                    "profile_id": "bad-profile",
                    "budget": {"max_cases_per_run": 1, "max_provider_calls_per_run": 0},
                    "runtime_timeout_seconds": 60,
                    "max_retries": 0,
                    "pacing_seconds": 0.0,
                    "breaker": {"failure_threshold": 1, "cooldown_seconds": 60},
                    "retention": {"artifact_days": 1, "promoted_artifact_days": 1},
                    "allowed_gate_modes": ["manual"],
                    "failure_dispositions": ["fail"],
                    "quarantine": {
                        "allowed": True,
                        "max_days": 7,
                        "readmission_rule": "",
                    },
                    "required_version_fields": ["case_set_version"],
                }
            ],
        }

        with self.assertRaisesRegex(ValueError, "quarantine readmission_rule"):
            load_eval_operations_profile_policy(payload=payload)


if __name__ == "__main__":
    unittest.main()
