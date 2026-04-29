from __future__ import annotations

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    RagResultDiagnostics,
    RagResultPayload,
    SupervisorObservability,
    SupervisorResponse,
    WorkflowTraceSummary,
)

from .app_api_chat_runtime_support import (
    _optional_bool,
    _optional_int,
    _optional_list,
    _optional_record,
    _optional_string,
    _required_string,
    _string_tuple,
)
from .app_api_chat_runtime_trace import (
    _build_observed_trace,
    _parse_claim_support,
    _parse_prompt_trace,
    _parse_remote_content_suspicion_summary,
    _parse_source_trust_summary,
)

__all__ = (
    "_build_observed_trace",
    "_build_supervisor_response",
    "_build_supervisor_response_from_internal_eval",
)


def _optional_string_mapping(value: object) -> dict[str, str]:
    record = _optional_record(value)
    if record is None:
        return {}
    return {
        str(key): item for key, item in record.items() if isinstance(item, str) and item.strip()
    }


def _build_supervisor_response(result: dict[str, object]) -> SupervisorResponse:
    kind = _required_string(result.get("kind"), "answer.result.kind")
    request_id = _required_string(result.get("requestId"), "answer.result.requestId")
    del request_id
    trace_id = _required_string(result.get("traceId"), "answer.result.traceId")
    del trace_id

    if kind == "answer":
        return SupervisorResponse(
            selected_target="rag-agent",
            status="completed",
            answer_text=_required_string(result.get("text"), "answer.result.text"),
            confidence="low",
            result=None,
        )
    if kind == "clarification":
        follow_up = _required_string(result.get("text"), "answer.result.text")
        return SupervisorResponse(
            selected_target="rag-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="low",
            result=None,
        )
    if kind == "no_answer":
        return SupervisorResponse(
            selected_target="rag-agent",
            status="no_answer",
            answer_text=_required_string(result.get("text"), "answer.result.text"),
            confidence="low",
            result=None,
        )
    if kind == "error":
        message = _required_string(result.get("message"), "answer.result.message")
        error_code = _required_string(result.get("errorCode"), "answer.result.errorCode")
        return SupervisorResponse(
            selected_target=None,
            status="error",
            answer_text=message,
            confidence="low",
            error=ErrorInfo(
                code=error_code,
                message=message,
                retryable=bool(result.get("retryable")),
            ),
            result=None,
        )
    raise ValueError(f"unsupported app-api result kind: {kind}")


def _build_supervisor_response_from_internal_eval(payload: dict[str, object]) -> SupervisorResponse:
    status = _required_string(payload.get("status"), "supervisor.status")
    selected_target = _optional_string(payload.get("selectedTarget"))
    answer_text = _optional_string(payload.get("answerText")) or ""
    follow_up_question = _optional_string(payload.get("followUpQuestion")) or ""
    trace_id = _required_string(payload.get("traceId"), "supervisor.traceId")
    del trace_id
    error_payload = _optional_record(payload.get("error"))

    error = None
    if error_payload is not None:
        error = ErrorInfo(
            code=_required_string(error_payload.get("code"), "supervisor.error.code"),
            message=_required_string(error_payload.get("message"), "supervisor.error.message"),
            retryable=bool(error_payload.get("retryable")),
        )

    return SupervisorResponse(
        selected_target=selected_target,
        status=status,  # type: ignore[arg-type]
        answer_text=answer_text,
        follow_up_question=follow_up_question,
        confidence="low",
        result=_parse_supervisor_result(payload.get("result")),
        error=error,
        observability=_parse_supervisor_observability(payload.get("observability")),
        workflow_trace_summary=_parse_workflow_trace_summary(
            payload.get("workflow_trace_summary")
            if "workflow_trace_summary" in payload
            else payload.get("workflowTraceSummary")
        ),
    )


def _parse_workflow_trace_summary(value: object) -> WorkflowTraceSummary | None:
    record = _optional_record(value)
    if record is None:
        return None
    selected_tools = _optional_list(_record_value(record, "selected_tools", "selectedTools"))
    handoff_chain = _optional_list(_record_value(record, "handoff_chain", "handoffChain"))
    return WorkflowTraceSummary(
        routing_frame=_optional_record(_record_value(record, "routing_frame", "routingFrame"))
        or {},
        context_resolution=_optional_record(
            _record_value(record, "context_resolution", "contextResolution")
        )
        or {},
        planning_outcome=_optional_string(
            _record_value(record, "planning_outcome", "planningOutcome")
        )
        or "",
        direct_vs_delegate_branch=_optional_string(
            _record_value(record, "direct_vs_delegate_branch", "directVsDelegateBranch")
        )
        or "",
        workflow_mode=_optional_string(_record_value(record, "workflow_mode", "workflowMode"))
        or "",
        handoff=_optional_record(record.get("handoff")) or {},
        handoff_chain=tuple(dict(item) for item in handoff_chain if isinstance(item, dict)),
        selected_target=_optional_string(_record_value(record, "selected_target", "selectedTarget"))
        or "",
        selected_tools=tuple(str(item) for item in selected_tools if str(item).strip()),
        tool_argument_summary=_optional_record(
            _record_value(record, "tool_argument_summary", "toolArgumentSummary")
        )
        or {},
        trace_steps=_tuple_of_records(_record_value(record, "trace_steps", "traceSteps")),
        tool_call_summaries=_tuple_of_records(
            _record_value(record, "tool_call_summaries", "toolCallSummaries")
        ),
        guardrail_outcomes=_optional_record(
            _record_value(record, "guardrail_outcomes", "guardrailOutcomes")
        )
        or {},
        fail_close_reason=_optional_string(
            _record_value(record, "fail_close_reason", "failCloseReason")
        )
        or "",
        runtime_versions=_optional_record(
            _record_value(record, "runtime_versions", "runtimeVersions")
        )
        or {},
        policy_artifact_versions=_optional_record(
            _record_value(record, "policy_artifact_versions", "policyArtifactVersions")
        )
        or {},
    )


def _record_value(record: dict[str, object], snake_key: str, camel_key: str) -> object:
    return record.get(snake_key) if snake_key in record else record.get(camel_key)


def _tuple_of_records(value: object) -> tuple[dict[str, object], ...]:
    return tuple(dict(item) for item in _optional_list(value) if isinstance(item, dict))


def _parse_supervisor_result(value: object) -> RagResultPayload | None:
    record = _optional_record(value)
    evidence_record = _optional_record(record.get("evidence")) if record is not None else None
    if evidence_record is None:
        return None
    return RagResultPayload(
        evidence=EvidenceBundle(
            query_text=_optional_string(evidence_record.get("query_text")) or "",
            corpus=_required_string(
                evidence_record.get("corpus"), "supervisor.result.evidence.corpus"
            ),
            collection=_required_string(
                evidence_record.get("collection"),
                "supervisor.result.evidence.collection",
            ),
            sources=tuple(
                _parse_evidence_source(item, field=f"supervisor.result.evidence.sources[{index}]")
                for index, item in enumerate(_optional_list(evidence_record.get("sources")))
            ),
        ),
        diagnostics=_parse_rag_result_diagnostics(record.get("diagnostics")),
    )


def _parse_evidence_source(value: object, *, field: str) -> EvidenceSource:
    record = _optional_record(value)
    if record is None:
        raise ValueError(f"{field} must be an object")
    return EvidenceSource(
        doc_id=_required_string(record.get("doc_id"), f"{field}.doc_id"),
        revision_track=_required_string(record.get("revision_track"), f"{field}.revision_track"),
        version_id=_required_string(record.get("version_id"), f"{field}.version_id"),
        chunk_id=_required_string(record.get("chunk_id"), f"{field}.chunk_id"),
        anchor=_optional_record(record.get("anchor")) or {},
        canonical_url=_required_string(record.get("canonical_url"), f"{field}.canonical_url"),
        latest_url=_required_string(record.get("latest_url"), f"{field}.latest_url"),
        source_channel=_required_string(record.get("source_channel"), f"{field}.source_channel"),
        collection=_required_string(record.get("collection"), f"{field}.collection"),
        is_current=bool(record.get("is_current")),
        snippet=_required_string(record.get("snippet"), f"{field}.snippet"),
        score=float(record.get("score") or 0.0),
        source_title=_optional_string(record.get("source_title")) or "",
        canonical_source_id=_optional_string(record.get("canonical_source_id")) or "",
        canonical_source_title=_optional_string(record.get("canonical_source_title")) or "",
        source_unit_kind=_optional_string(record.get("source_unit_kind")) or "",
        source_unit_key=_optional_string(record.get("source_unit_key")) or "",
        remote_content_suspicion_labels=_string_tuple(
            record.get("remote_content_suspicion_labels")
            if "remote_content_suspicion_labels" in record
            else record.get("remoteContentSuspicionLabels")
        ),
        source_trust_tier=_optional_string(
            record.get("source_trust_tier")
            if "source_trust_tier" in record
            else record.get("sourceTrustTier")
        )
        or "",
    )


def _parse_observed_source(value: object, *, field: str) -> EvidenceSource:
    record = _optional_record(value)
    if record is None:
        raise ValueError(f"{field} must be an object")
    if "revision_track" in record and "version_id" in record and "canonical_url" in record:
        return _parse_evidence_source(record, field=field)

    doc_id = _required_string(
        record.get("doc_id") if "doc_id" in record else record.get("docId"),
        f"{field}.doc_id",
    )
    chunk_id = _optional_string(
        record.get("chunk_id") if "chunk_id" in record else record.get("chunkId")
    )
    collection = _required_string(record.get("collection"), f"{field}.collection")
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=_optional_string(
            record.get("version_id") if "version_id" in record else record.get("versionId")
        )
        or "observed-trace",
        chunk_id=chunk_id or f"{doc_id}:observed-trace",
        anchor=_optional_record(record.get("anchor")) or {},
        canonical_url=_optional_string(
            record.get("canonical_url") if "canonical_url" in record else record.get("canonicalUrl")
        )
        or "",
        latest_url=_optional_string(
            record.get("latest_url") if "latest_url" in record else record.get("latestUrl")
        )
        or "",
        source_channel=_optional_string(
            record.get("source_channel")
            if "source_channel" in record
            else record.get("sourceChannel")
        )
        or "pdf_ocr",
        collection=collection,
        is_current=bool(
            record.get("is_current") if "is_current" in record else record.get("isCurrent")
        ),
        snippet=_optional_string(record.get("snippet")) or "",
        score=float(record.get("score") or 0.0),
        source_title=_optional_string(
            record.get("source_title") if "source_title" in record else record.get("sourceTitle")
        )
        or "",
        canonical_source_id=_optional_string(
            record.get("canonical_source_id")
            if "canonical_source_id" in record
            else record.get("canonicalSourceId")
        )
        or "",
        canonical_source_title=_optional_string(
            record.get("canonical_source_title")
            if "canonical_source_title" in record
            else record.get("canonicalSourceTitle")
        )
        or "",
        source_unit_kind=_optional_string(
            record.get("source_unit_kind")
            if "source_unit_kind" in record
            else record.get("sourceUnitKind")
        )
        or "",
        source_unit_key=_optional_string(
            record.get("source_unit_key")
            if "source_unit_key" in record
            else record.get("sourceUnitKey")
        )
        or "",
        remote_content_suspicion_labels=_string_tuple(
            record.get("remote_content_suspicion_labels")
            if "remote_content_suspicion_labels" in record
            else record.get("remoteContentSuspicionLabels")
        ),
        source_trust_tier=_optional_string(
            record.get("source_trust_tier")
            if "source_trust_tier" in record
            else record.get("sourceTrustTier")
        )
        or "",
    )


def _parse_supervisor_observability(value: object) -> SupervisorObservability | None:
    record = _optional_record(value)
    if record is None:
        return None
    return SupervisorObservability(
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


def _parse_rag_result_diagnostics(value: object) -> RagResultDiagnostics | None:
    record = _optional_record(value)
    if record is None:
        return None
    return RagResultDiagnostics(
        resolved_scope_corpus=_optional_string(
            record.get("resolved_scope_corpus")
            if "resolved_scope_corpus" in record
            else record.get("resolvedScopeCorpus")
        ),
        resolved_scope_collection=_optional_string(
            record.get("resolved_scope_collection")
            if "resolved_scope_collection" in record
            else record.get("resolvedScopeCollection")
        )
        or "",
        resolved_policy_document_id=_optional_string(
            record.get("resolved_policy_document_id")
            if "resolved_policy_document_id" in record
            else record.get("resolvedPolicyDocumentId")
        )
        or "",
        resolved_policy_title=_optional_string(
            record.get("resolved_policy_title")
            if "resolved_policy_title" in record
            else record.get("resolvedPolicyTitle")
        )
        or "",
        rewritten_query=_optional_string(
            record.get("rewritten_query")
            if "rewritten_query" in record
            else record.get("rewrittenQuery")
        )
        or "",
        clarification_reason=_optional_string(
            record.get("clarification_reason")
            if "clarification_reason" in record
            else record.get("clarificationReason")
        )
        or "",
        no_answer_reason=_optional_string(
            record.get("no_answer_reason")
            if "no_answer_reason" in record
            else record.get("noAnswerReason")
        )
        or "",
        semantic_outcome=_optional_string(
            record.get("semantic_outcome")
            if "semantic_outcome" in record
            else record.get("semanticOutcome")
        )
        or "",
        retrieval_adequacy_verdict=_optional_string(
            record.get("retrieval_adequacy_verdict")
            if "retrieval_adequacy_verdict" in record
            else record.get("retrievalAdequacyVerdict")
        )
        or "",
        retrieval_adequacy_reason=_optional_string(
            record.get("retrieval_adequacy_reason")
            if "retrieval_adequacy_reason" in record
            else record.get("retrievalAdequacyReason")
        )
        or "",
        grounding_verdict=_optional_string(
            record.get("grounding_verdict")
            if "grounding_verdict" in record
            else record.get("groundingVerdict")
        )
        or "",
        grounding_downgraded=_optional_bool(
            record.get("grounding_downgraded")
            if "grounding_downgraded" in record
            else record.get("groundingDowngraded")
        )
        or False,
        freshness_fail_closed=_optional_bool(
            record.get("freshness_fail_closed")
            if "freshness_fail_closed" in record
            else record.get("freshnessFailClosed")
        )
        or False,
        scope_class=_optional_string(
            record.get("scope_class") if "scope_class" in record else record.get("scopeClass")
        )
        or "",
        policy_reason=_optional_string(
            record.get("policy_reason") if "policy_reason" in record else record.get("policyReason")
        )
        or "",
        retrieved_title_summary=_string_tuple(
            record.get("retrieved_title_summary")
            if "retrieved_title_summary" in record
            else record.get("retrievedTitleSummary")
        ),
        candidate_title_summary=_string_tuple(
            record.get("candidate_title_summary")
            if "candidate_title_summary" in record
            else record.get("candidateTitleSummary")
        ),
        resolution_mode=_optional_string(
            record.get("resolution_mode")
            if "resolution_mode" in record
            else record.get("resolutionMode")
        )
        or "",
        used_verified_identity=_optional_bool(
            record.get("used_verified_identity")
            if "used_verified_identity" in record
            else record.get("usedVerifiedIdentity")
        )
        or False,
        used_soft_preference=_optional_bool(
            record.get("used_soft_preference")
            if "used_soft_preference" in record
            else record.get("usedSoftPreference")
        )
        or False,
        resolved_entity_type=_optional_string(
            record.get("resolved_entity_type")
            if "resolved_entity_type" in record
            else record.get("resolvedEntityType")
        )
        or "",
        resolved_course_id=_optional_string(
            record.get("resolved_course_id")
            if "resolved_course_id" in record
            else record.get("resolvedCourseId")
        )
        or "",
        resolved_course_title=_optional_string(
            record.get("resolved_course_title")
            if "resolved_course_title" in record
            else record.get("resolvedCourseTitle")
        )
        or "",
        resolved_course_family_id=_optional_string(
            record.get("resolved_course_family_id")
            if "resolved_course_family_id" in record
            else record.get("resolvedCourseFamilyId")
        )
        or "",
        resolved_course_family_title=_optional_string(
            record.get("resolved_course_family_title")
            if "resolved_course_family_title" in record
            else record.get("resolvedCourseFamilyTitle")
        )
        or "",
        resolved_program_family_id=_optional_string(
            record.get("resolved_program_family_id")
            if "resolved_program_family_id" in record
            else record.get("resolvedProgramFamilyId")
        )
        or "",
        resolved_program_family_title=_optional_string(
            record.get("resolved_program_family_title")
            if "resolved_program_family_title" in record
            else record.get("resolvedProgramFamilyTitle")
        )
        or "",
        session_program_family=_optional_string(
            record.get("session_program_family")
            if "session_program_family" in record
            else record.get("sessionProgramFamily")
        )
        or "",
        session_program=_optional_string(
            record.get("session_program")
            if "session_program" in record
            else record.get("sessionProgram")
        )
        or "",
        session_semester=_optional_string(
            record.get("session_semester")
            if "session_semester" in record
            else record.get("sessionSemester")
        )
        or "",
        remote_content_suspicion_summary=_parse_remote_content_suspicion_summary(
            record.get("remote_content_suspicion_summary")
            if "remote_content_suspicion_summary" in record
            else record.get("remoteContentSuspicionSummary")
        ),
        source_trust_summary=_parse_source_trust_summary(
            record.get("source_trust_summary")
            if "source_trust_summary" in record
            else record.get("sourceTrustSummary")
        ),
        claim_supports=tuple(
            _parse_claim_support(
                item,
                field=f"supervisor.result.diagnostics.claim_supports[{index}]",
            )
            for index, item in enumerate(
                _optional_list(
                    record.get("claim_supports")
                    if "claim_supports" in record
                    else record.get("claimSupports")
                )
            )
        ),
        unsupported_fields=_string_tuple(
            record.get("unsupported_fields")
            if "unsupported_fields" in record
            else record.get("unsupportedFields")
        ),
        partial_answer=_optional_bool(
            record.get("partial_answer")
            if "partial_answer" in record
            else record.get("partialAnswer")
        )
        or False,
        prompt_runtime_state=_optional_string(
            record.get("prompt_runtime_state")
            if "prompt_runtime_state" in record
            else record.get("promptRuntimeState")
        )
        or "",
        prompt_runtime_detail=_optional_string(
            record.get("prompt_runtime_detail")
            if "prompt_runtime_detail" in record
            else record.get("promptRuntimeDetail")
        )
        or "",
        prompt_trace=_parse_prompt_trace(
            record.get("prompt_trace") if "prompt_trace" in record else record.get("promptTrace")
        ),
        retrieved_sources=tuple(
            _parse_observed_source(
                item,
                field=f"supervisor.result.diagnostics.retrieved_sources[{index}]",
            )
            for index, item in enumerate(
                _optional_list(
                    record.get("retrieved_sources")
                    if "retrieved_sources" in record
                    else record.get("retrievedSources")
                )
            )
        ),
    )
