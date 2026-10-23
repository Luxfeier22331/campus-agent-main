package execution

import (
	"strings"
	"testing"
	"time"
)

func TestValidateDurableRunEventBaseAcceptsFinalizationReservation(t *testing.T) {
	startedAt := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	completedAt := startedAt.Add(250 * time.Millisecond)
	event := finalizationReservationEventForValidationTest(startedAt, completedAt)

	if err := ValidateDurableRunEventBase(event); err != nil {
		t.Fatalf("validate finalization reservation: %v", err)
	}
}

func TestValidateDurableRunEventBaseRejectsInvalidFinalizationReservation(t *testing.T) {
	startedAt := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	completedAt := startedAt.Add(250 * time.Millisecond)
	tests := map[string]func(*DurableRunEvent){
		"browser visibility": func(event *DurableRunEvent) {
			event.Visibility = DurableRunEventVisibilityBrowser
		},
		"extra payload": func(event *DurableRunEvent) {
			event.Payload["response"] = map[string]any{"answer": "hidden"}
		},
		"completion before start": func(event *DurableRunEvent) {
			event.Payload["completed_at"] = startedAt.Add(-time.Nanosecond).Format(time.RFC3339Nano)
			event.OccurredAt = startedAt.Add(-time.Nanosecond)
		},
		"occurred at drift": func(event *DurableRunEvent) {
			event.OccurredAt = completedAt.Add(time.Second)
		},
		"fingerprint": func(event *DurableRunEvent) {
			event.Payload["finalization_fingerprint_sha256"] = strings.Repeat("A", 64)
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			event := finalizationReservationEventForValidationTest(startedAt, completedAt)
			mutate(&event)
			if err := ValidateDurableRunEventBase(event); err == nil {
				t.Fatal("invalid finalization reservation was accepted")
			}
		})
	}
}

func finalizationReservationEventForValidationTest(startedAt, completedAt time.Time) DurableRunEvent {
	requestID := "req-finalization-reservation-validation"
	return DurableRunEvent{
		EventID:              requestID + ":finalization-reserved",
		RequestID:            requestID,
		ConversationID:       "conv-finalization-reservation-validation",
		EventType:            DurableRunEventTypeFinalizationReserved,
		Sequence:             1,
		OccurredAt:           completedAt,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "finalization-reservation-event-v1",
		Payload: map[string]any{
			"completed_at":                    completedAt.Format(time.RFC3339Nano),
			"finalization_fingerprint_sha256": strings.Repeat("a", 64),
			"request_id":                      requestID,
			"started_at":                      startedAt.Format(time.RFC3339Nano),
			"workflow_result_ref":             "workflow://result",
		},
	}
}
