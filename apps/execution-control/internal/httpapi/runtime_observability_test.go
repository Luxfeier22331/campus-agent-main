package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

func TestRuntimeTelemetryEventIncludesLangfuseSessionAndUser(t *testing.T) {
	event := runtimeTelemetryEvent(
		telemetry.Event{Name: "answer.accepted"},
		execution.AnswerExecutionRequest{
			ConversationID: "conv-observability-001",
			OwnerUserID:    "user-observability-001",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				SelectedCapability: "knowledge",
			},
		},
	)

	if event.ConversationID != "conv-observability-001" {
		t.Fatalf("conversation id = %q, want conv-observability-001", event.ConversationID)
	}
	if event.UserID != "user-observability-001" {
		t.Fatalf("user id = %q, want user-observability-001", event.UserID)
	}
	if event.SelectedCapability != "knowledge" {
		t.Fatalf("selected capability = %q, want knowledge", event.SelectedCapability)
	}
}
