from __future__ import annotations

import json

from agents import Agent, FunctionTool, ModelSettings, RunConfig, Runner
from agents.models.openai_provider import OpenAIProvider
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
    reject_model_supplied_scope_or_selector,
    resolve_admitted_query_slot_id,
)
from campus_rag_agent.rag_sdk_trace import build_rag_sdk_trace_projection
from campus_shared import PromptRuntimeProviderConfig
from pydantic import BaseModel, ConfigDict, Field

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
    ) -> None:
        self._provider_config = provider_config
        self._model_name = model_name.strip()
        self._instructions = instructions.strip() or _RAG_SDK_INSTRUCTIONS
        self._max_turns = max_turns
        if not self._model_name:
            raise ValueError("RAG Agents SDK runner model_name is required")
        if self._max_turns <= 1:
            raise ValueError("RAG Agents SDK runner max_turns must allow tool use")

    def __call__(self, request: RagSdkRunRequest) -> RagSdkRunResult:
        agent = Agent(
            name="rag-agent-internal-sdk-loop",
            instructions=self._instructions,
            tools=[self.build_retrieve_evidence_tool(request)],
            model=self._model_name,
            model_settings=ModelSettings(
                tool_choice="required",
                parallel_tool_calls=False,
                max_tokens=self._provider_config.max_output_tokens,
            ),
            output_type=_RagSdkStructuredOutput,
        )
        result = Runner.run_sync(
            agent,
            request.user_goal,
            context=request,
            max_turns=self._max_turns,
            run_config=RunConfig(
                model_provider=OpenAIProvider(
                    api_key=self._provider_config.api_key,
                    base_url=self._provider_config.base_url,
                    use_responses=True,
                ),
                tracing_disabled=True,
                trace_include_sensitive_data=False,
            ),
        )
        output = _coerce_structured_output(getattr(result, "final_output", None))
        return RagSdkRunResult(
            output=output,
            trace_projection=build_rag_sdk_trace_projection(
                rollout_mode=request.rollout_mode,
                runtime="openai_agents_sdk",
                tool_names=("retrieve_evidence",),
                model_response_ref=str(getattr(result, "last_response_id", "") or ""),
            ),
        )

    def build_retrieve_evidence_tool(self, request: RagSdkRunRequest) -> FunctionTool:
        async def invoke_tool(_context: object, raw_arguments: str) -> str:
            arguments = _parse_tool_arguments(raw_arguments)
            try:
                reject_model_supplied_scope_or_selector(arguments)
                query_slot_id = resolve_admitted_query_slot_id(
                    arguments.get("query_slot_id"),
                    admitted_query_slot_ids=request.query_intent.admitted_query_slot_ids,
                )
            except RagSdkToolError as exc:
                raise ValueError(exc.failure_class) from exc
            return json.dumps(
                {
                    "status": "completed",
                    "query_slot_id": query_slot_id,
                    "retrieval_intent": str(arguments.get("retrieval_intent") or "").strip(),
                    "corpus": request.evidence.corpus,
                    "collection": request.evidence.collection,
                    "source_count": len(request.evidence.anchors),
                    "anchors": [
                        {
                            "source_id": anchor.source_id,
                            "chunk_id": anchor.chunk_id,
                            "excerpt": anchor.excerpt,
                            "span_ref": anchor.span_ref,
                            "title": anchor.title,
                            "url": anchor.url,
                        }
                        for anchor in request.evidence.anchors
                    ],
                },
                ensure_ascii=False,
                sort_keys=True,
            )

        return FunctionTool(
            name="retrieve_evidence",
            description=(
                "Return bounded evidence anchors for an admitted deterministic RAG query slot."
            ),
            params_json_schema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "query_slot_id": {
                        "type": "string",
                        "description": "One of the admitted deterministic query slot ids.",
                    },
                    "retrieval_intent": {
                        "type": "string",
                        "description": "Short semantic label for the requested evidence.",
                    },
                },
                "required": ["query_slot_id", "retrieval_intent"],
            },
            on_invoke_tool=invoke_tool,
            strict_json_schema=True,
            timeout_behavior="raise_exception",
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


def _anchor(value: _RagSdkStructuredAnchor) -> RagSdkEvidenceAnchor:
    return RagSdkEvidenceAnchor(
        source_id=value.source_id,
        chunk_id=value.chunk_id,
        excerpt=value.excerpt,
        span_ref=value.span_ref,
        title=value.title,
        url=value.url,
    )


def _parse_tool_arguments(raw_arguments: str) -> dict[str, object]:
    try:
        parsed = json.loads(raw_arguments or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("rag_sdk_bad_tool_arguments") from exc
    if not isinstance(parsed, dict):
        raise ValueError("rag_sdk_bad_tool_arguments")
    return dict(parsed)


__all__ = ["OpenAIRagAgentsSdkRunner"]
