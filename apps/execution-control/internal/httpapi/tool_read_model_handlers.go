package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

type toolReadModelAccessContext struct {
	ActivityAttempt int    `json:"activity_attempt"`
	InvocationID    string `json:"invocation_id"`
	RunID           string `json:"run_id"`
	TraceID         string `json:"trace_id"`
}

type toolReadModelRequestEnvelope struct {
	AccessContext toolReadModelAccessContext `json:"access_context"`
	Payload       json.RawMessage            `json:"payload"`
}

func (s *Server) handleToolReadModel(
	response http.ResponseWriter,
	request *http.Request,
	tool string,
) {
	if !s.toolReadModelAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid tool read model auth.", false)
		s.metrics.RecordToolReadModel(tool, "unauthorized", http.StatusUnauthorized)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		s.metrics.RecordToolReadModel(tool, "invalid_request", http.StatusBadRequest)
		return
	}
	envelope, err := decodeToolReadModelRequestEnvelope(body)
	if err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		s.metrics.RecordToolReadModel(tool, "invalid_request", http.StatusBadRequest)
		return
	}
	if err := s.validateToolReadModelAccessContext(request.Context(), envelope.AccessContext, tool); err != nil {
		setOutcome(response, "run_context_conflict")
		writeError(response, http.StatusConflict, "run_context_conflict", err.Error(), false)
		s.metrics.RecordToolReadModel(tool, "run_context_conflict", http.StatusConflict)
		return
	}
	ctx, cancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond,
	)
	defer cancel()

	var result toolreadmodel.Response
	switch tool {
	case toolreadmodel.ToolTransportScheduleLookup:
		result = s.toolReadModel.LookupTransportSchedule(ctx, body)
	default:
		result = toolreadmodel.Response{
			StatusCode: http.StatusNotFound,
			Outcome:    "not_found",
			Body: map[string]any{
				"error": map[string]any{
					"code":      "not_found",
					"message":   "Tool read model tool not found.",
					"retryable": false,
				},
			},
		}
	}
	setOutcome(response, result.Outcome)
	s.metrics.RecordToolReadModel(tool, result.Outcome, result.StatusCode)
	writeJSON(response, result.StatusCode, result.Body)
}

func decodeToolReadModelRequestEnvelope(body []byte) (toolReadModelRequestEnvelope, error) {
	var envelope toolReadModelRequestEnvelope
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return envelope, fmt.Errorf("tool read model request is invalid: %w", err)
	}
	if len(envelope.Payload) == 0 || strings.TrimSpace(envelope.AccessContext.RunID) == "" ||
		strings.TrimSpace(envelope.AccessContext.TraceID) == "" ||
		strings.TrimSpace(envelope.AccessContext.InvocationID) == "" || envelope.AccessContext.ActivityAttempt <= 0 {
		return envelope, errors.New("payload and access_context identity are required")
	}
	return envelope, nil
}

func (s *Server) validateToolReadModelAccessContext(
	ctx context.Context,
	access toolReadModelAccessContext,
	tool string,
) error {
	if s.runProjectionStore == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, access.RunID)
	if err != nil {
		return err
	}
	if run.TraceID != access.TraceID {
		return errors.New("tool access trace_id does not match run")
	}
	if run.Status != execution.DurableRunStatusRunning {
		return errors.New("tool access run is not running")
	}
	steps, err := s.runProjectionStore.ListRunSteps(ctx, run.RunID)
	if err != nil {
		return err
	}
	step, latestAttempt, ok := latestPrimaryAgentStep(steps)
	if !ok {
		return errors.New("agent.primary admission projection is unavailable")
	}
	if access.ActivityAttempt != latestAttempt {
		return fmt.Errorf(
			"tool access activity_attempt %d does not match latest agent attempt %d",
			access.ActivityAttempt,
			latestAttempt,
		)
	}
	visible := stringSliceFromAny(step.SanitizedPayload["visible_tool_names"])
	for _, candidate := range visible {
		if candidate == tool {
			return nil
		}
	}
	return fmt.Errorf("tool %s is not visible for the admitted agent run", tool)
}

// latestPrimaryAgentStep returns the aggregate agent projection that owns the
// current admission snapshot. RunStepProjection is normally a single row per
// step, but selecting by attempt here also keeps custom/read-replica stores
// from accidentally authorizing against an older row.
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
