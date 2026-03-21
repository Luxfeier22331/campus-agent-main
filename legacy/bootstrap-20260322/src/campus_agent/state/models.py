from __future__ import annotations

from dataclasses import dataclass, field


JsonDict = dict[str, object]


@dataclass(slots=True)
class WorkflowTraceContext:
    trace_id: str
    parent_run_id: str
    tool_call_id: str

    def to_dict(self) -> JsonDict:
        return {
            "trace_id": self.trace_id,
            "parent_run_id": self.parent_run_id,
            "tool_call_id": self.tool_call_id,
        }

    @classmethod
    def from_dict(cls, data: JsonDict) -> "WorkflowTraceContext":
        return cls(
            trace_id=str(data["trace_id"]),
            parent_run_id=str(data["parent_run_id"]),
            tool_call_id=str(data["tool_call_id"]),
        )


@dataclass(slots=True)
class WorkflowActorContext:
    user_id: str | None = None
    roles: tuple[str, ...] = ()
    departments: tuple[str, ...] = ()
    groups: tuple[str, ...] = ()
    campus_scope: str | None = None
    snapshot: JsonDict = field(default_factory=dict)

    def to_dict(self) -> JsonDict:
        return {
            "user_id": self.user_id,
            "roles": list(self.roles),
            "departments": list(self.departments),
            "groups": list(self.groups),
            "campus_scope": self.campus_scope,
            "snapshot": dict(self.snapshot),
        }

    @classmethod
    def from_dict(cls, data: JsonDict | None) -> "WorkflowActorContext":
        payload = data or {}
        return cls(
            user_id=_optional_str(payload.get("user_id")),
            roles=tuple(_as_string_list(payload.get("roles"))),
            departments=tuple(_as_string_list(payload.get("departments"))),
            groups=tuple(_as_string_list(payload.get("groups"))),
            campus_scope=_optional_str(payload.get("campus_scope")),
            snapshot=dict(payload.get("snapshot") or {}),
        )

    def to_actor_snapshot(self) -> JsonDict:
        snapshot = {
            "actor_roles": list(self.roles),
            "actor_departments": list(self.departments),
            "actor_groups": list(self.groups),
            "is_authenticated": bool(self.user_id),
        }
        if self.user_id:
            snapshot["actor_user_id"] = self.user_id
        if self.campus_scope:
            snapshot["campus_scope"] = self.campus_scope
        return snapshot


@dataclass(slots=True)
class ToolExecutionRecord:
    tool_name: str
    tool_call_id: str
    request: JsonDict
    response: JsonDict
    status: str

    def to_dict(self) -> JsonDict:
        return {
            "tool_name": self.tool_name,
            "tool_call_id": self.tool_call_id,
            "request": dict(self.request),
            "response": dict(self.response),
            "status": self.status,
        }

    @classmethod
    def from_dict(cls, data: JsonDict) -> "ToolExecutionRecord":
        return cls(
            tool_name=str(data["tool_name"]),
            tool_call_id=str(data["tool_call_id"]),
            request=dict(data.get("request") or {}),
            response=dict(data.get("response") or {}),
            status=str(data["status"]),
        )


@dataclass(slots=True)
class WorkflowState:
    conversation_id: str
    workflow_run_id: str
    user_query: str
    intent: str | None = None
    selected_tool: str | None = None
    tool_results: list[ToolExecutionRecord] = field(default_factory=list)
    final_answer: str | None = None
    directory_query: str | None = None
    directory_candidates: list[JsonDict] = field(default_factory=list)
    selected_directory_entry: JsonDict | None = None
    campus_candidates: list[JsonDict] = field(default_factory=list)
    selected_campus: JsonDict | None = None
    poi_candidates: list[JsonDict] = field(default_factory=list)
    selected_poi: JsonDict | None = None
    target_coordinate: JsonDict | None = None
    navigation_mode: str | None = None
    pending_confirmation: bool = False
    trace: WorkflowTraceContext | None = None
    actor_context: WorkflowActorContext = field(default_factory=WorkflowActorContext)
    actor_snapshot: JsonDict = field(default_factory=dict)
    status: str = "pending"
    last_completed_step: str | None = None
    resume_token: str | None = None
    error_code: str | None = None
    retry_count: int = 0
    hitl_context: JsonDict = field(default_factory=dict)
    extension_state: JsonDict = field(default_factory=dict)
    schema_version: str = "v1"

    def to_dict(self) -> JsonDict:
        return {
            "schema_version": self.schema_version,
            "conversation_id": self.conversation_id,
            "workflow_run_id": self.workflow_run_id,
            "user_query": self.user_query,
            "intent": self.intent,
            "selected_tool": self.selected_tool,
            "tool_results": [record.to_dict() for record in self.tool_results],
            "final_answer": self.final_answer,
            "directory_query": self.directory_query,
            "directory_candidates": list(self.directory_candidates),
            "selected_directory_entry": self.selected_directory_entry,
            "campus_candidates": list(self.campus_candidates),
            "selected_campus": self.selected_campus,
            "poi_candidates": list(self.poi_candidates),
            "selected_poi": self.selected_poi,
            "target_coordinate": self.target_coordinate,
            "navigation_mode": self.navigation_mode,
            "pending_confirmation": self.pending_confirmation,
            "trace": self.trace.to_dict() if self.trace else None,
            "actor_context": self.actor_context.to_dict(),
            "actor_snapshot": dict(self.actor_snapshot),
            "status": self.status,
            "last_completed_step": self.last_completed_step,
            "resume_token": self.resume_token,
            "error_code": self.error_code,
            "retry_count": self.retry_count,
            "hitl_context": dict(self.hitl_context),
            "extension_state": dict(self.extension_state),
        }

    @classmethod
    def from_dict(cls, data: JsonDict) -> "WorkflowState":
        return cls(
            schema_version=str(data.get("schema_version") or "v1"),
            conversation_id=str(data["conversation_id"]),
            workflow_run_id=str(data["workflow_run_id"]),
            user_query=str(data["user_query"]),
            intent=_optional_str(data.get("intent")),
            selected_tool=_optional_str(data.get("selected_tool")),
            tool_results=[
                ToolExecutionRecord.from_dict(item)
                for item in list(data.get("tool_results") or [])
            ],
            final_answer=_optional_str(data.get("final_answer")),
            directory_query=_optional_str(data.get("directory_query")),
            directory_candidates=list(data.get("directory_candidates") or []),
            selected_directory_entry=data.get("selected_directory_entry"),
            campus_candidates=list(data.get("campus_candidates") or []),
            selected_campus=data.get("selected_campus"),
            poi_candidates=list(data.get("poi_candidates") or []),
            selected_poi=data.get("selected_poi"),
            target_coordinate=data.get("target_coordinate"),
            navigation_mode=_optional_str(data.get("navigation_mode")),
            pending_confirmation=bool(data.get("pending_confirmation", False)),
            trace=WorkflowTraceContext.from_dict(data["trace"])
            if data.get("trace")
            else None,
            actor_context=WorkflowActorContext.from_dict(data.get("actor_context")),
            actor_snapshot=dict(data.get("actor_snapshot") or {}),
            status=str(data.get("status") or "pending"),
            last_completed_step=_optional_str(data.get("last_completed_step")),
            resume_token=_optional_str(data.get("resume_token")),
            error_code=_optional_str(data.get("error_code")),
            retry_count=int(data.get("retry_count", 0)),
            hitl_context=dict(data.get("hitl_context") or {}),
            extension_state=dict(data.get("extension_state") or {}),
        )


def _as_string_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text else None
