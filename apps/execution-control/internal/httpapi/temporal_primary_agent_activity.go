package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
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
	providerConfig, err := s.resolveProviderConfigSnapshot(ctx, providerConfigRolePrimaryAgent)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "provider_profile_missing", err)
	}
	input.KnowledgeTargets, err = s.knowledgeTargetsForAgent(input.VisibleToolNames)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "knowledge_target_registry_unavailable", err)
	}
	agentResultRef := temporalProjectionRef(run.RunID, "agent/primary/result")
	attempt := temporalActivityAttempt(ctx)
	limits := s.primaryAgentRuntimeLimits()
	finalModelContext, err := primaryAgentFinalModelContextForRun(run, input, limits)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "context_budget_exceeded", err)
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
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
			"context_usage":          primaryAgentContextUsageSummary(finalModelContext),
			"knowledge_targets":      knowledgeTargetsProjectionPayload(input.KnowledgeTargets),
			"memory_context_summary": temporalMemoryContextProjectionPayload(input.MemoryContext),
			"memory_projection_refs": append([]string{}, input.MemoryProjectionRefs...),
			"requested_tool":         input.RequestedTool,
			"visible_tool_names":     append([]string{}, input.VisibleToolNames...),
		},
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	output, err := s.callAgentRuntime(
		ctx,
		run,
		input,
		providerConfig,
		finalModelContext,
		limits,
		attempt,
	)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, primaryAgentRuntimeFailureKind(err), err)
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
			input.VisibleToolNames,
			output,
		); err != nil {
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
		}
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"tool_execution_failed",
			primaryAgentToolFailureError{ToolName: toolName, FailCloseReason: failCloseReason},
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
			input.VisibleToolNames,
			output,
		); err != nil {
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
		}
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_incomplete",
			fmt.Errorf("agent runtime status is %q", output.Status),
		)
	}
	if output.TerminalReason == "" {
		output.TerminalReason = primaryAgentActivityTerminalReason(output)
	}
	completedAt := time.Now().UTC()
	if err := s.projectPrimaryAgentToolResults(
		ctx,
		run,
		startedAt,
		completedAt,
		attempt,
		input.VisibleToolNames,
		output,
	); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if !validPrimaryAgentTerminalEnvelope(output.TerminalEnvelope) {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_missing_terminal_envelope",
			fmt.Errorf("agent runtime terminal_envelope is required"),
		)
	}
	payload, err := primaryAgentResultPayload(primaryAgentResultInput{
		activityAttempt: attempt,
		activityInput:   input,
		run:             run,
	}, output)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "agent_runtime_result_invalid", err)
	}
	if err := s.replaceTemporalAgentMetadata(ctx, run, func(metadata map[string]any) {
		for key, value := range payload {
			metadata[key] = value
		}
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:            attempt,
		Tool:               "",
		Run:                run,
		Status:             "completed",
		StepID:             "agent.primary",
		StepKind:           "agent",
		TaskQueue:          temporalruntime.ActivityTaskQueueAgent,
		WorkerID:           s.config.TemporalWorkerIdentity,
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
		Payload:            withPrimaryAgentContextUsage(payload, finalModelContext),
	}); err != nil {
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
			"selected_tools":       append([]string{}, output.SelectedTools...),
			"stage_timing":         cloneAnyMapFromMetadata(output.StageTiming),
			"terminal_reason":      output.TerminalReason,
		},
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	return output, nil
}

func (s *Server) knowledgeTargetsForAgent(
	visibleToolNames []string,
) ([]temporalruntime.KnowledgeTarget, error) {
	if !containsPrimaryAgentVisibleTool(visibleToolNames, "knowledge_query") {
		return nil, nil
	}
	policies, err := runtimepolicy.QueryServingTargets(
		strings.TrimSpace(s.config.QueryServingTargetsPath),
	)
	if err != nil {
		return nil, err
	}
	targets := make([]temporalruntime.KnowledgeTarget, 0, len(policies))
	for _, policy := range policies {
		targets = append(targets, temporalruntime.KnowledgeTarget{
			Description: policy.Description,
			Target:      policy.Target,
		})
	}
	return targets, nil
}

func knowledgeTargetsProjectionPayload(targets []temporalruntime.KnowledgeTarget) []map[string]any {
	if len(targets) == 0 {
		return nil
	}
	payload := make([]map[string]any, 0, len(targets))
	for _, target := range targets {
		payload = append(payload, map[string]any{
			"description": target.Description,
			"target":      target.Target,
		})
	}
	return payload
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
) error {
	visible := stringSet(visibleToolNames)
	for index, result := range output.ToolResults {
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
		_, knowledgeHandoffVisible := visible["knowledge_query"]
		if !modelVisible && (toolName != "knowledge_search" || !knowledgeHandoffVisible) {
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
				"result":                   cloneAnyMapFromMetadata(result.Result),
				"runtime_surface":          "openai_agents_sdk_tool",
				"sdk_result_ref":           strings.TrimSpace(result.ResultRef),
				"selected_tool":            toolName,
				"tool_status":              status,
			}
			if err := s.projectTemporalStep(ctx, temporalStepProjection{
				Attempt:         attempt,
				Tool:            projectionClass,
				Run:             run,
				Status:          "failed",
				StepID:          stepID,
				StepKind:        "tool",
				TaskQueue:       temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
				WorkerID:        s.config.TemporalWorkerIdentity,
				StartedAt:       startedAt,
				CompletedAt:     completedAt,
				UpdatedAt:       completedAt,
				ResultKind:      "activity_failure",
				ProjectionRef:   resultRef,
				FailCloseReason: "schema_contract_drift",
				Payload:         payload,
			}); err != nil {
				return err
			}
			return fmt.Errorf("agent runtime tool %s arguments invalid fail_close_reason=schema_contract_drift: %w", toolName, err)
		}
		resultPayload := cloneAnyMapFromMetadata(result.Result)
		if toolName == "knowledge_search" {
			continue
		}
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
				"result":                   resultPayload,
				"runtime_surface":          "openai_agents_sdk_tool",
				"sdk_result_ref":           strings.TrimSpace(result.ResultRef),
				"selected_tool":            toolName,
				"tool_status":              status,
			}
			if err := s.projectTemporalStep(ctx, temporalStepProjection{
				Attempt:         attempt,
				Tool:            projectionClass,
				Run:             run,
				Status:          "failed",
				StepID:          stepID,
				StepKind:        "tool",
				TaskQueue:       temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
				WorkerID:        s.config.TemporalWorkerIdentity,
				StartedAt:       startedAt,
				CompletedAt:     completedAt,
				UpdatedAt:       completedAt,
				ResultKind:      "activity_failure",
				ProjectionRef:   resultRef,
				FailCloseReason: "result_contract_drift",
				Payload:         payload,
			}); err != nil {
				return err
			}
			return fmt.Errorf("agent runtime tool %s result invalid fail_close_reason=result_contract_drift: %w", toolName, err)
		}
		payload := map[string]any{
			"arguments_json_sha256":    argumentMetadata.ArgumentsJSONSHA256,
			"arguments_schema_sha256":  argumentMetadata.ArgumentsSchemaSHA256,
			"arguments_schema_version": argumentMetadata.ArgumentsSchemaVersion,
			"fail_close_reason":        strings.TrimSpace(result.FailCloseReason),
			"outcome":                  resultPayload["outcome"],
			"payload_kind":             payloadKind,
			"result":                   resultPayload,
			"runtime_surface":          "openai_agents_sdk_tool",
			"sdk_result_ref":           strings.TrimSpace(result.ResultRef),
			"selected_tool":            toolName,
			"tool_status":              status,
		}
		if len(resultEnvelope) > 0 {
			payload["result_envelope"] = resultEnvelope
		}
		if err := s.projectTemporalStep(ctx, temporalStepProjection{
			Attempt:         attempt,
			Tool:            projectionClass,
			Run:             run,
			Status:          temporalSDKToolStepStatus(status),
			StepID:          stepID,
			StepKind:        "tool",
			TaskQueue:       temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
			WorkerID:        s.config.TemporalWorkerIdentity,
			StartedAt:       startedAt,
			CompletedAt:     completedAt,
			UpdatedAt:       completedAt,
			ResultKind:      temporalSDKToolResultKind(status),
			ProjectionRef:   resultRef,
			FailCloseReason: strings.TrimSpace(result.FailCloseReason),
			Payload:         payload,
		}); err != nil {
			return err
		}
	}
	return nil
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
	switch strings.TrimSpace(toolName) {
	case "transport_schedule_lookup":
		return "transport_schedule_lookup"
	case "knowledge_query":
		return "knowledge_query"
	case "knowledge_search":
		return "knowledge_search"
	default:
		return "tool"
	}
}

func validatePrimaryAgentSDKToolResult(toolName string, payloadKind string) error {
	registry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if !ok {
		return fmt.Errorf("tool registry is not available")
	}
	tool, ok := registry.ToolByName(toolName)
	if !ok || !tool.ReadOnly ||
		(tool.Exposure != "model_visible" &&
			(toolName != "knowledge_search" || tool.Exposure != "internal_only")) {
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
	if strings.TrimSpace(toolName) != "transport_schedule_lookup" {
		return nil, nil
	}
	if strings.TrimSpace(status) != "completed" {
		return nil, nil
	}
	envelope := cloneAnyMapFromMetadata(result["result_envelope"])
	if len(envelope) == 0 {
		return nil, fmt.Errorf("campus_services typed tool result_envelope is required")
	}
	if stringValue(envelope["schema_version"]) != "campus_services_tool_result.v1" {
		return nil, fmt.Errorf("campus_services typed tool result_envelope schema_version drift")
	}
	if stringValue(envelope["tool_name"]) != toolName {
		return nil, fmt.Errorf("campus_services typed tool result_envelope tool identity drift")
	}
	if stringValue(envelope["query_kind"]) == "" ||
		stringValue(envelope["outcome"]) == "" ||
		stringValue(envelope["content_hash"]) == "" {
		return nil, fmt.Errorf("campus_services typed tool result_envelope missing required fields")
	}
	if stringValue(envelope["outcome"]) != stringValue(result["outcome"]) {
		return nil, fmt.Errorf("campus_services typed tool result_envelope outcome drift")
	}
	if payloadKind == "transport_schedule_lookup" &&
		stringValue(envelope["query_kind"]) != "transport_schedule" {
		return nil, fmt.Errorf("campus_services typed tool result_envelope query_kind drift")
	}
	envelope["projection_ref"] = projectionRef
	return envelope, nil
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
	err := s.projectTemporalFailureStep(ctx, run, temporalStepFailureProjection{
		Tool:            "",
		FailureHash:     summary.Hash,
		FailureKind:     summary.Kind,
		ProjectionRef:   temporalProjectionRef(run.RunID, "agent/primary/result"),
		ResultKind:      "activity_failure",
		StepID:          "agent.primary",
		StepKind:        "agent",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		FailCloseReason: failCloseReason,
		Payload:         payload,
		TimeoutOutcome:  timeoutOutcome,
	}, cause)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, sanitizedTemporalApplicationError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return temporalruntime.ExecutePrimaryAgentActivityOutput{}, temporalApplicationError(summary, false)
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

func (s *Server) replaceTemporalAgentMetadata(
	ctx context.Context,
	run execution.DurableRun,
	mutate func(map[string]any),
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	metadata := cloneTemporalMetadata(latest.Metadata)
	agentMetadata := cloneAnyMapFromMetadata(metadata["temporal_agent"])
	mutate(agentMetadata)
	metadata["temporal_agent"] = agentMetadata
	return s.runProjectionStore.ReplaceRunMetadata(ctx, run.RunID, metadata)
}

func (s *Server) replaceExecutionPayloadMetadata(
	ctx context.Context,
	run execution.DurableRun,
	mutate func(map[string]any),
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	metadata := cloneTemporalMetadata(latest.Metadata)
	payload := cloneAnyMapFromMetadata(metadata["execution_payload"])
	mutate(payload)
	metadata["execution_payload"] = payload
	return s.runProjectionStore.ReplaceRunMetadata(ctx, run.RunID, metadata)
}

func primaryAgentInputText(run execution.DurableRun) string {
	executionPayload := cloneAnyMapFromMetadata(run.Metadata["execution_payload"])
	return strings.TrimSpace(stringValue(executionPayload["user_goal"]))
}
