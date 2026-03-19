from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from campus_agent.config import CampusAgentSettings


CAMPUS_RAG_HEADER_MAPPING = {
    "x-actor-user-id": "x-rag-user-id",
    "x-actor-roles": "x-rag-roles",
    "x-actor-departments": "x-rag-departments",
    "x-actor-groups": "x-rag-groups",
    "x-campus-scope": "x-rag-campus-scope",
}


JsonDict = dict[str, object]


@dataclass(slots=True)
class CanonicalHeaders:
    authorization: str | None = None
    trace_id: str = ""
    parent_run_id: str = ""
    tool_call_id: str = ""
    caller_service: str = "campus-agent"
    actor_user_id: str | None = None
    actor_roles: tuple[str, ...] = ()
    actor_departments: tuple[str, ...] = ()
    actor_groups: tuple[str, ...] = ()
    campus_scope: str | None = None
    actor_snapshot: JsonDict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: JsonDict) -> "CanonicalHeaders":
        normalized = {_normalize_key(key): value for key, value in data.items()}
        return cls(
            authorization=_optional_str(normalized.get("authorization")),
            trace_id=_string_value(normalized, "trace_id"),
            parent_run_id=_string_value(normalized, "parent_run_id"),
            tool_call_id=_string_value(normalized, "tool_call_id"),
            caller_service=_string_value(normalized, "caller_service", "campus-agent"),
            actor_user_id=_optional_str(normalized.get("actor_user_id")),
            actor_roles=tuple(_as_string_list(normalized.get("actor_roles"))),
            actor_departments=tuple(
                _as_string_list(normalized.get("actor_departments"))
            ),
            actor_groups=tuple(_as_string_list(normalized.get("actor_groups"))),
            campus_scope=_optional_str(normalized.get("campus_scope")),
            actor_snapshot=dict(normalized.get("actor_snapshot") or {}),
        )

    def canonical_trace_headers(self) -> dict[str, str]:
        return {
            "x-trace-id": self.trace_id,
            "x-parent-run-id": self.parent_run_id,
            "x-tool-call-id": self.tool_call_id,
        }

    def runtime_headers(self) -> dict[str, str]:
        headers = {
            "X-Request-ID": self.tool_call_id,
            "x-caller-service": self.caller_service,
            "x-rag-authenticated": "true" if self.actor_user_id else "false",
        }
        if self.authorization:
            headers["Authorization"] = self.authorization
        if self.actor_user_id:
            headers["x-rag-user-id"] = self.actor_user_id
        if self.actor_roles:
            headers["x-rag-roles"] = ",".join(self.actor_roles)
        if self.actor_departments:
            headers["x-rag-departments"] = ",".join(self.actor_departments)
        if self.actor_groups:
            headers["x-rag-groups"] = ",".join(self.actor_groups)
        if self.campus_scope:
            headers["x-rag-campus-scope"] = self.campus_scope

        headers.update(self.canonical_trace_headers())
        return headers


class CampusRagRuntime(Protocol):
    def request(
        self,
        *,
        path: str,
        headers: dict[str, str],
        json: JsonDict,
        canonical_trace_headers: dict[str, str],
    ) -> JsonDict:
        """Execute a request against the current campusRag runtime."""


class MockCampusRagRuntime:
    """Test double for the current flat campusRag runtime surface."""

    def __init__(
        self,
        *,
        search_response: JsonDict | None = None,
        answer_response: JsonDict | None = None,
    ) -> None:
        self.requests: list[JsonDict] = []
        self.search_response = search_response
        self.answer_response = answer_response

    def request(
        self,
        *,
        path: str,
        headers: dict[str, str],
        json: JsonDict,
        canonical_trace_headers: dict[str, str],
    ) -> JsonDict:
        request_record = {
            "path": path,
            "headers": dict(headers),
            "json": dict(json),
            "canonical_trace_headers": dict(canonical_trace_headers),
        }
        self.requests.append(request_record)

        request_id = headers["X-Request-ID"]
        if path == "/api/search":
            if self.search_response is not None:
                return dict(self.search_response)
            return {
                "request_id": request_id,
                "query": json["query"],
                "hits": [
                    {
                        "corpus": "student_handbook",
                        "doc_id": "doc-library-hours",
                        "version_id": "v2026-03-19",
                        "chunk_id": "chunk-001",
                        "title": "Library Hours",
                        "snippet": "The library is open from 08:00 to 22:00.",
                        "score": 0.98,
                        "anchor": "hours",
                        "acl_level": "campus",
                        "canonical_url": "https://campus.example/library",
                        "latest_url": "https://campus.example/library",
                    }
                ],
                "retrieval_profile": {"strategy": "mock-semantic"},
                "timing": {"total_ms": 12},
            }

        if path == "/api/answer":
            if self.answer_response is not None:
                return dict(self.answer_response)
            return {
                "request_id": request_id,
                "query": json["query"],
                "answer_type": "answer",
                "answer": "- Students must complete the required credits. [S1]",
                "artifact": {
                    "type": "answer_items",
                    "items": [
                        {
                            "text": "Students must complete the required credits.",
                            "sources": ["S1"],
                            "evidence": "Students must complete the required credits.",
                        }
                    ],
                    "note": "",
                },
                "answer_artifact_version": "v1",
                "render_mode": "compat_text",
                "sources": [
                    {
                        "label": "S1",
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "chunk-001",
                        "anchor": {
                            "source_ref": "docs/student-handbook/graduation.md",
                            "section_path": ["Graduation Rules"],
                            "page_start": 12,
                            "page_end": 12,
                        },
                        "acl_level": "public",
                        "unit_id": "chunk-001",
                        "corpus": "student_handbook",
                        "title": "Graduation Rules",
                        "doc_title": "Graduation Rules",
                        "snippet": "Students must complete the required credits.",
                        "score": 0.8123,
                        "page_start": 12,
                        "page_end": 12,
                        "pages_span": "12",
                        "unit_type": "article_body",
                        "policy_title": "Graduation Rules",
                        "canonical_url": "https://docs.example.edu/v/v1:test-001/student_handbook/handbook:test-001#graduation-rules",
                        "latest_url": "https://docs.example.edu/docs/student_handbook/handbook:test-001#graduation-rules",
                        "ref_url": "https://docs.example.edu/v/v1:test-001/student_handbook/handbook:test-001#graduation-rules",
                        "source_url": "docs/student-handbook/graduation.md",
                        "doc_type": "",
                        "section": "",
                        "module": "",
                    }
                ],
                "tables": [],
                "timing": {
                    "rewrite_s": 0.0,
                    "retrieve_s": 0.012,
                    "rerank_s": 0.0,
                    "dedupe_s": 0.0,
                    "search_s": 0.013,
                    "acl_s": 0.012,
                    "answer_s": 0.004,
                    "total_s": 0.017,
                },
                "question_type": "extractive_items",
                "sources_all": [],
            }

        return {
            "request_id": request_id,
            "error": {
                "code": "unknown_path",
                "message": f"Unsupported path: {path}",
                "retryable": False,
            },
        }


class CampusRagAdapter:
    """Canonical wrapper around the current campusRag runtime surface."""

    def __init__(
        self,
        *,
        runtime: CampusRagRuntime,
        settings: CampusAgentSettings | None = None,
    ) -> None:
        self.runtime = runtime
        self.settings = settings or CampusAgentSettings()

    def search(self, *, payload: JsonDict, headers: CanonicalHeaders) -> JsonDict:
        return self._call_runtime(
            tool_name="campus_rag_search",
            path=self.settings.rag_search_path,
            payload=payload,
            headers=headers,
        )

    def answer(self, *, payload: JsonDict, headers: CanonicalHeaders) -> JsonDict:
        return self._call_runtime(
            tool_name="campus_rag_answer",
            path=self.settings.rag_answer_path,
            payload=payload,
            headers=headers,
        )

    def gate1_contract_materials(self) -> JsonDict:
        return {
            "workflow_expected_payloads": {
                "campus_rag_search": {
                    "query": "library hours",
                    "corpora": ["student_handbook"],
                    "filters": {"audience": "student"},
                    "debug": False,
                },
                "campus_rag_answer": {
                    "query": "Where is the library service desk?",
                    "corpora": ["student_handbook"],
                    "filters": {"audience": "student"},
                    "debug": False,
                },
            },
            "adapter_call_shapes": {
                "campus_rag_search": {
                    "path": self.settings.rag_search_path,
                    "headers": {
                        "X-Request-ID": "<x-tool-call-id>",
                        "Authorization": "Bearer <token>",
                        "x-rag-user-id": "<x-actor-user-id>",
                        "x-rag-roles": "<csv roles>",
                        "x-rag-departments": "<csv departments>",
                        "x-rag-groups": "<csv groups>",
                        "x-rag-campus-scope": "<x-campus-scope>",
                        "x-rag-authenticated": "<derived boolean>",
                    },
                },
                "campus_rag_answer": {
                    "path": self.settings.rag_answer_path,
                    "headers": {
                        "X-Request-ID": "<x-tool-call-id>",
                        "Authorization": "Bearer <token>",
                        "x-rag-user-id": "<x-actor-user-id>",
                        "x-rag-roles": "<csv roles>",
                        "x-rag-departments": "<csv departments>",
                        "x-rag-groups": "<csv groups>",
                        "x-rag-campus-scope": "<x-campus-scope>",
                        "x-rag-authenticated": "<derived boolean>",
                    },
                },
            },
            "header_mapping": dict(CAMPUS_RAG_HEADER_MAPPING),
            "runtime_truth_alignment": {
                "default_registry_corpus": "student_handbook",
                "answer_runtime_shape": {
                    "answer_type": "answer",
                    "answer_artifact_version": "v1",
                    "render_mode": "compat_text",
                    "artifact_required": True,
                    "sources_locator_fields": [
                        "doc_id",
                        "version_id",
                        "chunk_id",
                        "anchor",
                        "acl_level",
                        "canonical_url",
                        "latest_url",
                    ],
                },
            },
            "canonical_runtime_mapping_summary": {
                "request_id_rule": "X-Request-ID mirrors canonical x-tool-call-id",
                "trace_rule": "canonical trace headers remain in workflow state, adapter logs, and canonical envelope trace_id",
                "response_rule": "flat runtime payloads are wrapped into the canonical common envelope",
                "error_rule": "FastAPI detail payloads are normalized into the canonical common error envelope",
            },
        }

    def _call_runtime(
        self,
        *,
        tool_name: str,
        path: str,
        payload: JsonDict,
        headers: CanonicalHeaders,
    ) -> JsonDict:
        flat_response = self.runtime.request(
            path=path,
            headers=headers.runtime_headers(),
            json=payload,
            canonical_trace_headers=headers.canonical_trace_headers(),
        )
        request_id = str(flat_response.get("request_id") or headers.tool_call_id)
        if "error" in flat_response:
            return {
                "ok": False,
                "tool_name": tool_name,
                "contract_version": self.settings.contract_version,
                "request_id": request_id,
                "trace_id": headers.trace_id,
                "error": flat_response["error"],
            }
        if "detail" in flat_response:
            return {
                "ok": False,
                "tool_name": tool_name,
                "contract_version": self.settings.contract_version,
                "request_id": request_id,
                "trace_id": headers.trace_id,
                "error": _detail_to_canonical_error(flat_response["detail"]),
            }

        data = dict(flat_response)
        data.pop("request_id", None)
        return {
            "ok": True,
            "tool_name": tool_name,
            "contract_version": self.settings.contract_version,
            "request_id": request_id,
            "trace_id": headers.trace_id,
            "data": data,
        }


def _normalize_key(key: str) -> str:
    normalized = key.strip().lower().replace("-", "_")
    if normalized.startswith("x_"):
        normalized = normalized[2:]
    return normalized


def _string_value(data: JsonDict, key: str, default: str = "") -> str:
    return str(data.get(key) or default)


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text else None


def _as_string_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def _detail_to_canonical_error(detail: object) -> JsonDict:
    if isinstance(detail, dict):
        code = str(detail.get("code") or "runtime_error")
        message = str(detail.get("message") or detail.get("detail") or code)
        retryable = bool(detail.get("retryable", False))
        return {
            "code": code,
            "message": message,
            "retryable": retryable,
        }

    if isinstance(detail, list) and detail:
        first = detail[0]
        if isinstance(first, dict):
            code = str(first.get("type") or "invalid_request")
            location = first.get("loc")
            if isinstance(location, (list, tuple)):
                location_text = ".".join(str(item) for item in location)
            else:
                location_text = str(location) if location else "request"
            message = f"{location_text}: {first.get('msg', code)}"
            return {
                "code": code,
                "message": message,
                "retryable": False,
            }

    return {
        "code": "runtime_error",
        "message": str(detail),
        "retryable": False,
    }
