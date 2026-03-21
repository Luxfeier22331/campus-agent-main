from __future__ import annotations

from dataclasses import dataclass, field
import os


@dataclass(slots=True, frozen=True)
class CampusAgentSettings:
    """Bootstrap settings for the workflow-first entry agent."""

    app_name: str = "campus-agent"
    workflow_engine: str = "agno_workflow_first"
    contract_version: str = "v1"
    rag_search_path: str = "/api/search"
    rag_answer_path: str = "/api/answer"
    rag_service_name: str = "campusRag"
    workflow_state_backend: str = "in_memory"
    postgres_conninfo: str | None = None
    request_context_candidate_memory_limit: int = 10
    request_context_emit_memory_limit: int = 3
    default_corpora: tuple[str, ...] = field(
        default_factory=lambda: ("student_handbook",)
    )

    @classmethod
    def from_env(cls) -> "CampusAgentSettings":
        corpora = os.getenv("CAMPUS_AGENT_DEFAULT_CORPORA", "student_handbook")
        return cls(
            app_name=os.getenv("CAMPUS_AGENT_APP_NAME", "campus-agent"),
            workflow_engine=os.getenv(
                "CAMPUS_AGENT_WORKFLOW_ENGINE",
                "agno_workflow_first",
            ),
            contract_version=os.getenv("CAMPUS_AGENT_CONTRACT_VERSION", "v1"),
            rag_search_path=os.getenv("CAMPUS_AGENT_RAG_SEARCH_PATH", "/api/search"),
            rag_answer_path=os.getenv("CAMPUS_AGENT_RAG_ANSWER_PATH", "/api/answer"),
            rag_service_name=os.getenv("CAMPUS_AGENT_RAG_SERVICE_NAME", "campusRag"),
            workflow_state_backend=os.getenv(
                "CAMPUS_AGENT_WORKFLOW_STATE_BACKEND",
                "in_memory",
            ),
            postgres_conninfo=os.getenv("CAMPUS_AGENT_POSTGRES_CONNINFO"),
            request_context_candidate_memory_limit=max(
                1,
                int(os.getenv("CAMPUS_AGENT_REQUEST_CONTEXT_CANDIDATE_MEMORY_LIMIT", "10")),
            ),
            request_context_emit_memory_limit=max(
                1,
                int(os.getenv("CAMPUS_AGENT_REQUEST_CONTEXT_EMIT_MEMORY_LIMIT", "3")),
            ),
            default_corpora=tuple(
                item.strip()
                for item in corpora.split(",")
                if item.strip()
            )
            or ("student_handbook",),
        )
