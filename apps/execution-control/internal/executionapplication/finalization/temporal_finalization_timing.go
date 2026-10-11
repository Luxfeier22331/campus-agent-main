package finalization

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionfailure"
)

const FinalizationReservationPayloadSchema = "finalization-reservation-event-v1"

type FinalizationTimingReservation struct {
	CompletedAt       time.Time
	FinalizationHash  string
	StartedAt         time.Time
	WorkflowResultRef string
}

func CanonicalFinalizationTime(value time.Time) time.Time {
	if value.IsZero() {
		return time.Time{}
	}
	return value.UTC().Truncate(time.Microsecond)
}

func FinalizationEventTimeString(value time.Time) string {
	return CanonicalFinalizationTime(value).Format(time.RFC3339Nano)
}

func FinalizationReservationEvent(
	run execution.DurableRun,
	input executioncontract.FinalizationInput,
	reservation FinalizationTimingReservation,
) execution.DurableRunEvent {
	return execution.DurableRunEvent{
		EventID:              run.RequestID + ":finalization-reserved",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationReserved,
		OccurredAt:           reservation.CompletedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: FinalizationReservationPayloadSchema,
		Payload: map[string]any{
			"completed_at":                    FinalizationEventTimeString(reservation.CompletedAt),
			"finalization_fingerprint_sha256": reservation.FinalizationHash,
			"request_id":                      run.RequestID,
			"started_at":                      FinalizationEventTimeString(reservation.StartedAt),
			"workflow_result_ref":             input.WorkflowResult.WorkflowResultRef,
		},
	}
}

func (s *FinalizationService) EnsureFinalizationProgress(
	ctx context.Context,
	run execution.DurableRun,
) (time.Time, error) {
	if startedAt, found, err := s.ReadFinalizationProgress(ctx, run); err != nil {
		return time.Time{}, err
	} else if found {
		return startedAt, nil
	}

	startedAt := CanonicalFinalizationTime(time.Now())
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
	_, appendErr := s.RunProjectionStore.AppendRunEvent(ctx, event)
	if appendErr == nil {
		return startedAt, nil
	} else if !errors.Is(appendErr, execution.ErrInvalidRunEvent) {
		return time.Time{}, appendErr
	}

	// A retry may race another worker's first append. Re-read the durable event
	// and use it only when its identity is the expected finalizing progress.
	if startedAt, found, readErr := s.ReadFinalizationProgress(ctx, run); readErr != nil {
		return time.Time{}, readErr
	} else if found {
		return startedAt, nil
	}
	return time.Time{}, appendErr
}

func (s *FinalizationService) ReadFinalizationProgress(
	ctx context.Context,
	run execution.DurableRun,
) (time.Time, bool, error) {
	events, err := s.RunProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return time.Time{}, false, err
	}
	progressID := run.RequestID + ":progress:" + string(execution.DurableRunProgressPhaseFinalizing)
	for _, event := range events {
		if event.EventID != progressID {
			continue
		}
		startedAt, validateErr := ValidateFinalizationProgressEvent(run, event)
		if validateErr != nil {
			return time.Time{}, false, validateErr
		}
		return startedAt, true, nil
	}
	return time.Time{}, false, nil
}

func ValidateFinalizationProgressEvent(
	run execution.DurableRun,
	event execution.DurableRunEvent,
) (time.Time, error) {
	if event.RequestID != run.RequestID ||
		event.ConversationID != run.ConversationID ||
		event.EventType != execution.DurableRunEventTypeRunProgress ||
		event.Visibility != execution.DurableRunEventVisibilityBrowser ||
		event.PayloadSchemaVersion != "run-progress-event-v1" {
		return time.Time{}, executionfailure.SanitizedError(
			"finalization_replay_conflict",
			errors.New("finalizing progress event identity differs"),
			true,
		)
	}
	if execution.StringValue(event.Payload["request_id"]) != run.RequestID ||
		execution.StringValue(event.Payload["phase"]) != string(execution.DurableRunProgressPhaseFinalizing) ||
		event.OccurredAt.IsZero() {
		return time.Time{}, executionfailure.SanitizedError(
			"finalization_replay_incomplete",
			errors.New("finalizing progress event is incomplete"),
			true,
		)
	}
	return CanonicalFinalizationTime(event.OccurredAt), nil
}

func (s *FinalizationService) EnsureFinalizationTimingReservation(
	ctx context.Context,
	run execution.DurableRun,
	input executioncontract.FinalizationInput,
	finalizedResponse map[string]any,
	startedAt time.Time,
	finalizationHash string,
) (FinalizationTimingReservation, error) {
	startedAt = CanonicalFinalizationTime(startedAt)
	finalizationHash = strings.TrimSpace(finalizationHash)
	if startedAt.IsZero() || !execution.ValidLowerHexSHA256(finalizationHash) {
		return FinalizationTimingReservation{}, executionfailure.SanitizedError(
			"finalization_replay_incomplete",
			errors.New("finalization timing identity is incomplete"),
			true,
		)
	}
	events, err := s.RunProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return FinalizationTimingReservation{}, err
	}
	var reservationEvent *execution.DurableRunEvent
	for index := range events {
		event := events[index]
		switch event.EventID {
		case run.RequestID + ":finalization-reserved":
			if reservationEvent != nil {
				return FinalizationTimingReservation{}, FinalizationReplayConflict(
					"multiple finalization reservation events exist",
				)
			}
			candidate := execution.CloneDurableRunEvent(event)
			reservationEvent = &candidate
		}
	}

	if reservationEvent != nil {
		reservation, parseErr := ParseFinalizationReservationEvent(*reservationEvent)
		if parseErr != nil {
			return FinalizationTimingReservation{}, parseErr
		}
		if reservation.WorkflowResultRef != strings.TrimSpace(input.WorkflowResult.WorkflowResultRef) ||
			reservation.FinalizationHash != finalizationHash ||
			!reservation.StartedAt.Equal(startedAt) {
			return FinalizationTimingReservation{}, FinalizationReplayConflict(
				"finalization reservation identity differs",
			)
		}
		return reservation, nil
	}

	completedAt := CanonicalFinalizationTime(time.Now())
	if completedAt.Before(startedAt) {
		// Wall-clock rollback must not produce a negative product duration. The
		// reservation remains a wall-clock boundary, so clamp only this rollback.
		completedAt = startedAt
	}
	reservation := FinalizationTimingReservation{
		CompletedAt:       completedAt,
		FinalizationHash:  finalizationHash,
		StartedAt:         startedAt,
		WorkflowResultRef: strings.TrimSpace(input.WorkflowResult.WorkflowResultRef),
	}
	event := FinalizationReservationEvent(run, input, reservation)
	_, appendErr := s.RunProjectionStore.AppendRunEvent(ctx, event)
	if appendErr == nil {
		return reservation, nil
	} else if !errors.Is(appendErr, execution.ErrInvalidRunEvent) {
		return FinalizationTimingReservation{}, appendErr
	}

	// If another attempt won the reservation append, reuse it only after all
	// identity and timing fields have been checked. A different reservation is
	// a replay conflict, never a reason to send a second callback.
	events, listErr := s.RunProjectionStore.ListRunEvents(ctx, run.RequestID)
	if listErr != nil {
		return FinalizationTimingReservation{}, listErr
	}
	for _, existing := range events {
		if existing.EventID != event.EventID {
			continue
		}
		stored, parseErr := ParseFinalizationReservationEvent(existing)
		if parseErr != nil {
			return FinalizationTimingReservation{}, parseErr
		}
		if stored.WorkflowResultRef != reservation.WorkflowResultRef ||
			stored.FinalizationHash != reservation.FinalizationHash ||
			!stored.StartedAt.Equal(reservation.StartedAt) ||
			!stored.CompletedAt.Equal(reservation.CompletedAt) {
			return FinalizationTimingReservation{}, FinalizationReplayConflict(
				"concurrent finalization reservation differs",
			)
		}
		return stored, nil
	}
	return FinalizationTimingReservation{}, appendErr
}

func ParseFinalizationReservationEvent(
	event execution.DurableRunEvent,
) (FinalizationTimingReservation, error) {
	if event.EventType != execution.DurableRunEventTypeFinalizationReserved ||
		event.EventID != event.RequestID+":finalization-reserved" ||
		event.Visibility != execution.DurableRunEventVisibilityInternal ||
		event.PayloadSchemaVersion != FinalizationReservationPayloadSchema {
		return FinalizationTimingReservation{}, FinalizationReplayConflict(
			"finalization reservation event identity differs",
		)
	}
	startedAt, startedOK := FinalizationEventTime(event.Payload["started_at"])
	completedAt, completedOK := FinalizationEventTime(event.Payload["completed_at"])
	if execution.StringValue(event.Payload["request_id"]) != event.RequestID ||
		strings.TrimSpace(execution.StringValue(event.Payload["workflow_result_ref"])) == "" ||
		!execution.ValidLowerHexSHA256(execution.StringValue(event.Payload["finalization_fingerprint_sha256"])) ||
		!startedOK || !completedOK || completedAt.Before(startedAt) ||
		event.OccurredAt.IsZero() || !CanonicalFinalizationTime(event.OccurredAt).Equal(completedAt) {
		return FinalizationTimingReservation{}, FinalizationReplayIncomplete(
			"finalization reservation event is malformed",
		)
	}
	return FinalizationTimingReservation{
		CompletedAt:       completedAt,
		FinalizationHash:  execution.StringValue(event.Payload["finalization_fingerprint_sha256"]),
		StartedAt:         startedAt,
		WorkflowResultRef: strings.TrimSpace(execution.StringValue(event.Payload["workflow_result_ref"])),
	}, nil
}

func FinalizationEventTime(value any) (time.Time, bool) {
	switch typed := value.(type) {
	case string:
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(typed))
		if err != nil || parsed.IsZero() {
			return time.Time{}, false
		}
		return CanonicalFinalizationTime(parsed), true
	case time.Time:
		if typed.IsZero() {
			return time.Time{}, false
		}
		return CanonicalFinalizationTime(typed), true
	default:
		return time.Time{}, false
	}
}

func FinalizationReplayConflict(message string) error {
	return executionfailure.SanitizedError("finalization_replay_conflict", errors.New(message), true)
}

func FinalizationReplayIncomplete(message string) error {
	return executionfailure.SanitizedError("finalization_replay_incomplete", errors.New(message), true)
}

func (s *FinalizationService) CompletedFinalizationTiming(
	ctx context.Context,
	run execution.DurableRun,
	input executioncontract.FinalizationInput,
	finalizedResponse map[string]any,
	finalizationHash string,
) (FinalizationTimingReservation, error) {
	events, err := s.RunProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return FinalizationTimingReservation{}, err
	}
	for _, event := range events {
		if event.EventID != run.RequestID+":finalization-reserved" {
			continue
		}
		reservation, parseErr := ParseFinalizationReservationEvent(event)
		if parseErr != nil {
			return FinalizationTimingReservation{}, parseErr
		}
		if reservation.WorkflowResultRef != strings.TrimSpace(input.WorkflowResult.WorkflowResultRef) ||
			reservation.FinalizationHash != strings.TrimSpace(finalizationHash) ||
			!reservation.CompletedAt.Equal(CanonicalFinalizationTime(run.CompletedAt)) {
			return FinalizationTimingReservation{}, FinalizationReplayConflict(
				"completed run reservation identity differs",
			)
		}
		progressStartedAt, foundProgress, progressErr := s.ReadFinalizationProgress(ctx, run)
		if progressErr != nil {
			return FinalizationTimingReservation{}, progressErr
		}
		if !foundProgress || !progressStartedAt.Equal(reservation.StartedAt) {
			return FinalizationTimingReservation{}, FinalizationReplayIncomplete(
				"completed reservation lacks matching finalizing progress evidence",
			)
		}
		return reservation, nil
	}
	if run.CompletedAt.IsZero() {
		return FinalizationTimingReservation{}, FinalizationReplayIncomplete("completed run timing evidence is missing")
	}
	return FinalizationTimingReservation{
		CompletedAt:      CanonicalFinalizationTime(run.CompletedAt),
		FinalizationHash: strings.TrimSpace(finalizationHash),
	}, nil
}
