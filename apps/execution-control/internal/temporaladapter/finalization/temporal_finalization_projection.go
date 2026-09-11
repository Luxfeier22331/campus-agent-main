package finalization

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const maxFinalizationRecoveryBytes = execution.MaxAgentOperationPayloadBytes

func TemporalFinalizationResultPayload(
	finalizedResponse map[string]any,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	run execution.DurableRun,
) map[string]any {
	payload := map[string]any{
		"workflow_result_ref":  input.WorkflowResult.WorkflowResultRef,
		"finalization_summary": TemporalFinalizationProjectionSummary(finalizedResponse),
		"request_id":           run.RequestID,
	}
	payload["finalization_fingerprint_sha256"] = activityprojection.Sha256AnyValue(payload)
	return payload
}

func TemporalFinalizationProjectionSummary(finalizedResponse map[string]any) map[string]any {
	result := execution.OptionalMapFromMap(finalizedResponse, "result")
	sourceCount := 0
	campusSourceCount := 0
	webSourceCount := 0
	switch sources := result["sources"].(type) {
	case []any:
		sourceCount = len(sources)
		for _, source := range sources {
			kind := execution.StringValue(execution.CloneAnyMapFromValue(source)["kind"])
			switch kind {
			case "campus_document", "campus_notice":
				campusSourceCount++
			case "web_page":
				webSourceCount++
			}
		}
	case []map[string]any:
		sourceCount = len(sources)
		for _, source := range sources {
			switch execution.StringValue(source["kind"]) {
			case "campus_document", "campus_notice":
				campusSourceCount++
			case "web_page":
				webSourceCount++
			}
		}
	}
	answerText := execution.StringValue(finalizedResponse["answer_text"])
	return map[string]any{
		"answer_text":         answerText,
		"answer_text_sha256":  activityprojection.Sha256AnyValue(answerText),
		"campus_source_count": campusSourceCount,
		"response_sha256":     activityprojection.Sha256AnyValue(finalizedResponse),
		"source_count":        sourceCount,
		"status":              execution.StringValue(finalizedResponse["status"]),
		"web_source_count":    webSourceCount,
	}
}

func (s *Adapter) AppendTemporalFinalizationCompletedEvents(
	ctx context.Context,
	run execution.DurableRun,
	occurredAt time.Time,
	finalizedResponse map[string]any,
	payload map[string]any,
) error {
	if err := validateFinalizationRecoveryResponse(finalizedResponse); err != nil {
		return err
	}
	internalPayload := execution.CloneAnyMapFromValue(payload)
	internalPayload["response"] = finalizedResponse
	expected := execution.DurableRunEvent{
		EventID:              run.RequestID + ":finalization-completed-internal",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           occurredAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              internalPayload,
	}
	events, err := s.RunProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return err
	}
	for _, existing := range events {
		if existing.EventID != expected.EventID {
			continue
		}
		if existing.RequestID != expected.RequestID ||
			existing.ConversationID != expected.ConversationID ||
			existing.EventType != expected.EventType ||
			existing.Visibility != expected.Visibility ||
			existing.PayloadSchemaVersion != expected.PayloadSchemaVersion ||
			!CanonicalFinalizationTime(existing.OccurredAt).Equal(CanonicalFinalizationTime(expected.OccurredAt)) {
			return activityprojection.SanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("internal finalization completion identity differs"),
				true,
			)
		}
		if !activityprojection.TemporalEventPayloadEquivalent(
			execution.CloneAnyMapFromValue(existing.Payload["response"]),
			finalizedResponse,
		) {
			return activityprojection.SanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("internal finalization response differs"),
				true,
			)
		}
		if execution.StringValue(existing.Payload["request_id"]) != run.RequestID {
			return activityprojection.SanitizedTemporalApplicationError(
				"finalization_replay_incomplete",
				errors.New("internal finalization request identity is missing"),
				true,
			)
		}
		if workflowResultRef := execution.StringValue(existing.Payload["workflow_result_ref"]); workflowResultRef != "" &&
			workflowResultRef != strings.TrimSpace(execution.StringValue(payload["workflow_result_ref"])) {
			return activityprojection.SanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("internal finalization workflow result identity differs"),
				true,
			)
		}
		return nil
	}
	if err := s.AppendTemporalRunEvent(ctx, expected); err != nil {
		return err
	}
	// The browser-visible terminal event is appended only after the
	// FinalizeRunProjection CAS commits the canonical finalization records and
	// releases the conversation lock.
	return nil
}

func validateFinalizationRecoveryResponse(response map[string]any) error {
	encodedResponse, err := json.Marshal(response)
	if err != nil {
		return fmt.Errorf("encode finalization recovery response: %w", err)
	}
	if len(encodedResponse) > maxFinalizationRecoveryBytes {
		return activityprojection.SanitizedTemporalApplicationError(
			"finalization_response_too_large",
			fmt.Errorf("finalization recovery response exceeds %d bytes", maxFinalizationRecoveryBytes),
			true,
		)
	}
	if err := validateRecoveryResponseFields(encodedResponse); err != nil {
		return activityprojection.SanitizedTemporalApplicationError("finalization_response_invalid", err, true)
	}
	return nil
}

// finalizationSuccessEvidence is intentionally narrower than a product read:
// the internal event is appended only after the product callback succeeds.
// It is therefore safe to use as a fence against publishing a conflicting
// failure, but it is not by itself a repair or a choice of canonical records.
func (s *Adapter) FinalizationSuccessEvidence(
	ctx context.Context,
	run execution.DurableRun,
) (bool, error) {
	if s == nil || s.RunProjectionStore == nil {
		return false, execution.ErrRunProjectionStoreNotConfigured
	}
	events, err := s.RunProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return false, activityprojection.SanitizedTemporalApplicationError(
			"finalization_projection_evidence_unavailable",
			err,
			false,
		)
	}
	evidenceID := run.RequestID + ":finalization-completed-internal"
	for _, event := range events {
		if event.EventID != evidenceID {
			continue
		}
		if event.RequestID != run.RequestID ||
			event.ConversationID != run.ConversationID ||
			event.EventType != execution.DurableRunEventTypeFinalizationCompleted ||
			event.Visibility != execution.DurableRunEventVisibilityInternal ||
			event.PayloadSchemaVersion != "run-event-v1" {
			return false, activityprojection.SanitizedTemporalApplicationError(
				"finalization_projection_conflict",
				errors.New("internal finalization success evidence has conflicting identity"),
				true,
			)
		}
		if execution.StringValue(event.Payload["request_id"]) != strings.TrimSpace(run.RequestID) ||
			len(execution.CloneAnyMapFromValue(event.Payload["response"])) == 0 {
			return false, activityprojection.SanitizedTemporalApplicationError(
				"finalization_projection_conflict",
				errors.New("internal finalization success evidence is incomplete"),
				true,
			)
		}
		return true, nil
	}
	return false, nil
}

func (s *Adapter) GuardAgainstFinalizationSuccess(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
) error {
	hasEvidence, err := s.FinalizationSuccessEvidence(ctx, run)
	if err != nil {
		if s != nil && s.Logger != nil {
			s.Logger.Error(
				"finalization success evidence could not be evaluated",
				"request_id", run.RequestID,
				"failure_kind", strings.TrimSpace(failureKind),
				"error", err,
			)
		}
		return err
	}
	if !hasEvidence {
		return nil
	}
	if s != nil && s.Logger != nil {
		s.Logger.Error(
			"finalization projection conflict blocks failure terminal",
			"request_id", run.RequestID,
			"failure_kind", strings.TrimSpace(failureKind),
		)
	}
	return activityprojection.SanitizedTemporalApplicationError(
		"finalization_projection_conflict",
		errors.New("product finalization succeeded before durable completion projection"),
		true,
	)
}
