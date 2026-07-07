package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityProjectsKnowledgeQueryArgumentsIntoExecutionPayload(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 45, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-knowledge-args",
		"conv-primary-agent-knowledge-args",
		now,
		ragHandoffForDurableWorkerTest("最近学校官网有什么招生新闻？"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-knowledge-args",
			"final_output":         "",
			"provider_response_id": "resp-primary-agent-knowledge-args",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-knowledge-args",
			"selected_tools":       []string{"knowledge_query"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "knowledge_query",
				"tool":         "knowledge_query",
				"payload_kind": "knowledge_query",
				"arguments_json": map[string]any{
					"query_text":       "最近学校官网有什么招生新闻？",
					"intent":           "answer_question",
					"requested_scope":  map[string]any{"corpus": "official_web", "collection": "fresh_news"},
					"query_mode":       "freshness_sensitive",
					"version_query":    map[string]any{"mode": "freshness_sensitive", "as_of": nil, "version_id": nil, "compare_to_version_id": nil},
					"freshness_intent": "latest",
					"constraints":      map[string]any{"max_age_hours": float64(48), "official_sources_only": true},
				},
				"result_ref": "agent-runtime://run-primary-agent-knowledge-args/tools/knowledge_query",
				"result":     map[string]any{"workflow_signal": "knowledge_query"},
			}},
			"terminal_reason": "tool_selected",
			"usage": map[string]any{
				"input_tokens":             18,
				"output_tokens":            4,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 19,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:knowledge-args",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:            "run-primary-agent-knowledge-args",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-knowledge-args",
		VisibleToolNames: []string{"knowledge_query"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-primary-agent-knowledge-args")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	payload := expectMetadataMapForTest(t, run.Metadata["execution_payload"], "execution_payload")
	if payload["user_goal"] != "最近学校官网有什么招生新闻？" {
		t.Fatalf("user_goal = %v", payload["user_goal"])
	}
	scope := expectMetadataMapForTest(t, payload["requested_scope"], "requested_scope")
	if scope["corpus"] != "official_web" || scope["collection"] != "fresh_news" {
		t.Fatalf("requested_scope = %#v, want official_web/fresh_news", scope)
	}
	if payload["intent"] != "answer_question" {
		t.Fatalf("intent = %v, want answer_question", payload["intent"])
	}
	if payload["query_mode"] != "freshness_sensitive" {
		t.Fatalf("query_mode = %v, want freshness_sensitive", payload["query_mode"])
	}
	versionQuery := expectMetadataMapForTest(t, payload["version_query"], "version_query")
	if versionQuery["mode"] != "freshness_sensitive" {
		t.Fatalf("version_query.mode = %v, want freshness_sensitive", versionQuery["mode"])
	}
	if payload["freshness_intent"] != "latest" {
		t.Fatalf("freshness_intent = %v, want latest", payload["freshness_intent"])
	}
	projectedConstraints := expectMetadataMapForTest(t, payload["constraints"], "constraints")
	if projectedConstraints["max_age_hours"] != float64(48) {
		t.Fatalf("projected constraints = %#v, want max_age_hours 48", projectedConstraints)
	}
	knowledgeArgs := expectMetadataMapForTest(t, payload["knowledge_query_args"], "knowledge_query_args")
	constraints := expectMetadataMapForTest(t, knowledgeArgs["constraints"], "knowledge_query_args.constraints")
	if constraints["max_age_hours"] != float64(48) {
		t.Fatalf("constraints = %#v, want max_age_hours 48", constraints)
	}
}

func TestExecutePrimaryAgentActivityRejectsKnowledgeQueryArgumentsMissingStructuredFields(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 5, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-knowledge-args-invalid",
		"conv-primary-agent-knowledge-args-invalid",
		now,
		ragHandoffForDurableWorkerTest("最近学校官网有什么招生新闻？"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-knowledge-args-invalid",
			"final_output":         "",
			"provider_response_id": "resp-primary-agent-knowledge-args-invalid",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-knowledge-args-invalid",
			"selected_tools":       []string{"knowledge_query"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "knowledge_query",
				"tool":         "knowledge_query",
				"payload_kind": "knowledge_query",
				"arguments_json": map[string]any{
					"query_text": "最近学校官网有什么招生新闻？",
					"intent":     "answer_question",
				},
				"result_ref": "agent-runtime://run-primary-agent-knowledge-args-invalid/tools/knowledge_query",
				"result":     map[string]any{"workflow_signal": "knowledge_query"},
			}},
			"terminal_reason": "tool_selected",
			"usage": map[string]any{
				"input_tokens":  18,
				"output_tokens": 4,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:knowledge-args-invalid",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:            "run-primary-agent-knowledge-args-invalid",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-knowledge-args-invalid",
		VisibleToolNames: []string{"knowledge_query"},
	})
	if err == nil {
		t.Fatal("execute primary agent accepted incomplete knowledge_query arguments")
	}
	if !strings.Contains(err.Error(), "fail_close_reason=schema_contract_drift") {
		t.Fatalf("error = %q, want schema_contract_drift fail close", err.Error())
	}
	attempts, listErr := store.ListStepAttempts(context.Background(), "run-primary-agent-knowledge-args-invalid")
	if listErr != nil {
		t.Fatalf("list attempts: %v", listErr)
	}
	var toolAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "sdk_tool.execute.knowledge_query.1" {
			toolAttempt = &attempts[index]
			break
		}
	}
	if toolAttempt == nil {
		t.Fatalf("knowledge_query failure attempt missing: %#v", attempts)
		return
	}
	if toolAttempt.Status != "failed" ||
		toolAttempt.FailCloseReason != "schema_contract_drift" {
		t.Fatalf("tool attempt = %#v, want failed schema_contract_drift", toolAttempt)
	}
	if !strings.Contains(stringValue(toolAttempt.SanitizedPayload["argument_validation"]), "requested_scope") {
		t.Fatalf("tool attempt payload = %#v, want missing requested_scope validation", toolAttempt.SanitizedPayload)
	}
}
