from __future__ import annotations

import json
from dataclasses import replace

from campus_rag_agent.rag_sdk_models import (
    RagSdkEvidenceAnchor,
    RagSdkRunRequest,
    RagSdkRunResult,
)
from campus_rag_agent.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
    RagSdkListItem,
    RagSdkListItemSupport,
)
from campus_rag_agent.rag_sdk_tools import (
    RagSdkToolError,
)
from campus_rag_agent.rag_sdk_trace import build_rag_sdk_trace_projection
from campus_shared import PromptRuntimeProviderConfig
from pydantic import BaseModel, ConfigDict, Field

from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.openai_agents_runtime import (
    OpenAIAgentsNativeRuntime,
    OpenAIAgentsRuntimeError,
    OpenAIAgentsToolInvocation,
)
from campus_supervisor_agent_worker.tool_execution import (
    ToolExecutionContext,
    ToolExecutionSession,
    build_default_tool_execution_session,
)
from campus_supervisor_agent_worker.tool_spec_registry import default_tool_spec_registry

_RAG_SDK_INSTRUCTIONS = """
You are a bounded campus RAG synthesis loop.
Use the retrieve_evidence function tool before producing a final answer.
Only answer from the bounded evidence anchors returned by the tool.
Every factual claim and every list item must cite source ids and claim/list support anchors with
source_id, chunk_id, excerpt and span_ref. Do not invent sources, URLs, policies, dates or
procedures.
""".strip()


class _RagSdkStructuredAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    chunk_id: str = ""
    excerpt: str
    span_ref: str
    title: str = ""
    url: str = ""


class _RagSdkStructuredClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim_id: str
    text: str
    claim_type: str = "fact"


class _RagSdkStructuredListItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    source_ids: list[str] = Field(default_factory=list)


class _RagSdkStructuredClaimSupport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim_id: str
    anchors: list[_RagSdkStructuredAnchor] = Field(default_factory=list)


class _RagSdkStructuredListItemSupport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_text: str
    anchors: list[_RagSdkStructuredAnchor] = Field(default_factory=list)


class _RagSdkStructuredOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer_text: str
    answer_kind: str
    semantic_outcome: str
    confidence: str
    cited_source_ids: list[str] = Field(default_factory=list)
    answer_items: list[_RagSdkStructuredListItem] = Field(default_factory=list)
    claims: list[_RagSdkStructuredClaim] = Field(default_factory=list)
    claim_supports: list[_RagSdkStructuredClaimSupport] = Field(default_factory=list)
    item_supports: list[_RagSdkStructuredListItemSupport] = Field(default_factory=list)
    evidence_anchors: list[_RagSdkStructuredAnchor] = Field(default_factory=list)
    coverage_note: str = ""
    limitations: list[str] = Field(default_factory=list)
    unsupported_reason: str = ""
    needs_clarification: bool = False
    follow_up_question: str = ""


class OpenAIRagAgentsSdkRunner:
    def __init__(
        self,
        *,
        provider_config: PromptRuntimeProviderConfig,
        model_name: str,
        instructions: str = _RAG_SDK_INSTRUCTIONS,
        max_turns: int = 3,
        tool_execution_session: ToolExecutionSession | None = None,
    ) -> None:
        self._instructions = instructions.strip() or _RAG_SDK_INSTRUCTIONS
        self._runtime = OpenAIAgentsNativeRuntime(
            provider_config=provider_config,
            model_name=model_name,
            max_turns=max_turns,
        )
        self._tool_execution_session = tool_execution_session or _build_rag_tool_execution_session()

    def __call__(self, request: RagSdkRunRequest) -> RagSdkRunResult:
        result = self._runtime.run(
            agent_name="rag-agent-internal-sdk-loop",
            instructions=self._instructions,
            input_text=request.user_goal,
            context=request,
            tool_descriptors=build_agents_sdk_tool_descriptors(("retrieve_evidence",)),
            output_type=_RagSdkStructuredOutput,
            execute_tool=lambda invocation: self._execute_retrieve_evidence_tool(
                invocation,
                request=request,
            ),
        )
        output = _coerce_structured_output(result.final_output)
        return RagSdkRunResult(
            output=output,
            trace_projection=build_rag_sdk_trace_projection(
                runtime="openai_agents_sdk",
                tool_names=("retrieve_evidence",),
                model_response_ref=result.model_response_ref,
            ),
        )

    def build_retrieve_evidence_tool(self, request: RagSdkRunRequest):
        from agents import FunctionTool

        descriptor = build_agents_sdk_tool_descriptors(("retrieve_evidence",))[0]

        async def invoke_tool(context: object, raw_arguments: str) -> str:
            arguments = _parse_tool_arguments(raw_arguments)
            try:
                result = self._execute_retrieve_evidence_tool(
                    OpenAIAgentsToolInvocation(
                        name=descriptor.name,
                        arguments=arguments,
                        call_id=str(getattr(context, "tool_call_id", "") or ""),
                    ),
                    request=request,
                )
            except OpenAIAgentsRuntimeError as exc:
                raise ValueError(exc.failure_class) from exc
            return json.dumps(result, ensure_ascii=False, sort_keys=True)

        return FunctionTool(
            name=descriptor.name,
            description=descriptor.description,
            params_json_schema=descriptor.parameters,
            on_invoke_tool=invoke_tool,
            strict_json_schema=descriptor.function_schema_strict,
            timeout_seconds=None,
            timeout_behavior="raise_exception",
        )

    def _execute_retrieve_evidence_tool(
        self,
        invocation: OpenAIAgentsToolInvocation,
        *,
        request: RagSdkRunRequest,
    ) -> dict[str, object]:
        try:
            result = self._tool_execution_session.execute_sdk_tool(
                invocation,
                context=ToolExecutionContext(rag_sdk_request=request),
            )
        except RagSdkToolError as exc:
            raise OpenAIAgentsRuntimeError(exc.failure_class, exc.failure_class) from exc
        except Exception as exc:
            if isinstance(exc, OpenAIAgentsRuntimeError):
                raise
            message = str(exc)
            failure_class = message.split(":", 1)[0] if ":" in message else "sdk_tool_failed"
            raise OpenAIAgentsRuntimeError(failure_class, message) from exc
        if not isinstance(result, dict):
            raise OpenAIAgentsRuntimeError(
                "sdk_tool_failed",
                "retrieve_evidence must return a bounded mapping result",
            )
        return result


def _build_rag_tool_execution_session() -> ToolExecutionSession:
    registry = default_tool_spec_registry()
    rag_only_registry = replace(
        registry,
        tools=tuple(tool for tool in registry.tools if tool.name == "retrieve_evidence"),
    )
    return build_default_tool_execution_session(
        campus_services_query_service=None,
        notice_query_service=None,
        tool_registry=rag_only_registry,
    )


def _coerce_structured_output(value: object) -> RagSdkAnswerOutput:
    if isinstance(value, _RagSdkStructuredOutput):
        output = value
    elif isinstance(value, BaseModel):
        output = _RagSdkStructuredOutput.model_validate(value.model_dump())
    elif isinstance(value, dict):
        output = _RagSdkStructuredOutput.model_validate(value)
    elif isinstance(value, str):
        output = _RagSdkStructuredOutput.model_validate_json(value)
    else:
        raise ValueError("rag_sdk_malformed_output")
    return RagSdkAnswerOutput(
        answer_text=output.answer_text,
        answer_kind=output.answer_kind,
        semantic_outcome=output.semantic_outcome,
        confidence=output.confidence,
        cited_source_ids=tuple(output.cited_source_ids),
        answer_items=tuple(
            RagSdkListItem(text=item.text, source_ids=tuple(item.source_ids))
            for item in output.answer_items
        ),
        claims=tuple(
            RagSdkClaim(
                claim_id=claim.claim_id,
                text=claim.text,
                claim_type=claim.claim_type,
            )
            for claim in output.claims
        ),
        claim_supports=tuple(
            RagSdkClaimSupport(
                claim_id=support.claim_id,
                anchors=tuple(_anchor(anchor) for anchor in support.anchors),
            )
            for support in output.claim_supports
        ),
        item_supports=tuple(
            RagSdkListItemSupport(
                item_text=support.item_text,
                anchors=tuple(_anchor(anchor) for anchor in support.anchors),
            )
            for support in output.item_supports
        ),
        evidence_anchors=tuple(_anchor(anchor) for anchor in output.evidence_anchors),
        coverage_note=output.coverage_note,
        limitations=tuple(output.limitations),
        unsupported_reason=output.unsupported_reason,
        needs_clarification=output.needs_clarification,
        follow_up_question=output.follow_up_question,
    )


def _parse_tool_arguments(raw_arguments: str) -> dict[str, object]:
    try:
        parsed = json.loads(raw_arguments or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("rag_sdk_bad_arguments") from exc
    if not isinstance(parsed, dict):
        raise ValueError("rag_sdk_bad_arguments")
    return dict(parsed)


def _anchor(value: _RagSdkStructuredAnchor) -> RagSdkEvidenceAnchor:
    return RagSdkEvidenceAnchor(
        source_id=value.source_id,
        chunk_id=value.chunk_id,
        excerpt=value.excerpt,
        span_ref=value.span_ref,
        title=value.title,
        url=value.url,
    )


__all__ = ["OpenAIRagAgentsSdkRunner"]
