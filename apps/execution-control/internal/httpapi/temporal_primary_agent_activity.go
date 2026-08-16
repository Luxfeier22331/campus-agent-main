package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/activity"
)

func (s *Server) ExecutePrimaryAgentActivity(
	ctx context.Context,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "agent.primary", 10*time.Second)
	defer stopHeartbeat()
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	inputMetadata, err := executionInputMetadata(run)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "execution_input_metadata_invalid", err)
	}
	invocationID := run.RunID + ":agent.primary"
	executionPayload, err := s.loadExecutionPayload(ctx, run)
	if err != nil {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			executionInputFailureKind(err, "execution_input_unavailable"),
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
	var providerConfig providerConfigSnapshot
	limits := s.primaryAgentRuntimeLimits()
	snapshot := input.AdmissionSnapshot
	visibleToolNames := input.VisibleToolNames
	if err := validateAdmissionSnapshotForVisibleTools(snapshot, visibleToolNames); err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "admission_snapshot_invalid", err)
	}
	if err := s.validateLocalToolRuntimeFingerprint(snapshot.ToolRuntimeFingerprint); err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "admission_snapshot_mismatch", err)
	}
	providerConfig, err = s.resolveProviderConfigSnapshot(ctx, providerConfigKindLLM)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "provider_config_missing", err)
	}
	if providerConfigAdmissionHash(providerConfig) != snapshot.ProviderConfigSHA256 {
		return s.failPrimaryAgentActivity(ctx, run, "admission_snapshot_mismatch", errors.New("active llm setting does not match admission"))
	}
	campusDocsRetrieval, err := campusDocsRetrievalForPrimaryAgent(input)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "campus_docs_retrieval_invalid", err)
	}
	limits = limitsFromAdmissionSnapshot(snapshot.AgentLimits)
	limits.MaxTurns = snapshot.ExecutionStrategy.MaxModelTurns
	limits.MaxToolCalls = snapshot.ExecutionStrategy.MaxToolCalls
	agentResultRef := temporalProjectionRef(run.RunID, "agent/primary/result")
	attempt := temporalActivityAttempt(ctx)
	conversationContext, err := primaryAgentConversationContextForRun(executionPayload, limits)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "context_budget_exceeded", err)
	}
	providerRequestPayload := primaryAgentRuntimeRequestPayload(
		run,
		input,
		strings.TrimSpace(stringValue(executionPayload["user_goal"])),
		providerConfig,
		conversationContext,
		campusDocsRetrieval,
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
			RunID:        run.RunID,
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
			"execution_strategy":       executionStrategyProjectionPayload(snapshot.ExecutionStrategy),
			"tool_runtime_fingerprint": toolRuntimeFingerprintSnapshotMap(snapshot.ToolRuntimeFingerprint),
			"visible_tool_names":       append([]string{}, visibleToolNames...),
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
	if snapshot.ToolRuntimeFingerprintSHA256 != "" {
		if err := validateAgentRuntimeToolFingerprint(
			snapshot.ToolRuntimeFingerprint,
			output.ToolRuntimeFingerprint,
		); err != nil {
			return s.failPrimaryAgentActivity(ctx, run, "agent_runtime_fingerprint_mismatch", err, output)
		}
	}
	output.RunID = run.RunID
	output.AgentResultRef = agentResultRef
	if toolName, failCloseReason, failed := primaryAgentFailedToolResult(output); failed {
		completedAt := time.Now().UTC()
		if err := s.projectPrimaryAgentToolResults(
			ctx,
			run,
			startedAt,
			completedAt,
			attempt,
			visibleToolNames,
			output,
		); err != nil {
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
		}
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"tool_execution_failed",
			primaryAgentToolFailureError{ToolName: toolName, FailCloseReason: failCloseReason},
			output,
		)
	}
	if strings.TrimSpace(output.Status) != "completed" {
		completedAt := time.Now().UTC()
		if err := s.projectPrimaryAgentToolResults(
			ctx,
			run,
			startedAt,
			completedAt,
			attempt,
			visibleToolNames,
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
		output.TerminalReason = primaryAgentActivityTerminalReason(output)
	}
	if !validPrimaryAgentTerminalEnvelope(output.TerminalEnvelope) {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_missing_terminal_envelope",
			fmt.Errorf("agent runtime terminal_envelope is required"),
			output,
		)
	}
	payload, err := primaryAgentResultPayload(primaryAgentResultInput{
		activityAttempt: attempt,
		activityInput:   input,
		run:             run,
	}, output)
	if err != nil {
		projectionErr := s.projectPrimaryAgentToolResults(
			ctx,
			run,
			startedAt,
			time.Now().UTC(),
			attempt,
			visibleToolNames,
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
		payload["context_usage"] = cloneAnyMapFromMetadata(output.ContextUsage)
	}
	outputSummary, err := encodeAgentInvocationOutputSummary(agentResultRef, invocationSHA256)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "agent_invocation_receipt_failed", err, output)
	}
	completedReceiptAt := time.Now().UTC().Truncate(time.Microsecond)
	outputDigest := sha256Bytes(outputSummary)
	if _, err := s.runProjectionStore.CompleteAgentInvocation(ctx, execution.AgentInvocationReceipt{
		InvocationID: invocationID,
		RunID:        run.RunID,
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
		visibleToolNames,
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
		InputTokens:        output.Usage.InputTokens,
		OutputTokens:       output.Usage.OutputTokens,
		CachedInputTokens:  output.Usage.CachedInputTokens,
		Payload:            projectionPayload,
	})); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":agent-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeAgentCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"agent_result_ref":     agentResultRef,
			"provider_response_id": output.ProviderResponseID,
			"stage_timing":         cloneAnyMapFromMetadata(output.StageTiming),
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

func (s *Server) beginPrimaryAgentRun(
	ctx context.Context,
	run execution.DurableRun,
	startedAt time.Time,
) (execution.DurableRun, error) {
	switch run.Status {
	case execution.DurableRunStatusQueued:
		admitted, err := s.runProjectionStore.TransitionRun(
			ctx,
			run.RunID,
			execution.DurableRunStatusAdmitted,
			"",
			startedAt,
		)
		if err != nil {
			return execution.DurableRun{}, err
		}
		if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RunID + ":run-admitted",
			RunID:                run.RunID,
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
			"run %s status %s cannot execute primary agent",
			run.RunID,
			run.Status,
		)
	}
	if run.Status == execution.DurableRunStatusAdmitted {
		running, err := s.runProjectionStore.TransitionRun(
			ctx,
			run.RunID,
			execution.DurableRunStatusRunning,
			"",
			startedAt,
		)
		if err != nil {
			return execution.DurableRun{}, err
		}
		if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RunID + ":run-started",
			RunID:                run.RunID,
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

func (s *Server) projectPrimaryAgentToolResults(
	ctx context.Context,
	run execution.DurableRun,
	startedAt time.Time,
	completedAt time.Time,
	attempt int,
	visibleToolNames []string,
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
	identities ...primaryAgentProjectionIdentity,
) error {
	identity := primaryAgentProjectionIdentity{WorkerID: s.config.TemporalWorkerIdentity}
	if len(identities) > 0 {
		identity = identities[0]
	}
	visible := stringSet(visibleToolNames)
	for index, result := range output.ToolResults {
		durationMS, err := primaryAgentToolDurationMS(result.DurationMS)
		if err != nil {
			return err
		}
		toolName := strings.TrimSpace(result.ToolName)
		if toolName == "" {
			return fmt.Errorf("agent runtime tool result tool_name is required")
		}
		projectionClass := projectionClassForToolName(toolName)
		payloadKind := strings.TrimSpace(result.PayloadKind)
		if payloadKind == "" {
			return fmt.Errorf("agent runtime tool result payload_kind is required")
		}
		status := strings.TrimSpace(result.Status)
		if status == "" {
			return fmt.Errorf("agent runtime tool result status is required")
		}
		if err := validatePrimaryAgentSDKToolResult(toolName, payloadKind); err != nil {
			return err
		}
		_, modelVisible := visible[toolName]
		if !modelVisible {
			return fmt.Errorf(
				"agent runtime tool %s was not visible for this turn",
				toolName,
			)
		}
		callIndex := index + 1
		stepID := fmt.Sprintf("sdk_tool.execute.%s.%d", toolName, callIndex)
		resultRef := primaryAgentSDKToolProjectionRef(run.RunID, toolName, callIndex)
		argumentMetadata, err := validateSDKToolArguments(toolName, result.ArgumentsJSON)
		if err != nil {
			validationFailure := summarizeTemporalFailure("tool_argument_invalid", "", err)
			payload := map[string]any{
				"argument_validation":      "Tool arguments did not match the admitted schema.",
				"argument_validation_hash": validationFailure.Hash,
				"arguments_json_sha256":    argumentMetadata.ArgumentsJSONSHA256,
				"arguments_schema_sha256":  argumentMetadata.ArgumentsSchemaSHA256,
				"arguments_schema_version": argumentMetadata.ArgumentsSchemaVersion,
				"fail_close_reason":        "schema_contract_drift",
				"payload_kind":             payloadKind,
				"result_sha256":            sha256AnyValue(result.Result),
				"runtime_surface":          "openai_agents_sdk_tool",
				"sdk_result_ref":           strings.TrimSpace(result.ResultRef),
				"tool_name":                toolName,
				"tool_status":              status,
			}
			if err := s.projectTemporalStep(ctx, identity.apply(temporalStepProjection{
				Attempt:         attempt,
				ActivityAttempt: attempt,
				PreserveAttempt: identity.PreserveAttempt,
				Tool:            projectionClass,
				Run:             run,
				Status:          "failed",
				StepID:          stepID,
				StepKind:        "tool",
				TaskQueue:       temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
				WorkerID:        identity.WorkerID,
				StartedAt:       startedAt,
				CompletedAt:     completedAt,
				DurationMS:      durationMS,
				UpdatedAt:       completedAt,
				ResultKind:      "activity_failure",
				ProjectionRef:   resultRef,
				FailCloseReason: "schema_contract_drift",
				Payload:         payload,
			})); err != nil {
				return err
			}
			return fmt.Errorf("agent runtime tool %s arguments invalid fail_close_reason=schema_contract_drift: %w", toolName, err)
		}
		resultPayload := cloneAnyMapFromMetadata(result.Result)
		resultEnvelope, err := sdkToolResultEnvelopeForProjection(
			toolName,
			payloadKind,
			status,
			resultPayload,
			resultRef,
		)
		if err != nil {
			payload := map[string]any{
				"arguments_json_sha256":    argumentMetadata.ArgumentsJSONSHA256,
				"arguments_schema_sha256":  argumentMetadata.ArgumentsSchemaSHA256,
				"arguments_schema_version": argumentMetadata.ArgumentsSchemaVersion,
				"fail_close_reason":        "result_contract_drift",
				"payload_kind":             payloadKind,
				"result_sha256":            sha256AnyValue(resultPayload),
				"runtime_surface":          "openai_agents_sdk_tool",
				"sdk_result_ref":           strings.TrimSpace(result.ResultRef),
				"tool_name":                toolName,
				"tool_status":              status,
			}
			if err := s.projectTemporalStep(ctx, identity.apply(temporalStepProjection{
				Attempt:         attempt,
				ActivityAttempt: attempt,
				PreserveAttempt: identity.PreserveAttempt,
				Tool:            projectionClass,
				Run:             run,
				Status:          "failed",
				StepID:          stepID,
				StepKind:        "tool",
				TaskQueue:       temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
				WorkerID:        identity.WorkerID,
				StartedAt:       startedAt,
				CompletedAt:     completedAt,
				DurationMS:      durationMS,
				UpdatedAt:       completedAt,
				ResultKind:      "activity_failure",
				ProjectionRef:   resultRef,
				FailCloseReason: "result_contract_drift",
				Payload:         payload,
			})); err != nil {
				return err
			}
			return fmt.Errorf("agent runtime tool %s result invalid fail_close_reason=result_contract_drift: %w", toolName, err)
		}
		_ = resultEnvelope
		payload := map[string]any{
			"arguments_json_sha256":    argumentMetadata.ArgumentsJSONSHA256,
			"arguments_schema_sha256":  argumentMetadata.ArgumentsSchemaSHA256,
			"arguments_schema_version": argumentMetadata.ArgumentsSchemaVersion,
			"fail_close_reason":        strings.TrimSpace(result.FailCloseReason),
			"outcome":                  boundedToolOutcome(resultPayload["outcome"]),
			"payload_kind":             payloadKind,
			"result_sha256":            sha256AnyValue(resultPayload),
			"runtime_surface":          "openai_agents_sdk_tool",
			"sdk_result_ref":           strings.TrimSpace(result.ResultRef),
			"tool_name":                toolName,
			"tool_status":              status,
		}
		// The raw tool result stays in the bounded Temporal Activity result.
		// Step and event projections carry hashes and bounded outcomes.
		if err := s.projectTemporalStep(ctx, identity.apply(temporalStepProjection{
			Attempt:         attempt,
			ActivityAttempt: attempt,
			PreserveAttempt: identity.PreserveAttempt,
			Tool:            projectionClass,
			Run:             run,
			Status:          temporalSDKToolStepStatus(status),
			StepID:          stepID,
			StepKind:        "tool",
			TaskQueue:       temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
			WorkerID:        identity.WorkerID,
			StartedAt:       startedAt,
			CompletedAt:     completedAt,
			DurationMS:      durationMS,
			UpdatedAt:       completedAt,
			ResultKind:      temporalSDKToolResultKind(status),
			ProjectionRef:   resultRef,
			FailCloseReason: strings.TrimSpace(result.FailCloseReason),
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

func validatePrimaryAgentSDKToolResult(toolName string, payloadKind string) error {
	registry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if !ok {
		return fmt.Errorf("tool registry is not available")
	}
	// Exposure controls whether a new run can offer the tool to the model. A
	// completed result may be replayed after that exposure is closed, so result
	// projection is bound to the registered read-only contract and the turn's
	// frozen visible_tool_names instead.
	tool, ok := registry.ToolByName(toolName)
	if !ok || !tool.ReadOnly {
		return fmt.Errorf("agent runtime tool %s is not admitted", toolName)
	}
	if tool.Name != payloadKind {
		return fmt.Errorf("agent runtime tool %s drifted from admitted payload kind", toolName)
	}
	return nil
}

func sdkToolResultEnvelopeForProjection(
	toolName string,
	payloadKind string,
	status string,
	result map[string]any,
	projectionRef string,
) (map[string]any, error) {
	toolName = strings.TrimSpace(toolName)
	status = strings.TrimSpace(status)
	if toolName == personalMemoryRecallToolName {
		if status != "completed" {
			return nil, nil
		}
		if err := validatePersonalMemoryRecallToolResult(result); err != nil {
			return nil, err
		}
		return nil, nil
	}
	return nil, nil
}

func validatePersonalMemoryRecallToolResult(result map[string]any) error {
	if len(result) != 2 {
		return fmt.Errorf("personal_memory_recall result must contain only outcome and memory_text")
	}
	outcome, outcomeOK := result["outcome"].(string)
	if !outcomeOK || (outcome != "matched" && outcome != "no_match") {
		return fmt.Errorf("personal_memory_recall result outcome is invalid")
	}
	if _, ok := result["memory_text"].(string); !ok {
		return fmt.Errorf("personal_memory_recall result memory_text must be a string")
	}
	return nil
}

func temporalSDKToolStepStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "completed":
		return "completed"
	default:
		return "failed"
	}
}

func temporalSDKToolResultKind(status string) string {
	switch strings.TrimSpace(status) {
	case "completed":
		return "typed_tool_result"
	default:
		return "activity_failure"
	}
}

func (s *Server) failPrimaryAgentActivity(
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
	var toolFailure primaryAgentToolFailureError
	if errors.As(cause, &toolFailure) {
		failCloseReason = toolFailure.FailCloseReason
	}
	summary := summarizeTemporalFailure(failureKind, "", cause)
	payload := map[string]any{
		"failure_hash": summary.Hash,
		"failure_kind": summary.Kind,
		"message":      summary.Message,
	}
	if failCloseReason != "" {
		payload["fail_close_reason"] = failCloseReason
	}
	if toolFailure.ToolName != "" {
		payload["tool_name"] = toolFailure.ToolName
	}
	var runtimeHTTPError agentRuntimeHTTPError
	if errors.As(cause, &runtimeHTTPError) {
		payload["agent_runtime_http_status"] = runtimeHTTPError.StatusCode
		if stableCode := primaryAgentRuntimeFailureKind(runtimeHTTPError); stableCode == strings.TrimSpace(runtimeHTTPError.Code) {
			payload["agent_runtime_error_code"] = stableCode
		}
	}
	var output temporalruntime.ExecutePrimaryAgentActivityOutput
	if len(outputs) > 0 {
		output = outputs[0]
	}
	err := s.projectTemporalFailureStep(ctx, run, temporalStepFailureProjection{
		Tool:               "",
		FailureHash:        summary.Hash,
		FailureKind:        summary.Kind,
		ModelName:          output.ModelName,
		ModelProvider:      output.ModelProvider,
		ModelRequestCount:  output.Usage.ModelRequestCount,
		InputTokens:        output.Usage.InputTokens,
		OutputTokens:       output.Usage.OutputTokens,
		CachedInputTokens:  output.Usage.CachedInputTokens,
		UsageObserved:      output.Usage.UsageObserved,
		ProviderResponseID: output.ProviderResponseID,
		ProjectionRef:      temporalProjectionRef(run.RunID, "agent/primary/result"),
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

type primaryAgentToolFailureError struct {
	FailCloseReason string
	ToolName        string
}

func (e primaryAgentToolFailureError) Error() string {
	return fmt.Sprintf(
		"agent runtime tool %s failed with fail_close_reason=%s",
		e.ToolName,
		e.FailCloseReason,
	)
}

func primaryAgentFailedToolResult(
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
) (string, string, bool) {
	for _, result := range output.ToolResults {
		if strings.TrimSpace(result.Status) != "failed" {
			continue
		}
		reason := strings.TrimSpace(result.FailCloseReason)
		if reason == "" {
			reason = "tool_execution_failed"
		}
		return strings.TrimSpace(result.ToolName), reason, true
	}
	return "", "", false
}

func validPrimaryAgentTerminalEnvelope(envelope map[string]any) bool {
	kind := strings.TrimSpace(stringValue(envelope["kind"]))
	switch kind {
	case "answer":
		return strings.TrimSpace(stringValue(envelope["answer_text"])) != ""
	case "clarification_required":
		return strings.TrimSpace(stringValue(envelope["follow_up_question"])) != "" ||
			strings.TrimSpace(stringValue(envelope["answer_text"])) != ""
	case "out_of_scope", "policy_refusal", "unsupported_by_evidence":
		return strings.TrimSpace(stringValue(envelope["reason"])) != "" ||
			strings.TrimSpace(stringValue(envelope["answer_text"])) != ""
	default:
		return false
	}
}

func primaryAgentActivityTerminalReason(output temporalruntime.ExecutePrimaryAgentActivityOutput) string {
	switch primaryAgentTerminalKind(output.TerminalEnvelope) {
	case "clarification_required":
		return "clarification_required"
	case "out_of_scope":
		return "out_of_scope"
	case "policy_refusal":
		return "policy_refusal"
	case "unsupported_by_evidence":
		return "unsupported_by_evidence"
	default:
		return string(execution.DurableTerminalReasonAnswerCompleted)
	}
}
