from __future__ import annotations


def profile_answer_expectation(
    profile: str,
) -> tuple[dict[str, object], int, tuple[str, ...], str, str, tuple[int, ...]]:
    context = {
        "actor": {
            "user_id": "smoke-student",
            "principal_id": "smoke-student",
            "principal_type": "student",
            "roles": ["student"],
        },
        "authorization": {
            "retrieval_filter": {
                "entitlement_groups": [],
                "visibility_level": "public",
                "policy_projection_version": "phase1-authorization-projection-v1",
            }
        },
    }
    if profile == "closed_gate":
        return (
            {
                "user_goal": "campus shuttle schedule",
                "request_id": "process-smoke-structured-runtime-closed",
                "requested_capability": "campus_services",
                "context": context,
            },
            503,
            ("structured_runtime_closed",),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "terminal_fail_close":
        return (
            {
                "user_goal": "解释一下 AI",
                "request_id": "process-smoke-terminal-fail-close",
                "requested_capability": "knowledge",
                "context": context,
            },
            200,
            ("product_scope_boundary",),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "rag_delegate":
        return (
            {
                "user_goal": "公费医疗报销",
                "request_id": "process-smoke-rag-delegate",
                "requested_capability": "knowledge",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": context,
            },
            200,
            (
                "workflow_trace_summary",
                "agent_execution_projection",
                "agent_plan",
                "grounded_answer",
                "中央民族大学学生公费医疗管理办法",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "rag_delegate_sdk_candidate":
        return (
            {
                "user_goal": "公费医疗报销",
                "request_id": "process-smoke-rag-delegate-sdk-candidate",
                "requested_capability": "knowledge",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": context,
            },
            200,
            (
                "workflow_trace_summary",
                "agent_execution_projection",
                "rag-agent",
                "retrieval.query",
                "rag_sdk_completed",
                "rag-sdk-trace-projection-v1",
                "中央民族大学学生公费医疗管理办法",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "rag_delegate_institutional_rules":
        institutional_rules_context = {
            **context,
            "authorization": {
                "retrieval_filter": {
                    "entitlement_groups": ["campus_members"],
                    "visibility_level": "restricted",
                    "visibility_scope": "campus",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                }
            },
        }
        return (
            {
                "user_goal": "研究生助教助研助管工作应该依据哪份管理办法？",
                "request_id": "process-smoke-rag-delegate-institutional-rules",
                "requested_capability": "knowledge",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "institutional_rules",
                },
                "context": institutional_rules_context,
            },
            200,
            (
                "workflow_trace_summary",
                "agent_execution_projection",
                "agent_plan",
                "grounded_answer",
                "中央民族大学研究生",
                "三助",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "transport_schedule_sdk_opened":
        return (
            {
                "user_goal": "我明天早上要去丰台上课，最早的班车是几点",
                "request_id": "process-smoke-transport-schedule-sdk-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "transport_schedule_lookup",
                "resolved_current",
                "single_handoff",
                "sdk_completed",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "transport_schedule_sdk_opened_stream":
        return (
            {
                "user_goal": "我明天早上要去丰台上课，最早的班车是几点",
                "request_id": "process-smoke-transport-schedule-sdk-opened-stream",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "event: execution.completed",
                "campus-services-agent",
                "transport_schedule_lookup",
                "resolved_current",
                "single_handoff",
                "sdk_completed",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer/stream",
            "sse",
            (200,),
        )
    if profile == "service_status_sdk_opened":
        return (
            {
                "user_goal": "校园卡现在开放吗",
                "request_id": "process-smoke-service-status-sdk-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "service_status_lookup",
                "resolved_current",
                "single_handoff",
                "sdk_completed",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "service_guide_sdk_opened":
        return (
            {
                "user_goal": "公费医疗报销需要什么材料",
                "request_id": "process-smoke-service-guide-sdk-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "service_guide_lookup",
                "resolved_current",
                "single_handoff",
                "sdk_completed",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "contact_directory_sdk_opened":
        return (
            {
                "user_goal": "卡务中心联系电话是多少",
                "request_id": "process-smoke-contact-directory-sdk-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "contact_directory_lookup",
                "resolved_current",
                "single_handoff",
                "sdk_completed",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "notice_discover_sdk_opened":
        return (
            {
                "user_goal": "烟雾测试通知",
                "request_id": "process-smoke-notice-discover-sdk-opened",
                "requested_capability": "notice",
                "context": context,
            },
            200,
            (
                "notice-agent",
                "campus_notice_discover",
                "resolved_current",
                "烟雾测试通知",
                "single_handoff",
                "sdk_completed",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "academic_calendar_sdk_opened":
        return (
            {
                "user_goal": "今天第几教学周",
                "request_id": "process-smoke-academic-calendar-sdk-opened",
                "requested_capability": "academic_calendar",
                "context": context,
            },
            200,
            (
                "calendar-agent",
                "academic_calendar_lookup",
                "resolved_current",
                "single_handoff",
                "sdk_completed",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "multi_step_notice_knowledge_followthrough":
        notice_context = {
            **context,
            "session": {
                "selected_notice_ref": {
                    "notice_id": "notice:smoke:001",
                    "source_family": "wechat_public_notice",
                    "title": "烟雾测试通知",
                },
                "turn_count": 2,
            },
        }
        return (
            {
                "user_goal": "这条通知依据学生手册哪条规定？",
                "request_id": "process-smoke-multi-step-notice-knowledge",
                "requested_capability": "knowledge",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": notice_context,
            },
            200,
            (
                "workflow_trace_summary",
                "multi_step",
                "context_projections",
                "notice_context",
                "notice-agent",
                "campus_notice_get",
                "rag-agent",
                "retrieval.query",
                "agent_execution_projection",
                "已读取的通知上下文",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "transactional_approval_required":
        return (
            {
                "user_goal": "帮我提交公费医疗报销申请",
                "request_id": "process-smoke-transactional-approval-required",
                "requested_capability": "knowledge",
                "context": context,
            },
            200,
            ("approval_required", "workflow_trace_summary", "selected_target"),
            "/api/v1/answer",
            "json",
            (200,),
        )
    raise ValueError(f"unsupported process smoke profile: {profile}")


__all__ = ["profile_answer_expectation"]
