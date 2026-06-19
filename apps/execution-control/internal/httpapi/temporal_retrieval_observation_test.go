package httpapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

func TestRetrievalRuntimeObservationEventIncludesPlanIDAndSanitizedQuery(t *testing.T) {
	event := retrievalRuntimeObservationEvent(
		retrievalRuntimeObservationInput{
			CandidateCount: 3,
			FailureKind:    "",
			Plan: ragruntime.PlanProjection{
				Collection:      "student_rules",
				CollectionAlias: "student_rules",
				Corpus:          "regulations",
				PlanID:          "rag:regulations:student_rules:current",
				QueryMode:       "current",
				QueryText:       "学生请假手续",
				RunID:           "run-observation",
				StepID:          "rag.plan",
				TopK:            3,
			},
			ReferenceCount: 2,
			Run: execution.DurableRun{
				ConversationID:     "conv-observation",
				OwnerUserID:        "user-observation",
				RequestID:          "req-observation",
				RunID:              "run-observation",
				SelectedCapability: "knowledge",
				TraceID:            "trace-run",
			},
			TerminalState: "completed",
			TraceID:       "trace-activity",
		},
		12*time.Millisecond,
	)

	if event.Name != "retrieval.runtime_observation" {
		t.Fatalf("event name = %q, want retrieval.runtime_observation", event.Name)
	}
	if event.PlanID != "rag:regulations:student_rules:current" {
		t.Fatalf("plan id = %q", event.PlanID)
	}
	if event.StepID != "retrieval.indexed_lookup" || event.TerminalState != "completed" {
		t.Fatalf("step/terminal = %q/%q", event.StepID, event.TerminalState)
	}
	if event.QuerySHA256 == "" || event.QuerySHA256 == "学生请假手续" {
		t.Fatalf("query hash = %q, want sanitized hash only", event.QuerySHA256)
	}
	if event.RequestID != "req-observation" || event.TraceID != "trace-activity" {
		t.Fatalf("correlation = request %q trace %q", event.RequestID, event.TraceID)
	}
	if event.ConversationID != "conv-observation" || event.UserID != "user-observation" {
		t.Fatalf("langfuse identity = conversation %q user %q", event.ConversationID, event.UserID)
	}
	if event.SelectedCapability != "knowledge" {
		t.Fatalf("selected capability = %q, want knowledge", event.SelectedCapability)
	}
}

func TestEmitRetrievalRuntimeObservationFailsClosedWhenTelemetryUnavailable(t *testing.T) {
	server := NewServer(config.Config{
		OTelEnabled: true,
	})
	t.Cleanup(func() {
		if err := server.Shutdown(context.Background()); err != nil {
			t.Fatalf("shutdown server: %v", err)
		}
	})

	err := server.emitRetrievalRuntimeObservation(
		context.Background(),
		retrievalRuntimeObservationInput{
			Plan: ragruntime.PlanProjection{
				Collection: "student_rules",
				Corpus:     "regulations",
				PlanID:     "rag:regulations:student_rules:current",
				QueryMode:  "current",
				QueryText:  "学生请假手续",
			},
			Run: execution.DurableRun{
				ConversationID:     "conv-observation",
				OwnerUserID:        "user-observation",
				RequestID:          "req-observation",
				RunID:              "run-observation",
				SelectedCapability: "knowledge",
				TraceID:            "trace-run",
			},
			StartedAt:     time.Now().UTC(),
			TerminalState: "completed",
		},
	)

	if !errors.Is(err, telemetry.ErrTelemetryUnavailable) {
		t.Fatalf("error = %v, want ErrTelemetryUnavailable", err)
	}
}
