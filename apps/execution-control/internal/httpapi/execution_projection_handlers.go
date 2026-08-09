package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) handleExecutionRunGet(response http.ResponseWriter, request *http.Request, runID string) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.runProjectionStore == nil {
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
		writeError(response, http.StatusBadRequest, "invalid_request", "run_id is required.", false)
		return
	}
	run, err := s.runProjectionStore.GetRun(request.Context(), strings.TrimSpace(runID))
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "durable_run_not_found", "Durable run not found.", false)
			return
		}
		writeError(response, http.StatusInternalServerError, "durable_run_query_failed", err.Error(), true)
		return
	}
	writeJSON(response, http.StatusOK, durableRunResponse(run))
}

func (s *Server) handleExecutionRunEvents(response http.ResponseWriter, request *http.Request, runID string) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.runProjectionStore == nil {
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
		writeError(response, http.StatusBadRequest, "invalid_request", "run_id is required.", false)
		return
	}
	afterSequence, err := readAfterSequenceQuery(request)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	waitBudget, err := readRunEventsWaitBudget(request)
	if err != nil {
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
			writeError(response, http.StatusNotFound, "durable_run_not_found", "Durable run not found.", false)
			return
		}
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
	nextSequence := afterSequence
	for _, event := range events {
		body = append(body, durableRunEventResponse(event))
		if event.Sequence > nextSequence {
			nextSequence = event.Sequence
		}
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"events":        body,
		"next_sequence": nextSequence,
	})
}

func (s *Server) listRunEventsAfterWithOptionalWait(
	ctx context.Context,
	runID string,
	afterSequence int64,
	waitBudget time.Duration,
) ([]execution.DurableRunEvent, error) {
	events, err := s.runProjectionStore.ListRunEventsAfter(ctx, runID, afterSequence)
	if err != nil || len(events) > 0 || waitBudget <= 0 {
		return events, err
	}
	waitCtx, cancel := context.WithTimeout(ctx, waitBudget)
	defer cancel()
	events, err = s.runProjectionStore.WaitForRunEventsAfter(waitCtx, runID, afterSequence)
	if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
		return []execution.DurableRunEvent{}, nil
	}
	return events, err
}

func (s *Server) handleExecutionRunSteps(response http.ResponseWriter, request *http.Request, runID string) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.runProjectionStore == nil {
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
		writeError(response, http.StatusBadRequest, "invalid_request", "run_id is required.", false)
		return
	}
	run, err := s.runProjectionStore.GetRun(request.Context(), runID)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "execution_run_not_found", "Execution run not found.", false)
			return
		}
		writeError(response, http.StatusInternalServerError, "execution_run_query_failed", err.Error(), true)
		return
	}
	steps, err := s.runProjectionStore.ListRunSteps(request.Context(), runID)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "execution_run_not_found", "Execution run not found.", false)
			return
		}
		writeError(response, http.StatusInternalServerError, "execution_run_steps_query_failed", err.Error(), true)
		return
	}
	attempts, err := s.runProjectionStore.ListStepAttempts(request.Context(), runID)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "execution_step_attempts_query_failed", err.Error(), true)
		return
	}
	results, err := s.runProjectionStore.ListStepResults(request.Context(), runID)
	if err != nil {
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
) (execution.DurableRun, bool, error) {
	wire, err := contracts.DecodeExecutionRunCreateRequestWireJSON(body)
	if err != nil {
		return execution.DurableRun{}, false, fmt.Errorf("invalid execution run create request: %w", err)
	}
	taskQueue = strings.TrimSpace(taskQueue)
	if taskQueue == "" {
		return execution.DurableRun{}, false, errors.New("execution task queue is not configured")
	}
	return execution.DurableRun{
		RunID:           wire.RunID,
		ConversationID:  wire.ConversationID,
		TurnID:          wire.TurnID,
		RequestID:       wire.RequestID,
		TraceID:         wire.TraceID,
		OwnerUserID:     wire.OwnerUserID,
		Surface:         wire.Surface,
		Status:          execution.DurableRunStatusCreated,
		TaskQueue:       taskQueue,
		CreatedAt:       now,
		UpdatedAt:       now,
		RuntimeVersions: wire.RuntimeVersions,
		Metadata: map[string]any{
			"execution_contract_version": wire.Metadata.ExecutionContractVersion,
			"execution_input_ref":        wire.Metadata.ExecutionInputRef,
			"execution_input_sha256":     wire.Metadata.ExecutionInputSHA256,
		},
	}, wire.PersonalMemoryRecallAllowed, nil
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
	results, attempts = successfulPrimaryAgentActivityProjections(steps, results, attempts)
	toolCalls := projectedPublicToolCalls(results, attempts)
	return map[string]any{
		"schema_version": "agent_runtime_eval_projection.v3",
		"run": map[string]any{
			"run_id":            run.RunID,
			"request_id":        run.RequestID,
			"trace_id":          run.TraceID,
			"status":            string(run.Status),
			"terminal_reason":   string(run.TerminalReason),
			"fail_close_reason": run.FailCloseReason,
		},
		"trajectory": map[string]any{
			"tool_calls":             toolCalls,
			"direct_answer":          projectedBoolFromResults(results, "direct_answer"),
			"requires_clarification": projectedBoolFromResults(results, "requires_clarification"),
		},
		"tool_trajectory": buildToolTrajectoryProjection(run, steps, results, toolCalls),
		"planning":        projectedPlanningForEval(results),
		"rag":             projectedRAGForEval(results),
		"memory":          projectedMemoryForEval(results),
	}
}

func successfulPrimaryAgentActivityProjections(
	steps []execution.RunStepProjection,
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
	aggregateMismatch := successfulAttempt > 0 && !primaryAgentAggregateMatchesAttempt(steps, successfulAttempt)
	if aggregateMismatch {
		successfulAttempt = 0
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
			(!aggregateMismatch && successfulAttempt == 0 ||
				successfulAttempt > 0 && projectionActivityAttempt(attempt) == successfulAttempt) {
			filteredAttempts = append(filteredAttempts, attempt)
		}
	}
	return filteredResults, filteredAttempts
}

func primaryAgentAggregateMatchesAttempt(
	steps []execution.RunStepProjection,
	activityAttempt int,
) bool {
	for _, step := range steps {
		if step.StepID != "agent.primary" {
			continue
		}
		if step.Status != "completed" {
			return false
		}
		aggregateAttempt := step.ActivityAttempt
		if aggregateAttempt <= 0 {
			aggregateAttempt, _ = positiveIntValue(step.SanitizedPayload["activity_attempt"])
		}
		if aggregateAttempt <= 0 {
			return true
		}
		return aggregateAttempt == activityAttempt
	}
	return true
}

func primaryAgentActivityStep(stepID string) bool {
	return stepID == "agent.primary" || strings.HasPrefix(stepID, "sdk_tool.execute.")
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
	results []execution.StepResultProjection,
	toolCalls []map[string]any,
) map[string]any {
	decisionKind := "direct_answer"
	if run.FailCloseReason != "" || run.TerminalReason == execution.DurableTerminalReasonPolicyRejected ||
		run.TerminalReason == execution.DurableTerminalReasonToolClosed ||
		run.TerminalReason == execution.DurableTerminalReasonRuntimeInvariant {
		decisionKind = "fail_closed"
	} else if len(toolCalls) > 0 {
		decisionKind = "tool_assisted"
	}
	projection := map[string]any{
		"schema_version":  "tool_trajectory.v3",
		"request_id":      run.RequestID,
		"run_id":          run.RunID,
		"trace_id":        run.TraceID,
		"conversation_id": run.ConversationID,
		"surface":         run.Surface,
		"environment":     firstNonEmptyText(run.Metadata["environment"], run.RuntimeVersions["environment"]),
		"release":         firstNonEmptyText(run.Metadata["release"], run.RuntimeVersions["release"]),
		"available_tools": projectedAvailableTools(steps, results),
		"decision_kind":   decisionKind,
		"tool_calls":      toolCalls,
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
		if !strings.HasPrefix(result.StepID, "sdk_tool.execute.") {
			continue
		}
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		toolName := firstNonEmptyText(payload["tool_name"], toolNameFromSDKStepID(result.StepID))
		if toolName == "" {
			continue
		}
		call := map[string]any{
			"tool_name":    toolName,
			"tool_call_id": firstNonEmptyText(result.ProjectionRef, result.ResultID),
			"status":       result.Status,
			"result_kind":  result.ResultKind,
		}
		if argumentsHash := firstNonEmptyText(payload["arguments_json_sha256"]); argumentsHash != "" {
			call["arguments_hash"] = argumentsHash
		}
		if reason := firstNonEmptyText(payload["fail_close_reason"]); reason != "" {
			call["fail_close_reason"] = reason
		}
		if toolAttempt, ok := resultAttemptByProjectionRef[result.ProjectionRef]; ok && toolAttempt.DurationMS > 0 {
			call["duration_ms"] = toolAttempt.DurationMS
		} else if attempt, ok := attemptByID[result.AttemptID]; ok && attempt.DurationMS > 0 {
			call["duration_ms"] = attempt.DurationMS
		}
		calls = append(calls, sanitizeProjectionPayload(call))
	}
	return calls
}

func toolNameFromSDKStepID(stepID string) string {
	parts := strings.Split(strings.TrimSpace(stepID), ".")
	if len(parts) < 4 || parts[0] != "sdk_tool" || parts[1] != "execute" {
		return ""
	}
	return strings.TrimSpace(parts[2])
}

func appendPublicProjectionTool(values *[]string, tool string) {
	appendUniqueProjectionString(values, strings.TrimSpace(tool))
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
	return normalizedKey == "memory_text" ||
		strings.Contains(normalizedKey, "raw_prompt") ||
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
