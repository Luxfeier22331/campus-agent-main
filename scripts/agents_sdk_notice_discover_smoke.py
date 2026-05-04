from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from campus_contracts import (
    AgentRequest,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    NoticeCard,
)
from campus_notice_agent.query_service import NoticeDiscoverQuery
from campus_supervisor_agent_worker.agent_delegates import (
    _build_agent_delegates,
    _build_agents_sdk_runner,
)
from campus_supervisor_agent_worker.settings import ApiSettings

SMOKE_SCHEMA_VERSION = "agents-sdk-notice-discover-smoke.v1"
DEFAULT_REPORT_PATH = Path(".tmp/agents-sdk-notice-discover-smoke.json")


@dataclass(slots=True)
class FixtureNoticeQueryService:
    called: bool = False
    last_query: NoticeDiscoverQuery | None = None

    def discover_notice(self, query: NoticeDiscoverQuery) -> CampusNoticeDiscoverResult:
        self.called = True
        self.last_query = query
        return CampusNoticeDiscoverResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            source_families=("official_web_public_notice",),
            notice_cards=(
                NoticeCard(
                    notice_id="notice:sdk-smoke:spring-holiday",
                    title="2026 年春假安排通知",
                    source_family="official_web_public_notice",
                    source_url="https://campus.example/notices/spring-holiday",
                    published_at="2026-04-20",
                ),
            ),
            queried_time_anchor="2026-05-04T00:00:00+08:00",
        )

    def get_notice(self, _query):
        raise AssertionError("notice discover smoke must not call campus_notice_get")


def run_smoke(*, report_path: Path = DEFAULT_REPORT_PATH) -> dict[str, object]:
    _load_repo_env()
    settings = _smoke_settings()
    runner = _build_agents_sdk_runner(settings)
    if runner is None:
        raise RuntimeError("Agents SDK smoke runner was not admitted by settings")
    query_service = FixtureNoticeQueryService()
    delegates = _build_agent_delegates(
        settings=settings,
        rag_prompt_executor=None,
        campus_services_query_service=None,
        notice_query_service=query_service,
        agents_sdk_runner=runner,
    )
    started = time.monotonic()
    response = delegates["notice-agent"](
        AgentRequest(
            target="notice-agent",
            user_goal="找春假通知，返回标题和原文链接",
            request_id="agents-sdk-notice-discover-smoke",
            payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
            allowed_tools=("campus_notice_discover",),
        )
    )
    elapsed_ms = int((time.monotonic() - started) * 1000)
    observability = response.agent_observability
    safe_details = observability.safe_details if observability is not None else {}
    trace_projection = safe_details.get("agents_sdk_trace_projection")
    runner_projection = safe_details.get("agents_sdk_runner_projection")
    report = {
        "schema_version": SMOKE_SCHEMA_VERSION,
        "passed": _response_passed(response, query_service=query_service),
        "mode": "real_openai_agents_sdk_with_fixture_notice_query_service",
        "elapsed_ms": elapsed_ms,
        "status": response.status,
        "selected_tool": observability.selected_tool if observability is not None else "",
        "tool_outcome": observability.tool_outcome if observability is not None else "",
        "source_ref_count": observability.source_ref_count if observability is not None else 0,
        "query_service_called": query_service.called,
        "answer_text_present": bool(response.answer_text.strip()),
        "trace_projection": trace_projection if isinstance(trace_projection, dict) else {},
        "runner_projection": runner_projection if isinstance(runner_projection, dict) else {},
        "env": _env_summary(settings),
        "notes": [
            "OpenAI Agents SDK/provider path is real.",
            "Notice query service is a repo-owned fixture because no structured query endpoint is configured.",
        ],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def _response_passed(response, *, query_service: FixtureNoticeQueryService) -> bool:
    observability = response.agent_observability
    return (
        response.status == "completed"
        and query_service.called
        and observability is not None
        and observability.selected_tool == "campus_notice_discover"
        and observability.tool_outcome == "sdk_completed"
        and int(observability.source_ref_count or 0) > 0
        and bool(response.answer_text.strip())
    )


def _smoke_settings() -> ApiSettings:
    model = _env("AGENT_PROMPT_MODEL") or _env("PROMPT_RUNTIME_MODEL")
    provider = _env("PROMPT_RUNTIME_PROVIDER") or _env("AGENT_RUNTIME_PROVIDER")
    api_key = _env("PROMPT_RUNTIME_API_KEY") or _env("LLM_API_KEY")
    base_url = _env("PROMPT_RUNTIME_BASE_URL") or _env("LLM_BASE_URL")
    missing = [
        key
        for key, value in {
            "PROMPT_RUNTIME_PROVIDER or AGENT_RUNTIME_PROVIDER": provider,
            "AGENT_PROMPT_MODEL or PROMPT_RUNTIME_MODEL": model,
            "PROMPT_RUNTIME_API_KEY or LLM_API_KEY": api_key,
            "PROMPT_RUNTIME_BASE_URL or LLM_BASE_URL": base_url,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"Agents SDK smoke missing provider env: {', '.join(missing)}")
    return ApiSettings(
        runtime_provider=provider,
        prompt_runtime_provider=provider,
        prompt_runtime_api_key=api_key,
        prompt_runtime_base_url=base_url,
        agent_prompt_model=model,
        prompt_runtime_model=model,
        agents_sdk_runtime_enabled=True,
        agents_sdk_runtime_allowed_targets=("notice-agent",),
        agents_sdk_runtime_allowed_tools=("campus_notice_discover",),
    )


def _env_summary(settings: ApiSettings) -> dict[str, object]:
    return {
        "agents_sdk_runtime_enabled": settings.agents_sdk_runtime_enabled,
        "allowed_targets": list(settings.agents_sdk_runtime_allowed_targets),
        "allowed_tools": list(settings.agents_sdk_runtime_allowed_tools),
        "prompt_runtime_provider": settings.prompt_runtime_provider,
        "agent_prompt_model": settings.agent_prompt_model,
        "prompt_runtime_base_url_present": bool(settings.prompt_runtime_base_url),
        "prompt_runtime_api_key_present": bool(settings.prompt_runtime_api_key),
        "structured_query_base_url_present": bool(_env("SUPERVISOR_STRUCTURED_QUERY_BASE_URL")),
        "structured_query_secret_present": bool(
            _env("SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET")
        ),
    }


def _load_repo_env() -> None:
    path = Path(".env")
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#") or "=" not in raw_line:
            continue
        key, value = raw_line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def main() -> None:
    report = run_smoke()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report.get("passed") is not True:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
