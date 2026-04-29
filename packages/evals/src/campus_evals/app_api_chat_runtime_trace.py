from __future__ import annotations

from campus_contracts import (
    ClaimSupport,
    KnowledgeScope,
    PromptTrace,
    RagResultPayload,
    RemoteContentSuspicionSummary,
    SourceTrustSummary,
    SupervisorResponse,
)

from campus_evals.models import ObservedTrace

from .app_api_chat_runtime_support import (
    _optional_bool,
    _optional_int,
    _optional_record,
    _optional_string,
    _required_string,
    _string_tuple,
)


def _parse_prompt_trace(value: object) -> PromptTrace | None:
    record = _optional_record(value)
    if record is None:
        return None
    return PromptTrace(
        prompt_id=_optional_string(
            record.get("prompt_id") if "prompt_id" in record else record.get("promptId")
        )
        or "",
        prompt_version=_optional_string(
            record.get("prompt_version")
            if "prompt_version" in record
            else record.get("promptVersion")
        )
        or "",
        template_sha256=_optional_string(
            record.get("template_sha256")
            if "template_sha256" in record
            else record.get("templateSha256")
        )
        or "",
        variables_schema_version=_optional_string(
            record.get("variables_schema_version")
            if "variables_schema_version" in record
            else record.get("variablesSchemaVersion")
        )
        or "",
        output_schema_version=_optional_string(
            record.get("output_schema_version")
            if "output_schema_version" in record
            else record.get("outputSchemaVersion")
        )
        or "",
        model_provider=_optional_string(
            record.get("model_provider")
            if "model_provider" in record
            else record.get("modelProvider")
        )
        or "",
        model_name=_optional_string(
            record.get("model_name") if "model_name" in record else record.get("modelName")
        )
        or "",
    )


def _parse_claim_support(value: object, *, field: str) -> ClaimSupport:
    record = _optional_record(value)
    if record is None:
        raise ValueError(f"{field} must be an object")
    return ClaimSupport(
        claim_type=_required_string(
            record.get("claim_type") if "claim_type" in record else record.get("claimType"),
            f"{field}.claim_type",
        ),
        claim_text=_required_string(
            record.get("claim_text") if "claim_text" in record else record.get("claimText"),
            f"{field}.claim_text",
        ),
        supported=bool(record.get("supported")),
        support_source_doc_id=_optional_string(
            record.get("support_source_doc_id")
            if "support_source_doc_id" in record
            else record.get("supportSourceDocId")
        )
        or "",
        support_snippet=_optional_string(
            record.get("support_snippet")
            if "support_snippet" in record
            else record.get("supportSnippet")
        )
        or "",
        required_source_trust_tier=_optional_string(
            record.get("required_source_trust_tier")
            if "required_source_trust_tier" in record
            else record.get("requiredSourceTrustTier")
        )
        or "",
        support_source_trust_tier=_optional_string(
            record.get("support_source_trust_tier")
            if "support_source_trust_tier" in record
            else record.get("supportSourceTrustTier")
        )
        or "",
    )


def _parse_source_trust_summary(value: object) -> SourceTrustSummary | None:
    record = _optional_record(value)
    if record is None:
        return None
    return SourceTrustSummary(
        observed_tiers=_string_tuple(
            record.get("observed_tiers")
            if "observed_tiers" in record
            else record.get("observedTiers")
        ),
        answer_bearing_tiers=_string_tuple(
            record.get("answer_bearing_tiers")
            if "answer_bearing_tiers" in record
            else record.get("answerBearingTiers")
        ),
        blocked_claim_types=_string_tuple(
            record.get("blocked_claim_types")
            if "blocked_claim_types" in record
            else record.get("blockedClaimTypes")
        ),
        freshness_claim_blocked=_optional_bool(
            record.get("freshness_claim_blocked")
            if "freshness_claim_blocked" in record
            else record.get("freshnessClaimBlocked")
        )
        or False,
        authorization_claim_blocked=_optional_bool(
            record.get("authorization_claim_blocked")
            if "authorization_claim_blocked" in record
            else record.get("authorizationClaimBlocked")
        )
        or False,
    )


def _parse_remote_content_suspicion_summary(
    value: object,
) -> RemoteContentSuspicionSummary | None:
    record = _optional_record(value)
    if record is None:
        return None
    return RemoteContentSuspicionSummary(
        flagged_source_count=_optional_int(
            record.get("flagged_source_count")
            if "flagged_source_count" in record
            else record.get("flaggedSourceCount")
        )
        or 0,
        flag_labels=_string_tuple(
            record.get("flag_labels") if "flag_labels" in record else record.get("flagLabels")
        ),
        generation_blocked=_optional_bool(
            record.get("generation_blocked")
            if "generation_blocked" in record
            else record.get("generationBlocked")
        )
        or False,
    )


def _build_observed_trace(*, scope: dict[str, str], response: SupervisorResponse) -> ObservedTrace:
    retrieved_sources = ()
    supporting_sources = ()
    if isinstance(response.result, RagResultPayload):
        supporting_sources = tuple(response.result.evidence.sources)
        if response.observability is not None and response.observability.retrieved_sources:
            retrieved_sources = tuple(response.observability.retrieved_sources)
        elif (
            response.result.diagnostics is not None
            and response.result.diagnostics.retrieved_sources
        ):
            retrieved_sources = tuple(response.result.diagnostics.retrieved_sources)
        elif (
            response.observability is not None
            and response.observability.retrieval_attempted is True
            and supporting_sources
        ):
            retrieved_sources = supporting_sources

    retrieval_called = (
        response.observability.retrieval_attempted if response.observability is not None else None
    )
    if retrieval_called is None and isinstance(response.result, RagResultPayload):
        retrieval_called = bool(retrieved_sources or supporting_sources)

    return ObservedTrace(
        selected_scope=KnowledgeScope(
            corpus=_required_string(scope.get("corpus"), "scope.corpus"),
            collection=_required_string(scope.get("collection"), "scope.collection"),
        ),
        retrieval_called=retrieval_called,
        clarification_emitted=response.status == "needs_clarification",
        error_path=response.status == "error",
        retrieved_sources=retrieved_sources,
        supporting_sources=supporting_sources,
    )
