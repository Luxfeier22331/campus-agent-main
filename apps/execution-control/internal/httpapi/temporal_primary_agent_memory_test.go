package httpapi

import "testing"

func assertPrimaryAgentMemoryContextForTest(t *testing.T, seenBody map[string]any) {
	t.Helper()
	if _, exists := seenBody["memory_context"]; exists {
		t.Fatalf("agent runtime request contains duplicate top-level memory_context: %#v", seenBody)
	}
	finalModelContext, ok := seenBody["final_model_context"].(map[string]any)
	if !ok {
		t.Fatalf("agent runtime request missing final_model_context: %#v", seenBody)
	}
	memoryContext, ok := finalModelContext["memory_context"].(map[string]any)
	if !ok {
		t.Fatalf("final_model_context missing memory_context: %#v", finalModelContext)
	}
	if memoryContext["context_block"] != "用户记忆:\n- 用户偏好先看结论" ||
		memoryContext["memory_ref"] != "projection://runs/run-primary-agent-001/memory/recall" {
		t.Fatalf("memory_context = %#v", memoryContext)
	}
	if _, exists := memoryContext["provider"]; exists {
		t.Fatalf("memory_context includes empty optional provider: %#v", memoryContext)
	}
	if _, exists := memoryContext["retrieval_mode"]; exists {
		t.Fatalf("memory_context includes empty optional retrieval_mode: %#v", memoryContext)
	}
}
