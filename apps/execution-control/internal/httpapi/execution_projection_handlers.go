package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) handleExecutionRunGet(response http.ResponseWriter, request *http.Request, runID string) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.runProjectionStore == nil {
		setOutcome(response, "projection_store_not_configured")
		writeError(
			response,
			http.StatusServiceUnavailable,
			"projection_store_not_configured",
			"Execution projection store is not configured.",
			true,
		)
		return
	}
	if strings.TrimSpace(runID) == "" {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "run_id is required.", false)
		return
	}
	run, err := s.runProjectionStore.GetRun(request.Context(), strings.TrimSpace(runID))
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			setOutcome(response, "durable_run_not_found")
			writeError(response, http.StatusNotFound, "durable_run_not_found", "Durable run not found.", false)
			return
		}
		setOutcome(response, "durable_run_query_failed")
		writeError(response, http.StatusInternalServerError, "durable_run_query_failed", err.Error(), true)
		return
	}
	setOutcome(response, "durable_run")
	writeJSON(response, http.StatusOK, durableRunResponse(run))
}

func (s *Server) handleExecutionRunEvents(response http.ResponseWriter, request *http.Request, runID string) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.runProjectionStore == nil {
		setOutcome(response, "projection_store_not_configured")
		writeError(
			response,
			http.StatusServiceUnavailable,
			"projection_store_not_configured",
			"Execution projection store is not configured.",
			true,
		)
		return
	}
	if strings.TrimSpace(runID) == "" {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "run_id is required.", false)
		return
	}
	afterSequence, err := readAfterSequenceQuery(request)
	if err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	waitBudget, err := readRunEventsWaitBudget(request)
	if err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	events, err := s.listRunEventsAfterWithOptionalWait(
		request.Context(),
		strings.TrimSpace(runID),
		afterSequence,
		waitBudget,
	)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			setOutcome(response, "durable_run_not_found")
			writeError(response, http.StatusNotFound, "durable_run_not_found", "Durable run not found.", false)
			return
		}
		setOutcome(response, "durable_run_events_query_failed")
		writeError(
			response,
			http.StatusInternalServerError,
			"durable_run_events_query_failed",
			err.Error(),
			true,
		)
		return
	}
	body := make([]map[string]any, 0, len(events))
	for _, event := range events {
		body = append(body, durableRunEventResponse(event))
	}
	setOutcome(response, "durable_run_events")
	writeJSON(response, http.StatusOK, map[string]any{"events": body})
}

func (s *Server) listRunEventsAfterWithOptionalWait(
	ctx context.Context,
	runID string,
	afterSequence int64,
	waitBudget time.Duration,
) ([]execution.DurableRunEvent, error) {
	deadline := time.Now().Add(waitBudget)
	for {
		events, err := s.runProjectionStore.ListRunEventsAfter(ctx, runID, afterSequence)
		if err != nil {
			return nil, err
		}
		if len(events) > 0 || waitBudget <= 0 || !time.Now().Before(deadline) {
			return events, nil
		}

		timer := time.NewTimer(200 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func (s *Server) handleExecutionRunSteps(response http.ResponseWriter, request *http.Request, runID string) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.runProjectionStore == nil {
		setOutcome(response, "projection_store_not_configured")
		writeError(
			response,
			http.StatusServiceUnavailable,
			"projection_store_not_configured",
			"Execution projection store is not configured.",
			true,
		)
		return
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "run_id is required.", false)
		return
	}
	run, err := s.runProjectionStore.GetRun(request.Context(), runID)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			setOutcome(response, "execution_run_not_found")
			writeError(response, http.StatusNotFound, "execution_run_not_found", "Execution run not found.", false)
			return
		}
		setOutcome(response, "execution_run_query_failed")
		writeError(response, http.StatusInternalServerError, "execution_run_query_failed", err.Error(), true)
		return
	}
	steps, err := s.runProjectionStore.ListRunSteps(request.Context(), runID)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			setOutcome(response, "execution_run_not_found")
			writeError(response, http.StatusNotFound, "execution_run_not_found", "Execution run not found.", false)
			return
		}
		setOutcome(response, "execution_run_steps_query_failed")
		writeError(response, http.StatusInternalServerError, "execution_run_steps_query_failed", err.Error(), true)
		return
	}
	attempts, err := s.runProjectionStore.ListStepAttempts(request.Context(), runID)
	if err != nil {
		setOutcome(response, "execution_step_attempts_query_failed")
		writeError(response, http.StatusInternalServerError, "execution_step_attempts_query_failed", err.Error(), true)
		return
	}
	results, err := s.runProjectionStore.ListStepResults(request.Context(), runID)
	if err != nil {
		setOutcome(response, "execution_step_results_query_failed")
		writeError(response, http.StatusInternalServerError, "execution_step_results_query_failed", err.Error(), true)
		return
	}
	bodySteps := make([]map[string]any, 0, len(steps))
	for _, step := range steps {
		bodySteps = append(bodySteps, runStepProjectionResponse(step))
	}
	bodyAttempts := make([]map[string]any, 0, len(attempts))
	for _, attempt := range attempts {
		bodyAttempts = append(bodyAttempts, stepAttemptProjectionResponse(attempt))
	}
	bodyResults := make([]map[string]any, 0, len(results))
	for _, result := range results {
		bodyResults = append(bodyResults, stepResultProjectionResponse(result))
	}
	setOutcome(response, "execution_run_steps")
	writeJSON(response, http.StatusOK, map[string]any{
		"steps":                         bodySteps,
		"attempts":                      bodyAttempts,
		"results":                       bodyResults,
		"agent_runtime_eval_projection": buildAgentRuntimeEvalProjection(run, steps, attempts, results),
	})
}

func readAfterSequenceQuery(request *http.Request) (int64, error) {
	raw := strings.TrimSpace(request.URL.Query().Get("after_sequence"))
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, errors.New("after_sequence must be a non-negative integer")
	}
	return value, nil
}

func readRunEventsWaitBudget(request *http.Request) (time.Duration, error) {
	raw := strings.TrimSpace(request.URL.Query().Get("wait_ms"))
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, errors.New("wait_ms must be a non-negative integer")
	}
	if value > 30_000 {
		return 0, errors.New("wait_ms must be less than or equal to 30000")
	}
	return time.Duration(value) * time.Millisecond, nil
}

func durableRunFromCreateBody(
	body json.RawMessage,
	now time.Time,
	taskQueue string,
) (execution.DurableRun, error) {
	wire, err := contracts.DecodeExecutionRunCreateRequestWireJSON(body)
	if err != nil {
		return execution.DurableRun{}, fmt.Errorf("invalid execution run create request: %w", err)
	}
	metadataPayload, err := executionPayloadMetadataMap(wire.Metadata.ExecutionPayload)
	if err != nil {
		return execution.DurableRun{}, err
	}
	taskQueue = strings.TrimSpace(taskQueue)
	if taskQueue == "" {
		return execution.DurableRun{}, errors.New("execution task queue is not configured")
	}
	return execution.DurableRun{
		RunID:           wire.RunID,
		ConversationID:  wire.ConversationID,
		TurnID:          wire.TurnID,
		RequestID:       wire.RequestID,
		TraceID:         wire.TraceID,
		OwnerUserID:     wire.OwnerUserID,
		Surface:         wire.Surface,
		RequestedTool:   string(wire.Metadata.ExecutionPayload.RequestedTool),
		Status:          execution.DurableRunStatusCreated,
		TaskQueue:       taskQueue,
		CreatedAt:       now,
		UpdatedAt:       now,
		RuntimeVersions: wire.RuntimeVersions,
		Metadata:        map[string]any{"execution_payload": metadataPayload},
	}, nil
}

func executionPayloadMetadataMap(payload contracts.ExecutionPayloadWire) (map[string]any, error) {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("metadata.execution_payload cannot be encoded: %w", err)
	}
	var metadata map[string]any
	if err := json.Unmarshal(payloadJSON, &metadata); err != nil {
		return nil, fmt.Errorf("metadata.execution_payload cannot be materialized: %w", err)
	}
	return metadata, nil
}

func durableRunResponse(run execution.DurableRun) map[string]any {
	return map[string]any{
		"run_id":               run.RunID,
		"conversation_id":      run.ConversationID,
		"turn_id":              run.TurnID,
		"request_id":           run.RequestID,
		"trace_id":             run.TraceID,
		"owner_user_id":        run.OwnerUserID,
		"surface":              run.Surface,
		"requested_tool":       run.RequestedTool,
		"selected_tool":        run.SelectedTool,
		"status":               string(run.Status),
		"task_queue":           run.TaskQueue,
		"terminal_reason":      string(run.TerminalReason),
		"fail_close_reason":    run.FailCloseReason,
		"created_at":           formatOptionalTime(run.CreatedAt),
		"queued_at":            formatOptionalTime(run.QueuedAt),
		"admitted_at":          formatOptionalTime(run.AdmittedAt),
		"started_at":           formatOptionalTime(run.StartedAt),
		"streaming_started_at": formatOptionalTime(run.StreamingStartedAt),
		"completed_at":         formatOptionalTime(run.CompletedAt),
		"updated_at":           formatOptionalTime(run.UpdatedAt),
		"final_response_ref":   run.FinalResponseRef,
	}
}

func durableRunEventResponse(event execution.DurableRunEvent) map[string]any {
	return map[string]any{
		"event_id":               event.EventID,
		"run_id":                 event.RunID,
		"conversation_id":        event.ConversationID,
		"event_type":             string(event.EventType),
		"sequence":               event.Sequence,
		"occurred_at":            formatOptionalTime(event.OccurredAt),
		"visibility":             string(event.Visibility),
		"payload_schema_version": event.PayloadSchemaVersion,
		"payload":                event.Payload,
	}
}

func runStepProjectionResponse(step execution.RunStepProjection) map[string]any {
	return map[string]any{
		"step_id":                step.StepID,
		"run_id":                 step.RunID,
		"conversation_id":        step.ConversationID,
		"step_kind":              step.StepKind,
		"tool":                   step.Tool,
		"parent_step_id":         step.ParentStepID,
		"status":                 step.Status,
		"task_queue":             step.TaskQueue,
		"worker_id":              step.WorkerID,
		"started_at":             formatOptionalTime(step.StartedAt),
		"completed_at":           formatOptionalTime(step.CompletedAt),
		"updated_at":             formatOptionalTime(step.UpdatedAt),
		"payload_schema_version": step.PayloadSchemaVersion,
		"sanitized_payload":      sanitizeProjectionPayload(step.SanitizedPayload),
	}
}

func stepAttemptProjectionResponse(attempt execution.StepAttemptProjection) map[string]any {
	return map[string]any{
		"attempt_id":              attempt.AttemptID,
		"step_id":                 attempt.StepID,
		"run_id":                  attempt.RunID,
		"attempt":                 attempt.Attempt,
		"status":                  attempt.Status,
		"task_queue":              attempt.TaskQueue,
		"worker_id":               attempt.WorkerID,
		"workflow_id":             attempt.WorkflowID,
		"temporal_run_id":         attempt.TemporalRunID,
		"activity_id":             attempt.ActivityID,
		"activity_type":           attempt.ActivityType,
		"activity_attempt":        attempt.ActivityAttempt,
		"scheduled_at":            formatOptionalTime(attempt.ScheduledAt),
		"started_at":              formatOptionalTime(attempt.StartedAt),
		"completed_at":            formatOptionalTime(attempt.CompletedAt),
		"schedule_to_start_ms":    attempt.ScheduleToStartMS,
		"duration_ms":             attempt.DurationMS,
		"provider_request_ref":    attempt.ProviderRequestRef,
		"provider_response_id":    attempt.ProviderResponseID,
		"model_provider":          attempt.ModelProvider,
		"model_name":              attempt.ModelName,
		"model_request_count":     attempt.ModelRequestCount,
		"input_tokens":            attempt.InputTokens,
		"output_tokens":           attempt.OutputTokens,
		"cached_input_tokens":     attempt.CachedInputTokens,
		"usage_observed":          attempt.UsageObserved,
		"cancel_outcome":          string(attempt.CancelOutcome),
		"timeout_outcome":         string(attempt.TimeoutOutcome),
		"late_completion_outcome": string(attempt.LateCompletionOutcome),
		"fail_close_reason":       attempt.FailCloseReason,
		"terminal_reason":         attempt.TerminalReason,
		"updated_at":              formatOptionalTime(attempt.UpdatedAt),
		"payload_schema_version":  attempt.PayloadSchemaVersion,
		"sanitized_payload":       sanitizeProjectionPayload(attempt.SanitizedPayload),
	}
}

func stepResultProjectionResponse(result execution.StepResultProjection) map[string]any {
	return map[string]any{
		"result_id":              result.ResultID,
		"step_id":                result.StepID,
		"run_id":                 result.RunID,
		"attempt_id":             result.AttemptID,
		"status":                 result.Status,
		"result_kind":            result.ResultKind,
		"projection_ref":         result.ProjectionRef,
		"created_at":             formatOptionalTime(result.CreatedAt),
		"payload_schema_version": result.PayloadSchemaVersion,
		"sanitized_payload":      sanitizeProjectionPayload(result.SanitizedPayload),
	}
}

func buildAgentRuntimeEvalProjection(
	run execution.DurableRun,
	steps []execution.RunStepProjection,
	attempts []execution.StepAttemptProjection,
	results []execution.StepResultProjection,
) map[string]any {
	results, attempts = successfulPrimaryAgentActivityProjections(results, attempts)
	selectedTool := firstNonEmptyText(
		run.SelectedTool,
		firstStepTool(steps),
		projectedSelectedTool(results),
	)
	return map[string]any{
		"schema_version": "agent_runtime_eval_projection.v2",
		"run": map[string]any{
			"run_id":            run.RunID,
			"request_id":        run.RequestID,
			"trace_id":          run.TraceID,
			"status":            string(run.Status),
			"terminal_reason":   string(run.TerminalReason),
			"fail_close_reason": run.FailCloseReason,
		},
		"trajectory": map[string]any{
			"selected_tool":          selectedTool,
			"tool_calls":             projectedPublicToolCalls(results, attempts),
			"internal_tool_calls":    projectedKnowledgeSearchCalls(results, attempts),
			"direct_answer":          projectedBoolFromResults(results, "direct_answer"),
			"requires_clarification": projectedBoolFromResults(results, "requires_clarification"),
		},
		"tool_trajectory": buildToolTrajectoryProjection(run, steps, attempts, results, selectedTool),
		"planning":        projectedPlanningForEval(results),
		"rag":             projectedRAGForEval(results),
		"memory":          projectedMemoryForEval(results),
	}
}

func successfulPrimaryAgentActivityProjections(
	results []execution.StepResultProjection,
	attempts []execution.StepAttemptProjection,
) ([]execution.StepResultProjection, []execution.StepAttemptProjection) {
	successfulAttempt := 0
	for _, result := range results {
		if result.StepID != "agent.primary" || result.Status != "completed" ||
			result.ResultKind != "agent_final_output" {
			continue
		}
		activityAttempt, ok := positiveIntValue(result.SanitizedPayload["activity_attempt"])
		if !ok || result.AttemptID != temporalStepAttemptID(result.RunID, result.StepID, activityAttempt) {
			continue
		}
		if activityAttempt > successfulAttempt {
			successfulAttempt = activityAttempt
		}
	}
	filteredResults := make([]execution.StepResultProjection, 0, len(results))
	for _, result := range results {
		if !primaryAgentActivityStep(result.StepID) {
			filteredResults = append(filteredResults, result)
			continue
		}
		if successfulAttempt > 0 &&
			result.AttemptID == temporalStepAttemptID(result.RunID, result.StepID, successfulAttempt) {
			filteredResults = append(filteredResults, result)
		}
	}
	filteredAttempts := make([]execution.StepAttemptProjection, 0, len(attempts))
	for _, attempt := range attempts {
		if !primaryAgentActivityStep(attempt.StepID) ||
			successfulAttempt > 0 && projectionActivityAttempt(attempt) == successfulAttempt {
			filteredAttempts = append(filteredAttempts, attempt)
		}
	}
	return filteredResults, filteredAttempts
}

func primaryAgentActivityStep(stepID string) bool {
	return stepID == "agent.primary" || strings.HasPrefix(stepID, "knowledge.search.") ||
		strings.HasPrefix(stepID, "sdk_tool.execute.")
}

func projectionActivityAttempt(attempt execution.StepAttemptProjection) int {
	if attempt.ActivityAttempt > 0 {
		return attempt.ActivityAttempt
	}
	return attempt.Attempt
}

func buildToolTrajectoryProjection(
	run execution.DurableRun,
	steps []execution.RunStepProjection,
	attempts []execution.StepAttemptProjection,
	results []execution.StepResultProjection,
	selectedTool string,
) map[string]any {
	toolCalls := projectedPublicToolCalls(results, attempts)
	internalToolCalls := projectedKnowledgeSearchCalls(results, attempts)
	decisionKind := "direct_answer"
	if run.FailCloseReason != "" || run.TerminalReason == execution.DurableTerminalReasonPolicyRejected ||
		run.TerminalReason == execution.DurableTerminalReasonToolClosed ||
		run.TerminalReason == execution.DurableTerminalReasonRuntimeInvariant {
		decisionKind = "fail_closed"
	} else if len(toolCalls) > 0 || selectedTool != "" && selectedTool != "none" {
		decisionKind = "tool_call"
	}
	projection := map[string]any{
		"schema_version":      "tool_trajectory.v2",
		"request_id":          run.RequestID,
		"run_id":              run.RunID,
		"trace_id":            run.TraceID,
		"conversation_id":     run.ConversationID,
		"surface":             run.Surface,
		"environment":         firstNonEmptyText(run.Metadata["environment"], run.RuntimeVersions["environment"]),
		"release":             firstNonEmptyText(run.Metadata["release"], run.RuntimeVersions["release"]),
		"available_tools":     projectedAvailableTools(steps, results),
		"decision_kind":       decisionKind,
		"selected_tool":       selectedTool,
		"tool_calls":          toolCalls,
		"internal_tool_calls": internalToolCalls,
	}
	if run.FailCloseReason != "" {
		projection["fail_close_reason"] = run.FailCloseReason
	}
	return sanitizeProjectionPayload(projection)
}

func projectedAvailableTools(
	steps []execution.RunStepProjection,
	results []execution.StepResultProjection,
) []string {
	values := []string{}
	for _, step := range steps {
		appendPublicProjectionTool(&values, step.Tool)
		payload := sanitizeProjectionPayload(step.SanitizedPayload)
		for _, tool := range stringSliceFromAny(payload["visible_tool_names"]) {
			appendPublicProjectionTool(&values, tool)
		}
	}
	for _, result := range results {
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		for _, tool := range stringSliceFromAny(payload["selected_tools"]) {
			appendPublicProjectionTool(&values, tool)
		}
	}
	return values
}

func projectedPublicToolCalls(
	results []execution.StepResultProjection,
	attempts []execution.StepAttemptProjection,
) []map[string]any {
	calls := []map[string]any{}
	attemptByID := map[string]execution.StepAttemptProjection{}
	for _, attempt := range attempts {
		attemptByID[attempt.AttemptID] = attempt
	}
	resultAttemptByProjectionRef := map[string]execution.StepAttemptProjection{}
	for _, result := range results {
		if attempt, ok := attemptByID[result.AttemptID]; ok && strings.TrimSpace(result.ProjectionRef) != "" {
			resultAttemptByProjectionRef[strings.TrimSpace(result.ProjectionRef)] = attempt
		}
	}
	for _, result := range results {
		if result.StepID != "agent.primary" {
			continue
		}
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		agentAttempt := attemptByID[result.AttemptID]
		for _, selectedTool := range primaryAgentPublicSelectedTools(stringSliceFromAny(payload["selected_tools"])) {
			if selectedTool != "knowledge_query" {
				continue
			}
			call := map[string]any{
				"tool_name":    "knowledge_query",
				"tool_call_id": result.ResultID + ":handoff:knowledge_query",
				"status":       result.Status,
				"result_kind":  "agent_handoff",
			}
			if provider := strings.TrimSpace(agentAttempt.ModelProvider); provider != "" {
				call["provider"] = provider
			}
			if model := strings.TrimSpace(agentAttempt.ModelName); model != "" {
				call["model"] = model
			}
			calls = append(calls, sanitizeProjectionPayload(call))
			break
		}
		for index, toolResult := range knowledgeEvidenceMaps(payload["tool_results"]) {
			internalToolName := firstNonEmptyText(toolResult["tool_name"])
			if internalToolName == "knowledge_search" {
				continue
			}
			toolName := internalToolName
			if toolName == "" {
				continue
			}
			resultRef := firstNonEmptyText(toolResult["result_ref"])
			call := map[string]any{
				"tool_name":    toolName,
				"tool_call_id": firstNonEmptyText(resultRef, fmt.Sprintf("%s:tool-call:%d", result.ResultID, index+1)),
				"status":       firstNonEmptyText(toolResult["status"], result.Status),
				"result_kind":  firstNonEmptyText(toolResult["payload_kind"], internalToolName),
			}
			if argumentsHash := firstNonEmptyText(toolResult["arguments_json_sha256"]); argumentsHash != "" {
				call["arguments_hash"] = argumentsHash
			}
			if reason := firstNonEmptyText(toolResult["fail_close_reason"]); reason != "" {
				call["fail_close_reason"] = reason
			}
			if evalSafeArgs := projectedEvalSafeToolArgs(toolName, toolResult); len(evalSafeArgs) > 0 {
				call["eval_safe_args"] = evalSafeArgs
			}
			if toolAttempt, ok := resultAttemptByProjectionRef[resultRef]; ok && toolAttempt.DurationMS > 0 {
				call["duration_ms"] = toolAttempt.DurationMS
			}
			if provider := strings.TrimSpace(agentAttempt.ModelProvider); provider != "" {
				call["provider"] = provider
			}
			if model := strings.TrimSpace(agentAttempt.ModelName); model != "" {
				call["model"] = model
			}
			calls = append(calls, sanitizeProjectionPayload(call))
		}
	}
	return calls
}

func projectedKnowledgeSearchCalls(
	results []execution.StepResultProjection,
	attempts []execution.StepAttemptProjection,
) []map[string]any {
	attemptByID := map[string]execution.StepAttemptProjection{}
	for _, attempt := range attempts {
		attemptByID[attempt.AttemptID] = attempt
	}
	calls := []map[string]any{}
	for _, result := range results {
		if !strings.HasPrefix(result.StepID, "knowledge.search.") {
			continue
		}
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		ordinal, ok := positiveIntValue(payload["search_ordinal"])
		if !ok {
			continue
		}
		call := map[string]any{
			"tool_name":      "knowledge_search",
			"tool_call_id":   firstNonEmptyText(payload["invocation_id"], result.ProjectionRef, result.ResultID),
			"status":         result.Status,
			"result_kind":    result.ResultKind,
			"search_ordinal": ordinal,
		}
		if queryHash := firstNonEmptyText(payload["query_sha256"]); queryHash != "" {
			call["query_hash"] = queryHash
		}
		if outcome := firstNonEmptyText(payload["outcome"]); outcome != "" {
			call["outcome"] = outcome
		}
		for _, key := range []string{"candidate_count", "discarded_count"} {
			if value, ok := positiveIntValue(payload[key]); ok {
				call[key] = value
			}
		}
		if evalSafeArgs := projectedEvalSafeToolArgs("knowledge_search", payload); len(evalSafeArgs) > 0 {
			call["eval_safe_args"] = evalSafeArgs
		}
		if attempt, ok := attemptByID[result.AttemptID]; ok && attempt.DurationMS > 0 {
			call["duration_ms"] = attempt.DurationMS
		}
		calls = append(calls, sanitizeProjectionPayload(call))
	}
	sort.SliceStable(calls, func(left int, right int) bool {
		leftOrdinal, _ := positiveIntValue(calls[left]["search_ordinal"])
		rightOrdinal, _ := positiveIntValue(calls[right]["search_ordinal"])
		return leftOrdinal < rightOrdinal
	})
	return calls
}

func projectedEvalSafeToolArgs(toolName string, toolResult map[string]any) map[string]any {
	if strings.TrimSpace(toolName) != "knowledge_search" {
		return map[string]any{}
	}
	result := optionalMapFromMap(toolResult, "result")
	if len(result) == 0 {
		result = toolResult
	}
	args := map[string]any{}
	if target := firstNonEmptyText(result["retrieval_target"], result["target"]); target != "" {
		args["target"] = target
	}
	if includeHistory, ok := result["include_history"].(bool); ok {
		args["include_history"] = includeHistory
	}
	return args
}

func projectedSelectedTool(results []execution.StepResultProjection) string {
	for _, result := range results {
		if result.StepID != "agent.primary" {
			continue
		}
		selectedTools := primaryAgentPublicSelectedTools(
			stringSliceFromAny(sanitizeProjectionPayload(result.SanitizedPayload)["selected_tools"]),
		)
		if selectedTool := primaryAgentSelectedTool(selectedTools); selectedTool != "" {
			return selectedTool
		}
	}
	return ""
}

func appendPublicProjectionTool(values *[]string, tool string) {
	appendUniqueProjectionString(values, publicProjectionToolName(tool))
}

func publicProjectionToolName(tool string) string {
	tool = strings.TrimSpace(tool)
	if tool == "knowledge_search" {
		return "knowledge_query"
	}
	return tool
}

func firstStepTool(steps []execution.RunStepProjection) string {
	for _, step := range steps {
		if tool := publicProjectionToolName(step.Tool); tool != "" {
			return tool
		}
	}
	return ""
}

func stringFromProjectionPayload(payload map[string]any, key string) string {
	value, _ := sanitizeProjectionPayload(payload)[key].(string)
	return strings.TrimSpace(value)
}

func projectedBoolFromResults(results []execution.StepResultProjection, key string) bool {
	for _, result := range results {
		value, ok := sanitizeProjectionPayload(result.SanitizedPayload)[key].(bool)
		if ok {
			return value
		}
	}
	return false
}

func projectedRecordFromResults(results []execution.StepResultProjection, key string) map[string]any {
	for _, result := range results {
		record, ok := sanitizeProjectionPayload(result.SanitizedPayload)[key].(map[string]any)
		if ok {
			return sanitizeProjectionPayload(record)
		}
	}
	return map[string]any{}
}

func sanitizeProjectionPayload(payload map[string]any) map[string]any {
	if payload == nil {
		return map[string]any{}
	}
	sanitized := map[string]any{}
	for key, value := range payload {
		if unsafeProjectionKey(key) {
			continue
		}
		sanitized[key] = sanitizeProjectionValue(value)
	}
	return sanitized
}

func sanitizeProjectionValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return sanitizeProjectionPayload(typed)
	case []any:
		items := make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, sanitizeProjectionValue(item))
		}
		return items
	case []map[string]any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, sanitizeProjectionPayload(item))
		}
		return items
	default:
		return value
	}
}

func unsafeProjectionKey(key string) bool {
	normalizedKey := strings.ToLower(strings.TrimSpace(key))
	return strings.Contains(normalizedKey, "raw_prompt") ||
		strings.Contains(normalizedKey, "raw_answer") ||
		strings.Contains(normalizedKey, "raw_provider") ||
		strings.Contains(normalizedKey, "raw_source") ||
		strings.Contains(normalizedKey, "source_body") ||
		strings.Contains(normalizedKey, "cookie") ||
		strings.Contains(normalizedKey, "authorization") ||
		strings.Contains(normalizedKey, "api_key") ||
		strings.Contains(normalizedKey, "secret")
}

func requiredStringFromMap(payload map[string]any, key string) string {
	return strings.TrimSpace(optionalStringFromMap(payload, key))
}

func optionalStringFromMap(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}

func optionalMapFromMap(payload map[string]any, key string) map[string]any {
	value, _ := payload[key].(map[string]any)
	if value == nil {
		return map[string]any{}
	}
	return value
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}
