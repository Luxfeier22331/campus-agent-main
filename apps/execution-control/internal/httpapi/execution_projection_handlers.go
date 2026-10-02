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
	if s.runReader == nil {
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
	run, err := s.runReader.GetRun(request.Context(), strings.TrimSpace(requestID))
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
	if s.runReader == nil {
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
	events, err := s.runReader.ListRunEventsAfter(ctx, requestID, afterSequence)
	if err != nil || len(events) > 0 || waitBudget <= 0 {
		return events, err
	}
	waitCtx, cancel := context.WithTimeout(ctx, waitBudget)
	defer cancel()
	events, err = s.runReader.WaitForRunEventsAfter(waitCtx, requestID, afterSequence)
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
	if s.runReader == nil {
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
	run, err := s.runReader.GetRun(request.Context(), requestID)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "execution_request_not_found", "Execution request not found.", false)
			return
		}
		writeError(response, http.StatusInternalServerError, "execution_run_query_failed", err.Error(), true)
		return
	}
	steps, err := s.runReader.ListRunSteps(request.Context(), requestID)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "execution_request_not_found", "Execution request not found.", false)
			return
		}
		writeError(response, http.StatusInternalServerError, "execution_run_steps_query_failed", err.Error(), true)
		return
	}
	attempts, err := s.runReader.ListStepAttempts(request.Context(), requestID)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "execution_step_attempts_query_failed", err.Error(), true)
		return
	}
	results, err := s.runReader.ListStepResults(request.Context(), requestID)
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
	results = currentWorkflowResultProjections(steps, attempts, results)
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

func currentWorkflowResultProjections(
	steps []execution.RunStepProjection,
	attempts []execution.StepAttemptProjection,
	results []execution.StepResultProjection,
) []execution.StepResultProjection {
	selectedAttempts := map[string]int{}
	for _, step := range steps {
		if !isWorkflowOperationStep(step.StepID) || step.Status != "completed" {
			continue
		}
		attempt := step.ActivityAttempt
		if attempt <= 0 {
			attempt, _ = execution.PositiveIntValue(step.SanitizedPayload["activity_attempt"])
		}
		if attempt > selectedAttempts[step.StepID] {
			selectedAttempts[step.StepID] = attempt
		}
	}
	for _, result := range results {
		if !isWorkflowOperationStep(result.StepID) || result.Status != "completed" {
			continue
		}
		activityAttempt := workflowResultActivityAttempt(result)
		if activityAttempt <= 0 {
			continue
		}
		if activityAttempt > selectedAttempts[result.StepID] {
			selectedAttempts[result.StepID] = activityAttempt
		}
	}
	for _, attempt := range attempts {
		if !isWorkflowOperationStep(attempt.StepID) || attempt.Status != "completed" {
			continue
		}
		if activityAttempt := execution.ProjectionActivityAttempt(attempt); activityAttempt > selectedAttempts[attempt.StepID] {
			selectedAttempts[attempt.StepID] = activityAttempt
		}
	}
	selectedFinalizationAttempt := 0
	for _, result := range results {
		if result.StepID != "finalization.write" || result.Status != "completed" {
			continue
		}
		if attempt := workflowResultActivityAttempt(result); attempt > selectedFinalizationAttempt {
			selectedFinalizationAttempt = attempt
		}
	}
	projected := make([]execution.StepResultProjection, 0, len(results))
	for _, result := range results {
		if isWorkflowOperationStep(result.StepID) {
			if result.Status == "completed" && workflowResultActivityAttempt(result) == selectedAttempts[result.StepID] {
				projected = append(projected, result)
			}
			continue
		}
		if result.StepID == "finalization.write" {
			if result.Status == "completed" && workflowResultActivityAttempt(result) == selectedFinalizationAttempt {
				projected = append(projected, result)
			}
			continue
		}
		if !strings.HasPrefix(result.StepID, "sdk_tool.execute.") {
			continue
		}
		parentStepID := execution.FirstNonEmptyText(
			result.SanitizedPayload["parent_step_id"],
			result.SanitizedPayload["workflow_step_id"],
		)
		if parentStepID == "" || selectedAttempts[parentStepID] <= 0 ||
			workflowResultActivityAttempt(result) != selectedAttempts[parentStepID] {
			continue
		}
		projected = append(projected, result)
	}
	return projected
}

func temporalStepAttemptID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":attempt-" + strconv.Itoa(attempt)
}

func isWorkflowOperationStep(stepID string) bool {
	stepID = strings.TrimSpace(stepID)
	return stepID == "solve.initial" || stepID == "answer.synthesize" ||
		strings.HasPrefix(stepID, "solve.replan.") || strings.HasPrefix(stepID, "task.step.")
}

func workflowResultActivityAttempt(result execution.StepResultProjection) int {
	if attempt, ok := execution.PositiveIntValue(result.SanitizedPayload["activity_attempt"]); ok {
		return attempt
	}
	parts := strings.Split(strings.TrimSpace(result.AttemptID), ":attempt-")
	if len(parts) != 2 {
		return 0
	}
	attempt, err := strconv.Atoi(parts[1])
	if err != nil || attempt <= 0 {
		return 0
	}
	return attempt
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
		if toolName == campusSearchToolName {
			if searchQuery := strings.TrimSpace(execution.StringValue(payload["search_query"])); searchQuery != "" {
				call["search_query"] = searchQuery
			}
			if searchGoal := strings.TrimSpace(execution.StringValue(payload["search_goal"])); searchGoal != "" {
				call["search_goal"] = searchGoal
			}
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
