package httpapi

import (
	"errors"
	"strings"

	contractsv1 "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

var errInvalidToolResponse = errors.New("invalid agent response")
var answerEligibleProjectionKinds = map[execution.ProjectionKind]struct{}{
	execution.ProjectionKindNoticeContext:       {},
	execution.ProjectionKindNoticeChangeSet:     {},
	execution.ProjectionKindNoticePeriodSummary: {},
	execution.ProjectionKindScheduleBaseline:    {},
	execution.ProjectionKindEvidenceBundle:      {},
}

type executionFinalizerContext struct {
	SelectedTool          string
	RuntimeDecisions      execution.RuntimeDecisionSummary
	Handoff               *execution.RuntimeHandoff
	Branch                string
	RuntimeVersions       map[string]any
	PolicyVersions        map[string]any
	ExecutionAttemptCount int
	ExecutionRetryCount   int
	WorkflowRun           *execution.WorkflowRun
}

type executionAttemptState struct {
	AttemptCount int
	RetryCount   int
}

func finalizerContextFromExecutionRequest(
	request execution.AnswerExecutionRequest,
	branch string,
	runStates ...executionAttemptState,
) executionFinalizerContext {
	runState := executionAttemptState{AttemptCount: 1}
	if len(runStates) > 0 {
		runState = runStates[0]
	}
	if runState.AttemptCount <= 0 {
		runState.AttemptCount = 1
	}
	if runState.RetryCount < 0 {
		runState.RetryCount = 0
	}
	return executionFinalizerContext{
		SelectedTool:          request.RuntimeDecisions.SelectedTool,
		RuntimeDecisions:      request.RuntimeDecisions,
		Handoff:               request.ToolHandoff,
		Branch:                branch,
		RuntimeVersions:       request.RuntimeDecisions.RuntimeVersions,
		PolicyVersions:        request.RuntimeDecisions.PolicyArtifactVersions,
		ExecutionAttemptCount: runState.AttemptCount,
		ExecutionRetryCount:   runState.RetryCount,
	}
}

func finalizerContextWithWorkflowRun(
	context executionFinalizerContext,
	run *execution.WorkflowRun,
) executionFinalizerContext {
	context.WorkflowRun = run
	return context
}

func firstWorkflowRun(runs []*execution.WorkflowRun) *execution.WorkflowRun {
	if len(runs) == 0 {
		return nil
	}
	return runs[0]
}

func terminalExecutionResponse(
	envelope map[string]any,
	traceID string,
	context executionFinalizerContext,
) map[string]any {
	response := make(map[string]any, len(envelope)+2)
	for key, value := range envelope {
		response[key] = value
	}
	if _, exists := response["result"]; !exists {
		response["result"] = nil
	}
	if _, exists := response["error"]; !exists {
		response["error"] = nil
	}
	if _, exists := response["workflow_trace_summary"]; !exists {
		target, _ := response["selected_tool"].(string)
		status, _ := response["status"].(string)
		result, _ := response["result"].(map[string]any)
		response["workflow_trace_summary"] = buildWorkflowTraceSummary(
			context,
			target,
			status,
			result,
			nil,
		)
	}
	response["trace_id"] = traceID
	return response
}

func workflowBranchForRequest(request execution.AnswerExecutionRequest) string {
	if request.WorkflowMode == execution.WorkflowModeMultiStep {
		return "multi_step"
	}
	return "delegate"
}

func finalizeAgentToolResponse(
	agentResponse map[string]any,
	traceID string,
	context executionFinalizerContext,
) (map[string]any, error) {
	target, err := requiredToolResponseString(agentResponse, "tool")
	if err != nil {
		return nil, errInvalidToolResponse
	}
	status, err := optionalToolResponseString(agentResponse, "status")
	if err != nil {
		return nil, errInvalidToolResponse
	}
	confidence, err := requiredToolResponseString(agentResponse, "confidence")
	if err != nil {
		return nil, errInvalidToolResponse
	}
	if !allowedToolID(target) || !allowedDelegateStatus(status) || !allowedConfidence(confidence) {
		return nil, errInvalidToolResponse
	}
	if !validFinalizerHandoffInvariant(target, context) {
		return nil, errInvalidToolResponse
	}
	answerText, err := requiredToolResponseString(agentResponse, "answer_text")
	if err != nil {
		return nil, errInvalidToolResponse
	}
	followUpQuestion, err := requiredToolResponseString(agentResponse, "follow_up_question")
	if err != nil {
		return nil, errInvalidToolResponse
	}
	result, err := optionalToolResponseObject(agentResponse, "result")
	if err != nil || hasForbiddenWorkflowTraceKey(result) {
		return nil, errInvalidToolResponse
	}
	errorBody, err := optionalToolResponseObject(agentResponse, "error")
	if err != nil || hasForbiddenWorkflowTraceKey(errorBody) {
		return nil, errInvalidToolResponse
	}
	if !validToolResponseErrorBody(errorBody) {
		return nil, errInvalidToolResponse
	}
	agentObservability, err := optionalToolResponseObject(agentResponse, "tool_observability")
	if err != nil || hasForbiddenWorkflowTraceKey(agentObservability) {
		return nil, errInvalidToolResponse
	}
	selectedTool := finalizerSelectedTool(agentObservability, context)
	context.SelectedTool = selectedTool
	response := map[string]any{
		"selected_tool":          target,
		"status":                 status,
		"answer_text":            answerText,
		"follow_up_question":     followUpQuestion,
		"confidence":             confidence,
		"result":                 result,
		"error":                  errorBody,
		"observability":          buildExecutionObservability(target, status, result, selectedTool),
		"workflow_trace_summary": buildWorkflowTraceSummary(context, target, status, result, agentObservability),
		"trace_id":               traceID,
	}
	return response, nil
}

func finalizerSelectedTool(
	agentObservability map[string]any,
	context executionFinalizerContext,
) string {
	return defaultString(
		stringValue(agentObservability["selected_tool"]),
		defaultString(context.SelectedTool, context.RuntimeDecisions.SelectedTool),
	)
}

func optionalToolResponseString(agentResponse map[string]any, field string) (string, error) {
	value, exists := agentResponse[field]
	if !exists || value == nil {
		return "", nil
	}
	text, ok := value.(string)
	if !ok {
		return "", errInvalidToolResponse
	}
	return strings.TrimSpace(text), nil
}

func requiredToolResponseString(agentResponse map[string]any, field string) (string, error) {
	value, exists := agentResponse[field]
	if !exists || value == nil {
		return "", errInvalidToolResponse
	}
	text, ok := value.(string)
	if !ok {
		return "", errInvalidToolResponse
	}
	return strings.TrimSpace(text), nil
}

func optionalToolResponseObject(agentResponse map[string]any, field string) (map[string]any, error) {
	value, exists := agentResponse[field]
	if !exists || value == nil {
		return nil, nil
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errInvalidToolResponse
	}
	return object, nil
}

func validToolResponseErrorBody(errorBody map[string]any) bool {
	if errorBody == nil {
		return true
	}
	code, ok := errorBody["code"].(string)
	if !ok || strings.TrimSpace(code) == "" {
		return false
	}
	message, ok := errorBody["message"].(string)
	if !ok || strings.TrimSpace(message) == "" {
		return false
	}
	_, ok = errorBody["retryable"].(bool)
	return ok
}

func buildWorkflowTraceSummary(
	context executionFinalizerContext,
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
	context executionFinalizerContext,
	target string,
	status string,
	result map[string]any,
	agentObservability map[string]any,
) contractsv1.WorkflowTraceSummaryWire {
	decisions := context.RuntimeDecisions
	selectedTool := finalizerSelectedTool(agentObservability, context)
	traceSelectedTool := selectedTool
	branch := context.Branch
	if branch == "" {
		branch = branchFromRuntimeDecision(decisions)
	}
	workflowMode := workflowMode(branch, context.Handoff, decisions)
	if context.WorkflowRun != nil && context.WorkflowRun.Mode != "" {
		workflowMode = string(context.WorkflowRun.Mode)
	}
	if strings.TrimSpace(traceSelectedTool) == "" {
		traceSelectedTool = workflowTraceSelectedTool(workflowMode, target)
	}
	if strings.TrimSpace(traceSelectedTool) == "" {
		traceSelectedTool = "none"
	}
	traceTarget := workflowTraceSelectedTool(workflowMode, target)
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
		context.ExecutionAttemptCount,
		context.ExecutionRetryCount,
	)
	if context.WorkflowRun != nil {
		run = *context.WorkflowRun
		if run.Branch != "" {
			branch = run.Branch
		}
		selectedTools = workflowTraceSelectedTools(run, context.Handoff, selectedTool)
		if traceTarget == "" && len(run.HandoffChain) > 0 {
			traceTarget = run.HandoffChain[len(run.HandoffChain)-1].ToolTarget
		}
		if len(handoff) == 0 && len(run.HandoffChain) > 0 {
			handoff = run.HandoffChain[0].Map()
		}
	}
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
		PlanningOutcome:             defaultString(decisions.PlanningOutcome, "not_preplanned"),
		DirectVsDelegateBranch:      branch,
		WorkflowMode:                contractsv1.WorkflowMode(workflowMode),
		Handoff:                     handoff,
		HandoffChain:                run.HandoffChainMaps(),
		ToolInvocations:             workflowToolInvocationWire(run.ToolInvocations),
		SelectedTool:                &traceSelectedTool,
		SelectedTools:               selectedTools,
		ContextProjections:          workflowContextProjectionWire(run.ContextProjections),
		AnswerArtifactProjectionIDs: workflowAnswerArtifactProjectionIDs(run.ContextProjections),
		AnswerArtifactKinds:         workflowAnswerArtifactKinds(run.ContextProjections),
		ToolArgumentSummary:         toolArgumentSummary,
		TraceSteps:                  run.StepMaps(),
		ToolCallSummaries: workflowToolCallSummaries(
			run,
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
