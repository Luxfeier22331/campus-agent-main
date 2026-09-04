package temporaladapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/activity"
)

func (s *Adapter) ExecutePrimaryAgent(
	ctx context.Context,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "agent.primary", 10*time.Second)
	defer stopHeartbeat()
	run, err := s.temporalActivityRun(ctx, input.RequestID)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	inputMetadata, err := execution.InputMetadata(run)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "execution_input_metadata_invalid", err)
	}
	invocationID := run.RequestID + ":agent.primary"
	executionPayload, err := s.loadExecutionPayload(ctx, run)
	if err != nil {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			execution.InputFailureKind(err, "execution_input_unavailable"),
			err,
		)
	}
	startedAt := time.Now().UTC()
	run, err = s.beginPrimaryAgentRun(ctx, run, startedAt)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if strings.TrimSpace(s.config.AgentRuntimeBaseURL) == "" ||
		strings.TrimSpace(s.config.AgentRuntimeSharedSecret) == "" {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_not_configured",
			fmt.Errorf("agent runtime base URL and shared secret are required"),
		)
	}
	limits := s.primaryAgentRuntimeLimits()
	snapshot := input.AdmissionSnapshot
	visibleFunctionToolNames := input.VisibleFunctionToolNames
	if s.admissionService == nil {
		return s.failPrimaryAgentActivity(ctx, run, "admission_snapshot_invalid", errors.New("agent admission service is not configured"))
	}
	if err := s.admissionService.ValidateWorkflowAdmission(snapshot, visibleFunctionToolNames); err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "admission_snapshot_invalid", err)
	}
	if err := s.admissionService.ValidateLocalToolContractFingerprint(snapshot.ToolContractFingerprint); err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "admission_snapshot_mismatch", err)
	}
	limits = limitsFromAdmissionSnapshot(snapshot.AgentLimits)
	limits.MaxTurns = snapshot.ExecutionStrategy.MaxModelTurns
	limits.MaxFunctionToolCalls = snapshot.ExecutionStrategy.MaxFunctionToolCalls
	agentResultRef := temporalProjectionRef(run.RequestID, "agent/primary/result")
	attempt := temporalActivityAttempt(ctx)
	conversationContext, err := primaryAgentConversationContextForRun(executionPayload, limits)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "context_budget_exceeded", err)
	}
	providerRequestPayload := primaryAgentRuntimeRequestPayload(
		run,
		input,
		strings.TrimSpace(execution.StringValue(executionPayload["user_goal"])),
		conversationContext,
		limits,
		attempt,
	)
	providerRequestBody, err := json.Marshal(providerRequestPayload)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "agent_invocation_envelope_invalid", err)
	}
	invocationEnvelope, err := newPrimaryAgentProviderInvocationEnvelope(
		run,
		input,
		inputMetadata.ExecutionInputSHA256,
		conversationContext,
		providerRequestBody,
		attempt,
	)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "agent_invocation_envelope_invalid", err)
	}
	invocationSHA256 := sha256AnyValue(invocationEnvelope)
	receiptNow := time.Now().UTC().Truncate(time.Microsecond)
	receipt, disposition, err := s.runProjectionStore.BeginAgentInvocation(
		ctx,
		execution.AgentInvocationReceipt{
			InvocationID: invocationID,
			RequestID:    run.RequestID,
			InputSHA256:  invocationSHA256,
			CreatedAt:    receiptNow,
			UpdatedAt:    receiptNow,
		},
	)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "agent_invocation_receipt_failed", err)
	}
	if disposition == execution.AgentInvocationDispositionAmbiguous {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, sanitizedTemporalApplicationError(
			"agent_attempt_uncertain",
			errors.New("agent invocation receipt is already started without a Temporal activity result"),
			true,
		)
	}
	if disposition == execution.AgentInvocationDispositionReplay {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, sanitizedTemporalApplicationError(
			"agent_attempt_uncertain",
			errors.New("agent invocation receipt is already completed without a Temporal activity result"),
			true,
		)
	}
	startedAt = receipt.CreatedAt
	startedProjection := s.withTemporalActivityEvidence(ctx, temporalStepProjection{
		Attempt:       attempt,
		Tool:          "",
		Run:           run,
		Status:        "started",
		StepID:        "agent.primary",
		StepKind:      "agent",
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: agentResultRef,
		Payload: map[string]any{
			"execution_control_release":   strings.TrimSpace(s.config.DeploymentRelease),
			"execution_strategy":          execution.ExecutionStrategyProjectionPayload(snapshot.ExecutionStrategy),
			"tool_contract_fingerprint":   execution.ToolContractFingerprintSnapshotMap(snapshot.ToolContractFingerprint),
			"visible_function_tool_names": append([]string{}, visibleFunctionToolNames...),
		},
	}, attempt)
	attempt = startedProjection.Attempt
	if err := s.projectTemporalStep(ctx, startedProjection); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	invocationEvidence := primaryAgentActivityEvidenceFromProjection(
		startedProjection,
		activity.IsActivity(ctx),
	)
	if err := s.appendTemporalRunProgress(
		ctx,
		run,
		execution.DurableRunProgressPhaseGenerating,
		time.Now().UTC(),
	); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	output, err := s.callAgentRuntimeRequest(
		ctx,
		run,
		input.TraceParent,
		providerRequestBody,
		limits.AgentDeadlineMS,
	)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, primaryAgentRuntimeFailureKind(err), err)
	}
	if snapshot.ToolContractFingerprintSHA256 != "" {
		if err := execution.ValidateAgentRuntimeToolContract(
			snapshot.ToolContractFingerprint,
			output.ToolContractFingerprint,
		); err != nil {
			return s.failPrimaryAgentActivity(ctx, run, "tool_contract_mismatch", err, output)
		}
	}
	output.RequestID = run.RequestID
	output.AgentResultRef = agentResultRef
	if strings.TrimSpace(output.Status) != "completed" {
		completedAt := time.Now().UTC()
		if err := s.projectPrimaryAgentToolResults(
			ctx,
			run,
			startedAt,
			completedAt,
			attempt,
			visibleFunctionToolNames,
			output,
		); err != nil {
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
		}
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_incomplete",
			fmt.Errorf("agent runtime status is %q", output.Status),
			output,
		)
	}
	if output.TerminalReason == "" {
		output.TerminalReason = string(execution.DurableTerminalReasonAnswerCompleted)
	}
	if strings.TrimSpace(output.FinalOutput) == "" {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_missing_final_output",
			fmt.Errorf("agent runtime final_output is required"),
			output,
		)
	}
	payload, err := primaryAgentResultPayload(primaryAgentResultInput{
		activityAttempt:         attempt,
		activityInput:           input,
		executionControlRelease: strings.TrimSpace(s.config.DeploymentRelease),
		run:                     run,
	}, output)
	if err != nil {
		projectionErr := s.projectPrimaryAgentToolResults(
			ctx,
			run,
			startedAt,
			time.Now().UTC(),
			attempt,
			visibleFunctionToolNames,
			output,
		)
		if projectionErr != nil {
			if activity.IsActivity(ctx) {
				return temporalruntime.ExecutePrimaryAgentActivityOutput{}, sanitizedTemporalApplicationError(
					"agent_runtime_result_invalid",
					projectionErr,
					true,
				)
			}
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, projectionErr
		}
		return s.failPrimaryAgentActivity(ctx, run, "agent_runtime_result_invalid", err, output)
	}
	payload["activity_evidence"] = invocationEvidence.payload()
	payload["activity_worker_id"] = invocationEvidence.WorkerID
	payload["provider_invocation_sha256"] = invocationSHA256
	if len(output.ContextUsage) > 0 {
		payload["context_usage"] = execution.CloneAnyMapFromValue(output.ContextUsage)
	}
	outputSummary, err := encodeAgentInvocationOutputSummary(agentResultRef, invocationSHA256)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "agent_invocation_receipt_failed", err, output)
	}
	completedReceiptAt := time.Now().UTC().Truncate(time.Microsecond)
	outputDigest := sha256Bytes(outputSummary)
	if _, err := s.runProjectionStore.CompleteAgentInvocation(ctx, execution.AgentInvocationReceipt{
		InvocationID: invocationID,
		RequestID:    run.RequestID,
		InputSHA256:  invocationSHA256,
		State:        execution.AgentInvocationReceiptStateCompleted,
		OutputJSON:   outputSummary,
		OutputSHA256: outputDigest,
		CreatedAt:    receiptNow,
		CompletedAt:  completedReceiptAt,
		UpdatedAt:    completedReceiptAt,
	}); err != nil {
		// The transaction outcome can be unknown. Retrying lets the next attempt
		// observe either the completed receipt or the fail-closed started receipt;
		// it must never invoke the model again.
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	completedAt := time.Now().UTC().Truncate(time.Microsecond)
	identity := primaryAgentProjectionIdentity{
		ActivityAttempt:   startedProjection.ActivityAttempt,
		ActivityID:        startedProjection.ActivityID,
		ActivityType:      startedProjection.ActivityType,
		Attempt:           startedProjection.Attempt,
		PreserveAttempt:   true,
		ScheduledAt:       startedProjection.ScheduledAt,
		ScheduleToStartMS: startedProjection.ScheduleToStartMS,
		StartedAt:         startedProjection.StartedAt,
		TemporalRunID:     startedProjection.TemporalRunID,
		WorkerID:          startedProjection.WorkerID,
		WorkflowID:        startedProjection.WorkflowID,
	}
	if err := s.projectPrimaryAgentToolResults(
		ctx,
		run,
		startedAt,
		completedAt,
		attempt,
		visibleFunctionToolNames,
		output,
		identity,
	); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	projectionPayload := primaryAgentResultProjectionPayload(payload)
	if err := s.projectTemporalStep(ctx, identity.apply(temporalStepProjection{
		Attempt:            attempt,
		ActivityAttempt:    attempt,
		PreserveAttempt:    true,
		Tool:               "",
		Run:                run,
		Status:             "completed",
		StepID:             "agent.primary",
		StepKind:           "agent",
		TaskQueue:          temporalruntime.ActivityTaskQueueAgent,
		WorkerID:           identity.WorkerID,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		UpdatedAt:          completedAt,
		ResultKind:         "agent_final_output",
		ProjectionRef:      agentResultRef,
		ProviderResponseID: output.ProviderResponseID,
		ModelProvider:      output.ModelProvider,
		ModelName:          output.ModelName,
		ModelRequestCount:  output.Usage.ModelRequestCount,
		InputTokens:        output.Usage.InputTokens,
		OutputTokens:       output.Usage.OutputTokens,
		CachedInputTokens:  output.Usage.CachedInputTokens,
		UsageObserved:      output.Usage.UsageObserved,
		Payload:            projectionPayload,
	})); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RequestID + ":agent-completed",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeAgentCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"agent_result_ref":     agentResultRef,
			"provider_response_id": output.ProviderResponseID,
			"stage_timing":         execution.CloneAnyMapFromValue(output.StageTiming),
			"terminal_reason":      output.TerminalReason,
		},
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	return output, nil
}

func containsPrimaryAgentVisibleTool(values []string, want string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == want {
			return true
		}
	}
	return false
}

func (s *Adapter) beginPrimaryAgentRun(
	ctx context.Context,
	run execution.DurableRun,
	startedAt time.Time,
) (execution.DurableRun, error) {
	switch run.Status {
	case execution.DurableRunStatusQueued:
		admitted, err := s.runProjectionStore.TransitionRun(
			ctx,
			run.RequestID,
			execution.DurableRunStatusAdmitted,
			"",
			startedAt,
		)
		if err != nil {
			return execution.DurableRun{}, err
		}
		if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RequestID + ":run-admitted",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunAdmitted,
			OccurredAt:           startedAt,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": string(execution.DurableRunStatusAdmitted)},
		}); err != nil {
			return execution.DurableRun{}, err
		}
		run = admitted
	case execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
		execution.DurableRunStatusStreaming:
	default:
		return execution.DurableRun{}, fmt.Errorf(
			"request %s status %s cannot execute primary agent",
			run.RequestID,
			run.Status,
		)
	}
	if run.Status == execution.DurableRunStatusAdmitted {
		running, err := s.runProjectionStore.TransitionRun(
			ctx,
			run.RequestID,
			execution.DurableRunStatusRunning,
			"",
			startedAt,
		)
		if err != nil {
			return execution.DurableRun{}, err
		}
		if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RequestID + ":run-started",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunStarted,
			OccurredAt:           startedAt,
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": string(execution.DurableRunStatusRunning)},
		}); err != nil {
			return execution.DurableRun{}, err
		}
		run = running
	}
	return run, nil
}

func (s *Adapter) projectPrimaryAgentToolResults(
	ctx context.Context,
	run execution.DurableRun,
	startedAt time.Time,
	completedAt time.Time,
	attempt int,
	visibleFunctionToolNames []string,
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
	identities ...primaryAgentProjectionIdentity,
) error {
	identity := primaryAgentProjectionIdentity{WorkerID: s.config.TemporalWorkerIdentity}
	if len(identities) > 0 {
		identity = identities[0]
	}
	visible := stringSet(visibleFunctionToolNames)
	for _, result := range output.ToolResults {
		durationMS, err := primaryAgentToolDurationMS(result.DurationMS)
		if err != nil {
			return err
		}
		toolName := strings.TrimSpace(result.ToolName)
		if toolName == "" {
			return fmt.Errorf("agent runtime tool result tool_name is required")
		}
		projectionClass := projectionClassForToolName(toolName)
		status := strings.TrimSpace(result.Status)
		if status == "" {
			return fmt.Errorf("agent runtime tool result status is required")
		}
		_, modelVisible := visible[toolName]
		if !modelVisible {
			return fmt.Errorf(
				"agent runtime tool %s was not visible for this turn",
				toolName,
			)
		}
		invocationID := strings.TrimSpace(result.InvocationID)
		if invocationID == "" {
			return fmt.Errorf("agent runtime tool result invocation_id is required")
		}
		stepID := fmt.Sprintf("sdk_tool.execute.%s.%s", toolName, invocationID)
		resultRef := primaryAgentToolProjectionRef(run.RequestID, toolName, invocationID)
		resultPayload := execution.CloneAnyMapFromValue(result.Result)
		payload := map[string]any{
			"arguments_json_sha256": execution.SHA256JSONRef(result.ArgumentsJSON),
			"invocation_id":         invocationID,
			"outcome":               boundedToolOutcome(resultPayload["outcome"]),
			"result_sha256":         sha256AnyValue(resultPayload),
			"tool_name":             toolName,
			"tool_status":           status,
		}
		if result.Failure != nil {
			payload["failure"] = result.Failure
		}
		if toolName == string(contracts.ToolIDCampusSearch) && status == "completed" {
			payload["result"] = execution.CloneAnyMapFromValue(resultPayload)
		}
		// The raw tool result stays in the bounded Temporal Activity result.
		// Step and event projections carry hashes and bounded outcomes.
		if err := s.projectTemporalStep(ctx, identity.apply(temporalStepProjection{
			Attempt:         attempt,
			ActivityAttempt: attempt,
			PreserveAttempt: identity.PreserveAttempt,
			Tool:            projectionClass,
			Run:             run,
			Status:          toolStepStatus(status),
			StepID:          stepID,
			StepKind:        "tool",
			TaskQueue:       temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
			WorkerID:        identity.WorkerID,
			StartedAt:       startedAt,
			CompletedAt:     completedAt,
			DurationMS:      durationMS,
			UpdatedAt:       completedAt,
			ResultKind:      toolResultKind(status),
			ProjectionRef:   resultRef,
			FailCloseReason: "",
			Payload:         payload,
		})); err != nil {
			return err
		}
	}
	return nil
}

type primaryAgentProjectionIdentity struct {
	ActivityAttempt   int
	ActivityID        string
	ActivityType      string
	Attempt           int
	PreserveAttempt   bool
	ScheduledAt       time.Time
	ScheduleToStartMS int64
	StartedAt         time.Time
	TemporalRunID     string
	WorkerID          string
	WorkflowID        string
}

func (identity primaryAgentProjectionIdentity) apply(
	projection temporalStepProjection,
) temporalStepProjection {
	projection.PreserveAttempt = identity.PreserveAttempt
	if identity.ActivityAttempt > 0 {
		projection.ActivityAttempt = identity.ActivityAttempt
	}
	if identity.Attempt > 0 {
		projection.Attempt = identity.Attempt
	}
	if identity.ActivityID != "" {
		projection.ActivityID = identity.ActivityID
	}
	if identity.ActivityType != "" {
		projection.ActivityType = identity.ActivityType
	}
	if !identity.ScheduledAt.IsZero() {
		projection.ScheduledAt = identity.ScheduledAt
	}
	if identity.ScheduleToStartMS > 0 {
		projection.ScheduleToStartMS = identity.ScheduleToStartMS
	}
	if !identity.StartedAt.IsZero() {
		projection.StartedAt = identity.StartedAt
	}
	if identity.TemporalRunID != "" {
		projection.TemporalRunID = identity.TemporalRunID
	}
	if identity.WorkerID != "" {
		projection.WorkerID = identity.WorkerID
	}
	if identity.WorkflowID != "" {
		projection.WorkflowID = identity.WorkflowID
	}
	return projection
}

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized != "" {
			result[normalized] = struct{}{}
		}
	}
	return result
}

func primaryAgentAttempt(attempt int) int {
	if attempt <= 0 {
		return 1
	}
	return attempt
}

func projectionClassForToolName(toolName string) string {
	toolName = strings.TrimSpace(toolName)
	registry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if ok {
		tool, registered := registry.ToolByName(toolName)
		if registered && tool.ReadOnly {
			return toolName
		}
	}
	return "tool"
}

func toolStepStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "completed":
		return "completed"
	default:
		return "failed"
	}
}

func toolResultKind(status string) string {
	switch strings.TrimSpace(status) {
	case "completed":
		return "typed_tool_result"
	default:
		return "activity_failure"
	}
}

func (s *Adapter) failPrimaryAgentActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
	outputs ...temporalruntime.ExecutePrimaryAgentActivityOutput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	failCloseReason := ""
	timeoutOutcome := execution.TimeoutOutcomeNotTimedOut
	switch failureKind {
	case "agent_runtime_timeout":
		failCloseReason = "agent_runtime_timeout"
		timeoutOutcome = execution.TimeoutOutcomeProviderTimeout
	case "agent_deadline_exceeded":
		failCloseReason = "agent_deadline_exceeded"
		timeoutOutcome = execution.TimeoutOutcomeActivityTimeout
	case "agent_runtime_unauthorized":
		failCloseReason = "agent_runtime_unauthorized"
	}
	summary := summarizeTemporalFailure(failureKind)
	payload := map[string]any{
		"execution_control_release": strings.TrimSpace(s.config.DeploymentRelease),
		"message":                   summary.Message,
	}
	var runtimeHTTPError agentRuntimeHTTPError
	if errors.As(cause, &runtimeHTTPError) {
		runtimeFailureKind := primaryAgentRuntimeFailureKind(runtimeHTTPError)
		if release := strings.TrimSpace(runtimeHTTPError.RuntimeRelease); release != "" {
			payload["agent_runtime_release"] = release
		}
		payload["failure"] = primaryAgentRuntimeFailurePayload(
			failureKind,
			primaryAgentRuntimeFailureCode(runtimeHTTPError.Code, runtimeFailureKind, failureKind),
			runtimeHTTPError.Operation,
			primaryAgentRuntimeFailureDetail(runtimeHTTPError.Code, runtimeFailureKind, runtimeHTTPError.Detail),
			runtimeHTTPError.StatusCode,
			runtimeHTTPError.InvocationID,
		)
	}
	var runtimeApplicationError agentRuntimeApplicationError
	if errors.As(cause, &runtimeApplicationError) {
		runtimeFailureKind := primaryAgentRuntimeFailureKind(runtimeApplicationError)
		if release := strings.TrimSpace(runtimeApplicationError.RuntimeRelease); release != "" {
			payload["agent_runtime_release"] = release
		}
		payload["failure"] = primaryAgentRuntimeFailurePayload(
			failureKind,
			primaryAgentRuntimeFailureCode(runtimeApplicationError.Code, runtimeFailureKind, failureKind),
			runtimeApplicationError.Operation,
			primaryAgentRuntimeFailureDetail(runtimeApplicationError.Code, runtimeFailureKind, runtimeApplicationError.Detail),
			runtimeApplicationError.HTTPStatus,
			runtimeApplicationError.InvocationID,
		)
	}
	if _, ok := payload["failure"]; !ok {
		payload["failure"] = primaryAgentRuntimeFailurePayload(
			failureKind,
			failureKind,
			"agent.primary",
			"",
			0,
			"",
		)
	}
	var output temporalruntime.ExecutePrimaryAgentActivityOutput
	if len(outputs) > 0 {
		output = outputs[0]
	}
	if release := strings.TrimSpace(output.RuntimeRelease); release != "" {
		payload["agent_runtime_release"] = release
	}
	err := s.projectTemporalFailureStep(ctx, run, temporalStepFailureProjection{
		Tool:               "",
		FailureKind:        summary.Kind,
		ModelName:          output.ModelName,
		ModelProvider:      output.ModelProvider,
		ModelRequestCount:  output.Usage.ModelRequestCount,
		InputTokens:        output.Usage.InputTokens,
		OutputTokens:       output.Usage.OutputTokens,
		CachedInputTokens:  output.Usage.CachedInputTokens,
		UsageObserved:      output.Usage.UsageObserved,
		ProviderResponseID: output.ProviderResponseID,
		ProjectionRef:      temporalProjectionRef(run.RequestID, "agent/primary/result"),
		ResultKind:         "activity_failure",
		StepID:             "agent.primary",
		StepKind:           "agent",
		TaskQueue:          temporalruntime.ActivityTaskQueueAgent,
		FailCloseReason:    failCloseReason,
		Payload:            payload,
		TimeoutOutcome:     timeoutOutcome,
	}, cause)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, sanitizedTemporalApplicationError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return temporalruntime.ExecutePrimaryAgentActivityOutput{}, temporalApplicationError(summary, true)
}

func primaryAgentRuntimeFailurePayload(
	fallbackCode string,
	code string,
	operation string,
	detail string,
	httpStatus int,
	invocationID string,
) map[string]any {
	code = strings.TrimSpace(code)
	if code == "" {
		code = strings.TrimSpace(fallbackCode)
	}
	operation = strings.TrimSpace(operation)
	if operation == "" {
		operation = "agent.primary"
	}
	failure := map[string]any{
		"code":      code,
		"operation": operation,
	}
	if detail = strings.TrimSpace(detail); detail != "" {
		failure["detail"] = detail
	}
	if httpStatus > 0 {
		failure["http_status"] = httpStatus
	}
	if invocationID = strings.TrimSpace(invocationID); invocationID != "" {
		failure["invocation_id"] = invocationID
	}
	return failure
}

func primaryAgentRuntimeFailureCode(code string, stableCode string, fallbackCode string) string {
	code = strings.TrimSpace(code)
	if code != "" && code == strings.TrimSpace(stableCode) {
		return code
	}
	return strings.TrimSpace(fallbackCode)
}

func primaryAgentRuntimeFailureDetail(code string, stableCode string, detail string) string {
	if strings.TrimSpace(stableCode) != "agent_runtime_response_invalid" {
		return detail
	}
	code = strings.TrimSpace(code)
	if code == "" || boundedTemporalFailureKind(code) != code {
		return "agent runtime returned an unregistered error code"
	}
	return "agent runtime returned unregistered error code " + code
}
