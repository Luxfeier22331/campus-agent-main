package execution

import (
	"encoding/json"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestObserveIntentForEvalProjectsGoRuntimePolicyAndPlanning(t *testing.T) {
	observed, err := ObserveIntentForEval(
		json.RawMessage(`{
			"user_goal":"奖学金怎么申请？",
			"request_id":"intent-eval-knowledge-001",
			"requested_tool":"knowledge_query"
		}`),
		map[string]string{
			"authorization": "Bearer intent-eval-token",
			"x-trace-id":    "trace-intent-eval-knowledge-001",
		},
		intentEvalBearerConfig(),
	)

	if err != nil {
		t.Fatalf("unexpected eval error: %#v", err)
	}
	if observed.ErrorCode != "" {
		t.Fatalf("error_code = %q, want empty", observed.ErrorCode)
	}
	if observed.ClassifierVersion != "go-runtime-policy-v2" {
		t.Fatalf("classifier_version = %q, want go-runtime-policy-v2", observed.ClassifierVersion)
	}
	if observed.SchemaVersion != "intent-schema-1.0.0" {
		t.Fatalf("schema_version = %q, want intent-schema-1.0.0", observed.SchemaVersion)
	}
	if observed.Tool != "knowledge_query" {
		t.Fatalf("tool = %q, want knowledge_query", observed.Tool)
	}
	if observed.SelectedTool != "none" {
		t.Fatalf("selected_tool = %q, want none before agent tool selection", observed.SelectedTool)
	}
	if observed.PlanningOutcome != "not_preplanned" {
		t.Fatalf("planning_outcome = %q, want not_preplanned", observed.PlanningOutcome)
	}
}

func TestObserveIntentForEvalReportsTerminalOutcomeForClosedPlaceLookup(t *testing.T) {
	observed, err := ObserveIntentForEval(
		json.RawMessage(`{
			"user_goal":"图书馆在哪里",
			"request_id":"intent-eval-place-closed-001",
			"requested_tool":"place_lookup"
		}`),
		map[string]string{
			"authorization": "Bearer intent-eval-token",
			"x-trace-id":    "trace-intent-eval-place-closed-001",
		},
		intentEvalBearerConfig(),
	)

	if err != nil {
		t.Fatalf("unexpected eval error: %#v", err)
	}
	if observed.NextAction != "out_of_scope" {
		t.Fatalf("next_action = %q, want out_of_scope", observed.NextAction)
	}
	if observed.Tool != "place_lookup" {
		t.Fatalf("tool = %q, want place_lookup", observed.Tool)
	}
	if observed.SelectedTool != "none" {
		t.Fatalf("selected_tool = %q, want none", observed.SelectedTool)
	}
	if observed.TerminalStatus != "no_answer" {
		t.Fatalf("terminal_status = %q, want no_answer", observed.TerminalStatus)
	}
}

func TestObserveIntentForEvalMapsInvalidEnvelopeToExecutionErrorCode(t *testing.T) {
	observed, err := ObserveIntentForEval(
		json.RawMessage(`{
			"user_goal":"图书馆在哪里",
			"request_id":"intent-eval-invalid-place-scope-001",
			"requested_tool":"place_lookup",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"}
		}`),
		map[string]string{
			"authorization": "Bearer intent-eval-token",
			"x-trace-id":    "trace-intent-eval-invalid-place-scope-001",
		},
		intentEvalBearerConfig(),
	)

	if err != nil {
		t.Fatalf("unexpected eval error: %#v", err)
	}
	if observed.ErrorCode != "invalid_execution_request" {
		t.Fatalf("error_code = %q, want invalid_execution_request", observed.ErrorCode)
	}
}

func intentEvalBearerConfig() config.Config {
	return config.Config{
		AuthMode:          "bearer",
		BearerToken:       "intent-eval-token",
		DefaultActorID:    "intent-eval-user",
		DefaultActorRoles: []string{"student"},
	}
}
