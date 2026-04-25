package httpapi

import "testing"

func TestFinalizeSpecialistBridgeResponseBuildsSupervisorEnvelope(t *testing.T) {
	response, err := finalizeSpecialistBridgeResponse(
		map[string]any{
			"target":      "rag-agent",
			"status":      "completed",
			"answer_text": "图书馆开放到 22:00。",
			"confidence":  "high",
			"result": map[string]any{
				"evidence": map[string]any{
					"sources": []any{
						map[string]any{"doc_id": "handbook:test-001"},
					},
				},
				"diagnostics": map[string]any{
					"retrieved_sources": []any{
						map[string]any{"doc_id": "handbook:test-001"},
					},
				},
			},
		},
		"trace-finalizer-1",
		"",
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	if response["selected_target"] != "rag-agent" {
		t.Fatalf("selected_target = %v, want rag-agent", response["selected_target"])
	}
	if response["status"] != "completed" {
		t.Fatalf("status = %v, want completed", response["status"])
	}
	if response["trace_id"] != "trace-finalizer-1" {
		t.Fatalf("trace_id = %v, want trace-finalizer-1", response["trace_id"])
	}
	observability, ok := response["observability"].(map[string]any)
	if !ok {
		t.Fatalf("observability = %#v, want object", response["observability"])
	}
	if observability["retrieval_attempted"] != true {
		t.Fatalf("retrieval_attempted = %v, want true", observability["retrieval_attempted"])
	}
	if observability["citation_count"] != 1 {
		t.Fatalf("citation_count = %v, want 1", observability["citation_count"])
	}
	if observability["semantic_outcome"] != "grounded_answer" {
		t.Fatalf("semantic_outcome = %v, want grounded_answer", observability["semantic_outcome"])
	}
}
