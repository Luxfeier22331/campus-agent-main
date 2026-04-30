package httpapi

import (
	"errors"
	"strings"

	contractsv1 "github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

var errInvalidAgentResponse = errors.New("invalid agent response")

type supervisorFinalizerContext struct {
	SelectedTool       string
	RuntimeDecisions   execution.RuntimeDecisionSummary
	Handoff            *execution.RuntimeHandoff
	Branch             string
	RuntimeVersions    map[string]any
	PolicyVersions     map[string]any
	BridgeAttemptCount int
	BridgeRetryCount   int
}

func finalizerContextFromExecutionRequest(
	request execution.AnswerExecutionRequest,
	branch string,
	runStates ...bridgeExecutionRunState,
) supervisorFinalizerContext {
	runState := bridgeExecutionRunState{AttemptCount: 1}
	if len(runStates) > 0 {
		runState = runStates[0]
	}
	if runState.AttemptCount <= 0 {
		runState.AttemptCount = 1
	}
	if runState.RetryCount < 0 {
		runState.RetryCount = 0
	}
	return supervisorFinalizerContext{
		SelectedTool:       request.RuntimeDecisions.SelectedTool,
		RuntimeDecisions:   request.RuntimeDecisions,
		Handoff:            request.StructuredHandoff,
		Branch:             branch,
		RuntimeVersions:    request.RuntimeDecisions.RuntimeVersions,
		PolicyVersions:     request.RuntimeDecisions.PolicyArtifactVersions,
		BridgeAttemptCount: runState.AttemptCount,
		BridgeRetryCount:   runState.RetryCount,
	}
}

func finalizeAgentBridgeResponse(
	agentResponse map[string]any,
	traceID string,
	context supervisorFinalizerContext,
) (map[string]any, error) {
	target, err := optionalAgentResponseString(agentResponse, "target")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	if target == "" {
		target, err = optionalAgentResponseString(agentResponse, "selected_target")
		if err != nil {
			return nil, errInvalidAgentResponse
		}
	}
	status, err := optionalAgentResponseString(agentResponse, "status")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	confidence, err := optionalAgentResponseString(agentResponse, "confidence")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	confidence = defaultString(confidence, "low")
	if !allowedAgentTarget(target) || !allowedDelegateStatus(status) || !allowedConfidence(confidence) {
		return nil, errInvalidAgentResponse
	}
	if !validFinalizerHandoffInvariant(target, context) {
		return nil, errInvalidAgentResponse
	}
	answerText, err := optionalAgentResponseString(agentResponse, "answer_text")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	followUpQuestion, err := optionalAgentResponseString(agentResponse, "follow_up_question")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	result, err := optionalAgentResponseObject(agentResponse, "result")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	errorBody, err := optionalAgentResponseObject(agentResponse, "error")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	agentObservability, err := optionalAgentResponseObject(agentResponse, "agent_observability")
	if err != nil || hasForbiddenWorkflowTraceKey(agentObservability) {
		return nil, errInvalidAgentResponse
	}
	response := map[string]any{
		"selected_target":        target,
		"status":                 status,
		"answer_text":            answerText,
		"follow_up_question":     followUpQuestion,
		"confidence":             confidence,
		"result":                 result,
		"error":                  errorBody,
		"observability":          buildSupervisorObservability(target, status, result, context.SelectedTool),
		"workflow_trace_summary": buildWorkflowTraceSummary(context, target, status, result, agentObservability),
		"trace_id":               traceID,
	}
	return response, nil
}

func optionalAgentResponseString(agentResponse map[string]any, field string) (string, error) {
	value, exists := agentResponse[field]
	if !exists || value == nil {
		return "", nil
	}
	text, ok := value.(string)
	if !ok {
		return "", errInvalidAgentResponse
	}
	return strings.TrimSpace(text), nil
}

func optionalAgentResponseObject(agentResponse map[string]any, field string) (map[string]any, error) {
	value, exists := agentResponse[field]
	if !exists || value == nil {
		return nil, nil
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errInvalidAgentResponse
	}
	return object, nil
}

func buildWorkflowTraceSummary(
	context supervisorFinalizerContext,
	target string,
	status string,
	result map[string]any,
	agentObservability map[string]any,
) map[string]any {
	return workflowTraceSummaryWireMap(
		buildWorkflowTraceSummaryWire(context, target, status, result, agentObservability),
	)
}

func buildWorkflowTraceSummaryWire(
	context supervisorFinalizerContext,
	target string,
	status string,
	result map[string]any,
	agentObservability map[string]any,
) contractsv1.WorkflowTraceSummaryWire {
	decisions := context.RuntimeDecisions
	selectedTool := defaultString(
		stringValue(agentObservability["selected_tool"]),
		defaultString(context.SelectedTool, decisions.SelectedTool),
	)
	if selectedTool == "" {
		selectedTool = inferSelectedTool(target, result)
	}
	branch := context.Branch
	if branch == "" {
		branch = branchFromRuntimeDecision(decisions)
	}
	workflowMode := workflowMode(branch, context.Handoff, decisions)
	traceTarget := workflowTraceSelectedTarget(workflowMode, target)
	handoff := workflowHandoffSummary(context.Handoff, target, selectedTool)
	selectedTools := workflowSelectedTools(context.Handoff, selectedTool)
	failCloseReason := defaultString(
		defaultString(decisions.FailCloseReason, stringValue(result["fail_close_reason"])),
		stringValue(agentObservability["fail_close_reason"]),
	)
	branch = workflowBranch(branch, status, failCloseReason)
	run := workflowTraceRun(
		workflowMode,
		branch,
		context.Handoff,
		traceTarget,
		selectedTool,
		status,
		decisions,
		failCloseReason,
		context.BridgeAttemptCount,
		context.BridgeRetryCount,
	)
	toolArgumentSummary := workflowToolArgumentSummary(
		selectedTool,
		context.Handoff,
		agentObservability,
	)
	runtimeVersions := context.RuntimeVersions
	if len(runtimeVersions) == 0 {
		runtimeVersions = decisions.RuntimeVersions
	}
	runtimeVersions = workflowRuntimeVersions(runtimeVersions)
	policyVersions := context.PolicyVersions
	if len(policyVersions) == 0 {
		policyVersions = decisions.PolicyArtifactVersions
	}
	selectedTarget := traceTarget
	return contractsv1.WorkflowTraceSummaryWire{
		RoutingFrame: map[string]any{
			"scope_gate_decision":     decisions.ScopeGateDecision,
			"policy_gate_decision":    decisions.PolicyGateDecision,
			"context_preflight_state": decisions.ContextPreflightState,
			"routing_next_action":     decisions.RoutingNextAction,
		},
		ContextResolution: map[string]any{
			"state": decisions.ContextPreflightState,
		},
		PlanningOutcome:        defaultString(decisions.PlanningOutcome, "not_preplanned"),
		DirectVsDelegateBranch: branch,
		WorkflowMode:           workflowMode,
		Handoff:                handoff,
		HandoffChain:           run.HandoffChainMaps(),
		SelectedTarget:         &selectedTarget,
		SelectedTools:          selectedTools,
		ToolArgumentSummary:    toolArgumentSummary,
		TraceSteps:             run.StepMaps(),
		ToolCallSummaries: workflowToolCallSummaries(
			selectedTool,
			traceTarget,
			status,
			result,
			toolArgumentSummary,
			agentObservability,
			failCloseReason,
		),
		GuardrailOutcomes: map[string]any{
			"scope_gate":        decisions.ScopeGateDecision,
			"policy_gate":       decisions.PolicyGateDecision,
			"context_preflight": decisions.ContextPreflightState,
		},
		FailCloseReason:        failCloseReason,
		RuntimeVersions:        safeWorkflowMap(runtimeVersions),
		PolicyArtifactVersions: safeWorkflowMap(policyVersions),
	}
}

func workflowTraceSummaryWireMap(wire contractsv1.WorkflowTraceSummaryWire) map[string]any {
	var selectedTarget any
	if wire.SelectedTarget != nil {
		selectedTarget = *wire.SelectedTarget
	}
	return map[string]any{
		"routing_frame":             wire.RoutingFrame,
		"context_resolution":        wire.ContextResolution,
		"planning_outcome":          wire.PlanningOutcome,
		"direct_vs_delegate_branch": wire.DirectVsDelegateBranch,
		"workflow_mode":             wire.WorkflowMode,
		"handoff":                   wire.Handoff,
		"handoff_chain":             wire.HandoffChain,
		"selected_target":           selectedTarget,
		"selected_tools":            wire.SelectedTools,
		"tool_argument_summary":     wire.ToolArgumentSummary,
		"trace_steps":               wire.TraceSteps,
		"tool_call_summaries":       wire.ToolCallSummaries,
		"guardrail_outcomes":        wire.GuardrailOutcomes,
		"fail_close_reason":         wire.FailCloseReason,
		"runtime_versions":          wire.RuntimeVersions,
		"policy_artifact_versions":  wire.PolicyArtifactVersions,
	}
}

func workflowMode(
	branch string,
	handoff *execution.RuntimeHandoff,
	decisions execution.RuntimeDecisionSummary,
) string {
	if branch == "terminal" {
		return "terminal"
	}
	if branch == "direct" {
		return "direct_runtime"
	}
	if branch == "delegate" || decisions.RoutingNextAction == "delegate" || handoff != nil {
		return "single_handoff"
	}
	if decisions.RoutingNextAction != "" && decisions.RoutingNextAction != "delegate" {
		return "terminal"
	}
	return "direct_runtime"
}

func workflowTraceSelectedTarget(workflowMode string, target string) string {
	if workflowMode == "terminal" {
		return "none"
	}
	return target
}

func validFinalizerHandoffInvariant(target string, context supervisorFinalizerContext) bool {
	isDelegate := context.Branch == "delegate" || context.RuntimeDecisions.RoutingNextAction == "delegate"
	if !isDelegate {
		return true
	}
	if context.Handoff == nil {
		return false
	}
	if context.RuntimeDecisions.SelectedTarget != "" && context.RuntimeDecisions.SelectedTarget != target {
		return false
	}
	if context.Handoff.Target != "" && context.Handoff.Target != target {
		return false
	}
	if context.SelectedTool != "" && len(context.Handoff.AllowedTools) > 0 {
		for _, tool := range context.Handoff.AllowedTools {
			if tool == context.SelectedTool {
				return true
			}
		}
		return false
	}
	return true
}

func workflowRuntimeVersions(source map[string]any) map[string]any {
	versions := safeWorkflowMap(source)
	if _, exists := versions["workflow_trace_summary"]; !exists {
		versions["workflow_trace_summary"] = contractsv1.WorkflowTraceSummaryVersion
	}
	if _, exists := versions["bridge_contract"]; !exists {
		versions["bridge_contract"] = contractsv1.BridgeVersion
	}
	if _, exists := versions["response_contract"]; !exists {
		versions["response_contract"] = contractsv1.ResponseContract
	}
	return versions
}

func workflowBranch(branch string, status string, failCloseReason string) string {
	if branch != "terminal" {
		return branch
	}
	if failCloseReason != "" {
		return "fail_close"
	}
	if status == "needs_clarification" {
		return "clarification"
	}
	return branch
}

func branchFromRuntimeDecision(decisions execution.RuntimeDecisionSummary) string {
	if decisions.RoutingNextAction == "delegate" {
		return "delegate"
	}
	if decisions.RoutingNextAction != "" {
		return "terminal"
	}
	return ""
}

func workflowHandoffSummary(
	handoff *execution.RuntimeHandoff,
	target string,
	selectedTool string,
) map[string]any {
	if handoff == nil {
		return map[string]any{}
	}
	return map[string]any{
		"target":        defaultString(handoff.Target, target),
		"payload_kind":  handoff.PayloadKind,
		"allowed_tools": append([]string(nil), handoff.AllowedTools...),
	}
}

func workflowTraceRun(
	workflowMode string,
	branch string,
	handoff *execution.RuntimeHandoff,
	target string,
	selectedTool string,
	status string,
	decisions execution.RuntimeDecisionSummary,
	failCloseReason string,
	bridgeAttemptCount int,
	bridgeRetryCount int,
) execution.WorkflowRun {
	if bridgeAttemptCount <= 0 {
		bridgeAttemptCount = 1
	}
	if bridgeRetryCount < 0 {
		bridgeRetryCount = 0
	}
	run := execution.WorkflowRun{
		Mode:   execution.WorkflowMode(workflowMode),
		Branch: branch,
		State:  workflowStateForStatus(status),
	}
	if run.Mode == execution.WorkflowModeSingleHandoff && handoff != nil {
		run.HandoffChain = append(run.HandoffChain, execution.HandoffStep{
			Target:       defaultString(handoff.Target, target),
			PayloadKind:  handoff.PayloadKind,
			AllowedTools: append([]string(nil), handoff.AllowedTools...),
			SelectedTool: selectedTool,
		})
	}
	run.Steps = append(run.Steps, execution.WorkflowStep{
		StepID:       "runtime_policy",
		SpanKind:     "runtime_policy",
		ParentStepID: "",
		Outcome: defaultString(
			decisions.RoutingNextAction,
			defaultString(branch, status),
		),
	})
	if branch == "delegate" {
		run.Steps = append(run.Steps, execution.WorkflowStep{
			StepID:       "handoff",
			SpanKind:     "handoff",
			ParentStepID: "runtime_policy",
			Target:       target,
			Outcome:      branch,
		})
	}
	if selectedTool != "" {
		run.Steps = append(run.Steps, execution.WorkflowStep{
			StepID:       "tool_call",
			SpanKind:     "tool_call",
			ParentStepID: workflowToolCallParentStep(branch),
			ToolName:     selectedTool,
			Target:       target,
			Outcome:      status,
			ResultStatus: status,
			RetryCount:   0,
		})
	}
	run.Steps = append(run.Steps, execution.WorkflowStep{
		StepID:            "finalization",
		SpanKind:          "finalization",
		ParentStepID:      workflowFinalizationParentStep(branch, selectedTool),
		Outcome:           status,
		ResultStatus:      status,
		AttemptCount:      bridgeAttemptCount,
		RuntimeRetryCount: bridgeRetryCount,
		FailCloseReason:   failCloseReason,
	})
	return run
}

func workflowStateForStatus(status string) execution.WorkflowState {
	switch status {
	case "completed":
		return execution.WorkflowStateCompleted
	case "cancelled":
		return execution.WorkflowStateCanceled
	case "timed_out":
		return execution.WorkflowStateTimedOut
	case "error":
		return execution.WorkflowStateFailed
	default:
		return execution.WorkflowStateRunning
	}
}

func workflowSelectedTools(handoff *execution.RuntimeHandoff, selectedTool string) []string {
	if selectedTool != "" {
		return []string{selectedTool}
	}
	return []string{}
}

func workflowToolCallParentStep(branch string) string {
	if branch == "delegate" {
		return "handoff"
	}
	return "runtime_policy"
}

func workflowFinalizationParentStep(branch string, selectedTool string) string {
	if selectedTool != "" {
		return "tool_call"
	}
	if branch == "delegate" {
		return "handoff"
	}
	return "runtime_policy"
}

func workflowToolCallSummaries(
	selectedTool string,
	target string,
	status string,
	result map[string]any,
	argumentSummary map[string]any,
	agentObservability map[string]any,
	failCloseReason string,
) []map[string]any {
	if selectedTool == "" {
		return []map[string]any{}
	}
	summary := map[string]any{
		"tool_name":        selectedTool,
		"target":           target,
		"result_status":    status,
		"argument_summary": safeWorkflowMap(argumentSummary),
		"source_ids":       workflowSourceIDs(result),
	}
	if businessOutcome := defaultString(
		stringValue(agentObservability["tool_outcome"]),
		defaultString(stringValue(agentObservability["result_outcome"]), stringValue(result["outcome"])),
	); businessOutcome != "" {
		summary["business_outcome"] = businessOutcome
	}
	if failCloseReason != "" {
		summary["fail_close_reason"] = failCloseReason
	}
	if accessDecision := stringValue(agentObservability["access_decision"]); accessDecision != "" {
		summary["access_decision"] = accessDecision
	}
	if safeDetails, ok := agentObservability["safe_details"].(map[string]any); ok &&
		!hasForbiddenWorkflowTraceKey(safeDetails) {
		summary["safe_details"] = safeDetails
	}
	return []map[string]any{summary}
}

func workflowToolArgumentSummary(
	selectedTool string,
	handoff *execution.RuntimeHandoff,
	agentObservability map[string]any,
) map[string]any {
	summary := map[string]any{}
	if selectedTool != "" {
		summary["selected_tool"] = selectedTool
	}
	if handoff != nil && handoff.PayloadKind != "" {
		summary["payload_kind"] = handoff.PayloadKind
	}
	for key, value := range workflowHandoffPayloadSummary(handoff) {
		summary[key] = value
	}
	for _, key := range []string{
		"tool_attempted",
		"tool_outcome",
		"failure_class",
		"fail_close_reason",
		"clarification_reason",
		"source_ref_count",
		"result_outcome",
		"access_decision",
	} {
		if value, ok := agentObservability[key]; ok {
			summary[key] = value
		}
	}
	if safeDetails, ok := agentObservability["safe_details"].(map[string]any); ok &&
		!hasForbiddenWorkflowTraceKey(safeDetails) {
		summary["safe_details"] = safeDetails
	}
	return summary
}

func workflowHandoffPayloadSummary(handoff *execution.RuntimeHandoff) map[string]any {
	if handoff == nil || len(handoff.Payload) == 0 || hasForbiddenWorkflowTraceKey(handoff.Payload) {
		return map[string]any{}
	}
	payload := handoff.Payload
	switch handoff.PayloadKind {
	case "rag_request":
		return workflowRagPayloadSummary(payload)
	case "transport_schedule_lookup":
		return workflowTransportPayloadSummary(payload)
	case "service_status_lookup":
		return workflowServiceStatusPayloadSummary(payload)
	case "service_guide_lookup":
		return workflowServiceGuidePayloadSummary(payload)
	case "contact_directory_lookup":
		return workflowContactDirectoryPayloadSummary(payload)
	case "campus_notice_discover":
		return workflowNoticeDiscoverPayloadSummary(payload)
	case "campus_notice_get":
		return workflowNoticeGetPayloadSummary(payload)
	default:
		return map[string]any{}
	}
}

func workflowRagPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	if scope, ok := payload["scope"].(map[string]any); ok {
		copyStringField(summary, scope, "corpus")
		copyStringField(summary, scope, "collection")
	}
	if versionQuery, ok := payload["version_query"].(map[string]any); ok {
		copyPrefixedStringField(summary, versionQuery, "mode", "version_query_mode")
		copyPrefixedStringField(summary, versionQuery, "as_of", "version_query_as_of")
		copyPrefixedStringField(summary, versionQuery, "version_id", "version_query_version_id")
		copyPrefixedStringField(
			summary,
			versionQuery,
			"compare_to_version_id",
			"version_query_compare_to_version_id",
		)
	}
	return summary
}

func workflowTransportPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	copyStringField(summary, payload, "intent")
	copyStringField(summary, payload, "campus_scope")
	if snapshotQuery, ok := payload["snapshot_query"].(map[string]any); ok {
		copyPrefixedStringField(summary, snapshotQuery, "mode", "snapshot_query_mode")
		copyPrefixedStringField(summary, snapshotQuery, "year_hint", "snapshot_query_year_hint")
		copyPrefixedStringField(summary, snapshotQuery, "as_of", "snapshot_query_as_of")
	}
	if serviceTimeQuery, ok := payload["service_time_query"].(map[string]any); ok {
		serviceTimeSummary := stringFields(
			serviceTimeQuery,
			"date_mode",
			"daypart",
			"time_anchor",
		)
		if len(serviceTimeSummary) > 0 {
			summary["service_time_query"] = serviceTimeSummary
		}
	}
	if routeSelector, ok := payload["route_selector"].(map[string]any); ok {
		routeSelectorSummary := stringFields(
			routeSelector,
			"route_id",
			"service_family",
			"origin_campus",
			"destination_campus",
		)
		if len(routeSelectorSummary) > 0 {
			summary["route_selector"] = routeSelectorSummary
		}
	}
	return summary
}

func workflowServiceStatusPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	copyStringField(summary, payload, "campus_scope")
	if temporalQuery, ok := payload["temporal_query"].(map[string]any); ok {
		copyPrefixedStringField(summary, temporalQuery, "mode", "temporal_query_mode")
		copyPrefixedStringField(summary, temporalQuery, "year_hint", "temporal_query_year_hint")
		copyPrefixedStringField(summary, temporalQuery, "as_of", "temporal_query_as_of")
	}
	return summary
}

func workflowServiceGuidePayloadSummary(payload map[string]any) map[string]any {
	summary := workflowServiceStatusPayloadSummary(payload)
	copyStringField(summary, payload, "guide_focus")
	copyStringField(summary, payload, "audience")
	return summary
}

func workflowContactDirectoryPayloadSummary(payload map[string]any) map[string]any {
	summary := workflowServiceStatusPayloadSummary(payload)
	copyStringField(summary, payload, "contact_focus")
	copyStringField(summary, payload, "audience")
	return summary
}

func workflowNoticeDiscoverPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	if temporalQuery, ok := payload["temporal_query"].(map[string]any); ok {
		copyPrefixedStringField(summary, temporalQuery, "mode", "temporal_query_mode")
		copyPrefixedStringField(summary, temporalQuery, "year_hint", "temporal_query_year_hint")
		copyPrefixedStringField(summary, temporalQuery, "as_of", "temporal_query_as_of")
	}
	return summary
}

func workflowNoticeGetPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	copyStringField(summary, payload, "notice_id")
	copyStringField(summary, payload, "source_family")
	return summary
}

func copyStringField(summary map[string]any, payload map[string]any, key string) {
	copyPrefixedStringField(summary, payload, key, key)
}

func copyPrefixedStringField(
	summary map[string]any,
	payload map[string]any,
	sourceKey string,
	summaryKey string,
) {
	if value := stringValue(payload[sourceKey]); value != "" {
		summary[summaryKey] = value
	}
}

func stringFields(payload map[string]any, keys ...string) map[string]any {
	summary := map[string]any{}
	for _, key := range keys {
		copyStringField(summary, payload, key)
	}
	return summary
}

func workflowSourceIDs(result map[string]any) []string {
	ids := []string{}
	collectWorkflowSourceIDs(result, &ids)
	return ids
}

func collectWorkflowSourceIDs(value any, ids *[]string) {
	switch current := value.(type) {
	case map[string]any:
		for key, item := range current {
			switch key {
			case "doc_id", "docId", "source_id", "sourceId", "source_ref", "sourceRef",
				"notice_id", "noticeId":
				appendWorkflowSourceID(ids, stringValue(item))
			case "source_ids", "sourceIds", "evidence_ids", "evidenceIds", "related_notice_refs",
				"relatedNoticeRefs", "source_refs", "sourceRefs", "notice_refs", "noticeRefs",
				"override_source_refs", "overrideSourceRefs":
				for _, sourceID := range stringArrayValue(item) {
					appendWorkflowSourceID(ids, sourceID)
				}
			}
			collectWorkflowSourceIDs(item, ids)
		}
	case []any:
		for _, item := range current {
			collectWorkflowSourceIDs(item, ids)
		}
	}
}

func appendWorkflowSourceID(ids *[]string, id string) {
	normalized := strings.TrimSpace(id)
	if normalized == "" || containsString(*ids, normalized) {
		return
	}
	*ids = append(*ids, normalized)
}

func safeWorkflowMap(value map[string]any) map[string]any {
	if value == nil || hasForbiddenWorkflowTraceKey(value) {
		return map[string]any{}
	}
	return value
}

func hasForbiddenWorkflowTraceKey(value any) bool {
	switch item := value.(type) {
	case nil:
		return false
	case map[string]any:
		for key, nested := range item {
			normalized := strings.ToLower(strings.TrimSpace(key))
			if forbiddenWorkflowTraceKey(normalized) || hasForbiddenWorkflowTraceKey(nested) {
				return true
			}
		}
	case []any:
		for _, nested := range item {
			if hasForbiddenWorkflowTraceKey(nested) {
				return true
			}
		}
	case []string:
		return false
	}
	return false
}

func forbiddenWorkflowTraceKey(key string) bool {
	normalizedKey := normalizeWorkflowTraceKeyToken(key)
	for _, token := range []string{
		"raw_prompt",
		"raw_transcript",
		"provider_raw_response",
		"raw_response",
		"jwt",
		"cookie",
		"auth_envelope",
		"retrieval_backend_dump",
	} {
		if strings.Contains(normalizedKey, normalizeWorkflowTraceKeyToken(token)) {
			return true
		}
	}
	return false
}

func normalizeWorkflowTraceKeyToken(value string) string {
	var builder strings.Builder
	for _, char := range strings.ToLower(strings.TrimSpace(value)) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func allowedAgentTarget(target string) bool {
	switch target {
	case "rag-agent", "navigation-agent", "campus-services-agent", "notice-agent":
		return true
	default:
		return false
	}
}

func allowedDelegateStatus(status string) bool {
	switch status {
	case "completed", "needs_clarification", "no_answer", "error":
		return true
	default:
		return false
	}
}

func allowedConfidence(confidence string) bool {
	switch confidence {
	case "high", "medium", "low":
		return true
	default:
		return false
	}
}

func buildSupervisorObservability(
	target string,
	status string,
	result map[string]any,
	selectedTool string,
) map[string]any {
	if target == "rag-agent" {
		return buildRagSupervisorObservability(status, result, selectedTool)
	}
	return buildStructuredSupervisorObservability(target, status, result, selectedTool)
}

func buildRagSupervisorObservability(
	status string,
	result map[string]any,
	selectedTool string,
) map[string]any {
	diagnostics := nestedMap(result, "diagnostics")
	evidence := nestedMap(result, "evidence")
	supportingSources := arrayValue(evidence["sources"])
	retrievedSources := arrayValue(diagnostics["retrieved_sources"])
	sourceCount := len(retrievedSources)
	retrievalAttempted := any(nil)
	switch status {
	case "completed":
		retrievalAttempted = true
	case "no_answer":
		retrievalAttempted = stringValue(diagnostics["no_answer_reason"]) != "curriculum_course_map_unsupported"
	case "needs_clarification":
		retrievalAttempted = sourceCount > 0
	}
	citationExpected := status == "completed"
	citationCount := 0
	if citationExpected {
		citationCount = len(supportingSources)
	}
	denied := stringValue(diagnostics["no_answer_reason"]) == "restricted_access_denied"
	freshnessFailClosed, _ := diagnostics["freshness_fail_closed"].(bool)
	return map[string]any{
		"retrieval_attempted":    retrievalAttempted,
		"candidate_count":        sourceCount,
		"retrieved_source_count": sourceCount,
		"retrieved_sources":      retrievedSources,
		"citation_expected":      citationExpected,
		"citation_count":         citationCount,
		"citation_missing":       citationExpected && citationCount == 0,
		"refusal_class":          refusalClassForAgentStatus(status),
		"semantic_outcome":       ragSemanticOutcome(status, diagnostics),
		"scope_class":            "in_scope",
		"acl_decision":           aclDecision(denied),
		"fail_closed":            denied || freshnessFailClosed,
		"prompt_runtime_state":   stringValue(diagnostics["prompt_runtime_state"]),
		"prompt_runtime_detail":  stringValue(diagnostics["prompt_runtime_detail"]),
		"resolved_scope_corpus":  optionalStringValue(diagnostics["resolved_scope_corpus"]),
		"resolved_scope_collection": stringValue(
			diagnostics["resolved_scope_collection"],
		),
		"selected_tool": selectedTool,
		"prompt_trace":  diagnostics["prompt_trace"],
	}
}

func buildStructuredSupervisorObservability(
	target string,
	status string,
	result map[string]any,
	selectedTool string,
) map[string]any {
	tool := defaultString(selectedTool, inferSelectedTool(target, result))
	outcome := stringValue(result["outcome"])
	failCloseReason := stringValue(result["fail_close_reason"])
	return map[string]any{
		"retrieval_attempted":              false,
		"candidate_count":                  candidateCountForTool(tool, result),
		"retrieved_source_count":           0,
		"retrieved_sources":                []any{},
		"citation_expected":                false,
		"citation_count":                   0,
		"citation_missing":                 false,
		"refusal_class":                    refusalClassForAgentStatus(status),
		"semantic_outcome":                 structuredSemanticOutcome(status, outcome),
		"scope_class":                      scopeClassForTarget(target),
		"acl_decision":                     "allowed",
		"fail_closed":                      failCloseReason != "",
		"selected_tool":                    tool,
		"tool_business_outcome":            outcome,
		"tool_fail_close_reason":           failCloseReason,
		"tool_historical_downgrade_reason": stringValue(result["historical_downgrade_reason"]),
		"service_guide_focus":              stringValue(result["guide_focus"]),
		"matched_service_category":         stringValue(result["matched_service_category"]),
		"notice_source_family_summary":     noticeSourceFamilySummary(result),
		"temporal_posture":                 temporalPosture(result),
	}
}

func ragSemanticOutcome(status string, diagnostics map[string]any) string {
	if semanticOutcome := stringValue(diagnostics["semantic_outcome"]); semanticOutcome != "" {
		return semanticOutcome
	}
	if status == "completed" {
		return "grounded_answer"
	}
	if status == "needs_clarification" {
		return "needs_clarification"
	}
	if status != "no_answer" {
		return ""
	}
	if stringValue(diagnostics["no_answer_reason"]) == "restricted_access_denied" {
		return "restricted_access_denied"
	}
	return "unsupported_by_evidence"
}

func structuredSemanticOutcome(status string, outcome string) string {
	if outcome != "" {
		return outcome
	}
	if status == "needs_clarification" {
		return "needs_clarification"
	}
	if status == "no_answer" {
		return "temporarily_unverifiable"
	}
	return ""
}

func refusalClassForAgentStatus(status string) string {
	if status == "needs_clarification" || status == "no_answer" {
		return status
	}
	return ""
}

func scopeClassForTarget(target string) string {
	switch target {
	case "rag-agent", "navigation-agent", "campus-services-agent", "notice-agent":
		return "in_scope"
	default:
		return ""
	}
}

func aclDecision(denied bool) string {
	if denied {
		return "denied"
	}
	return "allowed"
}

func inferSelectedTool(target string, result map[string]any) string {
	switch {
	case target == "navigation-agent":
		return "place_lookup"
	case target == "notice-agent" && stringValue(result["notice_id"]) != "":
		return "campus_notice_get"
	case target == "notice-agent":
		return "campus_notice_discover"
	case stringValue(result["contact_focus"]) != "":
		return "contact_directory_lookup"
	case stringValue(result["guide_focus"]) != "":
		return "service_guide_lookup"
	case stringValue(result["intent"]) != "":
		return "transport_schedule_lookup"
	case stringValue(result["subject_query"]) != "":
		return "service_status_lookup"
	default:
		return ""
	}
}

func candidateCountForTool(tool string, result map[string]any) int {
	switch tool {
	case "campus_notice_discover":
		return len(arrayValue(result["notice_cards"]))
	case "transport_schedule_lookup":
		return len(arrayValue(result["candidate_routes"]))
	case "service_guide_lookup":
		return len(arrayValue(result["candidate_services"]))
	case "contact_directory_lookup":
		return len(arrayValue(result["candidate_contacts"]))
	case "place_lookup":
		return len(arrayValue(result["candidate_places"]))
	default:
		return 0
	}
}

func noticeSourceFamilySummary(result map[string]any) string {
	families := []string{}
	collectNoticeSourceFamiliesFromValue(result, &families)
	return joinStrings(families, ",")
}

func collectNoticeSourceFamiliesFromValue(value any, families *[]string) {
	switch current := value.(type) {
	case map[string]any:
		for key, item := range current {
			switch key {
			case "source_family", "sourceFamily":
				appendNoticeSourceFamily(families, stringValue(item))
			case "source_families", "sourceFamilies":
				for _, family := range stringArrayValue(item) {
					appendNoticeSourceFamily(families, family)
				}
			case "source_ref", "sourceRef":
				appendNoticeSourceFamily(families, noticeSourceFamilyFromRef(stringValue(item)))
			case "source_refs", "sourceRefs", "related_notice_refs", "relatedNoticeRefs",
				"override_source_refs", "overrideSourceRefs", "notice_refs", "noticeRefs":
				for _, ref := range stringArrayValue(item) {
					appendNoticeSourceFamily(families, noticeSourceFamilyFromRef(ref))
				}
			}
			collectNoticeSourceFamiliesFromValue(item, families)
		}
	case []any:
		for _, item := range current {
			collectNoticeSourceFamiliesFromValue(item, families)
		}
	}
}

func appendNoticeSourceFamily(families *[]string, family string) {
	normalized := strings.TrimSpace(family)
	if normalized == "" || containsString(*families, normalized) {
		return
	}
	*families = append(*families, normalized)
}

func noticeSourceFamilyFromRef(ref string) string {
	normalized := strings.ToLower(strings.TrimSpace(ref))
	switch {
	case strings.HasPrefix(normalized, "authenticated_notice:"),
		strings.HasPrefix(normalized, "notice:muc_internal_portal:"),
		strings.HasPrefix(normalized, "notice:internal_notice_restricted:"):
		return "internal_notice_restricted"
	case strings.HasPrefix(normalized, "official_web:"),
		strings.HasPrefix(normalized, "notice:official_web:"):
		return "official_web_public_notice"
	case strings.HasPrefix(normalized, "wechat_public_notice:"),
		strings.HasPrefix(normalized, "notice:wechat_public_notice:"):
		return "wechat_public_notice"
	default:
		return ""
	}
}

func temporalPosture(result map[string]any) string {
	if stringValue(result["outcome"]) == "resolved_historical_reference" {
		return "historical_reference"
	}
	return "current"
}

func arrayValue(value any) []any {
	items, ok := value.([]any)
	if !ok {
		return []any{}
	}
	return items
}

func stringArrayValue(value any) []string {
	items := arrayValue(value)
	values := make([]string, 0, len(items))
	for _, item := range items {
		text := stringValue(item)
		if text != "" {
			values = append(values, text)
		}
	}
	return values
}

func optionalStringValue(value any) any {
	text := stringValue(value)
	if text == "" {
		return nil
	}
	return text
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func joinStrings(values []string, separator string) string {
	return strings.Join(values, separator)
}
