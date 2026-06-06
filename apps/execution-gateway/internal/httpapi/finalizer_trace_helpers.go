package httpapi

import (
	"strings"

	contractsv1 "github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/execution"
)

func workflowTraceSummaryWireMap(wire contractsv1.WorkflowTraceSummaryWire) map[string]any {
	var selectedTarget any
	if wire.SelectedTarget != nil {
		selectedTarget = *wire.SelectedTarget
	}
	return map[string]any{
		"routing_frame":                  wire.RoutingFrame,
		"context_resolution":             wire.ContextResolution,
		"planning_outcome":               wire.PlanningOutcome,
		"direct_vs_delegate_branch":      wire.DirectVsDelegateBranch,
		"workflow_mode":                  string(wire.WorkflowMode),
		"handoff":                        wire.Handoff,
		"handoff_chain":                  wire.HandoffChain,
		"agent_invocations":              workflowAgentInvocationWireMaps(wire.AgentInvocations),
		"selected_target":                selectedTarget,
		"selected_tools":                 wire.SelectedTools,
		"context_projections":            workflowContextProjectionWireMaps(wire.ContextProjections),
		"answer_artifact_projection_ids": append([]string{}, wire.AnswerArtifactProjectionIDs...),
		"answer_artifact_kinds":          stepOutputProjectionKindsToStrings(wire.AnswerArtifactKinds),
		"tool_argument_summary":          wire.ToolArgumentSummary,
		"trace_steps":                    wire.TraceSteps,
		"tool_call_summaries":            wire.ToolCallSummaries,
		"guardrail_outcomes":             wire.GuardrailOutcomes,
		"fail_close_reason":              wire.FailCloseReason,
		"runtime_versions":               wire.RuntimeVersions,
		"policy_artifact_versions":       wire.PolicyArtifactVersions,
	}
}

func workflowAnswerArtifactProjectionIDs(
	projections []execution.StepOutputProjection,
) []string {
	items := make([]string, 0, len(projections))
	for _, projection := range projections {
		if _, ok := answerEligibleProjectionKinds[projection.ProjectionKind]; !ok {
			continue
		}
		if projection.ProjectionID == "" {
			continue
		}
		items = append(items, projection.ProjectionID)
	}
	return items
}

func workflowAnswerArtifactKinds(
	projections []execution.StepOutputProjection,
) []contractsv1.StepOutputProjectionKind {
	items := make([]contractsv1.StepOutputProjectionKind, 0, len(projections))
	for _, projection := range projections {
		if _, ok := answerEligibleProjectionKinds[projection.ProjectionKind]; !ok {
			continue
		}
		items = append(items, contractsv1.StepOutputProjectionKind(projection.ProjectionKind))
	}
	return items
}

func stepOutputProjectionKindsToStrings(
	kinds []contractsv1.StepOutputProjectionKind,
) []string {
	items := make([]string, 0, len(kinds))
	for _, kind := range kinds {
		items = append(items, string(kind))
	}
	return items
}

func workflowContextProjectionWire(
	projections []execution.StepOutputProjection,
) []contractsv1.WorkflowContextProjectionWire {
	items := make([]contractsv1.WorkflowContextProjectionWire, 0, len(projections))
	for _, projection := range projections {
		items = append(items, contractsv1.WorkflowContextProjectionWire{
			ProjectionID:   projection.ProjectionID,
			SourceStepID:   projection.SourceStepID,
			ProjectionKind: contractsv1.StepOutputProjectionKind(projection.ProjectionKind),
			ContentHash:    projection.ContentHash,
			Safety: contractsv1.ProjectionSafetySummaryWire{
				Truncated:     projection.Safety.Truncated,
				Redacted:      projection.Safety.Redacted,
				MaxChars:      projection.Safety.MaxChars,
				FieldsPresent: append([]string{}, projection.Safety.FieldsPresent...),
			},
		})
	}
	return items
}

func workflowContextProjectionWireMaps(
	projections []contractsv1.WorkflowContextProjectionWire,
) []map[string]any {
	items := make([]map[string]any, 0, len(projections))
	for _, projection := range projections {
		items = append(items, map[string]any{
			"projection_id":   projection.ProjectionID,
			"source_step_id":  projection.SourceStepID,
			"projection_kind": projection.ProjectionKind,
			"content_hash":    projection.ContentHash,
			"safety": map[string]any{
				"truncated":      projection.Safety.Truncated,
				"redacted":       projection.Safety.Redacted,
				"max_chars":      projection.Safety.MaxChars,
				"fields_present": append([]string{}, projection.Safety.FieldsPresent...),
			},
		})
	}
	return items
}

func workflowAgentInvocationWire(
	invocations []execution.AgentInvocation,
) []contractsv1.AgentInvocationWire {
	items := make([]contractsv1.AgentInvocationWire, 0, len(invocations))
	for _, invocation := range invocations {
		items = append(items, contractsv1.AgentInvocationWire{
			InvocationID:       invocation.InvocationID,
			ParentInvocationID: invocation.ParentInvocationID,
			WorkflowRunRef:     invocation.WorkflowRunRef,
			StepID:             invocation.StepID,
			AgentID:            contractsv1.AgentTarget(invocation.AgentID),
			Status:             invocation.Status,
			AllowedTools:       append([]string{}, invocation.AllowedTools...),
			UsedTools:          append([]string{}, invocation.UsedTools...),
			ProjectionIDs:      append([]string{}, invocation.ProjectionIDs...),
			FailCloseReason:    invocation.FailCloseReason,
		})
	}
	return items
}

func workflowAgentInvocationWireMaps(
	invocations []contractsv1.AgentInvocationWire,
) []map[string]any {
	items := make([]map[string]any, 0, len(invocations))
	for _, invocation := range invocations {
		item := map[string]any{
			"invocation_id":    invocation.InvocationID,
			"workflow_run_ref": invocation.WorkflowRunRef,
			"step_id":          invocation.StepID,
			"agent_id":         string(invocation.AgentID),
			"status":           invocation.Status,
			"allowed_tools":    append([]string{}, invocation.AllowedTools...),
			"used_tools":       append([]string{}, invocation.UsedTools...),
			"projection_ids":   append([]string{}, invocation.ProjectionIDs...),
		}
		if invocation.ParentInvocationID != "" {
			item["parent_invocation_id"] = invocation.ParentInvocationID
		}
		if invocation.FailCloseReason != "" {
			item["fail_close_reason"] = invocation.FailCloseReason
		}
		items = append(items, item)
	}
	return items
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
	if context.WorkflowRun != nil {
		for _, handoff := range context.WorkflowRun.HandoffChain {
			if handoff.Target == target {
				return true
			}
		}
		return false
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
		"allowed_tools": append([]string{}, handoff.AllowedTools...),
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
			AllowedTools: append([]string{}, handoff.AllowedTools...),
			SelectedTool: selectedTool,
		})
		run.AgentInvocations = append(run.AgentInvocations, execution.AgentInvocation{
			InvocationID:   "agent-invocation:" + defaultString(handoff.Target, target) + ":1",
			WorkflowRunRef: workflowRunRef(run, target, selectedTool),
			StepID:         "handoff:" + defaultString(handoff.Target, target) + ":" + handoff.PayloadKind,
			AgentID:        defaultString(handoff.Target, target),
			Status:         status,
			AllowedTools:   append([]string{}, handoff.AllowedTools...),
			UsedTools:      workflowSelectedTools(handoff, selectedTool),
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
	case "completed", "needs_clarification", "no_answer":
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

func workflowSelectedToolsFromRun(run execution.WorkflowRun) []string {
	selected := make([]string, 0, len(run.HandoffChain))
	seen := map[string]struct{}{}
	for _, handoff := range run.HandoffChain {
		tool := handoff.SelectedTool
		if tool == "" {
			continue
		}
		if _, exists := seen[tool]; exists {
			continue
		}
		seen[tool] = struct{}{}
		selected = append(selected, tool)
	}
	return selected
}

func workflowTraceSelectedTools(
	run execution.WorkflowRun,
	handoff *execution.RuntimeHandoff,
	selectedTool string,
) []string {
	if run.Mode == execution.WorkflowModeMultiStep {
		return workflowSelectedToolsFromRun(run)
	}
	if len(run.HandoffChain) > 0 {
		return workflowSelectedToolsFromRun(run)
	}
	return workflowSelectedTools(handoff, selectedTool)
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
	run execution.WorkflowRun,
	selectedTool string,
	target string,
	status string,
	result map[string]any,
	argumentSummary map[string]any,
	agentObservability map[string]any,
	failCloseReason string,
) []map[string]any {
	if len(run.ToolCallSummaries) > 0 {
		return run.ToolCallSummaryMaps()
	}
	if selectedTool == "" {
		return []map[string]any{}
	}
	stepID := workflowToolCallStepID(run, selectedTool)
	workflowRunRef := workflowRunRef(run, target, selectedTool)
	summary := map[string]any{
		"schema_version":      "tool-call-summary-v1",
		"tool_call_id":        workflowRunRef + ":" + stepID,
		"workflow_run_ref":    workflowRunRef,
		"step_id":             stepID,
		"lifecycle_state":     workflowToolLifecycleState(status),
		"result_projection":   "bounded_summary",
		"raw_result_included": false,
		"tool_name":           selectedTool,
		"target":              target,
		"result_status":       status,
		"argument_summary":    safeWorkflowMap(argumentSummary),
		"source_ids":          workflowSourceIDs(result),
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
		if providerProjection, ok := safeDetails["provider_tool_call_projection"].(map[string]any); ok &&
			!hasForbiddenWorkflowTraceKey(providerProjection) {
			summary["provider_tool_call_projection"] = providerProjection
		}
	}
	return []map[string]any{summary}
}

func workflowToolCallStepID(run execution.WorkflowRun, selectedTool string) string {
	for _, step := range run.Steps {
		if step.SpanKind == "tool_call" && step.ToolName == selectedTool {
			return defaultString(step.StepID, "tool_call")
		}
	}
	return "tool_call"
}

func workflowRunRef(run execution.WorkflowRun, target string, selectedTool string) string {
	if run.RunID != "" {
		return run.RunID
	}
	parts := []string{string(run.Mode)}
	if target != "" {
		parts = append(parts, target)
	}
	if selectedTool != "" {
		parts = append(parts, selectedTool)
	}
	return strings.Join(parts, ":")
}

func workflowToolLifecycleState(status string) string {
	if status == "error" || status == "cancelled" || status == "timed_out" {
		return "failed"
	}
	return "completed"
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
