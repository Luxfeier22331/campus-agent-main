from __future__ import annotations

from campus_contracts import ExecutionObservability

from .app_api_chat_runtime_support import (
    _optional_bool,
    _optional_int,
    _optional_list,
    _optional_record,
    _optional_string,
)
from .app_api_chat_runtime_trace import _parse_prompt_trace


def _optional_string_mapping(value: object) -> dict[str, str]:
    record = _optional_record(value)
    if record is None:
        return {}
    return {
        str(key): item for key, item in record.items() if isinstance(item, str) and item.strip()
    }


def _parse_execution_observability(value: object) -> ExecutionObservability | None:
    record = _optional_record(value)
    if record is None:
        return None
    from .app_api_chat_runtime_decoding import _parse_observed_source

    return ExecutionObservability(
        retrieval_attempted=_optional_bool(
            record.get("retrievalAttempted")
            if "retrievalAttempted" in record
            else record.get("retrieval_attempted")
        ),
        candidate_count=_optional_int(
            record.get("candidateCount")
            if "candidateCount" in record
            else record.get("candidate_count")
        ),
        retrieved_source_count=_optional_int(
            record.get("retrievedSourceCount")
            if "retrievedSourceCount" in record
            else record.get("retrieved_source_count")
        ),
        retrieved_sources=tuple(
            _parse_observed_source(
                item,
                field=f"supervisor.observability.retrieved_sources[{index}]",
            )
            for index, item in enumerate(
                _optional_list(
                    record.get("retrievedSources")
                    if "retrievedSources" in record
                    else record.get("retrieved_sources")
                )
            )
        ),
        citation_expected=_optional_bool(
            record.get("citationExpected")
            if "citationExpected" in record
            else record.get("citation_expected")
        ),
        citation_count=_optional_int(
            record.get("citationCount")
            if "citationCount" in record
            else record.get("citation_count")
        ),
        citation_missing=_optional_bool(
            record.get("citationMissing")
            if "citationMissing" in record
            else record.get("citation_missing")
        ),
        refusal_class=_optional_string(
            record.get("refusalClass") if "refusalClass" in record else record.get("refusal_class")
        )
        or "",
        semantic_outcome=_optional_string(
            record.get("semanticOutcome")
            if "semanticOutcome" in record
            else record.get("semantic_outcome")
        )
        or "",
        scope_class=_optional_string(
            record.get("scopeClass") if "scopeClass" in record else record.get("scope_class")
        )
        or "",
        policy_reason=_optional_string(
            record.get("policyReason") if "policyReason" in record else record.get("policy_reason")
        )
        or "",
        intent_capability=_optional_string(
            record.get("intentCapability")
            if "intentCapability" in record
            else record.get("intent_capability")
        )
        or "",
        intent_task_kind=_optional_string(
            record.get("intentTaskKind")
            if "intentTaskKind" in record
            else record.get("intent_task_kind")
        )
        or "",
        intent_launch_state=_optional_string(
            record.get("intentLaunchState")
            if "intentLaunchState" in record
            else record.get("intent_launch_state")
        )
        or "",
        intent_next_action=_optional_string(
            record.get("intentNextAction")
            if "intentNextAction" in record
            else record.get("intent_next_action")
        )
        or "",
        intent_scope_class=_optional_string(
            record.get("intentScopeClass")
            if "intentScopeClass" in record
            else record.get("intent_scope_class")
        )
        or "",
        intent_scope_reason=_optional_string(
            record.get("intentScopeReason")
            if "intentScopeReason" in record
            else record.get("intent_scope_reason")
        )
        or "",
        intent_policy_reason=_optional_string(
            record.get("intentPolicyReason")
            if "intentPolicyReason" in record
            else record.get("intent_policy_reason")
        )
        or "",
        intent_classifier_version=_optional_string(
            record.get("intentClassifierVersion")
            if "intentClassifierVersion" in record
            else record.get("intent_classifier_version")
        )
        or "",
        intent_schema_version=_optional_string(
            record.get("intentSchemaVersion")
            if "intentSchemaVersion" in record
            else record.get("intent_schema_version")
        )
        or "",
        intent_routing_confidence=_optional_string(
            record.get("intentRoutingConfidence")
            if "intentRoutingConfidence" in record
            else record.get("intent_routing_confidence")
        )
        or "",
        intent_ambiguity_signal=_optional_string(
            record.get("intentAmbiguitySignal")
            if "intentAmbiguitySignal" in record
            else record.get("intent_ambiguity_signal")
        )
        or "",
        intent_context_resolution_state=_optional_string(
            record.get("intentContextResolutionState")
            if "intentContextResolutionState" in record
            else record.get("intent_context_resolution_state")
        )
        or "",
        intent_context_reference_type=_optional_string(
            record.get("intentContextReferenceType")
            if "intentContextReferenceType" in record
            else record.get("intent_context_reference_type")
        )
        or "",
        intent_resolved_slots=_optional_string_mapping(
            record.get("intentResolvedSlots")
            if "intentResolvedSlots" in record
            else record.get("intent_resolved_slots")
        ),
        intent_missing_slots=tuple(
            item
            for item in _optional_list(
                record.get("intentMissingSlots")
                if "intentMissingSlots" in record
                else record.get("intent_missing_slots")
            )
            if isinstance(item, str) and item.strip()
        ),
        intent_ambiguity_reason=_optional_string(
            record.get("intentAmbiguityReason")
            if "intentAmbiguityReason" in record
            else record.get("intent_ambiguity_reason")
        )
        or "",
        acl_decision=_optional_string(
            record.get("aclDecision") if "aclDecision" in record else record.get("acl_decision")
        )
        or "",
        acl_anomaly_code=_optional_string(
            record.get("aclAnomalyCode")
            if "aclAnomalyCode" in record
            else record.get("acl_anomaly_code")
        )
        or "",
        fail_closed=_optional_bool(
            record.get("failClosed") if "failClosed" in record else record.get("fail_closed")
        ),
        selected_tool=_optional_string(
            record.get("selectedTool") if "selectedTool" in record else record.get("selected_tool")
        )
        or "",
        tool_business_outcome=_optional_string(
            record.get("toolBusinessOutcome")
            if "toolBusinessOutcome" in record
            else record.get("tool_business_outcome")
        )
        or "",
        tool_fail_close_reason=_optional_string(
            record.get("toolFailCloseReason")
            if "toolFailCloseReason" in record
            else record.get("tool_fail_close_reason")
        )
        or "",
        tool_historical_downgrade_reason=_optional_string(
            record.get("toolHistoricalDowngradeReason")
            if "toolHistoricalDowngradeReason" in record
            else record.get("tool_historical_downgrade_reason")
        )
        or "",
        notice_source_family_summary=_optional_string(
            record.get("noticeSourceFamilySummary")
            if "noticeSourceFamilySummary" in record
            else record.get("notice_source_family_summary")
        )
        or "",
        temporal_posture=_optional_string(
            record.get("temporalPosture")
            if "temporalPosture" in record
            else record.get("temporal_posture")
        )
        or "",
        model_provider=_optional_string(
            record.get("modelProvider")
            if "modelProvider" in record
            else record.get("model_provider")
        )
        or "",
        model_name=_optional_string(
            record.get("modelName") if "modelName" in record else record.get("model_name")
        )
        or "",
        input_tokens=_optional_int(
            record.get("inputTokens") if "inputTokens" in record else record.get("input_tokens")
        ),
        output_tokens=_optional_int(
            record.get("outputTokens") if "outputTokens" in record else record.get("output_tokens")
        ),
        cached_input_tokens=_optional_int(
            record.get("cachedInputTokens")
            if "cachedInputTokens" in record
            else record.get("cached_input_tokens")
        ),
        estimated_cost_microusd=_optional_int(
            record.get("estimatedCostMicrousd")
            if "estimatedCostMicrousd" in record
            else record.get("estimated_cost_microusd")
        ),
        resolved_scope_corpus=_optional_string(
            record.get("resolvedScopeCorpus")
            if "resolvedScopeCorpus" in record
            else record.get("resolved_scope_corpus")
        ),
        resolved_scope_collection=_optional_string(
            record.get("resolvedScopeCollection")
            if "resolvedScopeCollection" in record
            else record.get("resolved_scope_collection")
        )
        or "",
        prompt_runtime_state=_optional_string(
            record.get("promptRuntimeState")
            if "promptRuntimeState" in record
            else record.get("prompt_runtime_state")
        )
        or "",
        prompt_runtime_detail=_optional_string(
            record.get("promptRuntimeDetail")
            if "promptRuntimeDetail" in record
            else record.get("prompt_runtime_detail")
        )
        or "",
        prompt_trace=_parse_prompt_trace(
            record.get("promptTrace") if "promptTrace" in record else record.get("prompt_trace")
        ),
    )
