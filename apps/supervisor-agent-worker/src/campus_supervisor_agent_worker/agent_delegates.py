from __future__ import annotations

from campus_navigation_agent import delegate_to_navigation_agent
from campus_notice_agent import NoticeHTTPQueryService, delegate_to_notice_agent
from campus_rag_agent.service import delegate_to_rag_agent
from campus_services_agent import CampusServicesHTTPQueryService, delegate_to_campus_services_agent

from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDelegate,
    ExecutionCancelledError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore
from campus_supervisor_agent_worker.prompt_executor import ProviderBackedRagPromptExecutor
from campus_supervisor_agent_worker.settings import ApiSettings


def bind_agent_handler(
    settings: ApiSettings,
    *,
    agent_handler,
    rag_prompt_executor: ProviderBackedRagPromptExecutor | None,
    cancel_flags: CancelFlagStore,
):
    if agent_handler is not dispatch_agent_request:
        return _wrap_with_cancel_checks(agent_handler, cancel_flags)
    campus_services_query_service = _build_campus_services_query_service(settings)
    notice_query_service = _build_notice_query_service(settings)
    agent_delegates = _build_agent_delegates(
        rag_prompt_executor=rag_prompt_executor,
        campus_services_query_service=campus_services_query_service,
        notice_query_service=notice_query_service,
    )

    return lambda request, preplanned_agent_request: dispatch_agent_request(
        preplanned_agent_request,
        agent_delegates=agent_delegates,
        cancellation_checker=lambda: cancel_flags.is_cancel_requested(request.request_id),
    )


def _build_agent_delegates(
    *,
    rag_prompt_executor: ProviderBackedRagPromptExecutor | None,
    campus_services_query_service: CampusServicesHTTPQueryService | None,
    notice_query_service: NoticeHTTPQueryService | None,
) -> dict[str, AgentDelegate]:
    agent_delegates: dict[str, AgentDelegate] = {
        "rag-agent": lambda agent_request: delegate_to_rag_agent(
            agent_request,
            prompt_executor=rag_prompt_executor,
        ),
        "navigation-agent": delegate_to_navigation_agent,
        "campus-services-agent": delegate_to_campus_services_agent,
        "notice-agent": delegate_to_notice_agent,
    }
    if campus_services_query_service is not None:
        agent_delegates["campus-services-agent"] = lambda agent_request: (
            delegate_to_campus_services_agent(
                agent_request,
                query_service=campus_services_query_service,
            )
        )
    if notice_query_service is not None:
        agent_delegates["notice-agent"] = lambda agent_request: delegate_to_notice_agent(
            agent_request,
            query_service=notice_query_service,
        )
    return agent_delegates


def _wrap_with_cancel_checks(agent_handler, cancel_flags: CancelFlagStore):
    def guarded_agent_handler(
        request,
        preplanned_agent_request,
    ):
        if cancel_flags.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Execution was cancelled.")
        response = agent_handler(preplanned_agent_request)
        if cancel_flags.is_cancel_requested(request.request_id):
            raise ExecutionCancelledError("Execution was cancelled.")
        return response

    return guarded_agent_handler


def _build_campus_services_query_service(
    settings: ApiSettings,
) -> CampusServicesHTTPQueryService | None:
    if not settings.structured_query_base_url or not settings.structured_query_shared_secret:
        return None
    return CampusServicesHTTPQueryService(
        base_url=settings.structured_query_base_url,
        shared_secret=settings.structured_query_shared_secret,
        timeout_seconds=settings.structured_query_timeout_seconds,
    )


def _build_notice_query_service(
    settings: ApiSettings,
) -> NoticeHTTPQueryService | None:
    if not settings.structured_query_base_url or not settings.structured_query_shared_secret:
        return None
    return NoticeHTTPQueryService(
        base_url=settings.structured_query_base_url,
        shared_secret=settings.structured_query_shared_secret,
        timeout_seconds=settings.structured_query_timeout_seconds,
    )
