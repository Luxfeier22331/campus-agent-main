from __future__ import annotations

import unittest

from campus_evals.authz_privacy_eval import (
    AUTHZ_PRIVACY_CASES_PATH,
    AuthzPrivacyObservation,
    evaluate_authz_privacy_cases,
    load_authz_privacy_cases,
)


class AuthzPrivacyEvalTest(unittest.TestCase):
    def test_loads_authz_privacy_fixture(self) -> None:
        case_set = load_authz_privacy_cases()

        self.assertTrue(AUTHZ_PRIVACY_CASES_PATH.exists())
        self.assertEqual(case_set.schema_version, 1)
        case_ids = {case.case_id for case in case_set.cases}
        self.assertIn("authz-restricted-notice-deny", case_ids)
        self.assertIn("authz-policy-unavailable-fail-close", case_ids)

    def test_evaluates_restricted_deny_closed_scope_and_policy_unavailable(self) -> None:
        case_set = load_authz_privacy_cases()
        observations = {
            case.case_id: AuthzPrivacyObservation(
                case_id=case.case_id,
                terminal_outcome=case.expected_terminal_outcome,
                fail_close_reason=case.expected_fail_close_reason,
                authorization_summary=dict(case.expected_authorization_summary),
                artifact_payload={"safe_trace_link": "https://trace.example/id"},
            )
            for case in case_set.cases
        }

        report = evaluate_authz_privacy_cases(case_set.cases, observations)

        self.assertTrue(report.passed)
        self.assertEqual(report.passed_count, len(case_set.cases))

    def test_redaction_guard_rejects_raw_auth_and_restricted_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            AuthzPrivacyObservation(
                case_id="authz-restricted-notice-deny",
                terminal_outcome="fail_close",
                fail_close_reason="restricted_access_denied",
                authorization_summary={"visibility": "restricted"},
                artifact_payload={"jwt": "secret"},
            )

    def test_fails_ordinary_no_hit_when_restricted_deny_expected(self) -> None:
        case_set = load_authz_privacy_cases()
        restricted_case = next(
            case for case in case_set.cases if case.case_id == "authz-restricted-notice-deny"
        )

        report = evaluate_authz_privacy_cases(
            (restricted_case,),
            {
                restricted_case.case_id: AuthzPrivacyObservation(
                    case_id=restricted_case.case_id,
                    terminal_outcome="no_hit",
                    fail_close_reason="",
                    authorization_summary={"visibility": "public"},
                    artifact_payload={},
                )
            },
        )

        self.assertFalse(report.passed)
        self.assertEqual(report.results[0].failure_class, "restricted_deny_mismatch")


if __name__ == "__main__":
    unittest.main()
