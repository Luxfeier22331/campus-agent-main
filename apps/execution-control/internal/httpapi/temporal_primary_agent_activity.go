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
	input.VisibleCapabilities = s.primaryAgentVisibleCapabilities(run, input)
	agentResultRef := temporalProjectionRef(run.RunID, "agent/primary/result")
	attempt := primaryAgentAttempt(input.Attempt)
	replanReason := strings.TrimSpace(input.ReplanReason)
	finalModelContext := primaryAgentFinalModelContextForRun(run, input)
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       attempt,
		Capability:    "primary_agent",
		Run:           run,
		Status:        "started",
		StepID:        "agent.primary",
		StepKind:      "agent",
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: agentResultRef,
		ReplanReason:  replanReason,
		Payload: map[string]any{
			"context_usage":          primaryAgentContextUsageSummary(finalModelContext),
			"memory_context":         temporalMemoryContextPayload(input.MemoryContext),
			"memory_projection_refs": append([]string{}, input.MemoryProjectionRefs...),
			"replan_reason":          replanReason,
			"requested_capability":   input.RequestedCapability,
			"visible_capabilities":   append([]string{}, input.VisibleCapabilities...),
		},
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	output, err := s.callAgentRuntime(ctx, run, input, providerConfig, finalModelContext)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, primaryAgentRuntimeFailureKind(err), err)
	}
	output.RunID = run.RunID
	output.AgentResultRef = agentResultRef
	if strings.TrimSpace(output.Status) != "completed" {
		completedAt := time.Now().UTC()
		if err := s.projectPrimaryAgentToolResults(
			ctx,
			run,
			startedAt,
			completedAt,
			attempt,
			replanReason,
			input.VisibleCapabilities,
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
		replanReason,
		input.VisibleCapabilities,
		output,
	); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if !primaryAgentOutputIsWorkflowSignal(output) && !validPrimaryAgentTerminalEnvelope(output.TerminalEnvelope) {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_missing_terminal_envelope",
			fmt.Errorf("agent runtime terminal_envelope is required"),
		)
	}
	payload, err := primaryAgentResultPayload(run.RunID, output)
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
		Attempt:               attempt,
		Capability:            "primary_agent",
		Run:                   run,
		Status:                "completed",
		StepID:                "agent.primary",
		StepKind:              "agent",
		TaskQueue:             temporalruntime.ActivityTaskQueueAgent,
		WorkerID:              s.config.TemporalWorkerIdentity,
		StartedAt:             startedAt,
		CompletedAt:           completedAt,
		UpdatedAt:             completedAt,
		ResultKind:            "agent_final_output",
		ProjectionRef:         agentResultRef,
		ProviderResponseID:    output.ProviderResponseID,
		ModelProvider:         output.ModelProvider,
		ModelName:             output.ModelName,
		InputTokens:           output.Usage.InputTokens,
		OutputTokens:          output.Usage.OutputTokens,
		CachedInputTokens:     output.Usage.CachedInputTokens,
		EstimatedCostMicroUSD: output.Usage.EstimatedCostMicroUSD,
		ReplanReason:          replanReason,
		Payload:               withPrimaryAgentContextUsage(payload, finalModelContext),
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
			"sdk_trace_ref":        output.SDKTraceRef,
			"selected_tools":       append([]string{}, output.SelectedTools...),
			"terminal_reason":      output.TerminalReason,
		},
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	return output, nil
}

func (s *Server) primaryAgentVisibleCapabilities(
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) []string {
	if s == nil || s.intentPolicyErr != nil {
		return append([]string{}, input.VisibleCapabilities...)
	}
	return runtimepolicy.PrimaryAgentVisibleCapabilities(
		input.VisibleCapabilities,
		input.RequestedCapability,
		primaryAgentInputText(run),
		s.intentPolicy,
	)
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
	replanReason string,
	visibleCapabilities []string,
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
) error {
	visible := stringSet(visibleCapabilities)
	for index, result := range output.ToolResults {
		if strings.TrimSpace(result.ToolName) == "knowledge_query" {
			continue
		}
		toolName := strings.TrimSpace(result.ToolName)
		if toolName == "" {
			return fmt.Errorf("agent runtime tool result tool_name is required")
		}
		capability := strings.TrimSpace(result.Capability)
		if capability == "" {
			return fmt.Errorf("agent runtime tool result capability is required")
		}
		payloadKind := strings.TrimSpace(result.PayloadKind)
		if payloadKind == "" {
			return fmt.Errorf("agent runtime tool result payload_kind is required")
		}
		status := strings.TrimSpace(result.Status)
		if status == "" {
			return fmt.Errorf("agent runtime tool result status is required")
		}
		if err := validatePrimaryAgentSDKToolResult(toolName, capability, payloadKind); err != nil {
			return err
		}
		if _, ok := visible[capability]; !ok {
			return fmt.Errorf(
				"agent runtime tool %s capability %s was not visible for this turn",
				toolName,
				capability,
			)
		}
		callIndex := index + 1
		stepID := fmt.Sprintf("sdk_tool.execute.%s.%d", toolName, callIndex)
		resultRef := primaryAgentSDKToolProjectionRef(run.RunID, toolName, callIndex)
		if err := validateSDKToolArguments(toolName, result.ArgumentsJSON); err != nil {
			payload := map[string]any{
				"argument_validation": err.Error(),
				"arguments_json":      cloneAnyMapFromMetadata(result.ArgumentsJSON),
				"fail_close_reason":   "schema_contract_drift",
				"payload_kind":        payloadKind,
				"replan_reason":       strings.TrimSpace(replanReason),
				"result":              cloneAnyMapFromMetadata(result.Result),
				"runtime_surface":     "openai_agents_sdk_tool",
				"sdk_result_ref":      strings.TrimSpace(result.ResultRef),
				"selected_tool":       toolName,
				"tool_status":         status,
			}
			if err := s.projectTemporalStep(ctx, temporalStepProjection{
				Attempt:         attempt,
				Capability:      capability,
				Run:             run,
				Status:          "failed",
				StepID:          stepID,
				StepKind:        "tool",
				TaskQueue:       temporalruntime.ActivityTaskQueueForCapability(capability),
				WorkerID:        s.config.TemporalWorkerIdentity,
				StartedAt:       startedAt,
				CompletedAt:     completedAt,
				UpdatedAt:       completedAt,
				ResultKind:      "activity_failure",
				ProjectionRef:   resultRef,
				FailCloseReason: "schema_contract_drift",
				ReplanReason:    strings.TrimSpace(replanReason),
				Payload:         payload,
			}); err != nil {
				return err
			}
			return fmt.Errorf("agent runtime tool %s arguments invalid fail_close_reason=schema_contract_drift: %w", toolName, err)
		}
		resultPayload := cloneAnyMapFromMetadata(result.Result)
		resultEnvelope, err := sdkToolResultEnvelopeForProjection(
			toolName,
			capability,
			payloadKind,
			status,
			resultPayload,
			resultRef,
		)
		if err != nil {
			payload := map[string]any{
				"fail_close_reason": "result_contract_drift",
				"payload_kind":      payloadKind,
				"replan_reason":     strings.TrimSpace(replanReason),
				"result":            resultPayload,
				"runtime_surface":   "openai_agents_sdk_tool",
				"sdk_result_ref":    strings.TrimSpace(result.ResultRef),
				"selected_tool":     toolName,
				"tool_status":       status,
			}
			if err := s.projectTemporalStep(ctx, temporalStepProjection{
				Attempt:         attempt,
				Capability:      capability,
				Run:             run,
				Status:          "failed",
				StepID:          stepID,
				StepKind:        "tool",
				TaskQueue:       temporalruntime.ActivityTaskQueueForCapability(capability),
				WorkerID:        s.config.TemporalWorkerIdentity,
				StartedAt:       startedAt,
				CompletedAt:     completedAt,
				UpdatedAt:       completedAt,
				ResultKind:      "activity_failure",
				ProjectionRef:   resultRef,
				FailCloseReason: "result_contract_drift",
				ReplanReason:    strings.TrimSpace(replanReason),
				Payload:         payload,
			}); err != nil {
				return err
			}
			return fmt.Errorf("agent runtime tool %s result invalid fail_close_reason=result_contract_drift: %w", toolName, err)
		}
		payload := map[string]any{
			"arguments_json":    cloneAnyMapFromMetadata(result.ArgumentsJSON),
			"fail_close_reason": strings.TrimSpace(result.FailCloseReason),
			"outcome":           resultPayload["outcome"],
			"payload_kind":      payloadKind,
			"replan_reason":     strings.TrimSpace(replanReason),
			"result":            resultPayload,
			"runtime_surface":   "openai_agents_sdk_tool",
			"sdk_result_ref":    strings.TrimSpace(result.ResultRef),
			"selected_tool":     toolName,
			"tool_status":       status,
		}
		if len(resultEnvelope) > 0 {
			payload["result_envelope"] = resultEnvelope
		}
		if err := s.projectTemporalStep(ctx, temporalStepProjection{
			Attempt:         attempt,
			Capability:      capability,
			Run:             run,
			Status:          temporalSDKToolStepStatus(status),
			StepID:          stepID,
			StepKind:        "tool",
			TaskQueue:       temporalruntime.ActivityTaskQueueForCapability(capability),
			WorkerID:        s.config.TemporalWorkerIdentity,
			StartedAt:       startedAt,
			CompletedAt:     completedAt,
			UpdatedAt:       completedAt,
			ResultKind:      temporalSDKToolResultKind(status),
			ProjectionRef:   resultRef,
			FailCloseReason: strings.TrimSpace(result.FailCloseReason),
			ReplanReason:    strings.TrimSpace(replanReason),
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

func validatePrimaryAgentSDKToolResult(toolName string, capability string, payloadKind string) error {
	registry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if !ok {
		return fmt.Errorf("tool registry is not available")
	}
	tool, ok := registry.ToolByName(toolName)
	if !ok {
		return fmt.Errorf("agent runtime tool %s is not admitted", toolName)
	}
	if !tool.Active || !tool.ReadOnly || tool.RuntimePosture != "typed_activity_admitted" {
		return fmt.Errorf("agent runtime tool %s is not admitted", toolName)
	}
	if tool.OwnerCapability != capability || tool.PayloadKind != payloadKind {
		return fmt.Errorf(
			"agent runtime tool %s drifted from admitted capability/payload kind",
			toolName,
		)
	}
	return nil
}

func sdkToolResultEnvelopeForProjection(
	toolName string,
	capability string,
	payloadKind string,
	status string,
	result map[string]any,
	projectionRef string,
) (map[string]any, error) {
	if capability != "campus_services" {
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
	if stringValue(envelope["capability"]) != capability ||
		stringValue(envelope["tool_name"]) != toolName {
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
	if failureKind == "agent_runtime_timeout" {
		failCloseReason = "agent_runtime_timeout"
		timeoutOutcome = execution.TimeoutOutcomeProviderTimeout
	}
	payload := map[string]any{
		"failure_kind": failureKind,
		"message":      cause.Error(),
	}
	if failCloseReason != "" {
		payload["fail_close_reason"] = failCloseReason
	}
	var runtimeHTTPError agentRuntimeHTTPError
	if errors.As(cause, &runtimeHTTPError) {
		payload["agent_runtime_http_status"] = runtimeHTTPError.StatusCode
		if strings.TrimSpace(runtimeHTTPError.Code) != "" {
			payload["agent_runtime_error_code"] = strings.TrimSpace(runtimeHTTPError.Code)
		}
	}
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		Capability:      "primary_agent",
		FailureKind:     failureKind,
		ProjectionRef:   temporalProjectionRef(run.RunID, "agent/primary/result"),
		ResultKind:      "activity_failure",
		StepID:          "agent.primary",
		StepKind:        "agent",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		FailCloseReason: failCloseReason,
		Payload:         payload,
		TimeoutOutcome:  timeoutOutcome,
	}, cause)
	return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
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

func primaryAgentOutputIsWorkflowSignal(output temporalruntime.ExecutePrimaryAgentActivityOutput) bool {
	for _, tool := range output.SelectedTools {
		if strings.TrimSpace(tool) == "knowledge_query" {
			return true
		}
	}
	for _, result := range output.ToolResults {
		if strings.TrimSpace(result.ToolName) == "knowledge_query" {
			return true
		}
		if signal, ok := result.Result["workflow_signal"].(string); ok &&
			strings.TrimSpace(signal) == "knowledge_query" {
			return true
		}
	}
	return false
}

func primaryAgentActivityTerminalReason(output temporalruntime.ExecutePrimaryAgentActivityOutput) string {
	if primaryAgentOutputIsWorkflowSignal(output) {
		return "tool_selected"
	}
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

func primaryAgentInputText(run execution.DurableRun) string {
	executionPayload := cloneAnyMapFromMetadata(run.Metadata["execution_payload"])
	return strings.TrimSpace(stringValue(executionPayload["user_goal"]))
}
