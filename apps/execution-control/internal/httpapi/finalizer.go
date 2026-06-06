package httpapi

import (
	"errors"
	"strings"

	contractsv1 "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

var errInvalidAgentResponse = errors.New("invalid agent response")
var answerEligibleProjectionKinds = map[execution.ProjectionKind]struct{}{
	execution.ProjectionKindNoticeContext:    {},
	execution.ProjectionKindNoticeChangeSet:  {},
	execution.ProjectionKindScheduleBaseline: {},
	execution.ProjectionKindEvidenceBundle:   {},
}

type supervisorFinalizerContext struct {
	SelectedTool       string
	RuntimeDecisions   execution.RuntimeDecisionSummary
	Handoff            *execution.RuntimeHandoff
	Branch             string
	RuntimeVersions    map[string]any
	PolicyVersions     map[string]any
	BridgeAttemptCount int
	BridgeRetryCount   int
	WorkflowRun        *execution.WorkflowRun
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

func finalizerContextWithWorkflowRun(
	context supervisorFinalizerContext,
	run *execution.WorkflowRun,
) supervisorFinalizerContext {
	context.WorkflowRun = run
	return context
}

func firstWorkflowRun(runs []*execution.WorkflowRun) *execution.WorkflowRun {
	if len(runs) == 0 {
		return nil
	}
	return runs[0]
}

func workflowBranchForRequest(request execution.AnswerExecutionRequest) string {
	if request.WorkflowMode == execution.WorkflowModeMultiStep {
		return "multi_step"
	}
	return "delegate"
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
	confidence, err := requiredAgentResponseString(agentResponse, "confidence")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	if !allowedAgentTarget(target) || !allowedDelegateStatus(status) || !allowedConfidence(confidence) {
		return nil, errInvalidAgentResponse
	}
	if !validFinalizerHandoffInvariant(target, context) {
		return nil, errInvalidAgentResponse
	}
	answerText, err := requiredAgentResponseString(agentResponse, "answer_text")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	followUpQuestion, err := requiredAgentResponseString(agentResponse, "follow_up_question")
	if err != nil {
		return nil, errInvalidAgentResponse
	}
	result, err := optionalAgentResponseObject(agentResponse, "result")
	if err != nil || hasForbiddenWorkflowTraceKey(result) {
		return nil, errInvalidAgentResponse
	}
	errorBody, err := optionalAgentResponseObject(agentResponse, "error")
	if err != nil || hasForbiddenWorkflowTraceKey(errorBody) {
		return nil, errInvalidAgentResponse
	}
	if !validAgentResponseErrorBody(errorBody) {
		return nil, errInvalidAgentResponse
	}
	agentObservability, err := optionalAgentResponseObject(agentResponse, "agent_observability")
	if err != nil || hasForbiddenWorkflowTraceKey(agentObservability) {
		return nil, errInvalidAgentResponse
	}
	selectedTool := finalizerSelectedTool(agentObservability, context)
	context.SelectedTool = selectedTool
	response := map[string]any{
		"selected_target":        target,
		"status":                 status,
		"answer_text":            answerText,
		"follow_up_question":     followUpQuestion,
		"confidence":             confidence,
		"result":                 result,
		"error":                  errorBody,
		"observability":          buildSupervisorObservability(target, status, result, selectedTool),
		"workflow_trace_summary": buildWorkflowTraceSummary(context, target, status, result, agentObservability),
		"trace_id":               traceID,
	}
	return response, nil
}

func finalizerSelectedTool(
	agentObservability map[string]any,
	context supervisorFinalizerContext,
) string {
	return defaultString(
		stringValue(agentObservability["selected_tool"]),
		defaultString(context.SelectedTool, context.RuntimeDecisions.SelectedTool),
	)
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

func requiredAgentResponseString(agentResponse map[string]any, field string) (string, error) {
	value, exists := agentResponse[field]
	if !exists || value == nil {
		return "", errInvalidAgentResponse
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

func validAgentResponseErrorBody(errorBody map[string]any) bool {
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
	selectedTool := finalizerSelectedTool(agentObservability, context)
	branch := context.Branch
	if branch == "" {
		branch = branchFromRuntimeDecision(decisions)
	}
	workflowMode := workflowMode(branch, context.Handoff, decisions)
	if context.WorkflowRun != nil && context.WorkflowRun.Mode != "" {
		workflowMode = string(context.WorkflowRun.Mode)
	}
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
	if context.WorkflowRun != nil {
		run = *context.WorkflowRun
		if run.Branch != "" {
			branch = run.Branch
		}
		selectedTools = workflowTraceSelectedTools(run, context.Handoff, selectedTool)
		if traceTarget == "" && len(run.HandoffChain) > 0 {
			traceTarget = run.HandoffChain[len(run.HandoffChain)-1].Target
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
		PlanningOutcome:             defaultString(decisions.PlanningOutcome, "not_preplanned"),
		DirectVsDelegateBranch:      branch,
		WorkflowMode:                contractsv1.WorkflowMode(workflowMode),
		Handoff:                     handoff,
		HandoffChain:                run.HandoffChainMaps(),
		AgentInvocations:            workflowAgentInvocationWire(run.AgentInvocations),
		SelectedTarget:              &selectedTarget,
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
