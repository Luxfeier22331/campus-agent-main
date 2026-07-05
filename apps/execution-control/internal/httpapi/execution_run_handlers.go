package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) handleExecutionRunCreate(response http.ResponseWriter, request *http.Request) {
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
	if s.temporalStarter == nil {
		setOutcome(response, "temporal_runtime_not_configured")
		writeError(
			response,
			http.StatusServiceUnavailable,
			"temporal_runtime_not_configured",
			"Temporal runtime is not configured.",
			true,
		)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	run, err := durableRunFromCreateBody(body, time.Now().UTC())
	if err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	visibleToolNames, err := s.visibleToolNamesForRun(run.RequestedTool)
	if err != nil {
		setOutcome(response, "tool_not_open")
		writeError(response, http.StatusConflict, "tool_not_open", err.Error(), false)
		return
	}
	created, err := s.runProjectionStore.CreateRun(request.Context(), run)
	if err != nil {
		if errors.Is(err, execution.ErrConversationActiveRun) {
			setOutcome(response, "conversation_active_run")
			writeError(
				response,
				http.StatusConflict,
				"conversation_active_run",
				"Conversation already has an active primary run.",
				true,
			)
			return
		}
		setOutcome(response, "execution_run_create_failed")
		writeError(response, http.StatusBadRequest, "execution_run_create_failed", err.Error(), false)
		return
	}
	queuedAt := time.Now().UTC()
	queued, err := s.runProjectionStore.TransitionRun(
		request.Context(),
		created.RunID,
		execution.DurableRunStatusQueued,
		"",
		queuedAt,
	)
	if err != nil {
		_ = s.runProjectionStore.DeleteRun(context.Background(), created.RunID)
		setOutcome(response, "execution_run_queue_failed")
		writeError(response, http.StatusInternalServerError, "execution_run_queue_failed", err.Error(), true)
		return
	}
	if err := s.appendExecutionRunStartEvents(request.Context(), created, queued, queuedAt); err != nil {
		_ = s.runProjectionStore.DeleteRun(context.Background(), created.RunID)
		setOutcome(response, "execution_run_event_failed")
		writeError(response, http.StatusInternalServerError, "execution_run_event_failed", err.Error(), true)
		return
	}
	workflowInput, err := s.workflowInputForQueuedRun(body, queued, visibleToolNames)
	if err != nil {
		_ = s.runProjectionStore.DeleteRun(context.Background(), queued.RunID)
		setOutcome(response, "execution_workflow_input_invalid")
		writeError(response, http.StatusBadRequest, "execution_workflow_input_invalid", err.Error(), false)
		return
	}
	if err := s.temporalStarter.StartToolExecutionWorkflow(request.Context(), workflowInput); err != nil {
		_ = s.runProjectionStore.DeleteRun(context.Background(), queued.RunID)
		setOutcome(response, "temporal_workflow_start_failed")
		writeError(
			response,
			http.StatusBadGateway,
			"temporal_workflow_start_failed",
			"Temporal workflow start failed.",
			true,
		)
		return
	}
	setOutcome(response, "execution_run_started")
	writeJSON(response, http.StatusAccepted, durableRunResponse(queued))
}

func (s *Server) appendExecutionRunStartEvents(
	ctx context.Context,
	created execution.DurableRun,
	queued execution.DurableRun,
	queuedAt time.Time,
) error {
	if _, err := s.runProjectionStore.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              created.RunID + ":workflow-started",
		RunID:                created.RunID,
		ConversationID:       created.ConversationID,
		EventType:            execution.DurableRunEventTypeWorkflowStarted,
		OccurredAt:           created.CreatedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(execution.DurableRunStatusCreated)},
	}); err != nil {
		return err
	}
	if _, err := s.runProjectionStore.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              created.RunID + ":run-queued",
		RunID:                queued.RunID,
		ConversationID:       queued.ConversationID,
		EventType:            execution.DurableRunEventTypeRunQueued,
		OccurredAt:           queuedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(execution.DurableRunStatusQueued)},
	}); err != nil {
		return err
	}
	return nil
}

func (s *Server) workflowInputForQueuedRun(
	rawBody json.RawMessage,
	run execution.DurableRun,
	visibleToolNames []string,
) (temporalruntime.ToolExecutionWorkflowInput, error) {
	payloadHash := sha256.Sum256(rawBody)
	workflowID := "campus-agent.chat." + strings.TrimSpace(run.RunID)
	return temporalruntime.ToolExecutionWorkflowInput{
		ConversationID: run.ConversationID,
		Namespace:      s.config.TemporalNamespace,
		PayloadSHA256:  hex.EncodeToString(payloadHash[:]),
		PolicyVersions: map[string]string{
			"intent_policy": strings.TrimSpace(s.config.IntentPolicyPath),
		},
		PersonalMemoryTimeoutSeconds: s.config.PersonalMemoryTimeoutSeconds,
		RequestID:                    run.RequestID,
		RequestedTool:                strings.TrimSpace(run.RequestedTool),
		RunID:                        run.RunID,
		TaskQueue:                    defaultString(strings.TrimSpace(s.config.TemporalTaskQueue), temporalruntime.WorkflowTaskQueue),
		TraceID:                      run.TraceID,
		TurnID:                       run.TurnID,
		VisibleToolNames:             append([]string{}, visibleToolNames...),
		WorkflowID:                   workflowID,
	}, nil
}

func (s *Server) visibleToolNamesForRun(requestedTool string) ([]string, error) {
	normalized := strings.TrimSpace(requestedTool)
	switch normalized {
	case "":
		tools := []string{"knowledge_query"}
		for _, toolName := range []string{
			"public_web_search",
			"transport_schedule_lookup",
			"campus_notice_discover",
		} {
			if s.config.ToolOpen(toolName) {
				tools = append(tools, toolName)
			}
		}
		return tools, nil
	case "knowledge_query":
		return []string{"knowledge_query"}, nil
	case "public_web_search":
		if !s.config.ToolOpen("public_web_search") {
			return nil, fmt.Errorf("tool public_web_search is not open in runtime profile")
		}
		return []string{"public_web_search"}, nil
	case "transport_schedule_lookup":
		if !s.config.ToolOpen("transport_schedule_lookup") {
			return nil, fmt.Errorf("tool transport_schedule_lookup is not open in runtime profile")
		}
		return []string{"transport_schedule_lookup"}, nil
	case "campus_notice_discover":
		if !s.config.ToolOpen("campus_notice_discover") {
			return nil, fmt.Errorf("tool campus_notice_discover is not open in runtime profile")
		}
		return []string{"campus_notice_discover"}, nil
	case "place_lookup":
		return nil, fmt.Errorf("navigation tools are not admitted by execution-control")
	default:
		return nil, fmt.Errorf("requested tool %s is not admitted by execution-control", normalized)
	}
}

func (s *Server) handleExecutionRunCancel(
	response http.ResponseWriter,
	request *http.Request,
	runID string,
) {
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
	if s.temporalStarter == nil {
		setOutcome(response, "temporal_runtime_not_configured")
		writeError(
			response,
			http.StatusServiceUnavailable,
			"temporal_runtime_not_configured",
			"Temporal runtime is not configured.",
			true,
		)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	payload, err := decodeJSONObject(body)
	if err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Cancel request body must be a JSON object.", false)
		return
	}
	reason, err := requiredRunCancelReason(payload)
	if err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
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
	if err := s.temporalStarter.CancelToolExecutionWorkflow(
		request.Context(),
		temporalruntime.ToolExecutionWorkflowCancelInput{
			Reason:     reason,
			RunID:      run.RunID,
			WorkflowID: "campus-agent.chat." + run.RunID,
		},
	); err != nil {
		setOutcome(response, "temporal_workflow_cancel_failed")
		writeError(
			response,
			http.StatusBadGateway,
			"temporal_workflow_cancel_failed",
			"Temporal workflow cancel failed.",
			true,
		)
		return
	}
	s.emitExecutionRunAuditEvent(run, executionaudit.Event{
		Decision:   reason,
		EventType:  "execution.cancel_requested",
		OccurredAt: time.Now().UTC(),
		Retryable:  false,
	})
	canceledAt := time.Now().UTC()
	canceled, err := s.runProjectionStore.CancelRunProjection(
		request.Context(),
		execution.DurableRunCancelRequest{
			RunID:  run.RunID,
			Reason: reason,
			Now:    canceledAt,
		},
	)
	if err != nil {
		setOutcome(response, "execution_run_cancel_failed")
		writeError(response, http.StatusConflict, "execution_run_cancel_failed", err.Error(), false)
		return
	}
	if err := s.projectCanceledRunSteps(request.Context(), canceled, reason, canceledAt); err != nil {
		setOutcome(response, "execution_run_cancel_step_projection_failed")
		writeError(
			response,
			http.StatusInternalServerError,
			"execution_run_cancel_step_projection_failed",
			err.Error(),
			true,
		)
		return
	}
	setOutcome(response, "execution_run_canceled")
	s.emitExecutionRunAuditEvent(canceled, executionaudit.Event{
		Decision:   reason,
		EventType:  "execution.cancelled",
		OccurredAt: canceledAt,
		Retryable:  false,
	})
	writeJSON(response, http.StatusAccepted, durableRunResponse(canceled))
}

func (s *Server) projectCanceledRunSteps(
	ctx context.Context,
	run execution.DurableRun,
	reason string,
	canceledAt time.Time,
) error {
	steps, err := s.runProjectionStore.ListRunSteps(ctx, run.RunID)
	if err != nil {
		return err
	}
	for _, step := range steps {
		if temporalStepTerminal(step.Status) {
			continue
		}
		step.Status = "canceled"
		step.CompletedAt = canceledAt
		step.UpdatedAt = canceledAt
		if step.SanitizedPayload == nil {
			step.SanitizedPayload = map[string]any{}
		}
		step.SanitizedPayload["cancel_outcome"] = string(execution.CancelOutcomeActivityContextCanceled)
		if step.StartedAt.IsZero() {
			step.SanitizedPayload["cancel_outcome"] = string(execution.CancelOutcomeRequestedBeforeStart)
		}
		step.SanitizedPayload["terminal_reason"] = string(execution.DurableTerminalReasonUserCanceled)
		step.SanitizedPayload["cancel_reason"] = reason
		if _, err := s.runProjectionStore.UpsertRunStep(ctx, step); err != nil {
			return err
		}
	}
	attempts, err := s.runProjectionStore.ListStepAttempts(ctx, run.RunID)
	if err != nil {
		return err
	}
	for _, attempt := range attempts {
		if temporalStepTerminal(attempt.Status) {
			continue
		}
		attempt.Status = "canceled"
		attempt.CompletedAt = canceledAt
		attempt.UpdatedAt = canceledAt
		attempt.TerminalReason = string(execution.DurableTerminalReasonUserCanceled)
		if attempt.StartedAt.IsZero() {
			attempt.CancelOutcome = execution.CancelOutcomeRequestedBeforeStart
		} else {
			attempt.CancelOutcome = execution.CancelOutcomeActivityContextCanceled
		}
		if attempt.TimeoutOutcome == "" {
			attempt.TimeoutOutcome = execution.TimeoutOutcomeNotTimedOut
		}
		if attempt.LateCompletionOutcome == "" {
			attempt.LateCompletionOutcome = execution.LateCompletionOutcomeNotLate
		}
		if attempt.SanitizedPayload == nil {
			attempt.SanitizedPayload = map[string]any{}
		}
		attempt.SanitizedPayload["cancel_outcome"] = string(attempt.CancelOutcome)
		attempt.SanitizedPayload["terminal_reason"] = attempt.TerminalReason
		attempt.SanitizedPayload["cancel_reason"] = reason
		if _, err := s.runProjectionStore.UpsertStepAttempt(ctx, attempt); err != nil {
			return err
		}
	}
	return nil
}

func requiredRunCancelReason(payload map[string]any) (string, error) {
	reason := optionalStringFromMap(payload, "reason")
	if reason != "user_requested" {
		return "", errors.New("cancel reason must be user_requested")
	}
	return reason, nil
}

func executionRunIDFromPath(path string, suffix string) (string, bool) {
	const prefix = "/internal/execution/runs/"
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
