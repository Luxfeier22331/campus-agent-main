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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) handleExecutionRunCreate(response http.ResponseWriter, request *http.Request) {
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
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	run, personalMemoryRecallAllowed, err := durableRunFromCreateBody(
		body,
		time.Now().UTC(),
		defaultString(strings.TrimSpace(s.config.TemporalTaskQueue), temporalruntime.WorkflowTaskQueue),
	)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	workflowInput, err := s.workflowInputForRun(
		request.Context(),
		run,
		personalMemoryRecallAllowed,
	)
	if err != nil {
		writeError(response, http.StatusBadRequest, "execution_workflow_input_invalid", err.Error(), false)
		return
	}
	workflowInputJSON, err := json.Marshal(workflowInput)
	if err != nil {
		writeError(response, http.StatusBadRequest, "execution_workflow_input_invalid", err.Error(), false)
		return
	}
	requestFingerprint, err := durableRunCreateFingerprint(run, personalMemoryRecallAllowed)
	if err != nil {
		writeError(response, http.StatusBadRequest, "execution_workflow_input_invalid", err.Error(), false)
		return
	}
	result, err := s.runProjectionStore.CreateRunWithStartIntent(
		request.Context(),
		execution.DurableRunCreateIntent{
			Run:                      run,
			RequestFingerprintSHA256: requestFingerprint,
			WorkflowID:               workflowInput.WorkflowID,
			PayloadSHA256:            workflowInput.PayloadSHA256,
			TaskQueue:                workflowInput.TaskQueue,
			WorkflowInputJSON:        workflowInputJSON,
			CreatedEvent: execution.DurableRunEvent{
				EventID:              run.RunID + ":run-created",
				RunID:                run.RunID,
				ConversationID:       run.ConversationID,
				EventType:            execution.DurableRunEventTypeRunCreated,
				OccurredAt:           run.CreatedAt,
				Visibility:           execution.DurableRunEventVisibilityInternal,
				PayloadSchemaVersion: "run-event-v1",
				Payload:              map[string]any{"status": string(execution.DurableRunStatusCreated)},
			},
		},
	)
	if err != nil {
		if errors.Is(err, execution.ErrConversationActiveRun) {
			writeError(
				response,
				http.StatusConflict,
				"conversation_active_run",
				"Conversation already has an active primary run.",
				true,
			)
			return
		}
		if errors.Is(err, execution.ErrDurableRunFingerprintConflict) {
			writeError(
				response,
				http.StatusConflict,
				"execution_run_fingerprint_conflict",
				"run_id is already bound to a different request fingerprint.",
				false,
			)
			return
		}
		writeError(response, http.StatusBadRequest, "execution_run_create_failed", err.Error(), false)
		return
	}
	s.wakeTemporalReconciler()
	writeJSON(response, http.StatusAccepted, durableRunResponse(result.Run))
}

func (s *Server) workflowInputForRun(
	ctx context.Context,
	run execution.DurableRun,
	personalMemoryRecallAllowed bool,
) (temporalruntime.ToolExecutionWorkflowInput, error) {
	workflowID := "campus-agent.chat." + strings.TrimSpace(run.RunID)
	inputMetadata, err := executionInputMetadata(run)
	if err != nil {
		return temporalruntime.ToolExecutionWorkflowInput{}, err
	}
	wire, err := s.loadExecutionInput(ctx, run)
	if err != nil {
		return temporalruntime.ToolExecutionWorkflowInput{}, err
	}
	campusDocsQuerySHA256, err := s.campusDocsQuerySHA256ForAdmission(wire)
	if err != nil {
		return temporalruntime.ToolExecutionWorkflowInput{}, err
	}
	admissionSnapshot, err := s.buildAgentAdmissionSnapshot(
		ctx,
		personalMemoryRecallAllowed,
		campusDocsQuerySHA256,
	)
	if err != nil {
		return temporalruntime.ToolExecutionWorkflowInput{}, err
	}
	admissionSHA256 := sha256JSONRef(admissionSnapshot)
	return temporalruntime.ToolExecutionWorkflowInput{
		AdmissionSnapshot:            admissionSnapshot,
		AdmissionSnapshotSHA256:      admissionSHA256,
		ConversationID:               run.ConversationID,
		Namespace:                    s.config.TemporalNamespace,
		PayloadSHA256:                inputMetadata.ExecutionInputSHA256,
		PersonalMemoryTimeoutSeconds: s.config.PersonalMemoryTimeoutSeconds,
		RequestID:                    run.RequestID,
		RunID:                        run.RunID,
		TaskQueue:                    defaultString(strings.TrimSpace(s.config.TemporalTaskQueue), temporalruntime.WorkflowTaskQueue),
		TraceID:                      run.TraceID,
		TraceParent:                  telemetry.InjectExecutionTraceHeaders(ctx, run.RequestID, run.TraceID)["traceparent"],
		TurnID:                       run.TurnID,
		WorkflowID:                   workflowID,
	}, nil
}

func durableRunCreateFingerprint(run execution.DurableRun, personalMemoryRecallAllowed bool) (string, error) {
	canonical := struct {
		ConversationID              string         `json:"conversation_id"`
		Metadata                    map[string]any `json:"metadata"`
		OwnerUserID                 string         `json:"owner_user_id"`
		PersonalMemoryRecallAllowed bool           `json:"personal_memory_recall_allowed"`
		RequestID                   string         `json:"request_id"`
		RunID                       string         `json:"run_id"`
		RuntimeVersions             map[string]any `json:"runtime_versions"`
		Surface                     string         `json:"surface"`
		TraceID                     string         `json:"trace_id"`
		TurnID                      string         `json:"turn_id"`
	}{
		ConversationID:              run.ConversationID,
		Metadata:                    cloneAnyMapFromMetadata(run.Metadata),
		OwnerUserID:                 run.OwnerUserID,
		PersonalMemoryRecallAllowed: personalMemoryRecallAllowed,
		RequestID:                   run.RequestID,
		RunID:                       run.RunID,
		RuntimeVersions:             cloneAnyMapFromMetadata(run.RuntimeVersions),
		Surface:                     run.Surface,
		TraceID:                     run.TraceID,
		TurnID:                      run.TurnID,
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return "", fmt.Errorf("encode execution run fingerprint: %w", err)
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func (s *Server) handleExecutionRunCancel(
	response http.ResponseWriter,
	request *http.Request,
	runID string,
) {
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
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	payload, err := decodeJSONObject(body)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "Cancel request body must be a JSON object.", false)
		return
	}
	reason, err := requiredRunCancelReason(payload)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		writeError(response, http.StatusBadRequest, "invalid_request", "run_id is required.", false)
		return
	}
	// PostgreSQL timestamptz stores microsecond precision. Persist and reuse one
	// canonical timestamp so retries produce the same product fingerprint.
	canceledAt := time.Now().UTC().Truncate(time.Microsecond)
	requested, err := s.runProjectionStore.RequestRunCancellation(
		request.Context(),
		execution.DurableRunCancellationRequest{
			RunID:  runID,
			Reason: reason,
			Now:    canceledAt,
		},
	)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "execution_run_not_found", "Execution run not found.", false)
			return
		}
		if errors.Is(err, execution.ErrDurableRunTerminalConflict) {
			writeError(response, http.StatusConflict, "execution_run_cancel_conflict", err.Error(), false)
			return
		}
		writeError(response, http.StatusInternalServerError, "execution_run_cancel_request_failed", err.Error(), true)
		return
	}
	s.wakeTemporalReconciler()
	writeJSON(response, http.StatusAccepted, durableRunResponse(requested))
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
