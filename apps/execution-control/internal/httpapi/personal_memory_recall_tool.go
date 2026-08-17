package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

const personalMemoryRecallToolName = "personal_memory_recall"

type personalMemoryRecallToolEnvelope struct {
	AccessContext agentToolAccessContext          `json:"access_context"`
	Payload       personalMemoryRecallToolPayload `json:"payload"`
}

type agentToolAccessContext struct {
	ActivityAttempt int    `json:"activity_attempt"`
	RunID           string `json:"run_id"`
	TraceID         string `json:"trace_id"`
	InvocationID    string `json:"invocation_id"`
}

type agentToolConflictError struct{ message string }

func (agentToolConflictError) Error() string { return "agent tool request conflicts with run state" }

type personalMemoryRecallToolPayload struct {
	Query string `json:"query"`
}

func (s *Server) handlePersonalMemoryRecallTool(response http.ResponseWriter, request *http.Request) {
	if !s.executionQueryAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid internal query auth.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	envelope, err := decodePersonalMemoryRecallToolEnvelope(body)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	result, err := s.executePersonalMemoryRecallTool(request.Context(), envelope)
	if err != nil {
		var conflict agentToolConflictError
		if errors.As(err, &conflict) {
			writeError(response, http.StatusConflict, "run_context_conflict", err.Error(), false)
			return
		}
		writeError(
			response,
			http.StatusServiceUnavailable,
			"personal_memory_recall_failed",
			"Personal memory recall failed.",
			true,
		)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func decodePersonalMemoryRecallToolEnvelope(body json.RawMessage) (personalMemoryRecallToolEnvelope, error) {
	var envelope personalMemoryRecallToolEnvelope
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return envelope, fmt.Errorf("personal_memory_recall request is invalid: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return envelope, errors.New("personal_memory_recall request has trailing JSON content")
	}
	envelope.Payload.Query = strings.TrimSpace(envelope.Payload.Query)
	envelope.AccessContext.RunID = strings.TrimSpace(envelope.AccessContext.RunID)
	envelope.AccessContext.TraceID = strings.TrimSpace(envelope.AccessContext.TraceID)
	envelope.AccessContext.InvocationID = strings.TrimSpace(envelope.AccessContext.InvocationID)
	if envelope.Payload.Query == "" || len([]rune(envelope.Payload.Query)) > 400 {
		return envelope, errors.New("payload.query must contain between 1 and 400 characters")
	}
	if envelope.AccessContext.RunID == "" || envelope.AccessContext.TraceID == "" ||
		envelope.AccessContext.InvocationID == "" || envelope.AccessContext.ActivityAttempt <= 0 {
		return envelope, errors.New("access_context.run_id, trace_id, invocation_id, and activity_attempt are required")
	}
	return envelope, nil
}

func (s *Server) executePersonalMemoryRecallTool(
	ctx context.Context,
	envelope personalMemoryRecallToolEnvelope,
) (map[string]any, error) {
	run, err := s.validateAgentToolRun(ctx, envelope.AccessContext, personalMemoryRecallToolName)
	if err != nil {
		return nil, err
	}
	intent, err := s.runProjectionStore.GetWorkflowStartIntent(ctx, run.RunID)
	if err != nil {
		return nil, err
	}
	workflowInput, err := s.newExecutionReconciler().DecodeAndValidateWorkflowStartInput(intent, run)
	if err != nil {
		return nil, agentToolConflictError{message: err.Error()}
	}
	strategy := workflowInput.AdmissionSnapshot.ExecutionStrategy
	if strategy.MemoryRecall != "model_optional" || strategy.MaxToolCalls != 1 ||
		len(strategy.VisibleToolNames) != 1 || strategy.VisibleToolNames[0] != personalMemoryRecallToolName {
		return nil, agentToolConflictError{message: "personal memory recall is not available for this run"}
	}
	payload, err := s.loadExecutionPayload(ctx, run)
	if err != nil {
		return nil, err
	}
	recallRequest, err := memoryRecallRequestForRun(run, payload)
	if err != nil {
		return nil, agentToolConflictError{message: err.Error()}
	}
	recallRequest.UserGoal = envelope.Payload.Query
	result, err := s.recallPersonalMemory(ctx, recallRequest)
	if err != nil {
		return nil, err
	}
	memoryText := strings.TrimSpace(result.ContextBlock)
	outcome := "no_match"
	if memoryText != "" {
		outcome = "matched"
	}
	return map[string]any{
		"memory_text": memoryText,
		"outcome":     outcome,
	}, nil
}

func (s *Server) validateAgentToolRun(
	ctx context.Context,
	access agentToolAccessContext,
	toolName string,
) (execution.DurableRun, error) {
	if s.runProjectionStoreErr != nil {
		return execution.DurableRun{}, s.runProjectionStoreErr
	}
	if s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, access.RunID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.TraceID != access.TraceID {
		return execution.DurableRun{}, agentToolConflictError{message: "agent tool trace_id does not match run"}
	}
	if run.Status != execution.DurableRunStatusRunning {
		return execution.DurableRun{}, agentToolConflictError{message: "agent tool run is not running"}
	}
	steps, err := s.runProjectionStore.ListRunSteps(ctx, run.RunID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	step, latestAttempt, ok := latestPrimaryAgentStep(steps)
	if !ok {
		return execution.DurableRun{}, agentToolConflictError{message: "agent.primary admission projection is unavailable"}
	}
	if latestAttempt != access.ActivityAttempt {
		return execution.DurableRun{}, agentToolConflictError{message: "agent tool activity_attempt does not match latest agent attempt"}
	}
	if !containsString(stringSliceFromAny(step.SanitizedPayload["visible_tool_names"]), toolName) {
		return execution.DurableRun{}, agentToolConflictError{message: "agent tool is not admitted for this run"}
	}
	return run, nil
}

func latestPrimaryAgentStep(
	steps []execution.RunStepProjection,
) (execution.RunStepProjection, int, bool) {
	var latest execution.RunStepProjection
	latestAttempt := 0
	found := false
	for _, step := range steps {
		if step.StepID != "agent.primary" {
			continue
		}
		attempt := step.ActivityAttempt
		if attempt <= 0 {
			attempt, _ = positiveIntValue(step.SanitizedPayload["activity_attempt"])
		}
		if attempt <= 0 {
			continue
		}
		if !found || attempt > latestAttempt ||
			(attempt == latestAttempt && step.UpdatedAt.After(latest.UpdatedAt)) {
			latest = step
			latestAttempt = attempt
			found = true
		}
	}
	return latest, latestAttempt, found
}
