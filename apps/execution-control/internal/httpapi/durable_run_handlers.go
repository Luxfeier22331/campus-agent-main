package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) handleDurableRunCreate(response http.ResponseWriter, request *http.Request) {
	writeRetiredDurableRoute(response)
}

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

func (s *Server) handleDurableRunEvents(response http.ResponseWriter, request *http.Request, runID string) {
	s.handleExecutionRunEvents(response, request, runID)
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
	events, err := s.runProjectionStore.ListRunEventsAfter(
		request.Context(),
		strings.TrimSpace(runID),
		afterSequence,
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
		"steps":    bodySteps,
		"attempts": bodyAttempts,
		"results":  bodyResults,
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

func (s *Server) handleDurableRunCancel(response http.ResponseWriter, request *http.Request, runID string) {
	writeRetiredDurableRoute(response)
}

func writeRetiredDurableRoute(response http.ResponseWriter) {
	setOutcome(response, "not_found")
	writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
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

func durableRunIDFromPath(path string, suffix string) (string, bool) {
	const prefix = "/internal/durable/runs/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	if suffix != "" {
		if !strings.HasSuffix(rest, suffix) {
			return "", false
		}
		rest = strings.TrimSuffix(rest, suffix)
	}
	if strings.Contains(rest, "/") || strings.TrimSpace(rest) == "" {
		return "", false
	}
	return rest, true
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
		"attempt_id":             attempt.AttemptID,
		"step_id":                attempt.StepID,
		"run_id":                 attempt.RunID,
		"attempt":                attempt.Attempt,
		"status":                 attempt.Status,
		"task_queue":             attempt.TaskQueue,
		"worker_id":              attempt.WorkerID,
		"started_at":             formatOptionalTime(attempt.StartedAt),
		"completed_at":           formatOptionalTime(attempt.CompletedAt),
		"updated_at":             formatOptionalTime(attempt.UpdatedAt),
		"payload_schema_version": attempt.PayloadSchemaVersion,
		"sanitized_payload":      sanitizeProjectionPayload(attempt.SanitizedPayload),
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

func sanitizeProjectionPayload(payload map[string]any) map[string]any {
	if payload == nil {
		return map[string]any{}
	}
	sanitized := map[string]any{}
	for key, value := range payload {
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		if strings.Contains(normalizedKey, "raw_prompt") ||
			strings.Contains(normalizedKey, "raw_answer") ||
			strings.Contains(normalizedKey, "raw_provider") ||
			strings.Contains(normalizedKey, "raw_source") ||
			strings.Contains(normalizedKey, "cookie") ||
			strings.Contains(normalizedKey, "authorization") {
			continue
		}
		sanitized[key] = value
	}
	return sanitized
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
