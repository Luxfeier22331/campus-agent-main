package httpapi

import "testing"

func assertPrimaryAgentMemoryContextForTest(t *testing.T, seenBody map[string]any) {
	t.Helper()
	memoryContext, ok := seenBody["memory_context"].(map[string]any)
	if !ok {
		t.Fatalf("agent runtime request missing memory_context: %#v", seenBody)
	}
	if memoryContext["context_block"] != "用户记忆:\n- 用户偏好先看结论" ||
		memoryContext["memory_ref"] != "projection://runs/run-primary-agent-001/memory/recall" {
		t.Fatalf("memory_context = %#v", memoryContext)
	}
}
