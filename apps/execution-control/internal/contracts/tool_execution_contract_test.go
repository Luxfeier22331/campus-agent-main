package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDecodeToolExecutionRequestWireJSONAcceptsCanonicalFixture(t *testing.T) {
	payload := readContractFixture(t, "tool_execution_delegate.valid.json")

	wire, err := DecodeToolExecutionRequestWireJSON(payload)
	if err != nil {
		t.Fatalf("DecodeToolExecutionRequestWireJSON returned error: %v", err)
	}
	if wire.ExecutionContractVersion != ExecutionContractVersion {
		t.Fatalf("execution contract version = %q, want %q", wire.ExecutionContractVersion, ExecutionContractVersion)
	}
	if wire.Context == nil {
		t.Fatal("context is nil")
	}
}

func TestDecodeToolExecutionRequestWireJSONAcceptsRequestWithoutRuntimeDecisions(t *testing.T) {
	payload := canonicalToolExecutionRequestPayload()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	wire, err := DecodeToolExecutionRequestWireJSON(body)
	if err != nil {
		t.Fatalf("DecodeToolExecutionRequestWireJSON returned error: %v", err)
	}
	if wire.RequestID != "req-contract-runtime-neutral" {
		t.Fatalf("request id = %q", wire.RequestID)
	}
}

func TestDecodeToolExecutionRequestWireJSONRejectsContextProfileMemory(t *testing.T) {
	var payload map[string]any
	if err := json.Unmarshal(readContractFixture(t, "tool_execution_delegate.valid.json"), &payload); err != nil {
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

	if _, err := DecodeToolExecutionRequestWireJSON(body); err == nil {
		t.Fatal("expected context.profile_memory to be rejected")
	}
}

func TestDecodeToolExecutionRequestWireJSONRejectsTopLevelConversationContext(t *testing.T) {
	payload := canonicalToolExecutionRequestPayload()
	payload["conversation_context"] = map[string]any{
		"schema_version":  "conversation_context.v1",
		"conversation_id": "conv-contract-runtime-neutral",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeToolExecutionRequestWireJSON(body); err == nil {
		t.Fatal("expected top-level conversation_context to be rejected")
	}
}

func TestDecodeToolExecutionLegacyRuntimeDecisionsWireStillValidatesWhenPresent(t *testing.T) {
	payload := readContractFixture(t, "tool_execution_delegate.valid.json")
	wire, err := DecodeToolExecutionRequestWireJSON(payload)
	if err != nil {
		t.Fatalf("DecodeToolExecutionRequestWireJSON returned error: %v", err)
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

func canonicalToolExecutionRequestPayload() map[string]any {
	return map[string]any{
		"execution_contract_version": "tool_execution_v1",
		"response_contract":          "execution_finalization_response_v2",
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
		"requested_tool": "knowledge_query",
		"effective_tool": "knowledge_query",
		"task_queue":     "campus-agent.workflow",
		"requested_scope": map[string]any{
			"corpus":     "regulations",
			"collection": "student_rules",
		},
		"version_query": map[string]any{"mode": "current"},
	}
}

func TestDecodeToolExecutionRequestWireJSONRejectsInvalidFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"tool_execution_extra_field.invalid.json",
		"tool_execution_invalid_enum.invalid.json",
		"tool_execution_invalid_version.invalid.json",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			if _, err := DecodeToolExecutionRequestWireJSON(readContractFixture(t, fixtureName)); err == nil {
				t.Fatal("expected invalid handoff fixture to be rejected")
			}
		})
	}
}

func TestDecodeToolExecutionResponseWireJSONAcceptsTerminalFixtures(t *testing.T) {
	expectedStatusByFixture := map[string]ExecutionStatus{
		"response_cancelled_null_target.valid.json":               ExecutionStatusCancelled,
		"response_completed_delegate.valid.json":                  ExecutionStatusCompleted,
		"response_error_execution_control_unavailable.valid.json": ExecutionStatusError,
		"response_timeout.valid.json":                             ExecutionStatusError,
	}

	for fixtureName, expectedStatus := range expectedStatusByFixture {
		t.Run(fixtureName, func(t *testing.T) {
			wire, err := DecodeToolExecutionResponseWireJSON(readContractFixture(t, fixtureName))
			if err != nil {
				t.Fatalf("DecodeToolExecutionResponseWireJSON returned error: %v", err)
			}
			if wire.Status != expectedStatus {
				t.Fatalf("status = %q, want %q", wire.Status, expectedStatus)
			}
		})
	}
}

func TestDecodeToolExecutionResponseWireJSONRejectsNonCanonicalFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"response_camel_case.invalid.json",
		"response_extra_field.invalid.json",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			if _, err := DecodeToolExecutionResponseWireJSON(readContractFixture(t, fixtureName)); err == nil {
				t.Fatal("expected invalid response fixture to be rejected")
			}
		})
	}
}

func TestDecodeToolExecutionResponseWireJSONRejectsErrorWithoutRetryable(t *testing.T) {
	payload := map[string]any{
		"selected_tool":          nil,
		"status":                 "error",
		"answer_text":            "",
		"follow_up_question":     "",
		"confidence":             "low",
		"result":                 nil,
		"error":                  map[string]any{"code": "activity_failed", "message": "activity failed"},
		"observability":          map[string]any{},
		"workflow_trace_summary": nil,
		"trace_id":               "trace-missing-retryable",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeToolExecutionResponseWireJSON(body); err == nil {
		t.Fatal("expected execution response error without retryable to be rejected")
	}
}

func TestDecodeToolExecutionResponseWireJSONRejectsNonCanonicalStageTiming(t *testing.T) {
	payload := canonicalToolExecutionResponsePayload()
	payload["stage_timing"] = map[string]any{
		"agent_runtime_duration_ms": 42,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeToolExecutionResponseWireJSON(body); err == nil {
		t.Fatal("expected non-canonical stage_timing field to be rejected")
	}
}

func TestDecodeToolExecutionResponseWireJSONRejectsInvalidDebugTraceRef(t *testing.T) {
	payload := canonicalToolExecutionResponsePayload()
	payload["debug_trace_refs"] = []map[string]any{{
		"sink":      "raw_sdk_trace",
		"trace_ref": "trace://raw-sdk",
	}}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeToolExecutionResponseWireJSON(body); err == nil {
		t.Fatal("expected invalid debug trace sink to be rejected")
	}
}

func TestDecodeToolExecutionResponseWireJSONAcceptsCanonicalStageTimingAndDebugTraceRef(t *testing.T) {
	payload := canonicalToolExecutionResponsePayload()
	payload["stage_timing"] = map[string]any{
		"agent.runtime_ms":     42,
		"agent.first_delta_ms": 12,
	}
	payload["debug_trace_refs"] = []map[string]any{{
		"sink":      "langfuse_otlp",
		"trace_id":  "trace-contract-response",
		"trace_ref": "langfuse://trace-contract-response",
		"url":       "https://langfuse.example/project/demo/traces/trace-contract-response",
	}}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	wire, err := DecodeToolExecutionResponseWireJSON(body)
	if err != nil {
		t.Fatalf("DecodeToolExecutionResponseWireJSON returned error: %v", err)
	}
	if wire.StageTiming[StageTimingFieldAgentRuntimeMs] != 42 {
		t.Fatalf("stage timing = %#v", wire.StageTiming)
	}
	if len(wire.DebugTraceRefs) != 1 || wire.DebugTraceRefs[0].Sink != DebugTraceSinkLangfuseOtlp {
		t.Fatalf("debug trace refs = %#v", wire.DebugTraceRefs)
	}
}

func canonicalToolExecutionResponsePayload() map[string]any {
	return map[string]any{
		"selected_tool":          nil,
		"status":                 "completed",
		"answer_text":            "ok",
		"follow_up_question":     "",
		"confidence":             "high",
		"result":                 map[string]any{},
		"error":                  nil,
		"observability":          map[string]any{},
		"workflow_trace_summary": nil,
		"trace_id":               "trace-contract-response",
	}
}

func readContractFixture(t *testing.T, fixtureName string) []byte {
	t.Helper()
	path := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"packages",
		"contracts",
		"fixtures",
		"tool_execution_contract",
		fixtureName,
	)
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", fixtureName, err)
	}
	return payload
}
