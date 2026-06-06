package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) handleExecutionRunCreate(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.durableRuntime == nil {
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
	created, err := s.durableRuntime.CreateRun(request.Context(), run)
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
	queued, err := s.durableRuntime.TransitionRun(
		request.Context(),
		created.RunID,
		execution.DurableRunStatusQueued,
		"",
		queuedAt,
	)
	if err != nil {
		_ = s.durableRuntime.DeleteRun(context.Background(), created.RunID)
		setOutcome(response, "execution_run_queue_failed")
		writeError(response, http.StatusInternalServerError, "execution_run_queue_failed", err.Error(), true)
		return
	}
	if err := s.appendExecutionRunStartEvents(request.Context(), created, queued, queuedAt); err != nil {
		_ = s.durableRuntime.DeleteRun(context.Background(), created.RunID)
		setOutcome(response, "execution_run_event_failed")
		writeError(response, http.StatusInternalServerError, "execution_run_event_failed", err.Error(), true)
		return
	}
	workflowInput, err := s.workflowInputForQueuedRun(body, queued)
	if err != nil {
		_ = s.durableRuntime.DeleteRun(context.Background(), queued.RunID)
		setOutcome(response, "execution_workflow_input_invalid")
		writeError(response, http.StatusBadRequest, "execution_workflow_input_invalid", err.Error(), false)
		return
	}
	if err := s.temporalStarter.StartChatAnswerWorkflow(request.Context(), workflowInput); err != nil {
		_ = s.durableRuntime.DeleteRun(context.Background(), queued.RunID)
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
	if _, err := s.durableRuntime.AppendRunEvent(ctx, execution.DurableRunEvent{
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
	if _, err := s.durableRuntime.AppendRunEvent(ctx, execution.DurableRunEvent{
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
) (temporalruntime.ChatAnswerWorkflowInput, error) {
	payloadHash := sha256.Sum256(rawBody)
	workflowID := "campus-agent.chat." + strings.TrimSpace(run.RunID)
	return temporalruntime.ChatAnswerWorkflowInput{
		ConversationID: run.ConversationID,
		Namespace:      s.config.TemporalNamespace,
		PayloadSHA256:  hex.EncodeToString(payloadHash[:]),
		PolicyVersions: map[string]string{
			"intent_policy": strings.TrimSpace(s.config.IntentPolicyPath),
		},
		RequestID:  run.RequestID,
		RunID:      run.RunID,
		TaskQueue:  defaultString(strings.TrimSpace(s.config.TemporalTaskQueue), temporalruntime.WorkflowTaskQueue),
		TraceID:    run.TraceID,
		TurnID:     run.TurnID,
		WorkflowID: workflowID,
	}, nil
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
	if s.durableRuntime == nil {
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
	reason := optionalStringFromMap(payload, "reason")
	if reason == "" {
		reason = "user_requested"
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "run_id is required.", false)
		return
	}
	run, err := s.durableRuntime.GetRun(request.Context(), runID)
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
	if err := s.temporalStarter.CancelChatAnswerWorkflow(
		request.Context(),
		temporalruntime.ChatAnswerWorkflowCancelInput{
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
	canceledAt := time.Now().UTC()
	coordinator := s.durableLeaseCoordinator
	if coordinator == nil {
		coordinator = execution.NewDurableLeaseCoordinator(s.durableRuntime)
	}
	canceled, err := coordinator.CancelRun(
		request.Context(),
		execution.DurableRunCancelRequest{
			RunID:         run.RunID,
			Reason:        reason,
			Now:           canceledAt,
			ReleaseReason: string(execution.DurableTerminalReasonUserCanceled),
		},
	)
	if err != nil {
		setOutcome(response, "execution_run_cancel_failed")
		writeError(response, http.StatusConflict, "execution_run_cancel_failed", err.Error(), false)
		return
	}
	setOutcome(response, "execution_run_canceled")
	writeJSON(response, http.StatusAccepted, durableRunResponse(canceled.Run))
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
