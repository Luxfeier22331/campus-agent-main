package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

type fakeKnowledgeSearchExecutor struct {
	request retrievalruntime.SearchRequest
	result  retrievalruntime.SearchResult
	err     error
}

func (f *fakeKnowledgeSearchExecutor) HealthCheck(context.Context) error { return f.err }

func (f *fakeKnowledgeSearchExecutor) Search(
	_ context.Context,
	request retrievalruntime.SearchRequest,
) (retrievalruntime.SearchResult, error) {
	f.request = request
	return f.result, f.err
}

func TestKnowledgeSearchHandlerUsesRunBoundScopeAndProjectsEvidence(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newToolReadModelAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	executor := &fakeKnowledgeSearchExecutor{result: retrievalruntime.SearchResult{
		RunID:           "run-knowledge-search",
		InvocationID:    "call-search-1",
		ResolvedScope:   "curriculum",
		ResolvedVersion: retrievalruntime.ResolvedVersion{Mode: "current"},
		Evidence: []retrievalruntime.Evidence{
			{
				EvidenceRef:  "evidence://sha256/test",
				Title:        "计算机科学与技术专业培养方案",
				Snippet:      "毕业最低学分为 160 学分。",
				CanonicalURL: "https://example.edu/curriculum/2024",
				VersionID:    "2024",
			},
		},
	}}
	server.knowledgeSearchExecutor = executor
	server.knowledgeSearchErr = nil
	createKnowledgeSearchRun(t, store)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/knowledge/search",
		strings.NewReader(`{
			"payload":{"query_text":"毕业学分要求"},
			"access_context":{
				"run_id":"run-knowledge-search",
				"trace_id":"trace-knowledge-search",
				"invocation_id":"call-search-1",
				"knowledge_scope":"curriculum",
				"version_query":{"mode":"current","as_of":null,"version_id":null,"compare_to_version_id":null}
			}
		}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["outcome"] != "found" || body["resolved_scope"] != "curriculum" {
		t.Fatalf("body = %#v", body)
	}
	if executor.request.Scope != "curriculum" || executor.request.Corpus != "curriculum" || executor.request.Collection != "curriculum_plan" {
		t.Fatalf("search request scope = %#v", executor.request)
	}
	if executor.request.RetrievalAccess.VisibilityLevel != "public" {
		t.Fatalf("retrieval access = %#v", executor.request.RetrievalAccess)
	}
	steps, err := store.ListRunSteps(context.Background(), "run-knowledge-search")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 || steps[0].StepKind != "retrieval" {
		t.Fatalf("steps = %#v", steps)
	}
	results, err := store.ListStepResults(context.Background(), "run-knowledge-search")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	if len(results) != 1 || results[0].ResultKind != "knowledge_search_result" {
		t.Fatalf("results = %#v", results)
	}
}

func TestKnowledgeSearchHandlerRejectsTraceDriftBeforeSearch(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newToolReadModelAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	executor := &fakeKnowledgeSearchExecutor{}
	server.knowledgeSearchExecutor = executor
	server.knowledgeSearchErr = nil
	createKnowledgeSearchRun(t, store)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/knowledge/search",
		strings.NewReader(`{
			"payload":{"query_text":"毕业学分要求"},
			"access_context":{
				"run_id":"run-knowledge-search",
				"trace_id":"wrong-trace",
				"invocation_id":"call-search-1",
				"knowledge_scope":"curriculum",
				"version_query":{"mode":"current","as_of":null,"version_id":null,"compare_to_version_id":null}
			}
		}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body = %s", response.Code, response.Body.String())
	}
	if executor.request.RunID != "" {
		t.Fatalf("search must not execute on trace drift: %#v", executor.request)
	}
}

func createKnowledgeSearchRun(t *testing.T, store *execution.InMemoryRunProjectionStore) {
	t.Helper()
	now := time.Date(2026, 7, 11, 8, 0, 0, 0, time.UTC)
	_, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          "run-knowledge-search",
		ConversationID: "conversation-knowledge-search",
		TurnID:         "turn-knowledge-search",
		RequestID:      "req-knowledge-search",
		TraceID:        "trace-knowledge-search",
		OwnerUserID:    "user-knowledge-search",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		Status:         execution.DurableRunStatusRunning,
		CreatedAt:      now,
		QueuedAt:       now,
		AdmittedAt:     now,
		StartedAt:      now,
		UpdatedAt:      now,
		Metadata: map[string]any{
			"execution_payload": map[string]any{
				"user_goal": "毕业学分要求",
				"context": map[string]any{
					"authorization": map[string]any{
						"retrieval_filter": map[string]any{
							"policy_projection_version": "retrieval-access-v1",
							"visibility_level":          "public",
							"visibility_scope":          "",
							"entitlement_groups":        []any{},
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
}
