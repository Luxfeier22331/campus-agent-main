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
    if profile == "structured_direct_opened":
        return (
            {
                "user_goal": "我明天早上要去丰台上课，最早的班车是几点",
                "request_id": "process-smoke-structured-direct-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "transport_schedule_lookup",
                "resolved_current",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "structured_direct_opened_stream":
        return (
            {
                "user_goal": "我明天早上要去丰台上课，最早的班车是几点",
                "request_id": "process-smoke-structured-direct-opened-stream",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "event: execution.completed",
                "campus-services-agent",
                "transport_schedule_lookup",
                "resolved_current",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer/stream",
            "sse",
            (200,),
        )
    if profile == "service_status_direct_opened":
        return (
            {
                "user_goal": "校园卡现在开放吗",
                "request_id": "process-smoke-service-status-direct-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "service_status_lookup",
                "resolved_current",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "service_guide_direct_opened":
        return (
            {
                "user_goal": "公费医疗报销需要什么材料",
                "request_id": "process-smoke-service-guide-direct-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "service_guide_lookup",
                "resolved_current",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "contact_directory_direct_opened":
        return (
            {
                "user_goal": "卡务中心联系电话是多少",
                "request_id": "process-smoke-contact-directory-direct-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "contact_directory_lookup",
                "resolved_current",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "notice_discover_direct_opened":
        return (
            {
                "user_goal": "烟雾测试通知",
                "request_id": "process-smoke-notice-discover-direct-opened",
                "requested_capability": "notice",
                "context": context,
            },
            200,
            (
                "notice-agent",
                "campus_notice_discover",
                "resolved_current",
                "烟雾测试通知",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "notice_get_direct_opened":
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
                "user_goal": "这条通知详情",
                "request_id": "process-smoke-notice-get-direct-opened",
                "requested_capability": "notice",
                "context": notice_context,
            },
            200,
            (
                "notice-agent",
                "campus_notice_get",
                "resolved_current",
                "烟雾测试通知",
                "direct_runtime",
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
