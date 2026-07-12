package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func assertPrimaryAgentLLMIOFingerprintForTest(t *testing.T, agentMetadata map[string]any) {
	t.Helper()
	fingerprint, ok := agentMetadata["llm_io_fingerprint"].(map[string]any)
	if !ok {
		t.Fatalf("agent metadata missing llm_io_fingerprint: %#v", agentMetadata)
	}
	if fingerprint["schema_version"] != "llm_io_fingerprint.v1" ||
		fingerprint["run_id"] != "run-primary-agent-001" ||
		fingerprint["request_id"] != "req-primary-agent-001" ||
		fingerprint["trace_id"] != "trace-executor-001" ||
		fingerprint["provider_profile_revision"] != "primary_agent:provider_profile_primary:3" ||
		fingerprint["provider"] != "openai" ||
		fingerprint["model"] != "gpt-test" {
		t.Fatalf("llm_io_fingerprint identity = %#v", fingerprint)
	}
	for _, field := range []string{
		"model_params_hash",
		"prompt_template_sha256",
		"rendered_prompt_sha256",
		"tool_catalog_sha256",
		"tool_schema_sha256",
		"workflow_artifact_sha256",
		"context_envelope_sha256",
		"memory_selection_sha256",
		"evidence_packet_sha256",
	} {
		value, _ := fingerprint[field].(string)
		if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+64 {
			t.Fatalf("llm_io_fingerprint[%s] = %q, want sha256 ref", field, value)
		}
	}
	toolRuntime, ok := fingerprint["tool_runtime_fingerprint"].(map[string]any)
	if !ok {
		t.Fatalf("llm_io_fingerprint missing tool_runtime_fingerprint: %#v", fingerprint)
	}
	if toolRuntime["schema_version"] != "tool_runtime_fingerprint.v1" ||
		toolRuntime["tools_schema_version"] != "tool-registry-v4" ||
		toolRuntime["function_schema_version"] != "tool-function-schemas-v1" ||
		toolRuntime["workflow_artifact_schema_version"] != "workflow-artifact-registry-v2" {
		t.Fatalf("tool_runtime_fingerprint identity = %#v", toolRuntime)
	}
	if fingerprint["tool_catalog_sha256"] != toolRuntime["tools_sha256"] ||
		fingerprint["tool_schema_sha256"] != toolRuntime["function_schema_sha256"] ||
		fingerprint["workflow_artifact_sha256"] != toolRuntime["workflow_artifact_sha256"] {
		t.Fatalf("flat tool hashes drift from runtime fingerprint: %#v", fingerprint)
	}
	serializedFingerprint, err := json.Marshal(fingerprint)
	if err != nil {
		t.Fatalf("marshal fingerprint: %v", err)
	}
	for _, forbidden := range []string{
		"hi 你是谁",
		"你好，我是校园问答助手。",
		"用户偏好先看结论",
		"sk-primary-agent",
	} {
		if strings.Contains(string(serializedFingerprint), forbidden) {
			t.Fatalf("llm_io_fingerprint leaked raw value %q: %s", forbidden, serializedFingerprint)
		}
	}
}
