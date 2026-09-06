package temporaladapter

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func temporalFinalizationResultPayload(
	finalizedResponse map[string]any,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	run execution.DurableRun,
) map[string]any {
	payload := map[string]any{
		"workflow_result_ref":  input.WorkflowResult.WorkflowResultRef,
		"finalization_summary": temporalFinalizationProjectionSummary(finalizedResponse),
		"request_id":           run.RequestID,
	}
	payload["finalization_fingerprint_sha256"] = sha256AnyValue(payload)
	return payload
}

func temporalFinalizationProjectionSummary(finalizedResponse map[string]any) map[string]any {
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
			case "campus_document":
				campusSourceCount++
			case "web_page":
				webSourceCount++
			}
		}
	case []map[string]any:
		sourceCount = len(sources)
		for _, source := range sources {
			switch execution.StringValue(source["kind"]) {
			case "campus_document":
				campusSourceCount++
			case "web_page":
				webSourceCount++
			}
		}
	}
	answerText := execution.StringValue(finalizedResponse["answer_text"])
	return map[string]any{
		"answer_text":         answerText,
		"answer_text_sha256":  sha256AnyValue(answerText),
		"campus_source_count": campusSourceCount,
		"response_sha256":     sha256AnyValue(finalizedResponse),
		"source_count":        sourceCount,
		"status":              execution.StringValue(finalizedResponse["status"]),
		"web_source_count":    webSourceCount,
	}
}

func (s *Adapter) appendTemporalFinalizationCompletedEvents(
	ctx context.Context,
	run execution.DurableRun,
	occurredAt time.Time,
	finalizedResponse map[string]any,
	payload map[string]any,
) error {
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
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
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
			!canonicalFinalizationTime(existing.OccurredAt).Equal(canonicalFinalizationTime(expected.OccurredAt)) {
			return sanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("internal finalization completion identity differs"),
				true,
			)
		}
		if !temporalEventPayloadEquivalent(
			execution.CloneAnyMapFromValue(existing.Payload["response"]),
			finalizedResponse,
		) {
			return sanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("internal finalization response differs"),
				true,
			)
		}
		if execution.StringValue(existing.Payload["request_id"]) != run.RequestID {
			return sanitizedTemporalApplicationError(
				"finalization_replay_incomplete",
				errors.New("internal finalization request identity is missing"),
				true,
			)
		}
		if workflowResultRef := execution.StringValue(existing.Payload["workflow_result_ref"]); workflowResultRef != "" &&
			workflowResultRef != strings.TrimSpace(execution.StringValue(payload["workflow_result_ref"])) {
			return sanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("internal finalization workflow result identity differs"),
				true,
			)
		}
		return nil
	}
	if err := s.appendTemporalRunEvent(ctx, expected); err != nil {
		return err
	}
	// The browser-visible terminal event is appended only after the
	// FinalizeRunProjection CAS commits the canonical finalization records and
	// releases the conversation lock.
	return nil
}

// finalizationSuccessEvidence is intentionally narrower than a product read:
// the internal event is appended only after the product callback succeeds.
// It is therefore safe to use as a fence against publishing a conflicting
// failure, but it is not by itself a repair or a choice of canonical records.
func (s *Adapter) finalizationSuccessEvidence(
	ctx context.Context,
	run execution.DurableRun,
) (bool, error) {
	if s == nil || s.runProjectionStore == nil {
		return false, execution.ErrRunProjectionStoreNotConfigured
	}
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return false, sanitizedTemporalApplicationError(
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
			return false, sanitizedTemporalApplicationError(
				"finalization_projection_conflict",
				errors.New("internal finalization success evidence has conflicting identity"),
				true,
			)
		}
		if execution.StringValue(event.Payload["request_id"]) != strings.TrimSpace(run.RequestID) ||
			len(execution.CloneAnyMapFromValue(event.Payload["response"])) == 0 {
			return false, sanitizedTemporalApplicationError(
				"finalization_projection_conflict",
				errors.New("internal finalization success evidence is incomplete"),
				true,
			)
		}
		return true, nil
	}
	return false, nil
}

func (s *Adapter) guardAgainstFinalizationSuccess(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
) error {
	hasEvidence, err := s.finalizationSuccessEvidence(ctx, run)
	if err != nil {
		if s != nil && s.logger != nil {
			s.logger.Error(
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
	if s != nil && s.logger != nil {
		s.logger.Error(
			"finalization projection conflict blocks failure terminal",
			"request_id", run.RequestID,
			"failure_kind", strings.TrimSpace(failureKind),
		)
	}
	return sanitizedTemporalApplicationError(
		"finalization_projection_conflict",
		errors.New("product finalization succeeded before durable completion projection"),
		true,
	)
}
