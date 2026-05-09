from __future__ import annotations

from campus_contracts import KnowledgeScope, VersionQuery

from campus_evals.intent_models import IntentCase


def _invalid_envelope_cases() -> tuple[IntentCase, ...]:
    service_scope = KnowledgeScope(corpus="campus_services", collection="service_catalog")
    handbook_scope = KnowledgeScope(corpus="regulations", collection="student_rules")
    return (
        IntentCase(
            case_id="intent-invalid-campus-services-scope",
            user_goal="校车时刻表",
            requested_capability="campus_services",
            requested_scope=service_scope,
            expected_capability="",
            expected_task_kind="",
            expected_launch_state="",
            expected_next_action="",
            expected_scope_class="",
            expected_target="none",
            expected_error_code="invalid_supervisor_request",
            critical=True,
        ),
        IntentCase(
            case_id="intent-invalid-notice-scope",
            user_goal="找一下春假通知",
            requested_capability="notice",
            requested_scope=handbook_scope,
            expected_capability="",
            expected_task_kind="",
            expected_launch_state="",
            expected_next_action="",
            expected_scope_class="",
            expected_target="none",
            expected_error_code="invalid_supervisor_request",
            critical=True,
        ),
        IntentCase(
            case_id="intent-invalid-notice-version-historical",
            user_goal="历史通知",
            requested_capability="notice",
            version_query=VersionQuery(mode="historical"),
            expected_capability="",
            expected_task_kind="",
            expected_launch_state="",
            expected_next_action="",
            expected_scope_class="",
            expected_target="none",
            expected_error_code="invalid_supervisor_request",
            critical=True,
        ),
        IntentCase(
            case_id="intent-invalid-place-scope",
            user_goal="图书馆在哪里",
            requested_capability="place_lookup",
            requested_scope=handbook_scope,
            expected_capability="",
            expected_task_kind="",
            expected_launch_state="",
            expected_next_action="",
            expected_scope_class="",
            expected_target="none",
            expected_error_code="invalid_supervisor_request",
            critical=True,
        ),
        IntentCase(
            case_id="intent-invalid-place-version",
            user_goal="图书馆在哪里",
            requested_capability="place_lookup",
            version_query=VersionQuery(mode="historical"),
            expected_capability="",
            expected_task_kind="",
            expected_launch_state="",
            expected_next_action="",
            expected_scope_class="",
            expected_target="none",
            expected_error_code="invalid_supervisor_request",
            critical=True,
        ),
    )
