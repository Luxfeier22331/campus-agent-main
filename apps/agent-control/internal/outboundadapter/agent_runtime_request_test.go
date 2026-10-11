package outboundadapter

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

func TestWorkflowOperationProviderRequestFingerprintIgnoresActivityAttempt(t *testing.T) {
	first := map[string]any{
		"activity_attempt": 1,
		"operation":        "solve",
		"operation_input":  map[string]any{"goal": "查询规定"},
	}
	second := execution.CloneAnyMap(first)
	second["activity_attempt"] = 2

	firstHash, err := runtimeRequestFingerprint(first)
	if err != nil {
		t.Fatalf("fingerprint first request: %v", err)
	}
	secondHash, err := runtimeRequestFingerprint(second)
	if err != nil {
		t.Fatalf("fingerprint retry request: %v", err)
	}
	if firstHash != secondHash {
		t.Fatalf("retry fingerprint = %q, want stable fingerprint %q", secondHash, firstHash)
	}
	if firstHash != "c928ca9bebee3087d2140bcfe0546750d4d5320195b05e0001233624177049ee" {
		t.Fatalf("logical request fingerprint changed: %s", firstHash)
	}

	second["operation_input"].(map[string]any)["goal"] = "查询奖学金"
	changedHash, err := runtimeRequestFingerprint(second)
	if err != nil {
		t.Fatalf("fingerprint changed request: %v", err)
	}
	if changedHash == firstHash {
		t.Fatal("semantic operation input change reused the receipt fingerprint")
	}
}

func TestPreparePreservesWireEncodingAndLogicalFingerprint(t *testing.T) {
	request := executionapplication.AgentRuntimeRequest{
		RequestID: "run", ConversationID: "conv", UserID: "user", DeadlineAt: time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC), ActivityAttempt: 1,
		Operation: executioncontract.WorkflowOperationSolve, Input: map[string]any{"goal": "查询规定"},
		ModelTargetSHA256: "model", StreamModelAnswer: true,
	}
	const expected = `{"activity_attempt":1,"conversation_id":"conv","deadline_at":"2026-10-10T00:00:00Z","expected_model_target_sha256":"model","limits":{"agent_deadline_ms":0,"context_char_limit":0,"current_input_char_limit":0,"max_function_tool_calls":0,"max_output_tokens":0,"max_plan_steps":0,"max_replans":0,"max_turns":0},"model_answer_transport":"stream","operation":"solve","operation_input":{"goal":"查询规定"},"request_id":"run","user_id":"user","visible_function_tool_names":[]}`
	encoded, err := encodeRuntimeRequest(request)
	if err != nil || string(encoded) != expected {
		t.Fatalf("wire=%s err=%v", encoded, err)
	}
	// No endpoint or secret: Prepare must be local even in production assembly.
	client := NewAgentRuntimeClient(config.Config{})
	first, err := client.Prepare(request)
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]any
	if err := json.Unmarshal([]byte(expected), &legacy); err != nil {
		t.Fatal(err)
	}
	want, err := runtimeRequestFingerprint(legacy)
	if err != nil || first != want {
		t.Fatalf("fingerprint=%s want=%s err=%v", first, want, err)
	}
	request.ActivityAttempt++
	retry, err := client.Prepare(request)
	if err != nil || retry != first {
		t.Fatalf("retry=%s err=%v", retry, err)
	}
	request.Input["goal"] = "查询奖学金"
	changed, err := client.Prepare(request)
	if err != nil || changed == first {
		t.Fatalf("semantic change=%s err=%v", changed, err)
	}
	request.Input["goal"] = strings.Repeat("x", execution.MaxAgentOperationPayloadBytes)
	_, err = client.Prepare(request)
	var oversized *execution.OperationPayloadTooLargeError
	if !errors.As(err, &oversized) {
		t.Fatalf("oversized error=%v", err)
	}
	request.Input["goal"] = make(chan int)
	if _, err := client.Prepare(request); err == nil {
		t.Fatal("unencodable input was accepted")
	}
}
