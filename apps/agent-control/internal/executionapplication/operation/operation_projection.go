package operation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/citationdiagnostic"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
)

// streamModelAnswers reports whether solve/execute_step operations should stream
// model answer deltas to the browser. It is gated by the answer-transport switch
// (EXECUTION_CONTROL_ANSWER_TRANSPORT) and defaults to buffered while the
// provider gateway rejects streaming requests that declare function tools.
func (s *RuntimeInputService) streamModelAnswers() bool {
	return s.AnswerTransport == "stream"
}

func ValidateWorkflowOperationRequest(request OperationRequest) error {
	if strings.TrimSpace(request.Goal) == "" {
		return errors.New("workflow operation goal is required")
	}
	switch request.Operation {
	case executioncontract.WorkflowOperationSolve:
		// Solve may run buffered (Stream=false) while the provider gateway rejects
		// streaming requests that declare function tools; the buffered answer is
		// projected as a single delta after completion. Re-enable the strict
		// stream requirement when the gateway defect is fixed.
		if request.StepID != "solve.initial" || request.MaxSteps < 1 ||
			request.MaxSteps > request.AdmissionSnapshot.AgentBudget.MaxPlanSteps {
			return errors.New("solver identity, stream mode, or step budget is invalid")
		}
	case executioncontract.WorkflowOperationExecuteStep:
		if request.Plan == nil || request.Step == nil || request.StepID != WorkflowTaskStepID(request.Step.ID) {
			return errors.New("executor step identity is invalid")
		}
		if request.CitationStart < 1 {
			return errors.New("executor citation_start must be positive")
		}
		if !executioncontract.WorkflowPlanContainsStep(*request.Plan, *request.Step) {
			return errors.New("executor step is not part of the supplied plan")
		}
	case executioncontract.WorkflowOperationReplan:
		if request.Plan == nil || request.ReplanIndex < 1 ||
			request.StepID != fmt.Sprintf("solve.replan.%d", request.ReplanIndex) {
			return errors.New("replanner identity is invalid")
		}
		if request.MaxRemainingSteps < 0 || request.MaxRemainingSteps != request.AdmissionSnapshot.AgentBudget.MaxPlanSteps-len(request.CompletedSteps) {
			return errors.New("replanner remaining-step budget is invalid")
		}
	case executioncontract.WorkflowOperationSynthesize:
		if request.StepID != "answer.synthesize" || (!request.Stream && request.Mode != "recovery") {
			return errors.New("synthesizer identity or stream mode is invalid")
		}
		mode := strings.TrimSpace(request.Mode)
		if mode == "" {
			mode = "planned"
		}
		if mode != "planned" && mode != "recovery" {
			return errors.New("synthesis mode is invalid")
		}
		if mode == "recovery" && (len(request.Evidence) == 0 || strings.TrimSpace(request.RecoveryReason) == "") {
			return errors.New("recovery synthesis requires evidence and a failure reason")
		}
		for _, item := range request.Evidence {
			if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Excerpt) == "" {
				return errors.New("synthesizer evidence fields are required")
			}
		}
		if mode == "recovery" {
			if err := ValidateWorkflowOutputEvidence(request.Evidence, WorkflowCandidateSourceSetFromAdmission(request.AdmissionSnapshot)); err != nil {
				return err
			}
			if err := ValidateWorkflowOutputSourceAttempts(request.SourceAttempts, WorkflowCandidateSourceSetFromAdmission(request.AdmissionSnapshot)); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("unsupported workflow operation %q", request.Operation)
	}
	return nil
}

func WorkflowCandidateSourceSetFromAdmission(snapshot execution.AgentAdmissionSnapshot) map[executioncontract.WorkflowSource]struct{} {
	allowed := map[executioncontract.WorkflowSource]struct{}{}
	for _, name := range snapshot.AgentCapabilities.VisibleFunctionToolNames {
		switch strings.TrimSpace(name) {
		case activityprojection.WorkflowCampusSearchToolName:
			allowed[executioncontract.WorkflowSourceCampusSearch] = struct{}{}
		case activityprojection.WorkflowPersonalMemoryRecallToolName:
			allowed[executioncontract.WorkflowSourcePersonalMemoryRecall] = struct{}{}
		}
	}
	if snapshot.AgentCapabilities.HostedWebSearch {
		allowed[executioncontract.WorkflowSourceWebSearch] = struct{}{}
	}
	return allowed
}

func ValidateWorkflowOutputSourceAttempts(
	attempts []executioncontract.WorkflowSourceAttempt,
	allowed map[executioncontract.WorkflowSource]struct{},
) error {
	for _, attempt := range attempts {
		if _, admitted := allowed[attempt.Source]; !admitted {
			return fmt.Errorf("workflow source attempt %q is not a candidate source for the current step", attempt.Source)
		}
		switch attempt.Status {
		case "matched", "no_match", "completed", "failed":
		default:
			return fmt.Errorf("workflow source attempt %q has invalid status %q", attempt.Source, attempt.Status)
		}
	}
	return nil
}

func ValidateWorkflowOutputEvidence(
	evidence []executioncontract.WorkflowEvidence,
	allowed map[executioncontract.WorkflowSource]struct{},
) error {
	for _, item := range evidence {
		if _, admitted := allowed[item.Source]; !admitted {
			return fmt.Errorf("workflow evidence %q uses a source that is not a candidate for the current step", item.ID)
		}
	}
	return nil
}

func WorkflowOperationInputError(message string) error {
	return executionfailure.SanitizedError("workflow_operation_input_invalid", errors.New(message), true)
}

func WorkflowTaskStepID(stepID string) string {
	stepID = strings.TrimSpace(stepID)
	if stepID == "" {
		return "task.step.invalid"
	}
	return "task.step." + stepID
}

func WorkflowOperationResultKind(operation executioncontract.WorkflowOperation) string {
	switch operation {
	case executioncontract.WorkflowOperationSolve:
		return "solve_result"
	case executioncontract.WorkflowOperationExecuteStep:
		return "task_step_result"
	case executioncontract.WorkflowOperationReplan:
		return "task_replan"
	case executioncontract.WorkflowOperationSynthesize:
		return "answer_synthesis"
	default:
		return "workflow_operation_result"
	}
}

func WorkflowOperationRuntimeRequest(
	run execution.DurableRun,
	request OperationRequest,
	conversationContext map[string]any,
	limits WorkflowRuntimeLimits,
	activityAttempt int,
) executionapplication.AgentRuntimeRequest {
	return executionapplication.AgentRuntimeRequest{
		RequestID:                run.RequestID,
		ConversationID:           run.ConversationID,
		UserID:                   run.OwnerUserID,
		DeadlineAt:               run.CreatedAt.Add(time.Duration(request.AdmissionSnapshot.AgentLimits.AgentDeadlineMS) * time.Millisecond),
		ActivityAttempt:          activityAttempt,
		Operation:                request.Operation,
		Input:                    request.Payload,
		VisibleFunctionToolNames: append([]string{}, request.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames...),
		Limits:                   executionapplication.RuntimeLimits(limits),
		ModelTargetSHA256:        request.AdmissionSnapshot.ModelTargetSHA256,
		ToolContractFingerprint:  execution.ToolContractFingerprintSnapshotMap(request.AdmissionSnapshot.ToolContractFingerprint),
		PriorEvidence:            request.PriorEvidence,
		PriorSourceAttempts:      request.PriorSourceAttempts,
		ConversationContext:      conversationContext,
		StreamModelAnswer:        request.Stream,
	}
}

func WorkflowOperationOutputFromRuntimeResponse(
	response executionapplication.AgentRuntimeResult,
	operation executioncontract.WorkflowOperation,
	resultRef string,
) (executioncontract.OperationOutput, error) {
	tools, err := WorkflowToolResultsFromRuntimeResponse(response, operation)
	if err != nil {
		return executioncontract.OperationOutput{}, err
	}
	output := executioncontract.OperationOutput{
		Failure:                 normalizedRuntimeFailure(response.Failure),
		AnswerStarted:           response.AnswerStarted,
		Operation:               operation,
		SolveOutcome:            strings.TrimSpace(response.SolveOutcome),
		WorkflowResultRef:       resultRef,
		FinalOutput:             strings.TrimSpace(response.FinalOutput),
		ModelName:               strings.TrimSpace(response.ModelName),
		ModelProvider:           strings.TrimSpace(response.ModelProvider),
		ProviderResponseID:      strings.TrimSpace(response.ProviderResponseID),
		RequestID:               strings.TrimSpace(response.RequestID),
		StageTiming:             execution.CloneAnyMapFromValue(response.StageTiming),
		Status:                  strings.TrimSpace(response.Status),
		ToolContractFingerprint: execution.CloneAnyMapFromValue(response.ToolContractFingerprint),
		ToolResults:             tools,
		RuntimeRelease:          strings.TrimSpace(response.RuntimeRelease),
		Usage: executioncontract.AgentUsageSummary{
			CachedInputTokens: response.Usage.CachedInputTokens,
			InputTokens:       response.Usage.InputTokens,
			ModelRequestCount: response.Usage.ModelRequestCount,
			OutputTokens:      response.Usage.OutputTokens,
			UsageObserved:     response.Usage.UsageObserved,
		},
		WebEvidence:         response.WebEvidence,
		WebSearchDiagnostic: response.WebSearchDiagnostic,
		TerminalReason:      response.TerminalReason,
	}
	output.Plan = response.Plan
	output.Replan = response.Replan
	output.RemainingFacts = append([]string{}, response.RemainingFacts...)

	if len(response.Evidence) > 0 {
		if err := decodeOperationValue(response.Evidence, &output.Evidence); err != nil {
			return executioncontract.OperationOutput{}, fmt.Errorf("decode workflow evidence: %w", err)
		}
	}
	if len(response.SourceAttempts) > 0 {
		if err := decodeOperationValue(response.SourceAttempts, &output.SourceAttempts); err != nil {
			return executioncontract.OperationOutput{}, fmt.Errorf("decode workflow source attempts: %w", err)
		}
	}
	if output.Status != "failed" && operation == executioncontract.WorkflowOperationSolve && output.SolveOutcome != "answer" && output.SolveOutcome != "plan" {
		return executioncontract.OperationOutput{}, errors.New("solve outcome is missing or invalid")
	}
	if output.Status != "failed" && output.Replan != nil && (output.Replan.SchemaVersion != "task_replan.v3" || (output.Replan.Decision != "continue" && output.Replan.Decision != "synthesize")) {
		return executioncontract.OperationOutput{}, errors.New("replan schema is invalid")
	}

	return output, nil
}

func WorkflowToolResultsFromRuntimeResponse(response executionapplication.AgentRuntimeResult, operation executioncontract.WorkflowOperation) ([]executioncontract.AgentToolResult, error) {
	results := make([]executioncontract.AgentToolResult, 0, len(response.ToolResults))
	for _, result := range response.ToolResults {
		bounded, err := temporalToolResult(result, operation)
		if err != nil {
			return nil, err
		}
		var failure *executioncontract.ExecutionFailure
		if result.Failure != nil {
			copied := *normalizedRuntimeFailure(result.Failure)
			copied.Detail = ""
			copied.Reason = ""
			copied.Citation = nil
			failure = &copied
		}
		results = append(results, executioncontract.AgentToolResult{StartedAt: CloneOptionalTime(result.StartedAt), CompletedAt: CloneOptionalTime(result.CompletedAt), DurationMS: result.DurationMS, Failure: failure, InvocationID: strings.TrimSpace(result.InvocationID), Result: bounded, Status: strings.TrimSpace(result.Status), ToolName: strings.TrimSpace(result.ToolName)})
	}
	return results, nil
}

const temporalMemoryTextLimit = 4000

func WorkflowOperationResultPayload(
	request OperationRequest,
	output executioncontract.OperationOutput,
	activityAttempt int,
	runtimeRelease string,
) (map[string]any, error) {
	payload := map[string]any{
		"activity_attempt":          activityAttempt,
		"agent_runtime_release":     strings.TrimSpace(output.RuntimeRelease),
		"execution_control_release": strings.TrimSpace(runtimeRelease),
		"operation":                 string(request.Operation),
		"solve_outcome":             output.SolveOutcome,
		"provider_response_id":      output.ProviderResponseID,
		"stage_timing":              execution.CloneAnyMapFromValue(output.StageTiming),
		"status":                    output.Status,
		"terminal_reason":           output.TerminalReason,
		"usage": map[string]any{
			"model_request_count": output.Usage.ModelRequestCount,
			"input_tokens":        output.Usage.InputTokens,
			"output_tokens":       output.Usage.OutputTokens,
			"cached_input_tokens": output.Usage.CachedInputTokens,
			"usage_observed":      output.Usage.UsageObserved,
		},
		"web_search_diagnostic": output.WebSearchDiagnostic,
	}
	if output.Failure != nil {
		// Persist the same JSON object shape that PostgreSQL returns on replay.
		// A struct marshals fields in declaration order, unlike a decoded map.
		encoded, err := json.Marshal(output.Failure)
		if err != nil {
			return nil, err
		}
		var failure map[string]any
		if err := json.Unmarshal(encoded, &failure); err != nil {
			return nil, err
		}
		payload["failure"] = failure
		payload["failure_kind"] = output.Failure.Code
	}
	return payload, nil
}

func (s *RunProjectionService) ProjectWorkflowToolResults(
	ctx context.Context,
	run execution.DurableRun,
	request OperationRequest,
	tools []executionapplication.AgentToolResult,
	identity activityprojection.StepProjection,
	completedAt ...time.Time,
) error {
	projectedAt := time.Now().UTC().Truncate(time.Microsecond)
	if len(completedAt) > 0 {
		projectedAt = completedAt[0]
	}
	for _, result := range tools {
		toolName := strings.TrimSpace(result.ToolName)
		if toolName == "" || strings.TrimSpace(result.InvocationID) == "" {
			return errors.New("workflow tool result identity is required")
		}
		// Runtime normalizes tool/source output before projection. This function validates
		// projection fields and writes the bounded tool result.
		durationMS, err := WorkflowToolDurationMS(result.DurationMS)
		if err != nil {
			return err
		}
		startedAt, completedAt, err := WorkflowToolProjectionTimes(
			executioncontract.AgentToolResult{StartedAt: result.StartedAt, CompletedAt: result.CompletedAt},
			identity.StartedAt,
			projectedAt,
		)
		if err != nil {
			return fmt.Errorf("workflow tool %s timing is invalid: %w", toolName, err)
		}
		status := strings.TrimSpace(result.Status)
		if status != "completed" && status != "failed" {
			return fmt.Errorf("workflow tool %s returned invalid status %q", toolName, status)
		}
		resultPayload := execution.CloneAnyMapFromValue(result.Result)
		severity := "info"
		if status == "failed" {
			severity = "error"
		} else if strings.TrimSpace(execution.StringValue(resultPayload["outcome"])) == "no_match" {
			severity = "warning"
		}
		payload := map[string]any{
			"invocation_id":  result.InvocationID,
			"operation":      string(request.Operation),
			"parent_step_id": request.StepID,
			"outcome":        BoundedToolOutcome(resultPayload["outcome"]),
			"severity":       severity,
			"tool_name":      toolName,
			"tool_status":    status,
		}
		if result.Failure != nil {
			payload["failure"] = normalizedRuntimeFailure(result.Failure)
		}
		if toolName == activityprojection.WorkflowCampusSearchToolName {
			if searchQuery := strings.TrimSpace(execution.StringValue(result.ArgumentsJSON["search_query"])); searchQuery != "" {
				payload["search_query"] = searchQuery
			}
			if searchGoal := strings.TrimSpace(execution.StringValue(result.ArgumentsJSON["search_goal"])); searchGoal != "" {
				payload["search_goal"] = searchGoal
			}
		}
		if toolName == activityprojection.WorkflowCampusSearchToolName && status == "completed" {
			payload["result"] = execution.CloneAnyMapFromValue(resultPayload)
		}
		toolIdentity := identity
		attemptStartedAt := startedAt
		if m := result.Activity; m != nil {
			if m.WorkflowID != identity.WorkflowID || m.TemporalRunID != identity.TemporalRunID || m.ActivityID == "" || m.ActivityType == "" || m.ActivityAttempt < 1 {
				return errors.New("tool activity identity mismatch")
			}
			toolIdentity.WorkflowID = m.WorkflowID
			toolIdentity.TemporalRunID = m.TemporalRunID
			toolIdentity.ActivityID = m.ActivityID
			toolIdentity.ActivityType = m.ActivityType
			toolIdentity.Attempt = int(m.ActivityAttempt)
			toolIdentity.ActivityAttempt = int(m.ActivityAttempt)
			toolIdentity.ScheduledAt = m.ScheduledAt
			toolIdentity.TaskQueue = m.TaskQueue
			attemptStartedAt = m.StartedAt
			toolIdentity.ScheduleToStartMS = max(0, m.StartedAt.Sub(m.ScheduledAt).Milliseconds())
		}

		projectionClass := ProjectionClassForToolName(toolName)
		if err := s.ProjectStep(ctx, IdentityWithParent(toolIdentity, request.StepID, activityprojection.StepProjection{
			Attempt:            identity.Attempt,
			ActivityAttempt:    identity.ActivityAttempt,
			Tool:               projectionClass,
			Run:                run,
			Status:             ToolStepStatus(status),
			StepID:             fmt.Sprintf("sdk_tool.execute.%s.%s", toolName, result.InvocationID),
			StepKind:           "tool",
			TaskQueue:          execution.FirstNonEmptyText(toolIdentity.TaskQueue, executioncontract.ActivityTaskQueueForToolTarget(projectionClass)),
			WorkerID:           identity.WorkerID,
			StartedAt:          startedAt,
			CompletedAt:        completedAt,
			AttemptStartedAt:   attemptStartedAt,
			AttemptCompletedAt: completedAt,
			DurationMS:         durationMS,
			UpdatedAt:          projectedAt,
			AttemptUpdatedAt:   projectedAt,
			ResultKind:         ToolResultKind(status),
			ProjectionRef:      WorkflowToolProjectionRef(run.RequestID, toolName, result.InvocationID),
			Payload:            payload,
		})); err != nil {
			return err
		}
	}
	return nil
}

func WorkflowToolProjectionTimes(
	result executioncontract.AgentToolResult,
	fallbackStartedAt time.Time,
	fallbackCompletedAt time.Time,
) (time.Time, time.Time, error) {
	startedAt := CanonicalOptionalToolTime(result.StartedAt, fallbackStartedAt)
	completedAt := CanonicalOptionalToolTime(result.CompletedAt, fallbackCompletedAt)
	if !startedAt.IsZero() && !completedAt.IsZero() && completedAt.Before(startedAt) {
		return time.Time{}, time.Time{}, fmt.Errorf("completed_at precedes started_at")
	}
	return startedAt, completedAt, nil
}

func CanonicalOptionalToolTime(value *time.Time, fallback time.Time) time.Time {
	if value == nil || value.IsZero() {
		return fallback.UTC().Truncate(time.Microsecond)
	}
	return value.UTC().Truncate(time.Microsecond)
}

func CloneOptionalTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := value.UTC().Truncate(time.Microsecond)
	return &cloned
}

func IdentityWithParent(
	identity activityprojection.StepProjection,
	parentStepID string,
	projection activityprojection.StepProjection,
) activityprojection.StepProjection {
	projection.ParentStepID = parentStepID
	projection.ActivityID = identity.ActivityID
	projection.ActivityType = identity.ActivityType
	projection.ActivityAttempt = identity.ActivityAttempt
	projection.Attempt = identity.Attempt
	projection.PreserveAttempt = true
	projection.ScheduledAt = identity.ScheduledAt
	projection.ScheduleToStartMS = identity.ScheduleToStartMS
	projection.TemporalRunID = identity.TemporalRunID
	projection.WorkflowID = identity.WorkflowID
	return projection
}

func normalizedRuntimeFailure(failure *executioncontract.ExecutionFailure) *executioncontract.ExecutionFailure {
	if failure == nil {
		return nil
	}
	copied := *failure
	copied.Reason = citationdiagnostic.Reason(copied.Reason)
	copied.Citation = citationdiagnostic.Normalize(copied.Citation)
	return &copied
}
