package contracts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDecodeBridgeV6RequestWireJSONAcceptsCanonicalFixture(t *testing.T) {
	payload := readContractFixture(t, "bridge_v6_delegate.valid.json")

	wire, err := DecodeBridgeV6RequestWireJSON(payload)
	if err != nil {
		t.Fatalf("DecodeBridgeV6RequestWireJSON returned error: %v", err)
	}
	if wire.BridgeVersion != BridgeVersion {
		t.Fatalf("bridge version = %q, want %q", wire.BridgeVersion, BridgeVersion)
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
	if wire.RuntimeDecisions.WorkflowPlan.WorkflowMode != WorkflowModeSingleHandoff {
		t.Fatalf(
			"workflow mode = %q, want single_handoff",
			wire.RuntimeDecisions.WorkflowPlan.WorkflowMode,
		)
	}
}

func TestDecodeBridgeV6RequestWireJSONRejectsInvalidFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"bridge_v6_extra_field.invalid.json",
		"bridge_v6_invalid_enum.invalid.json",
		"bridge_v6_invalid_version.invalid.json",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			if _, err := DecodeBridgeV6RequestWireJSON(readContractFixture(t, fixtureName)); err == nil {
				t.Fatal("expected invalid bridge fixture to be rejected")
			}
		})
	}
}

func TestDecodeSupervisorResponseWireJSONAcceptsTerminalFixtures(t *testing.T) {
	expectedStatusByFixture := map[string]SupervisorStatus{
		"response_cancelled_null_target.valid.json":    SupervisorStatusCancelled,
		"response_completed_delegate.valid.json":       SupervisorStatusCompleted,
		"response_error_bridge_unavailable.valid.json": SupervisorStatusError,
		"response_timeout.valid.json":                  SupervisorStatusError,
	}

	for fixtureName, expectedStatus := range expectedStatusByFixture {
		t.Run(fixtureName, func(t *testing.T) {
			wire, err := DecodeSupervisorResponseWireJSON(readContractFixture(t, fixtureName))
			if err != nil {
				t.Fatalf("DecodeSupervisorResponseWireJSON returned error: %v", err)
			}
			if wire.Status != expectedStatus {
				t.Fatalf("status = %q, want %q", wire.Status, expectedStatus)
			}
		})
	}
}

func TestDecodeSupervisorResponseWireJSONRejectsNonCanonicalFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"response_camel_case.invalid.json",
		"response_extra_field.invalid.json",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			if _, err := DecodeSupervisorResponseWireJSON(readContractFixture(t, fixtureName)); err == nil {
				t.Fatal("expected invalid response fixture to be rejected")
			}
		})
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
		"supervisor_execution_contract",
		fixtureName,
	)
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", fixtureName, err)
	}
	return payload
}
