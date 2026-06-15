package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestProviderBackedRAGSynthesisExecutorBuildsSummaryAndAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("provider path = %q, want /responses", request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["model"] != "gpt-5-mini" {
			t.Fatalf("model = %v", body["model"])
		}
		input, ok := body["input"].([]any)
		if !ok || len(input) != 2 {
			t.Fatalf("input = %#v, want two messages", body["input"])
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"id":"resp_rag_123",
			"model":"gpt-5-mini",
			"output_parsed":{"answer_text":"学生应按学校规定办理请假手续。"},
			"usage":{
				"input_tokens":400,
				"output_tokens":100,
				"input_tokens_details":{"cached_tokens":20}
			}
		}`))
	}))
	defer server.Close()
	catalog, err := provider.LoadPricingCatalog(writeRAGPricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`))
	if err != nil {
		t.Fatalf("load pricing catalog: %v", err)
	}
	executor := providerBackedRAGSynthesisExecutor{
		clientFactory: func(providerConfigSnapshot) *provider.ResponsesClient {
			return provider.NewResponsesClient(provider.ResponsesClientConfig{
				APIKey:        "test-key",
				BaseURL:       server.URL,
				HTTPClient:    server.Client(),
				ModelName:     "gpt-5-mini",
				ModelProvider: "openai",
				Pricing:       catalog,
			})
		},
	}

	result, err := executor.ExecuteRAGSynthesis(context.Background(), ragSynthesisPacket{
		RunID:          "run-rag-provider",
		StepID:         "synthesis",
		RequestID:      "req-rag-provider",
		QueryIntent:    "policy_answer",
		OutputSchemaID: "rag_answer_v2",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		PromptRefs:     []string{"prompt://rag/rag_answer_v2"},
		SelectedEvidence: []ragruntime.EvidenceRef{{
			SourceID:  "student_rules",
			ChunkID:   "chunk-1",
			SpanRef:   "span://student_rules/chunk-1#0-24",
			Excerpt:   "学生应当按照学校规定办理请假手续。",
			SourceRef: "source://student_rules",
			Title:     "学生手册",
		}},
	})
	if err != nil {
		t.Fatalf("execute synthesis: %v", err)
	}
	if result.AnswerText != "学生应按学校规定办理请假手续。" {
		t.Fatalf("answer = %q", result.AnswerText)
	}
	if result.ProviderSummary.ProviderResponseID != "resp_rag_123" {
		t.Fatalf("provider response id = %q", result.ProviderSummary.ProviderResponseID)
	}
	if result.ProviderSummary.EstimatedCostMicroUSD != 296 {
		t.Fatalf("estimated cost = %d, want 296", result.ProviderSummary.EstimatedCostMicroUSD)
	}
}

func writeRAGPricingCatalogForTest(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "provider-pricing.v1.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write pricing catalog: %v", err)
	}
	return path
}
