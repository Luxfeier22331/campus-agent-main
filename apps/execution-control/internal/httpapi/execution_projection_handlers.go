package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) handleExecutionRunGet(response http.ResponseWriter, request *http.Request, requestID string) {
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
	if strings.TrimSpace(requestID) == "" {
		writeError(response, http.StatusBadRequest, "invalid_request", "request_id is required.", false)
		return
	}
	run, err := s.runProjectionStore.GetRun(request.Context(), strings.TrimSpace(requestID))
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

func (s *Server) handleExecutionRunEvents(response http.ResponseWriter, request *http.Request, requestID string) {
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
	if strings.TrimSpace(requestID) == "" {
		writeError(response, http.StatusBadRequest, "invalid_request", "request_id is required.", false)
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
		strings.TrimSpace(requestID),
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
	requestID string,
	afterSequence int64,
	waitBudget time.Duration,
) ([]execution.DurableRunEvent, error) {
	events, err := s.runProjectionStore.ListRunEventsAfter(ctx, requestID, afterSequence)
	if err != nil || len(events) > 0 || waitBudget <= 0 {
		return events, err
	}
	waitCtx, cancel := context.WithTimeout(ctx, waitBudget)
	defer cancel()
	events, err = s.runProjectionStore.WaitForRunEventsAfter(waitCtx, requestID, afterSequence)
	if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
		return []execution.DurableRunEvent{}, nil
	}
	return events, err
}

func (s *Server) handleExecutionRunSteps(response http.ResponseWriter, request *http.Request, requestID string) {
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
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		writeError(response, http.StatusBadRequest, "invalid_request", "request_id is required.", false)
		return
	}
	run, err := s.runProjectionStore.GetRun(request.Context(), requestID)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "execution_request_not_found", "Execution request not found.", false)
			return
		}
		writeError(response, http.StatusInternalServerError, "execution_run_query_failed", err.Error(), true)
		return
	}
	steps, err := s.runProjectionStore.ListRunSteps(request.Context(), requestID)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "execution_request_not_found", "Execution request not found.", false)
			return
		}
		writeError(response, http.StatusInternalServerError, "execution_run_steps_query_failed", err.Error(), true)
		return
	}
	attempts, err := s.runProjectionStore.ListStepAttempts(request.Context(), requestID)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "execution_step_attempts_query_failed", err.Error(), true)
		return
	}
	results, err := s.runProjectionStore.ListStepResults(request.Context(), requestID)
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

func durableRunResponse(run execution.DurableRun) map[string]any {
	return map[string]any{
		"conversation_id":      run.ConversationID,
		"request_id":           run.RequestID,
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
		"final_response_ref":   run.FinalResponseRef,
	}
}

func durableRunEventResponse(event execution.DurableRunEvent) map[string]any {
	return map[string]any{
		"event_id":               event.EventID,
		"request_id":             event.RequestID,
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
		"request_id":             step.RequestID,
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
		"sanitized_payload":      execution.CloneAnyMap(step.SanitizedPayload),
	}
}

func stepAttemptProjectionResponse(attempt execution.StepAttemptProjection) map[string]any {
	return map[string]any{
		"attempt_id":              attempt.AttemptID,
		"step_id":                 attempt.StepID,
		"request_id":              attempt.RequestID,
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
		"sanitized_payload":       execution.CloneAnyMap(attempt.SanitizedPayload),
	}
}

func stepResultProjectionResponse(result execution.StepResultProjection) map[string]any {
	return map[string]any{
		"result_id":              result.ResultID,
		"step_id":                result.StepID,
		"request_id":             result.RequestID,
		"attempt_id":             result.AttemptID,
		"status":                 result.Status,
		"result_kind":            result.ResultKind,
		"projection_ref":         result.ProjectionRef,
		"created_at":             formatOptionalTime(result.CreatedAt),
		"payload_schema_version": result.PayloadSchemaVersion,
		"sanitized_payload":      execution.CloneAnyMap(result.SanitizedPayload),
	}
}

func buildAgentRuntimeEvalProjection(
	run execution.DurableRun,
	steps []execution.RunStepProjection,
	attempts []execution.StepAttemptProjection,
	results []execution.StepResultProjection,
) map[string]any {
	results, _ = successfulPrimaryAgentActivityProjections(steps, results, attempts)
	rag := projectedRAGForEval(results)
	return map[string]any{
		"schema_version":        "agent_runtime_eval_projection.v5",
		"request_id":            run.RequestID,
		"answer":                rag["answer"],
		"retrieved_context_ids": rag["retrieved_context_ids"],
		"retrieved_contexts":    rag["retrieved_contexts"],
		"cited_context_ids":     rag["cited_context_ids"],
		"cited_contexts":        rag["cited_contexts"],
		"tool_trajectory":       buildToolTrajectoryProjection(run, projectedEvalToolCalls(results)),
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
		activityAttempt, ok := execution.PositiveIntValue(result.SanitizedPayload["activity_attempt"])
		if !ok || result.AttemptID != temporalStepAttemptID(result.RequestID, result.StepID, activityAttempt) {
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
			result.AttemptID == temporalStepAttemptID(result.RequestID, result.StepID, successfulAttempt) {
			filteredResults = append(filteredResults, result)
		}
	}
	filteredAttempts := make([]execution.StepAttemptProjection, 0, len(attempts))
	for _, attempt := range attempts {
		if !primaryAgentActivityStep(attempt.StepID) ||
			(!aggregateMismatch && successfulAttempt == 0 ||
				successfulAttempt > 0 && execution.ProjectionActivityAttempt(attempt) == successfulAttempt) {
			filteredAttempts = append(filteredAttempts, attempt)
		}
	}
	return filteredResults, filteredAttempts
}

func temporalStepAttemptID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":attempt-" + strconv.Itoa(attempt)
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
			aggregateAttempt, _ = execution.PositiveIntValue(step.SanitizedPayload["activity_attempt"])
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

func buildToolTrajectoryProjection(
	run execution.DurableRun,
	toolCalls []map[string]any,
) map[string]any {
	decisionKind := "direct_answer"
	if run.FailCloseReason != "" || run.TerminalReason == execution.DurableTerminalReasonToolClosed ||
		run.TerminalReason == execution.DurableTerminalReasonRuntimeInvariant {
		decisionKind = "fail_closed"
	} else if len(toolCalls) > 0 {
		decisionKind = "tool_assisted"
	}
	return map[string]any{
		"schema_version": "tool_trajectory.v4",
		"decision_kind":  decisionKind,
		"tool_calls":     toolCalls,
	}
}

func projectedEvalToolCalls(results []execution.StepResultProjection) []map[string]any {
	calls := []map[string]any{}
	for _, result := range results {
		if !strings.HasPrefix(result.StepID, "sdk_tool.execute.") {
			continue
		}
		payload := execution.CloneAnyMap(result.SanitizedPayload)
		toolName := execution.FirstNonEmptyText(payload["tool_name"], toolNameFromSDKStepID(result.StepID))
		if toolName == "" {
			continue
		}
		call := map[string]any{"tool_name": toolName}
		if evalSafeArgs, ok := payload["eval_safe_args"].(map[string]any); ok && len(evalSafeArgs) > 0 {
			call["eval_safe_args"] = execution.CloneAnyMap(evalSafeArgs)
		}
		calls = append(calls, call)
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

func requiredStringFromMap(payload map[string]any, key string) string {
	return strings.TrimSpace(optionalStringFromMap(payload, key))
}

func optionalStringFromMap(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}
