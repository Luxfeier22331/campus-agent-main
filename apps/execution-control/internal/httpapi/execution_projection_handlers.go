package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

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
		"agent_runtime_eval_projection": buildAgentRuntimeEvalProjection(run, steps, results),
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

func durableRunFromCreateBody(body json.RawMessage, now time.Time) (execution.DurableRun, error) {
	payload, err := decodeJSONObject(body)
	if err != nil {
		return execution.DurableRun{}, err
	}
	metadata, ok := payload["metadata"].(map[string]any)
	if !ok {
		return execution.DurableRun{}, errors.New("metadata is required")
	}
	run := execution.DurableRun{
		RunID:               requiredStringFromMap(payload, "run_id"),
		ConversationID:      requiredStringFromMap(payload, "conversation_id"),
		TurnID:              requiredStringFromMap(payload, "turn_id"),
		RequestID:           requiredStringFromMap(payload, "request_id"),
		TraceID:             optionalStringFromMap(payload, "trace_id"),
		OwnerUserID:         requiredStringFromMap(payload, "owner_user_id"),
		Surface:             requiredStringFromMap(payload, "surface"),
		RequestedCapability: optionalStringFromMap(payload, "requested_capability"),
		SelectedCapability:  optionalStringFromMap(payload, "selected_capability"),
		Lane:                execution.DurableLane(requiredStringFromMap(payload, "lane")),
		Status:              execution.DurableRunStatusCreated,
		CreatedAt:           now,
		UpdatedAt:           now,
		RuntimeVersions:     optionalMapFromMap(payload, "runtime_versions"),
		Metadata:            metadata,
	}
	if run.RunID == "" {
		return execution.DurableRun{}, errors.New("run_id is required")
	}
	if run.ConversationID == "" {
		return execution.DurableRun{}, errors.New("conversation_id is required")
	}
	if run.TurnID == "" {
		return execution.DurableRun{}, errors.New("turn_id is required")
	}
	if run.RequestID == "" {
		return execution.DurableRun{}, errors.New("request_id is required")
	}
	if run.OwnerUserID == "" {
		return execution.DurableRun{}, errors.New("owner_user_id is required")
	}
	if run.Surface == "" {
		return execution.DurableRun{}, errors.New("surface is required")
	}
	if run.Lane == "" {
		return execution.DurableRun{}, errors.New("lane is required")
	}
	if err := validateDurableRunExecutionPayload(run); err != nil {
		return execution.DurableRun{}, err
	}
	return run, nil
}

func validateDurableRunExecutionPayload(run execution.DurableRun) error {
	rawExecutionPayload, ok := run.Metadata["execution_payload"]
	if !ok {
		return errors.New("metadata.execution_payload is required")
	}
	executionPayload, ok := rawExecutionPayload.(map[string]any)
	if !ok {
		return errors.New("metadata.execution_payload must be an object")
	}
	if requiredStringFromMap(executionPayload, "request_id") != run.RequestID {
		return errors.New("metadata.execution_payload.request_id must match request_id")
	}
	if requiredStringFromMap(executionPayload, "conversation_id") != run.ConversationID {
		return errors.New("metadata.execution_payload.conversation_id must match conversation_id")
	}
	if run.TraceID != "" && executionPayloadTraceID(executionPayload) != run.TraceID {
		return errors.New("metadata.execution_payload.trace.trace_id must match trace_id")
	}
	if requiredStringFromMap(executionPayload, "user_goal") == "" {
		return errors.New("metadata.execution_payload.user_goal is required")
	}
	return nil
}

func executionPayloadTraceID(executionPayload map[string]any) string {
	rawTrace, ok := executionPayload["trace"].(map[string]any)
	if !ok {
		return ""
	}
	return requiredStringFromMap(rawTrace, "trace_id")
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
		"requested_capability": run.RequestedCapability,
		"selected_capability":  run.SelectedCapability,
		"lane":                 string(run.Lane),
		"status":               string(run.Status),
		"terminal_reason":      string(run.TerminalReason),
		"fail_close_reason":    run.FailCloseReason,
		"created_at":           formatOptionalTime(run.CreatedAt),
		"queued_at":            formatOptionalTime(run.QueuedAt),
		"admitted_at":          formatOptionalTime(run.AdmittedAt),
		"started_at":           formatOptionalTime(run.StartedAt),
		"streaming_started_at": formatOptionalTime(run.StreamingStartedAt),
		"completed_at":         formatOptionalTime(run.CompletedAt),
		"updated_at":           formatOptionalTime(run.UpdatedAt),
		"workflow_plan_ref":    run.WorkflowPlanRef,
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
		"capability":             step.Capability,
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
		"input_tokens":            attempt.InputTokens,
		"output_tokens":           attempt.OutputTokens,
		"cached_input_tokens":     attempt.CachedInputTokens,
		"estimated_cost_microusd": attempt.EstimatedCostMicroUSD,
		"pricing_version":         attempt.PricingVersion,
		"cancel_outcome":          string(attempt.CancelOutcome),
		"timeout_outcome":         string(attempt.TimeoutOutcome),
		"late_completion_outcome": string(attempt.LateCompletionOutcome),
		"fail_close_reason":       attempt.FailCloseReason,
		"replan_reason":           attempt.ReplanReason,
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
	results []execution.StepResultProjection,
) map[string]any {
	selectedCapability := firstNonEmptyText(
		run.SelectedCapability,
		firstStepCapability(steps),
		firstProjectedStringFromResults(results, "selected_capability"),
	)
	selectedTool := firstProjectedStringFromResults(results, "selected_tool")
	return map[string]any{
		"schema_version": "agent_runtime_eval_projection.v1",
		"run": map[string]any{
			"run_id":            run.RunID,
			"request_id":        run.RequestID,
			"trace_id":          run.TraceID,
			"status":            string(run.Status),
			"terminal_reason":   string(run.TerminalReason),
			"fail_close_reason": run.FailCloseReason,
		},
		"trajectory": map[string]any{
			"selected_capability":    selectedCapability,
			"selected_tool":          selectedTool,
			"tool_calls":             projectedToolCalls(results),
			"direct_answer":          projectedBoolFromResults(results, "direct_answer"),
			"requires_clarification": projectedBoolFromResults(results, "requires_clarification"),
		},
		"planning": projectedRecordFromResults(results, "planning"),
		"rag":      projectedRecordFromResults(results, "rag"),
		"memory":   projectedRecordFromResults(results, "memory"),
	}
}

func firstStepCapability(steps []execution.RunStepProjection) string {
	for _, step := range steps {
		if capability := strings.TrimSpace(step.Capability); capability != "" {
			return capability
		}
	}
	return ""
}

func firstProjectedStringFromResults(results []execution.StepResultProjection, key string) string {
	for _, result := range results {
		value := stringFromProjectionPayload(result.SanitizedPayload, key)
		if value != "" {
			return value
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

func projectedToolCalls(results []execution.StepResultProjection) []map[string]any {
	toolCalls := []map[string]any{}
	for _, result := range results {
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		if record, ok := payload["tool_call"].(map[string]any); ok {
			toolCalls = append(toolCalls, sanitizeProjectionPayload(record))
			continue
		}
		if selectedTool, _ := payload["selected_tool"].(string); strings.TrimSpace(selectedTool) != "" {
			toolCalls = append(toolCalls, map[string]any{
				"selected_tool": strings.TrimSpace(selectedTool),
			})
		}
	}
	return toolCalls
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
