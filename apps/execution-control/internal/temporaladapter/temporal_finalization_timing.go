package temporaladapter

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const finalizationReservationPayloadSchema = "finalization-reservation-event-v1"

type finalizationTimingReservation struct {
	CompletedAt       time.Time
	FinalizationHash  string
	Legacy            bool
	StartedAt         time.Time
	WorkflowResultRef string
}

func canonicalFinalizationTime(value time.Time) time.Time {
	if value.IsZero() {
		return time.Time{}
	}
	return value.UTC().Truncate(time.Microsecond)
}

func finalizationEventTimeString(value time.Time) string {
	return canonicalFinalizationTime(value).Format(time.RFC3339Nano)
}

func finalizationReservationEvent(
	run execution.DurableRun,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	reservation finalizationTimingReservation,
) execution.DurableRunEvent {
	return execution.DurableRunEvent{
		EventID:              run.RequestID + ":finalization-reserved",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationReserved,
		OccurredAt:           reservation.CompletedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: finalizationReservationPayloadSchema,
		Payload: map[string]any{
			"completed_at":                    finalizationEventTimeString(reservation.CompletedAt),
			"finalization_fingerprint_sha256": reservation.FinalizationHash,
			"request_id":                      run.RequestID,
			"started_at":                      finalizationEventTimeString(reservation.StartedAt),
			"workflow_result_ref":             input.WorkflowResult.WorkflowResultRef,
		},
	}
}

func (s *Adapter) ensureFinalizationProgress(
	ctx context.Context,
	run execution.DurableRun,
) (time.Time, error) {
	if startedAt, found, err := s.readFinalizationProgress(ctx, run); err != nil {
		return time.Time{}, err
	} else if found {
		return startedAt, nil
	}

	startedAt := canonicalFinalizationTime(time.Now())
	event := execution.DurableRunEvent{
		EventID:              run.RequestID + ":progress:" + string(execution.DurableRunProgressPhaseFinalizing),
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunProgress,
		OccurredAt:           startedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-progress-event-v1",
		Payload: map[string]any{
			"phase":      string(execution.DurableRunProgressPhaseFinalizing),
			"request_id": run.RequestID,
		},
	}
	_, appendErr := s.runProjectionStore.AppendRunEvent(ctx, event)
	if appendErr == nil {
		return startedAt, nil
	} else if !errors.Is(appendErr, execution.ErrInvalidRunEvent) {
		return time.Time{}, appendErr
	}

	// A retry may race another worker's first append. Re-read the durable event
	// and use it only when its identity is the expected finalizing progress.
	if startedAt, found, readErr := s.readFinalizationProgress(ctx, run); readErr != nil {
		return time.Time{}, readErr
	} else if found {
		return startedAt, nil
	}
	return time.Time{}, appendErr
}

func (s *Adapter) readFinalizationProgress(
	ctx context.Context,
	run execution.DurableRun,
) (time.Time, bool, error) {
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return time.Time{}, false, err
	}
	progressID := run.RequestID + ":progress:" + string(execution.DurableRunProgressPhaseFinalizing)
	for _, event := range events {
		if event.EventID != progressID {
			continue
		}
		startedAt, validateErr := validateFinalizationProgressEvent(run, event)
		if validateErr != nil {
			return time.Time{}, false, validateErr
		}
		return startedAt, true, nil
	}
	return time.Time{}, false, nil
}

func validateFinalizationProgressEvent(
	run execution.DurableRun,
	event execution.DurableRunEvent,
) (time.Time, error) {
	if event.RequestID != run.RequestID ||
		event.ConversationID != run.ConversationID ||
		event.EventType != execution.DurableRunEventTypeRunProgress ||
		event.Visibility != execution.DurableRunEventVisibilityBrowser ||
		event.PayloadSchemaVersion != "run-progress-event-v1" {
		return time.Time{}, sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			errors.New("finalizing progress event identity differs"),
			true,
		)
	}
	if execution.StringValue(event.Payload["request_id"]) != run.RequestID ||
		execution.StringValue(event.Payload["phase"]) != string(execution.DurableRunProgressPhaseFinalizing) ||
		event.OccurredAt.IsZero() {
		return time.Time{}, sanitizedTemporalApplicationError(
			"finalization_replay_incomplete",
			errors.New("finalizing progress event is incomplete"),
			true,
		)
	}
	return canonicalFinalizationTime(event.OccurredAt), nil
}

func (s *Adapter) ensureFinalizationTimingReservation(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	finalizedResponse map[string]any,
	startedAt time.Time,
	finalizationHash string,
) (finalizationTimingReservation, error) {
	startedAt = canonicalFinalizationTime(startedAt)
	finalizationHash = strings.TrimSpace(finalizationHash)
	if startedAt.IsZero() || !execution.ValidLowerHexSHA256(finalizationHash) {
		return finalizationTimingReservation{}, sanitizedTemporalApplicationError(
			"finalization_replay_incomplete",
			errors.New("finalization timing identity is incomplete"),
			true,
		)
	}
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return finalizationTimingReservation{}, err
	}
	var reservationEvent *execution.DurableRunEvent
	var legacyCompletionEvent *execution.DurableRunEvent
	for index := range events {
		event := events[index]
		switch event.EventID {
		case run.RequestID + ":finalization-reserved":
			if reservationEvent != nil {
				return finalizationTimingReservation{}, finalizationReplayConflict(
					"multiple finalization reservation events exist",
				)
			}
			candidate := execution.CloneDurableRunEvent(event)
			reservationEvent = &candidate
		case run.RequestID + ":finalization-completed-internal":
			if legacyCompletionEvent != nil {
				return finalizationTimingReservation{}, finalizationReplayConflict(
					"multiple internal finalization completion events exist",
				)
			}
			candidate := execution.CloneDurableRunEvent(event)
			legacyCompletionEvent = &candidate
		}
	}

	if reservationEvent != nil {
		reservation, parseErr := parseFinalizationReservationEvent(*reservationEvent)
		if parseErr != nil {
			return finalizationTimingReservation{}, parseErr
		}
		if reservation.WorkflowResultRef != strings.TrimSpace(input.WorkflowResult.WorkflowResultRef) ||
			reservation.FinalizationHash != finalizationHash ||
			!reservation.StartedAt.Equal(startedAt) {
			return finalizationTimingReservation{}, finalizationReplayConflict(
				"finalization reservation identity differs",
			)
		}
		if legacyCompletionEvent != nil {
			if _, err := validateLegacyFinalizationCompletion(
				*legacyCompletionEvent,
				run,
				finalizedResponse,
				input.WorkflowResult.WorkflowResultRef,
				reservation.CompletedAt,
			); err != nil {
				return finalizationTimingReservation{}, err
			}
		}
		return reservation, nil
	}

	if legacyCompletionEvent != nil {
		legacyCompletedAt, err := validateLegacyFinalizationCompletion(
			*legacyCompletionEvent,
			run,
			finalizedResponse,
			input.WorkflowResult.WorkflowResultRef,
			time.Time{},
		)
		if err != nil {
			return finalizationTimingReservation{}, err
		}
		if legacyCompletedAt.Before(startedAt) {
			return finalizationTimingReservation{}, finalizationReplayIncomplete(
				"legacy finalization completion precedes finalizing progress",
			)
		}
		return finalizationTimingReservation{
			CompletedAt:       legacyCompletedAt,
			FinalizationHash:  finalizationHash,
			Legacy:            true,
			StartedAt:         startedAt,
			WorkflowResultRef: strings.TrimSpace(input.WorkflowResult.WorkflowResultRef),
		}, nil
	}

	completedAt := canonicalFinalizationTime(time.Now())
	if completedAt.Before(startedAt) {
		// Wall-clock rollback must not produce a negative product duration. The
		// reservation remains a wall-clock boundary, so clamp only this rollback.
		completedAt = startedAt
	}
	reservation := finalizationTimingReservation{
		CompletedAt:       completedAt,
		FinalizationHash:  finalizationHash,
		StartedAt:         startedAt,
		WorkflowResultRef: strings.TrimSpace(input.WorkflowResult.WorkflowResultRef),
	}
	event := finalizationReservationEvent(run, input, reservation)
	_, appendErr := s.runProjectionStore.AppendRunEvent(ctx, event)
	if appendErr == nil {
		return reservation, nil
	} else if !errors.Is(appendErr, execution.ErrInvalidRunEvent) {
		return finalizationTimingReservation{}, appendErr
	}

	// If another attempt won the reservation append, reuse it only after all
	// identity and timing fields have been checked. A different reservation is
	// a replay conflict, never a reason to send a second callback.
	events, listErr := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
	if listErr != nil {
		return finalizationTimingReservation{}, listErr
	}
	for _, existing := range events {
		if existing.EventID != event.EventID {
			continue
		}
		stored, parseErr := parseFinalizationReservationEvent(existing)
		if parseErr != nil {
			return finalizationTimingReservation{}, parseErr
		}
		if stored.WorkflowResultRef != reservation.WorkflowResultRef ||
			stored.FinalizationHash != reservation.FinalizationHash ||
			!stored.StartedAt.Equal(reservation.StartedAt) ||
			!stored.CompletedAt.Equal(reservation.CompletedAt) {
			return finalizationTimingReservation{}, finalizationReplayConflict(
				"concurrent finalization reservation differs",
			)
		}
		return stored, nil
	}
	return finalizationTimingReservation{}, appendErr
}

func parseFinalizationReservationEvent(
	event execution.DurableRunEvent,
) (finalizationTimingReservation, error) {
	if event.EventType != execution.DurableRunEventTypeFinalizationReserved ||
		event.EventID != event.RequestID+":finalization-reserved" ||
		event.Visibility != execution.DurableRunEventVisibilityInternal ||
		event.PayloadSchemaVersion != finalizationReservationPayloadSchema {
		return finalizationTimingReservation{}, finalizationReplayConflict(
			"finalization reservation event identity differs",
		)
	}
	startedAt, startedOK := finalizationEventTime(event.Payload["started_at"])
	completedAt, completedOK := finalizationEventTime(event.Payload["completed_at"])
	if execution.StringValue(event.Payload["request_id"]) != event.RequestID ||
		strings.TrimSpace(execution.StringValue(event.Payload["workflow_result_ref"])) == "" ||
		!execution.ValidLowerHexSHA256(execution.StringValue(event.Payload["finalization_fingerprint_sha256"])) ||
		!startedOK || !completedOK || completedAt.Before(startedAt) ||
		event.OccurredAt.IsZero() || !canonicalFinalizationTime(event.OccurredAt).Equal(completedAt) {
		return finalizationTimingReservation{}, finalizationReplayIncomplete(
			"finalization reservation event is malformed",
		)
	}
	return finalizationTimingReservation{
		CompletedAt:       completedAt,
		FinalizationHash:  execution.StringValue(event.Payload["finalization_fingerprint_sha256"]),
		StartedAt:         startedAt,
		WorkflowResultRef: strings.TrimSpace(execution.StringValue(event.Payload["workflow_result_ref"])),
	}, nil
}

func finalizationEventTime(value any) (time.Time, bool) {
	switch typed := value.(type) {
	case string:
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(typed))
		if err != nil || parsed.IsZero() {
			return time.Time{}, false
		}
		return canonicalFinalizationTime(parsed), true
	case time.Time:
		if typed.IsZero() {
			return time.Time{}, false
		}
		return canonicalFinalizationTime(typed), true
	default:
		return time.Time{}, false
	}
}

func validateLegacyFinalizationCompletion(
	event execution.DurableRunEvent,
	run execution.DurableRun,
	finalizedResponse map[string]any,
	expectedWorkflowResultRef string,
	expectedCompletedAt time.Time,
) (time.Time, error) {
	if event.RequestID != run.RequestID ||
		event.ConversationID != run.ConversationID ||
		event.EventType != execution.DurableRunEventTypeFinalizationCompleted ||
		event.Visibility != execution.DurableRunEventVisibilityInternal ||
		event.PayloadSchemaVersion != "run-event-v1" {
		return time.Time{}, finalizationReplayConflict("legacy finalization completion identity differs")
	}
	if execution.StringValue(event.Payload["request_id"]) != run.RequestID {
		return time.Time{}, finalizationReplayIncomplete("legacy finalization request identity is missing")
	}
	response := execution.CloneAnyMapFromValue(event.Payload["response"])
	if len(response) == 0 {
		return time.Time{}, finalizationReplayIncomplete("legacy finalization response is missing")
	}
	if !temporalEventPayloadEquivalent(response, finalizedResponse) {
		return time.Time{}, finalizationReplayConflict("legacy finalization response differs")
	}
	if workflowResultRef := execution.StringValue(event.Payload["workflow_result_ref"]); workflowResultRef != "" &&
		workflowResultRef != strings.TrimSpace(expectedWorkflowResultRef) {
		return time.Time{}, finalizationReplayConflict("legacy workflow result identity differs")
	}
	completedAt := canonicalFinalizationTime(event.OccurredAt)
	if completedAt.IsZero() {
		return time.Time{}, finalizationReplayIncomplete("legacy finalization completion time is missing")
	}
	if !expectedCompletedAt.IsZero() && !completedAt.Equal(canonicalFinalizationTime(expectedCompletedAt)) {
		return time.Time{}, finalizationReplayConflict("legacy finalization completion time differs")
	}
	return completedAt, nil
}

func finalizationReplayConflict(message string) error {
	return sanitizedTemporalApplicationError("finalization_replay_conflict", errors.New(message), true)
}

func finalizationReplayIncomplete(message string) error {
	return sanitizedTemporalApplicationError("finalization_replay_incomplete", errors.New(message), true)
}

func (s *Adapter) legacyFinalizationCompletionTime(
	ctx context.Context,
	run execution.DurableRun,
	finalizedResponse map[string]any,
	expectedWorkflowResultRef string,
) (time.Time, bool, error) {
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return time.Time{}, false, err
	}
	for _, event := range events {
		if event.EventID != run.RequestID+":finalization-completed-internal" {
			continue
		}
		completedAt, err := validateLegacyFinalizationCompletion(
			event,
			run,
			finalizedResponse,
			expectedWorkflowResultRef,
			time.Time{},
		)
		if err != nil {
			return time.Time{}, false, err
		}
		return completedAt, true, nil
	}
	return time.Time{}, false, nil
}

func (s *Adapter) completedFinalizationTiming(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	finalizedResponse map[string]any,
	finalizationHash string,
) (finalizationTimingReservation, error) {
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return finalizationTimingReservation{}, err
	}
	for _, event := range events {
		if event.EventID != run.RequestID+":finalization-reserved" {
			continue
		}
		reservation, parseErr := parseFinalizationReservationEvent(event)
		if parseErr != nil {
			return finalizationTimingReservation{}, parseErr
		}
		if reservation.WorkflowResultRef != strings.TrimSpace(input.WorkflowResult.WorkflowResultRef) ||
			reservation.FinalizationHash != strings.TrimSpace(finalizationHash) ||
			!reservation.CompletedAt.Equal(canonicalFinalizationTime(run.CompletedAt)) {
			return finalizationTimingReservation{}, finalizationReplayConflict(
				"completed run reservation identity differs",
			)
		}
		progressStartedAt, foundProgress, progressErr := s.readFinalizationProgress(ctx, run)
		if progressErr != nil {
			return finalizationTimingReservation{}, progressErr
		}
		if !foundProgress || !progressStartedAt.Equal(reservation.StartedAt) {
			return finalizationTimingReservation{}, finalizationReplayIncomplete(
				"completed reservation lacks matching finalizing progress evidence",
			)
		}
		legacyCompletedAt, found, legacyErr := s.legacyFinalizationCompletionTime(
			ctx,
			run,
			finalizedResponse,
			input.WorkflowResult.WorkflowResultRef,
		)
		if legacyErr != nil {
			return finalizationTimingReservation{}, legacyErr
		}
		if !found || !legacyCompletedAt.Equal(reservation.CompletedAt) {
			return finalizationTimingReservation{}, finalizationReplayIncomplete(
				"completed reservation lacks matching finalization success evidence",
			)
		}
		return reservation, nil
	}
	if completedAt, found, err := s.legacyFinalizationCompletionTime(
		ctx,
		run,
		finalizedResponse,
		input.WorkflowResult.WorkflowResultRef,
	); err != nil {
		return finalizationTimingReservation{}, err
	} else if found {
		return finalizationTimingReservation{
			CompletedAt:       completedAt,
			FinalizationHash:  strings.TrimSpace(finalizationHash),
			Legacy:            true,
			WorkflowResultRef: strings.TrimSpace(input.WorkflowResult.WorkflowResultRef),
		}, nil
	}
	if run.CompletedAt.IsZero() {
		return finalizationTimingReservation{}, finalizationReplayIncomplete("completed run timing evidence is missing")
	}
	return finalizationTimingReservation{
		CompletedAt:      canonicalFinalizationTime(run.CompletedAt),
		FinalizationHash: strings.TrimSpace(finalizationHash),
	}, nil
}
