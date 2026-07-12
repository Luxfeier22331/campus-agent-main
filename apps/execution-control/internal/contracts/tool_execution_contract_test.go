package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDecodeExecutionPayloadWireJSONAcceptsCanonicalFixture(t *testing.T) {
	payload := readContractFixture(t, "execution_payload.valid.json")

	wire, err := DecodeExecutionPayloadWireJSON(payload)
	if err != nil {
		t.Fatalf("DecodeExecutionPayloadWireJSON returned error: %v", err)
	}
	if wire.ExecutionContractVersion != ExecutionContractVersion {
		t.Fatalf("execution contract version = %q, want %q", wire.ExecutionContractVersion, ExecutionContractVersion)
	}
	if wire.Context == nil {
		t.Fatal("context is nil")
	}
}

func TestDecodeExecutionRunCreateRequestWireJSONAcceptsCanonicalRequest(t *testing.T) {
	body, err := json.Marshal(canonicalExecutionRunCreateRequestPayload())
	if err != nil {
		t.Fatalf("marshal run create request: %v", err)
	}

	wire, err := DecodeExecutionRunCreateRequestWireJSON(body)
	if err != nil {
		t.Fatalf("DecodeExecutionRunCreateRequestWireJSON returned error: %v", err)
	}
	if wire.Metadata.ExecutionPayload.RequestedTool != RequestedToolKnowledgeQuery {
		t.Fatalf("requested tool = %q, want knowledge_query", wire.Metadata.ExecutionPayload.RequestedTool)
	}
}

func TestDecodeExecutionRunCreateRequestWireJSONRejectsCallerRoutingFields(t *testing.T) {
	for _, field := range []string{"requested_tool", "selected_tool", "task_queue"} {
		t.Run(field, func(t *testing.T) {
			payload := canonicalExecutionRunCreateRequestPayload()
			payload[field] = "caller-owned-value"
			body, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal run create request: %v", err)
			}

			if _, err := DecodeExecutionRunCreateRequestWireJSON(body); err == nil {
				t.Fatalf("expected caller routing field %s to be rejected", field)
			}
		})
	}
}

func TestDecodeExecutionPayloadWireJSONRejectsUnknownField(t *testing.T) {
	payload := canonicalExecutionPayload()
	payload["unexpected_field"] = true
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeExecutionPayloadWireJSON(body); err == nil {
		t.Fatal("expected unknown execution payload field to be rejected")
	}
}

func TestDecodeExecutionPayloadWireJSONRejectsUnknownTraceField(t *testing.T) {
	payload := canonicalExecutionPayload()
	payload["trace"] = map[string]any{
		"trace_id":   "trace-contract-runtime-neutral",
		"unexpected": true,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeExecutionPayloadWireJSON(body); err == nil {
		t.Fatal("expected unknown trace field to be rejected")
	}
}

func TestDecodeExecutionPayloadWireJSONRejectsUnknownVersionQueryField(t *testing.T) {
	payload := canonicalExecutionPayload()
	payload["version_query"] = map[string]any{
		"mode":       "current",
		"unexpected": true,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeExecutionPayloadWireJSON(body); err == nil {
		t.Fatal("expected unknown version query field to be rejected")
	}
}

func TestDecodeExecutionPayloadWireJSONRejectsContextProfileMemory(t *testing.T) {
	var payload map[string]any
	if err := json.Unmarshal(readContractFixture(t, "execution_payload.valid.json"), &payload); err != nil {
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

	if _, err := DecodeExecutionPayloadWireJSON(body); err == nil {
		t.Fatal("expected context.profile_memory to be rejected")
	}
}

func TestDecodeExecutionPayloadWireJSONRejectsTopLevelConversationContext(t *testing.T) {
	payload := canonicalExecutionPayload()
	payload["conversation_context"] = map[string]any{
		"schema_version":  "conversation_context.v1",
		"conversation_id": "conv-contract-runtime-neutral",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeExecutionPayloadWireJSON(body); err == nil {
		t.Fatal("expected top-level conversation_context to be rejected")
	}
}

func TestDecodeExecutionPayloadWireJSONRejectsScopeForNonKnowledgeTool(t *testing.T) {
	payload := canonicalExecutionPayload()
	payload["requested_tool"] = "transport_schedule_lookup"
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeExecutionPayloadWireJSON(body); err == nil {
		t.Fatal("expected scope for non-knowledge tool to be rejected")
	}
}

func TestAnswerArtifactKindValidAcceptsAgentFinalOutput(t *testing.T) {
	if !AnswerArtifactKindAgentFinalOutput.Valid() {
		t.Fatal("agent_final_output should be a valid answer artifact kind")
	}
}

func canonicalExecutionPayload() map[string]any {
	return map[string]any{
		"execution_contract_version": "tool_execution_v1",
		"response_contract":          "execution_finalization_response_v2",
		"user_goal":                  "学生手册请假制度怎么规定？",
		"conversation_id":            "conv-contract-runtime-neutral",
		"request_id":                 "req-contract-runtime-neutral",
		"safety_identifier":          nil,
		"trace":                      map[string]any{"trace_id": "trace-contract-runtime-neutral"},
		"context": map[string]any{
			"session_slots": map[string]any{},
		},
		"requested_tool": "knowledge_query",
		"scope":          "student_rules",
		"version_query":  map[string]any{"mode": "current"},
	}
}

func canonicalExecutionRunCreateRequestPayload() map[string]any {
	return map[string]any{
		"run_id":          "run-contract-runtime-neutral",
		"conversation_id": "conv-contract-runtime-neutral",
		"turn_id":         "turn-contract-runtime-neutral",
		"request_id":      "req-contract-runtime-neutral",
		"trace_id":        "trace-contract-runtime-neutral",
		"owner_user_id":   "user-contract-runtime-neutral",
		"surface":         "internal_eval",
		"runtime_versions": map[string]any{
			"caller": "app-api@test",
		},
		"metadata": map[string]any{
			"execution_payload": canonicalExecutionPayload(),
		},
	}
}

func TestDecodeExecutionPayloadWireJSONRejectsInvalidFixtures(t *testing.T) {
	for _, fixtureName := range []string{
		"execution_payload_extra_field.invalid.json",
		"execution_payload_invalid_enum.invalid.json",
		"execution_payload_invalid_version.invalid.json",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			if _, err := DecodeExecutionPayloadWireJSON(readContractFixture(t, fixtureName)); err == nil {
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

func TestDecodeToolExecutionResponseWireJSONAcceptsCanonicalStageTiming(t *testing.T) {
	payload := canonicalToolExecutionResponsePayload()
	payload["stage_timing"] = map[string]any{
		"agent.runtime_ms":     42,
		"agent.first_delta_ms": 12,
	}
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
}

func TestDecodeToolExecutionResponseWireJSONRejectsInvalidSessionUpdate(t *testing.T) {
	payload := canonicalToolExecutionResponsePayload()
	payload["session_update"] = map[string]any{
		"upsert_slots": []map[string]any{{
			"confirmed": true,
			"name":      "unexpected_slot",
			"value":     "计算机科学与技术",
		}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	if _, err := DecodeToolExecutionResponseWireJSON(body); err == nil {
		t.Fatal("expected invalid session update slot name to be rejected")
	}
}

func TestDecodeToolExecutionResponseWireJSONRequiresNullableFinalizationFields(t *testing.T) {
	for _, field := range []string{"resolved_scope", "session_update"} {
		t.Run(field, func(t *testing.T) {
			payload := canonicalToolExecutionResponsePayload()
			delete(payload, field)
			body, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}

			if _, err := DecodeToolExecutionResponseWireJSON(body); err == nil {
				t.Fatalf("expected missing %s to be rejected", field)
			}
		})
	}
}

func canonicalToolExecutionResponsePayload() map[string]any {
	return map[string]any{
		"selected_tool":          nil,
		"status":                 "completed",
		"answer_text":            "ok",
		"follow_up_question":     "",
		"confidence":             "high",
		"resolved_scope":         nil,
		"session_update":         nil,
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
