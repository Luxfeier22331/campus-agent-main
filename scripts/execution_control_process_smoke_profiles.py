from __future__ import annotations

TOOL_READ_MODEL_OPENED_TRUSTED_TIME = "2026-04-24T20:30:00+08:00"
TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME = "2026-05-07T08:00:00+08:00"
SDK_TOOL_READ_MODEL_OPENED_PROFILES = {
    "transport_schedule_sdk_opened",
    "transport_schedule_sdk_opened_stream",
    "notice_discover_sdk_opened",
}
MULTI_STEP_WORKFLOW_PROFILES = {
    "multi_step_notice_knowledge_followthrough",
    "transport_notice_override_multistep",
}
SELECTED_NOTICE_GUARDRAIL_PROFILES = {
    "selected_notice_knowledge_followthrough_ineligible",
}
AGENTS_SDK_NOTICE_PROFILES = {
    "agents_sdk_notice_discover_e2e",
}
RAG_RETRIEVAL_PROFILES = {
    "rag_delegate",
    "rag_delegate_sdk_candidate",
    "rag_delegate_institutional_rules",
    *MULTI_STEP_WORKFLOW_PROFILES,
}
RAG_SDK_PROFILES = {
    "rag_delegate_sdk_candidate",
}


def campus_services_sdk_profiles() -> set[str]:
    return {
        "transport_schedule_sdk_opened",
        "transport_schedule_sdk_opened_stream",
    }


def profile_requires_object_store(profile: str) -> bool:
    return profile in MULTI_STEP_WORKFLOW_PROFILES


def profile_requires_tool_read_model_projection(profile: str) -> bool:
    return profile in campus_services_sdk_profiles() or profile == (
        "transport_notice_override_multistep"
    )


def profile_requires_notice_read_model(profile: str) -> bool:
    return (
        profile == "notice_discover_sdk_opened"
        or profile in MULTI_STEP_WORKFLOW_PROFILES
        or profile in SELECTED_NOTICE_GUARDRAIL_PROFILES
        or profile in AGENTS_SDK_NOTICE_PROFILES
    )


def profile_requires_workflow_run_store(profile: str) -> bool:
    return profile in MULTI_STEP_WORKFLOW_PROFILES


def profile_requires_temporary_postgres(profile: str) -> bool:
    return True


def profile_execution_run_expectation(
    profile: str,
) -> tuple[dict[str, object], int, tuple[str, ...], str, tuple[int, ...]]:
    request, expected_readyz_statuses = _profile_request(profile)
    payload = _execution_run_payload(profile, request)
    return (
        payload,
        202,
        (
            payload["run_id"],  # type: ignore[index]
            payload["conversation_id"],  # type: ignore[index]
            '"status": "queued"',
        ),
        "/internal/execution/runs",
        expected_readyz_statuses,
    )


def _base_context() -> dict[str, object]:
    return {
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


def _profile_request(profile: str) -> tuple[dict[str, object], tuple[int, ...]]:
    context = _base_context()
    if profile == "closed_gate":
        return (
            {
                "user_goal": "campus shuttle schedule",
                "request_id": "process-smoke-tool-read-model-closed",
                "requested_tool": "transport_schedule_lookup",
                "context": context,
            },
            (200,),
        )
    if profile == "terminal_fail_close":
        return (
            {
                "user_goal": "解释一下 AI",
                "request_id": "process-smoke-terminal-fail-close",
                "requested_tool": "knowledge_query",
                "context": context,
            },
            (200,),
        )
    if profile == "rag_delegate":
        return (
            {
                "user_goal": "公费医疗报销",
                "request_id": "process-smoke-rag-delegate",
                "requested_tool": "knowledge_query",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": context,
            },
            (200,),
        )
    if profile == "rag_delegate_sdk_candidate":
        return (
            {
                "user_goal": "公费医疗报销",
                "request_id": "process-smoke-rag-delegate-sdk-candidate",
                "requested_tool": "knowledge_query",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": context,
            },
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
                "requested_tool": "knowledge_query",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "institutional_rules",
                },
                "context": institutional_rules_context,
            },
            (200,),
        )
    if profile == "transport_schedule_sdk_opened":
        return (
            {
                "user_goal": "我明天早上要去丰台上课，最早的班车是几点",
                "request_id": "process-smoke-transport-schedule-sdk-opened",
                "requested_tool": "transport_schedule_lookup",
                "context": context,
            },
            (200,),
        )
    if profile == "transport_schedule_sdk_opened_stream":
        return (
            {
                "user_goal": "我明天早上要去丰台上课，最早的班车是几点",
                "request_id": "process-smoke-transport-schedule-sdk-opened-stream",
                "requested_tool": "transport_schedule_lookup",
                "context": context,
            },
            (200,),
        )
    if profile == "notice_discover_sdk_opened":
        return (
            {
                "user_goal": "烟雾测试通知",
                "request_id": "process-smoke-notice-discover-sdk-opened",
                "requested_tool": "campus_notice_discover",
                "context": context,
            },
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
                    "target_surface": "regulations/student_rules",
                },
                "turn_count": 2,
            },
        }
        return (
            {
                "user_goal": "这条通知依据学生手册哪条规定？",
                "request_id": "process-smoke-multi-step-notice-knowledge",
                "requested_tool": "knowledge_query",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": notice_context,
            },
            (200,),
        )
    if profile == "selected_notice_knowledge_followthrough_ineligible":
        notice_context = {
            **context,
            "authorization": {
                "retrieval_filter": {
                    "entitlement_groups": ["students"],
                    "visibility_level": "restricted",
                    "visibility_scope": "campus",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                }
            },
            "session": {
                "selected_notice_ref": {
                    "notice_id": "notice:transport:355122",
                    "source_family": "internal_notice_restricted",
                    "title": "关于两校区学生通勤班车增加班次的通知",
                    "target_surface": "campus_services/service_status_candidate",
                },
                "turn_count": 2,
            },
        }
        return (
            {
                "user_goal": "这条班车通知依据学生手册哪条规定？",
                "request_id": "process-smoke-selected-notice-knowledge-ineligible",
                "requested_tool": "transport_schedule_lookup",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": notice_context,
            },
            (200,),
        )
    if profile == "transport_notice_override_multistep":
        notice_context = {
            **context,
            "authorization": {
                "retrieval_filter": {
                    "entitlement_groups": ["students"],
                    "visibility_level": "restricted",
                    "visibility_scope": "campus",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                }
            },
            "session": {
                "selected_notice_ref": {
                    "notice_id": "353903",
                    "source_family": "internal_notice_restricted",
                    "title": "关于通勤班车丰台校区乘车点调整的通知",
                    "target_surface": "campus_services/service_status_candidate",
                },
                "turn_count": 2,
            },
        }
        return (
            {
                "user_goal": "2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
                "request_id": "process-smoke-transport-notice-override-multistep",
                "requested_tool": "transport_schedule_lookup",
                "context": notice_context,
            },
            (200, 503),
        )
    if profile == "transactional_approval_required":
        return (
            {
                "user_goal": "帮我提交公费医疗报销申请",
                "request_id": "process-smoke-transactional-approval-required",
                "requested_tool": "knowledge_query",
                "context": context,
            },
            (200,),
        )
    raise ValueError(f"unsupported process smoke profile: {profile}")


def _execution_run_payload(profile: str, request: dict[str, object]) -> dict[str, object]:
    request_id = str(request["request_id"])
    tool_target = str(request.get("requested_tool") or "knowledge_query")
    run_id = request_id
    conversation_id = f"conversation-{profile.replace('_', '-')}"
    trace_id = f"trace-{request_id}"
    context = request.get("context", {})
    execution_payload = {
        "user_goal": request["user_goal"],
        "request_id": request_id,
        "conversation_id": conversation_id,
        "trace": {"trace_id": trace_id},
        "runtime_decisions": {"runtime_decision_summary": {}},
        "context": context,
        "requested_tool": tool_target,
    }
    if "requested_scope" in request:
        execution_payload["requested_scope"] = request["requested_scope"]
    return {
        **request,
        "run_id": run_id,
        "conversation_id": conversation_id,
        "turn_id": f"turn-{profile.replace('_', '-')}",
        "trace_id": trace_id,
        "owner_user_id": _owner_user_id(context),
        "surface": "local-process-smoke",
        "selected_tool": tool_target,
        "execution_group": _execution_group_for_tool_target(tool_target),
        "runtime_versions": {"contract": "temporal-execution-control-v1"},
        "metadata": {
            "execution_payload": execution_payload,
            "handoff": _handoff_for_tool_request(tool_target, request),
        },
    }


def _owner_user_id(context: object) -> str:
    if isinstance(context, dict):
        actor = context.get("actor")
        if isinstance(actor, dict):
            user_id = actor.get("user_id")
            if isinstance(user_id, str) and user_id.strip():
                return user_id.strip()
    return "smoke-student"


def _execution_group_for_tool_target(tool_target: str) -> str:
    if tool_target == "knowledge_query":
        return "rag"
    if tool_target == "transport_schedule_lookup":
        return "transport_schedule"
    if tool_target.startswith("campus_notice_"):
        return "notice"
    return "default"


def _handoff_for_tool_request(tool_target: str, request: dict[str, object]) -> dict[str, object]:
    user_goal = str(request["user_goal"])
    if tool_target == "knowledge_query":
        return {
            "target": "knowledge_query",
            "payload_kind": "rag_request",
            "allowed_tools": ["knowledge_query"],
            "payload": {
                "query_text": user_goal,
                "requested_scope": request.get("requested_scope", {}),
            },
        }
    if tool_target == "campus_notice_discover":
        return {
            "target": "campus_notice_discover",
            "payload_kind": "campus_notice_discover",
            "allowed_tools": ["campus_notice_discover"],
            "payload": {"query_text": user_goal},
        }
    if tool_target == "transport_schedule_lookup":
        return {
            "target": "transport_schedule_lookup",
            "payload_kind": "transport_schedule_lookup",
            "allowed_tools": [
                "transport_schedule_lookup",
            ],
            "payload": {"query_text": user_goal},
        }
    return {
        "target": "default-tool",
        "payload_kind": "default_request",
        "allowed_tools": [],
        "payload": {"query_text": user_goal},
    }


__all__ = [
    "AGENTS_SDK_NOTICE_PROFILES",
    "MULTI_STEP_WORKFLOW_PROFILES",
    "RAG_RETRIEVAL_PROFILES",
    "RAG_SDK_PROFILES",
    "SDK_TOOL_READ_MODEL_OPENED_PROFILES",
    "SELECTED_NOTICE_GUARDRAIL_PROFILES",
    "TOOL_READ_MODEL_OPENED_TRUSTED_TIME",
    "TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME",
    "campus_services_sdk_profiles",
    "profile_execution_run_expectation",
    "profile_requires_notice_read_model",
    "profile_requires_object_store",
    "profile_requires_temporary_postgres",
    "profile_requires_tool_read_model_projection",
    "profile_requires_workflow_run_store",
]
