package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDecodeCapabilityExecutionRequestWireJSONAcceptsCanonicalFixture(t *testing.T) {
	payload := readContractFixture(t, "capability_execution_delegate.valid.json")

	wire, err := DecodeCapabilityExecutionRequestWireJSON(payload)
	if err != nil {
		t.Fatalf("DecodeCapabilityExecutionRequestWireJSON returned error: %v", err)
	}
	if wire.ExecutionContractVersion != ExecutionContractVersion {
		t.Fatalf("execution contract version = %q, want %q", wire.ExecutionContractVersion, ExecutionContractVersion)
	}
	if wire.RuntimeDecisions.RuntimeDecisionSummary.PlanningOutcome != "preplanned" {
		t.Fatalf(
			"planning outcome = %q, want preplanned",
			wire.RuntimeDecisions.RuntimeDecisionSummary.PlanningOutcome,
		)
	}
	if wire.RuntimeDecisions.WorkflowPlan == nil {
		t.Fatal("workflow_plan is nil, want canonical plan projection")
	}
	if wire.RuntimeDecisions.WorkflowPlan.WorkflowMode != WorkflowModeSingleStep {
		t.Fatalf(
			"workflow mode = %q, want single_step",
			wire.RuntimeDecisions.WorkflowPlan.WorkflowMode,
		)
	}
}

func TestDecodeCapabilityExecutionRequestWireJSONRejectsInvalidFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"capability_execution_extra_field.invalid.json",
		"capability_execution_invalid_enum.invalid.json",
		"capability_execution_invalid_version.invalid.json",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			if _, err := DecodeCapabilityExecutionRequestWireJSON(readContractFixture(t, fixtureName)); err == nil {
				t.Fatal("expected invalid bridge fixture to be rejected")
			}
		})
	}
}

func TestDecodeCapabilityExecutionResponseWireJSONAcceptsTerminalFixtures(t *testing.T) {
	expectedStatusByFixture := map[string]ExecutionStatus{
		"response_cancelled_null_target.valid.json":               ExecutionStatusCancelled,
		"response_completed_delegate.valid.json":                  ExecutionStatusCompleted,
		"response_error_execution_control_unavailable.valid.json": ExecutionStatusError,
		"response_timeout.valid.json":                             ExecutionStatusError,
	}

	for fixtureName, expectedStatus := range expectedStatusByFixture {
		t.Run(fixtureName, func(t *testing.T) {
			wire, err := DecodeCapabilityExecutionResponseWireJSON(readContractFixture(t, fixtureName))
			if err != nil {
				t.Fatalf("DecodeCapabilityExecutionResponseWireJSON returned error: %v", err)
			}
			if wire.Status != expectedStatus {
				t.Fatalf("status = %q, want %q", wire.Status, expectedStatus)
			}
		})
	}
}

func TestDecodeCapabilityExecutionResponseWireJSONRejectsNonCanonicalFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"response_camel_case.invalid.json",
		"response_extra_field.invalid.json",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			if _, err := DecodeCapabilityExecutionResponseWireJSON(readContractFixture(t, fixtureName)); err == nil {
				t.Fatal("expected invalid response fixture to be rejected")
			}
		})
	}
}

func TestDecodeCapabilityExecutionResponseWireJSONRejectsErrorWithoutRetryable(t *testing.T) {
	payload := map[string]any{
		"selected_capability":    nil,
		"status":                 "error",
		"answer_text":            "",
		"follow_up_question":     "",
		"confidence":             "low",
		"result":                 nil,
		"error":                  map[string]any{"code": "bridge_failed", "message": "bridge failed"},
		"observability":          map[string]any{},
		"workflow_trace_summary": nil,
		"trace_id":               "trace-missing-retryable",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeCapabilityExecutionResponseWireJSON(body); err == nil {
		t.Fatal("expected execution response error without retryable to be rejected")
	}
}

func readContractFixture(t *testing.T, fixtureName string) []byte {
	t.Helper()
	path := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"tests",
		"fixtures",
		"capability_execution_contract",
		fixtureName,
	)
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", fixtureName, err)
	}
	return payload
}
