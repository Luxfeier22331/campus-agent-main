package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestQdrantPersonalMemoryResolveCandidateFiltersEmptyTenantExplicitly(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/collections/personal_memory_v1/points/scroll":
			if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
				t.Fatalf("decode scroll body: %v", err)
			}
		case "/collections/personal_memory_v1/points/query":
			var ignored map[string]any
			if err := json.NewDecoder(request.Body).Decode(&ignored); err != nil {
				t.Fatalf("decode query body: %v", err)
			}
		default:
			t.Fatalf("qdrant path = %q, want personal memory scroll or query", request.URL.Path)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"result": map[string]any{"points": []map[string]any{}},
		})
	}))
	defer server.Close()
	embedding := newStaticEmbeddingServer(t)
	executor := qdrantPersonalMemoryExecutor{
		collection:          "personal_memory_v1",
		configResolver:      memoryEmbeddingResolverForTest(embedding.URL, "embedding-model", 3),
		embeddingHTTPClient: embedding.Client(),
		httpClient:          server.Client(),
		qdrantQueryAPIKey:   "readonly-key",
		qdrantURL:           server.URL,
	}

	_, err := executor.ResolveCandidate(context.Background(), memoryruntime.ResolveCandidateRequest{
		Capability:       "any",
		CanonicalKey:     "goal:any:保研材料",
		CanonicalSubject: "保研材料",
		CompactText:      "近期目标: 关注保研材料",
		Confidence:       0.96,
		MemoryType:       "goal",
		ReasonCode:       "explicit_long_term_goal",
		SourceHash:       strings.Repeat("d", 64),
		UpdatedAt:        "2026-06-10T08:00:00Z",
		UserID:           "user_01",
	})
	if err != nil {
		t.Fatalf("resolve candidate: %v", err)
	}
	must := qdrantMustConditionsForTest(t, captured)
	assertQdrantMatchConditionForTest(t, must, "tenant_id", "")
}
