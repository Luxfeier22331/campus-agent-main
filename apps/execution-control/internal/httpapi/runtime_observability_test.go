package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
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
				SelectedTool: "knowledge_query",
			},
		},
	)

	if event.ConversationID != "conv-observability-001" {
		t.Fatalf("conversation id = %q, want conv-observability-001", event.ConversationID)
	}
	if event.UserID != "user-observability-001" {
		t.Fatalf("user id = %q, want user-observability-001", event.UserID)
	}
	if event.SelectedTool != "knowledge_query" {
		t.Fatalf("selected tool = %q, want knowledge_query", event.SelectedTool)
	}
}

func TestServerRuntimeTelemetryEventAddsReleaseAndEnvironment(t *testing.T) {
	server := &Server{
		config: config.Config{
			DeploymentEnvironment: "staging",
			RuntimeRelease:        "execution-control@2026.06.18",
		},
	}

	event := server.runtimeTelemetryEvent(
		telemetry.Event{Name: "answer.accepted"},
		execution.AnswerExecutionRequest{
			ConversationID: "conv-observability-001",
			OwnerUserID:    "user-observability-001",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				SelectedTool: "knowledge_query",
			},
		},
	)

	if event.Release != "execution-control@2026.06.18" {
		t.Fatalf("release = %q, want execution-control@2026.06.18", event.Release)
	}
	if event.DeploymentEnvironment != "staging" {
		t.Fatalf("deployment environment = %q, want staging", event.DeploymentEnvironment)
	}
}
