package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestProviderBackedRAGSynthesisExecutorBuildsSummaryAndAnswer(t *testing.T) {
	var synthesisPayload map[string]any
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
		if body["max_output_tokens"] != float64(900) {
			t.Fatalf("max_output_tokens = %#v, want 900", body["max_output_tokens"])
		}
		if store, ok := body["store"].(bool); !ok || store {
			t.Fatalf("store = %#v, want false", body["store"])
		}
		reasoning, ok := body["reasoning"].(map[string]any)
		if !ok || reasoning["effort"] != "low" {
			t.Fatalf("reasoning = %#v, want low effort", body["reasoning"])
		}
		text, ok := body["text"].(map[string]any)
		if !ok || text["verbosity"] != "low" {
			t.Fatalf("text = %#v, want low verbosity", body["text"])
		}
		input, ok := body["input"].([]any)
		if !ok || len(input) != 2 {
			t.Fatalf("input = %#v, want two messages", body["input"])
		}
		userMessage, ok := input[1].(map[string]any)
		if !ok {
			t.Fatalf("user message = %#v, want object", input[1])
		}
		content, ok := userMessage["content"].(string)
		if !ok {
			t.Fatalf("user content = %#v, want string", userMessage["content"])
		}
		if err := json.Unmarshal([]byte(content), &synthesisPayload); err != nil {
			t.Fatalf("decode synthesis payload: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"id":"resp_rag_123",
			"model":"gpt-5-mini",
			"status":"completed",
			"output_parsed":{
				"answer_text":"学生应按学校规定办理请假手续。",
				"semantic_outcome":"answer_from_selected_evidence",
				"confidence":"high",
				"used_evidence_refs":["source://student_rules"],
				"grounding_notes":"The answer is grounded in the selected student handbook excerpt."
			},
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
	storeProviderOutput := false
	executor := providerBackedRAGSynthesisExecutor{
		configResolver: staticProviderConfigResolver{
			string(providerConfigRoleRAGSynthesis): {
				APIKey:    "test-key",
				BaseURL:   server.URL,
				Model:     "gpt-5-mini",
				ProfileID: "provider_profile_rag_synthesis",
				Provider:  "openai",
				Revision:  3,
				Role:      string(providerConfigRoleRAGSynthesis),
				TimeoutMS: 30000,
				Transport: "responses",
			},
		},
		generationControls: provider.ResponsesGenerationControls{
			MaxOutputTokens: 900,
			ReasoningEffort: "low",
			Store:           &storeProviderOutput,
			TextVerbosity:   "low",
		},
		pricing:        catalog,
		runtimeRelease: "execution-control@test",
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
			ChunkID:         "chunk-1",
			DocumentID:      "student_rules",
			Excerpt:         "学生应当按照学校规定办理请假手续。",
			IsCurrent:       true,
			RootUnitID:      "student_rules:root:leave",
			SourceChannel:   "official_web",
			SourceID:        "student_rules",
			SourceRef:       "source://student_rules",
			SourceTrustTier: "T1",
			SourceUnitKind:  "clause",
			SourceUnitKey:   "leave",
			SpanRef:         "span://student_rules/chunk-1#0-24",
			Title:           "学生手册",
			VersionID:       "student_rules:v-current",
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
	if result.Confidence != "high" || result.SemanticOutcome != "answer_from_selected_evidence" {
		t.Fatalf("structured synthesis result = %#v", result)
	}
	selected, ok := synthesisPayload["selected_evidence"].([]any)
	if !ok || len(selected) != 1 {
		t.Fatalf("selected evidence payload = %#v", synthesisPayload["selected_evidence"])
	}
	evidence, ok := selected[0].(map[string]any)
	if !ok {
		t.Fatalf("evidence payload = %#v", selected[0])
	}
	for field, want := range map[string]any{
		"document_id":       "student_rules",
		"version_id":        "student_rules:v-current",
		"root_unit_id":      "student_rules:root:leave",
		"source_channel":    "official_web",
		"source_trust_tier": "T1",
		"source_unit_kind":  "clause",
		"source_unit_key":   "leave",
		"is_current":        true,
	} {
		if evidence[field] != want {
			t.Fatalf("evidence[%s] = %#v, want %#v in provider payload: %#v", field, evidence[field], want, evidence)
		}
	}
	if result.PromptTrace["prompt_id"] != ragSynthesisPromptID ||
		result.PromptTrace["prompt_version"] != ragSynthesisPromptVersion {
		t.Fatalf("prompt trace = %#v", result.PromptTrace)
	}
	if result.LLMIOFingerprint["schema_version"] != "llm_io_fingerprint.v1" ||
		result.LLMIOFingerprint["prompt_id"] != ragSynthesisPromptID ||
		result.LLMIOFingerprint["output_schema_id"] != "rag_answer_v2" ||
		result.LLMIOFingerprint["runtime_release"] != "execution-control@test" {
		t.Fatalf("llm io fingerprint = %#v", result.LLMIOFingerprint)
	}
	modelParams := cloneAnyMapFromMetadata(result.LLMIOFingerprint["model_params_projection"])
	projectedParams := cloneAnyMapFromMetadata(modelParams["projected_params"])
	if projectedParams["max_output_tokens"] != 900 ||
		projectedParams["reasoning_effort"] != "low" ||
		projectedParams["store"] != false ||
		projectedParams["text_verbosity"] != "low" {
		t.Fatalf("projected model params = %#v", projectedParams)
	}
	for _, field := range []string{
		"model_params_hash",
		"prompt_template_sha256",
		"rendered_prompt_sha256",
		"context_envelope_sha256",
		"memory_selection_sha256",
		"evidence_packet_sha256",
	} {
		value, ok := result.LLMIOFingerprint[field].(string)
		if !ok || !validSHA256Ref(value) {
			t.Fatalf("llm io fingerprint %s = %#v, want sha256 ref", field, result.LLMIOFingerprint[field])
		}
	}
}

func TestProviderBackedRAGSynthesisExecutorFailsClosedWhenStructuredOutputMissingConfidence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"id":"resp_rag_missing_confidence",
			"model":"gpt-5-mini",
			"status":"completed",
			"output_parsed":{
				"answer_text":"学生应按学校规定办理请假手续。",
				"semantic_outcome":"answer_from_selected_evidence",
				"used_evidence_refs":["source://student_rules"],
				"grounding_notes":"The answer is grounded in selected evidence."
			}
		}`))
	}))
	defer server.Close()
	executor := providerBackedRAGSynthesisExecutor{
		clientFactory: func(providerConfigSnapshot) *provider.ResponsesClient {
			return provider.NewResponsesClient(provider.ResponsesClientConfig{
				APIKey:        "test-key",
				BaseURL:       server.URL,
				HTTPClient:    server.Client(),
				ModelName:     "gpt-5-mini",
				ModelProvider: "openai",
			})
		},
	}

	_, err := executor.ExecuteRAGSynthesis(context.Background(), validRAGSynthesisPacketForTest())
	if err == nil {
		t.Fatal("expected missing confidence to fail closed")
	}
}

func TestProviderBackedRAGSynthesisExecutorFailsClosedWhenEvidenceRefWasNotSelected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"id":"resp_rag_unknown_ref",
			"model":"gpt-5-mini",
			"status":"completed",
			"output_parsed":{
				"answer_text":"学生应按学校规定办理请假手续。",
				"semantic_outcome":"answer_from_selected_evidence",
				"confidence":"medium",
				"used_evidence_refs":["source://not-selected"],
				"grounding_notes":"The answer cites an unselected source."
			}
		}`))
	}))
	defer server.Close()
	executor := providerBackedRAGSynthesisExecutor{
		clientFactory: func(providerConfigSnapshot) *provider.ResponsesClient {
			return provider.NewResponsesClient(provider.ResponsesClientConfig{
				APIKey:        "test-key",
				BaseURL:       server.URL,
				HTTPClient:    server.Client(),
				ModelName:     "gpt-5-mini",
				ModelProvider: "openai",
			})
		},
	}

	_, err := executor.ExecuteRAGSynthesis(context.Background(), validRAGSynthesisPacketForTest())
	if err == nil {
		t.Fatal("expected unselected evidence ref to fail closed")
	}
}

func TestNewRAGSynthesisExecutorUsesProviderTimeout(t *testing.T) {
	executor, err := newRAGSynthesisExecutor(config.Config{
		ProviderPricingPath: writeRAGPricingCatalogForTest(t, `{
			"schema_version":"provider-pricing-v1",
			"currency":"USD",
			"models":[{
				"provider":"openai",
				"model":"gpt-5-mini",
				"input_microusd_per_1k_tokens":250,
				"cached_input_microusd_per_1k_tokens":25,
				"output_microusd_per_1k_tokens":2000
			}]
		}`),
		RAGProviderTimeoutMS:            4500,
		RAGSynthesisMaxOutputTokens:     900,
		RAGSynthesisReasoningEffort:     "low",
		RAGSynthesisStoreProviderOutput: false,
		RAGSynthesisTextVerbosity:       "low",
		RuntimeRelease:                  "execution-control@test",
	}, staticProviderConfigResolver{
		string(providerConfigRoleRAGSynthesis): {
			APIKey:    "test-key",
			BaseURL:   "https://provider.example/v1",
			Model:     "gpt-5-mini",
			ProfileID: "provider_profile_rag_synthesis",
			Provider:  "openai",
			Revision:  3,
			Role:      string(providerConfigRoleRAGSynthesis),
			TimeoutMS: 30000,
			Transport: "responses",
		},
	})
	if err != nil {
		t.Fatalf("new rag synthesis executor: %v", err)
	}
	providerExecutor, ok := executor.(providerBackedRAGSynthesisExecutor)
	if !ok {
		t.Fatalf("executor type = %T, want providerBackedRAGSynthesisExecutor", executor)
	}
	if providerExecutor.providerTimeout.String() != "4.5s" {
		t.Fatalf("provider timeout = %s, want 4.5s", providerExecutor.providerTimeout)
	}
	if providerExecutor.generationControls.MaxOutputTokens != 900 ||
		providerExecutor.generationControls.ReasoningEffort != "low" ||
		providerExecutor.generationControls.Store == nil ||
		*providerExecutor.generationControls.Store ||
		providerExecutor.generationControls.TextVerbosity != "low" {
		t.Fatalf("generation controls = %#v", providerExecutor.generationControls)
	}
	if providerExecutor.runtimeRelease != "execution-control@test" {
		t.Fatalf("runtime release = %q, want execution-control@test", providerExecutor.runtimeRelease)
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

func validRAGSynthesisPacketForTest() ragSynthesisPacket {
	return ragSynthesisPacket{
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
	}
}
