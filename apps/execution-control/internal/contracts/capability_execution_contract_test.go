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
	if wire.Context == nil {
		t.Fatal("context is nil")
	}
}

func TestDecodeCapabilityExecutionRequestWireJSONAcceptsRequestWithoutRuntimeDecisions(t *testing.T) {
	payload := canonicalCapabilityExecutionRequestPayload()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	wire, err := DecodeCapabilityExecutionRequestWireJSON(body)
	if err != nil {
		t.Fatalf("DecodeCapabilityExecutionRequestWireJSON returned error: %v", err)
	}
	if wire.RequestID != "req-contract-runtime-neutral" {
		t.Fatalf("request id = %q", wire.RequestID)
	}
}

func TestDecodeCapabilityExecutionRequestWireJSONRejectsContextProfileMemory(t *testing.T) {
	var payload map[string]any
	if err := json.Unmarshal(readContractFixture(t, "capability_execution_delegate.valid.json"), &payload); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	payload["context"] = map[string]any{
		"profile_memory": []map[string]any{{
			"key":   "answer_style",
			"value": "先给结论",
		}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeCapabilityExecutionRequestWireJSON(body); err == nil {
		t.Fatal("expected context.profile_memory to be rejected")
	}
}

func TestDecodeCapabilityExecutionRequestWireJSONRejectsTopLevelConversationContext(t *testing.T) {
	payload := canonicalCapabilityExecutionRequestPayload()
	payload["conversation_context"] = map[string]any{
		"schema_version":  "conversation_context.v1",
		"conversation_id": "conv-contract-runtime-neutral",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeCapabilityExecutionRequestWireJSON(body); err == nil {
		t.Fatal("expected top-level conversation_context to be rejected")
	}
}

func TestDecodeCapabilityExecutionLegacyRuntimeDecisionsWireStillValidatesWhenPresent(t *testing.T) {
	payload := readContractFixture(t, "capability_execution_delegate.valid.json")
	wire, err := DecodeCapabilityExecutionRequestWireJSON(payload)
	if err != nil {
		t.Fatalf("DecodeCapabilityExecutionRequestWireJSON returned error: %v", err)
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

func TestStepOutputProjectionKindValidAcceptsAllSchemaProjectionKinds(t *testing.T) {
	for _, kind := range []StepOutputProjectionKind{
		StepOutputProjectionKindNoticeContext,
		StepOutputProjectionKindNoticeChangeSet,
		StepOutputProjectionKindNoticePeriodSummary,
		StepOutputProjectionKindScheduleBaseline,
		StepOutputProjectionKindPlaceContext,
		StepOutputProjectionKindEvidenceBundle,
		StepOutputProjectionKindGroundingVerdict,
	} {
		if !kind.Valid() {
			t.Fatalf("projection kind %q should be valid", kind)
		}
	}
}

func canonicalCapabilityExecutionRequestPayload() map[string]any {
	return map[string]any{
		"execution_contract_version": "capability_execution_v1",
		"response_contract":          "execution_finalization_response_v1",
		"user_goal":                  "学生手册请假制度怎么规定？",
		"conversation_id":            "conv-contract-runtime-neutral",
		"request_id":                 "req-contract-runtime-neutral",
		"safety_identifier":          nil,
		"trace":                      map[string]any{"trace_id": "trace-contract-runtime-neutral"},
		"actor": map[string]any{
			"user_id":        "student@example.edu",
			"principal_id":   "principal-contract-runtime-neutral",
			"principal_type": "student",
			"roles":          []string{"student"},
			"departments":    []string{},
		},
		"context": map[string]any{
			"session_slots": map[string]any{},
		},
		"requested_capability": "knowledge",
		"effective_capability": "knowledge",
		"lane":                 "rag",
		"requested_scope": map[string]any{
			"corpus":     "regulations",
			"collection": "student_rules",
		},
		"version_query": map[string]any{"mode": "current"},
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
				t.Fatal("expected invalid execution fixture to be rejected")
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
		"error":                  map[string]any{"code": "execution_failed", "message": "execution failed"},
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
