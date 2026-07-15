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
)

func TestExecutionRunStepsAgentRuntimeEvalProjectionDerivesRAGAndMemoryFromRuntimePayloads(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Now().UTC()
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-derived-eval",
		"conv-temporal-derived-eval",
		now,
		ragHandoffForDurableWorkerTest("国家奖学金申请需要满足什么基本条件"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-eval",
		execution.DurableRunStatusAdmitted,
		"",
		now,
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-eval",
		execution.DurableRunStatusRunning,
		"",
		now,
	); err != nil {
		t.Fatalf("start run: %v", err)
	}
	run, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-eval",
		execution.DurableRunStatusCompleted,
		execution.DurableTerminalReasonAnswerCompleted,
		now,
	)
	if err != nil {
		t.Fatalf("complete run: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "agent.primary:result:1",
		StepID:               "agent.primary",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "agent.primary", 1),
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/agent/primary/result",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
			"context_usage": map[string]any{
				"memory_recall_state":                 "completed",
				"previous_tool_result_count":          float64(1),
				"previous_evidence_count":             float64(1),
				"previous_evidence_source_hash_count": float64(1),
			},
			"selected_tools": []any{"knowledge_query"},
			"tool_results": []any{
				map[string]any{
					"arguments_json_sha256":    "sha256:args",
					"arguments_schema_sha256":  "sha256:schema",
					"arguments_schema_version": "knowledge_search.args.v1",
					"payload_kind":             "knowledge_search",
					"result": map[string]any{
						"outcome":          "found",
						"retrieval_target": "student_rules",
						"include_history":  false,
					},
					"result_ref": "projection://runs/run-temporal-derived-eval/knowledge/search/1",
					"status":     "completed",
					"tool_name":  "knowledge_search",
				},
			},
		},
	}); err != nil {
		t.Fatalf("upsert agent result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "knowledge.search.1:result:1",
		StepID:               "knowledge.search.1",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "knowledge.search.1", 1),
		Status:               "completed",
		ResultKind:           "knowledge_search_result",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/knowledge/search/1",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
			"evidence": []any{
				map[string]any{
					"document_id": "handbook:scholarship-policy",
					"snippet":     "国家奖学金评审需要满足学习成绩和综合测评要求。",
				},
			},
			"evidence_refs":    []any{"evidence://student-rules/scholarship"},
			"include_history":  false,
			"invocation_id":    "search-1",
			"outcome":          "found",
			"retrieval_target": "student_rules",
			"search_ordinal":   1,
		},
	}); err != nil {
		t.Fatalf("upsert knowledge search result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "finalization.write:result:1",
		StepID:               "finalization.write",
		RunID:                run.RunID,
		AttemptID:            "finalization.write:attempt:1",
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/finalization/write",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"finalized_response": map[string]any{
				"answer_text": "学习成绩、综合测评和奖励标准都需要满足。",
				"result": map[string]any{
					"sources": []any{
						map[string]any{
							"canonical_url": "https://example.edu/rules/scholarship",
							"source_body":   "must not leak",
							"source_kind":   "regulation",
							"source_title":  "本科生国家奖学金评审办法",
							"target_kind":   "public_web_url",
						},
					},
				},
			},
		},
	}); err != nil {
		t.Fatalf("upsert finalization result: %v", err)
	}

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/runs/run-temporal-derived-eval/steps",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	evalProjection := expectRecord(t, body["agent_runtime_eval_projection"], "agent_runtime_eval_projection")
	rag := expectRecord(t, evalProjection["rag"], "agent_runtime_eval_projection.rag")
	if titles, _ := rag["source_titles"].([]any); len(titles) != 1 || titles[0] != "本科生国家奖学金评审办法" {
		t.Fatalf("rag.source_titles = %#v", rag["source_titles"])
	}
	if rag["answer"] != "学习成绩、综合测评和奖励标准都需要满足。" {
		t.Fatalf("rag.answer = %#v", rag["answer"])
	}
	contexts, _ := rag["retrieved_contexts"].([]any)
	if len(contexts) != 1 || contexts[0] != "国家奖学金评审需要满足学习成绩和综合测评要求。" {
		t.Fatalf("rag.retrieved_contexts = %#v", rag["retrieved_contexts"])
	}
	contextIDs, _ := rag["retrieved_context_ids"].([]any)
	if len(contextIDs) != 1 || contextIDs[0] != "handbook:scholarship-policy" {
		t.Fatalf("rag.retrieved_context_ids = %#v", rag["retrieved_context_ids"])
	}
	planning := expectRecord(t, evalProjection["planning"], "agent_runtime_eval_projection.planning")
	resolvedTargets, _ := planning["resolved_targets"].([]any)
	if len(resolvedTargets) != 1 || resolvedTargets[0] != "student_rules" {
		t.Fatalf("planning.resolved_targets = %#v", planning["resolved_targets"])
	}
	searchSequence, _ := planning["search_sequence"].([]any)
	if len(searchSequence) != 1 {
		t.Fatalf("planning.search_sequence = %#v", planning["search_sequence"])
	}
	search := expectRecord(t, searchSequence[0], "planning.search_sequence[0]")
	searchArgs := expectRecord(t, search["eval_safe_args"], "planning.search_sequence[0].eval_safe_args")
	if search["search_ordinal"] != float64(1) ||
		searchArgs["target"] != "student_rules" || searchArgs["include_history"] != false {
		t.Fatalf("planning search = %#v", search)
	}
	if steps, _ := planning["planned_steps"].([]any); len(steps) != 3 ||
		steps[0] != "agent.primary" || steps[1] != "knowledge.search" || steps[2] != "finalization.write" {
		t.Fatalf("planning.planned_steps = %#v", planning["planned_steps"])
	}
	memory := expectRecord(t, evalProjection["memory"], "agent_runtime_eval_projection.memory")
	if memory["behavior"] != "previous_evidence_reuse" {
		t.Fatalf("memory.behavior = %#v", memory["behavior"])
	}
	observedTokens, _ := memory["observed_tokens"].([]any)
	if len(observedTokens) != 2 || observedTokens[0] != "previous_evidence_ref" || observedTokens[1] != "source_hash" {
		t.Fatalf("memory.observed_tokens = %#v", memory["observed_tokens"])
	}
	if strings.Contains(response.Body.String(), "must not leak") ||
		strings.Contains(response.Body.String(), "source_body") {
		t.Fatalf("derived eval projection leaked forbidden source body: %s", response.Body.String())
	}
}

func TestExecutionRunStepsAgentRuntimeEvalProjectionDerivesHistorySearchIntent(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Now().UTC()
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-derived-history-eval",
		"conv-temporal-derived-history-eval",
		now,
		ragHandoffForDurableWorkerTest("2024 年 9 月时学生公寓管理规则是什么"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-history-eval",
		execution.DurableRunStatusAdmitted,
		"",
		now,
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-history-eval",
		execution.DurableRunStatusRunning,
		"",
		now,
	); err != nil {
		t.Fatalf("start run: %v", err)
	}
	run, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-history-eval",
		execution.DurableRunStatusCompleted,
		execution.DurableTerminalReasonAnswerCompleted,
		now,
	)
	if err != nil {
		t.Fatalf("complete run: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "agent.primary:result:1",
		StepID:               "agent.primary",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "agent.primary", 1),
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        "projection://runs/run-temporal-derived-history-eval/agent/primary/result",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
			"selected_tools":   []any{"knowledge_query"},
		},
	}); err != nil {
		t.Fatalf("upsert agent result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "knowledge.search.1:result:1",
		StepID:               "knowledge.search.1",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "knowledge.search.1", 1),
		Status:               "completed",
		ResultKind:           "knowledge_search_result",
		ProjectionRef:        "projection://runs/run-temporal-derived-history-eval/knowledge/search/1",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
			"include_history":  true,
			"invocation_id":    "search-history-1",
			"outcome":          "found",
			"retrieval_target": "student_rules",
			"search_ordinal":   1,
		},
	}); err != nil {
		t.Fatalf("upsert knowledge search result: %v", err)
	}

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/runs/run-temporal-derived-history-eval/steps",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	evalProjection := expectRecord(t, body["agent_runtime_eval_projection"], "agent_runtime_eval_projection")
	planning := expectRecord(t, evalProjection["planning"], "agent_runtime_eval_projection.planning")
	searchSequence, _ := planning["search_sequence"].([]any)
	if len(searchSequence) != 1 {
		t.Fatalf("planning.search_sequence = %#v", planning["search_sequence"])
	}
	search := expectRecord(t, searchSequence[0], "planning.search_sequence[0]")
	searchArgs := expectRecord(t, search["eval_safe_args"], "planning.search_sequence[0].eval_safe_args")
	if searchArgs["target"] != "student_rules" || searchArgs["include_history"] != true {
		t.Fatalf("planning history search = %#v", search)
	}
	steps, _ := planning["planned_steps"].([]any)
	if len(steps) != 2 || steps[0] != "agent.primary" || steps[1] != "knowledge.search" {
		t.Fatalf("planning.planned_steps = %#v", planning["planned_steps"])
	}
}

func TestExecutionRunStepsAgentRuntimeEvalProjectionDerivesSanitizedHindsightMemorySignals(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Now().UTC()
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-memory-derived-eval",
		"conv-temporal-memory-derived-eval",
		now,
		ragHandoffForDurableWorkerTest("我之前关注哪个校区的培养方案？"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		"run-temporal-memory-derived-eval",
		execution.DurableRunStatusAdmitted,
		"",
		now,
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-temporal-memory-derived-eval",
		execution.DurableRunStatusRunning,
		"",
		now,
	); err != nil {
		t.Fatalf("start run: %v", err)
	}
	run, err := store.TransitionRun(
		context.Background(),
		"run-temporal-memory-derived-eval",
		execution.DurableRunStatusCompleted,
		execution.DurableTerminalReasonAnswerCompleted,
		now,
	)
	if err != nil {
		t.Fatalf("complete run: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "memory.recall:result:1",
		StepID:               "memory.recall",
		RunID:                run.RunID,
		AttemptID:            "memory.recall:attempt:1",
		Status:               "completed",
		ResultKind:           "memory_recall_result",
		ProjectionRef:        "projection://runs/run-temporal-memory-derived-eval/memory/recall",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"context_block":         "must not leak raw memory text",
			"memory_ref":            "projection://runs/run-temporal-memory-derived-eval/memory/recall",
			"operation_id":          "op-must-not-leak",
			"runtime_document_ref":  "doc-must-not-leak",
			"schema_version":        "memory_recall_result_v1",
			"selected_memory_chars": float64(42),
			"selected_memory_count": float64(2),
			"status":                "completed",
		},
	}); err != nil {
		t.Fatalf("upsert memory recall result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "memory.reflect:result:1",
		StepID:               "memory.reflect",
		RunID:                run.RunID,
		AttemptID:            "memory.reflect:attempt:1",
		Status:               "completed",
		ResultKind:           "memory_reflect_result",
		ProjectionRef:        "projection://runs/run-temporal-memory-derived-eval/memory/reflect",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"based_on_memory_context_items": []any{
				map[string]any{
					"compact_text": "must not leak compact text",
					"memory_id":    "memory-id-must-not-leak",
					"memory_type":  "fact",
					"tool":         "knowledge_query",
				},
			},
			"operation_id":   "reflect-op-must-not-leak",
			"reflect_ref":    "projection://runs/run-temporal-memory-derived-eval/memory/reflect",
			"schema_version": "memory_reflect_result_v1",
			"status":         "completed",
			"text":           "must not leak reflection text",
		},
	}); err != nil {
		t.Fatalf("upsert memory reflect result: %v", err)
	}

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/runs/run-temporal-memory-derived-eval/steps",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	evalProjection := expectRecord(t, body["agent_runtime_eval_projection"], "agent_runtime_eval_projection")
	memory := expectRecord(t, evalProjection["memory"], "agent_runtime_eval_projection.memory")
	if memory["behavior"] != "personal_memory_recall" {
		t.Fatalf("memory.behavior = %#v", memory["behavior"])
	}
	if memory["recall_status"] != "completed" || intFromProjection(memory["selected_memory_count"]) != 2 ||
		intFromProjection(memory["selected_memory_chars"]) != 42 {
		t.Fatalf("memory recall summary = %#v", memory)
	}
	if memory["reflect_status"] != "completed" || intFromProjection(memory["reflect_based_on_count"]) != 1 {
		t.Fatalf("memory reflect summary = %#v", memory)
	}
	observedTokens, _ := memory["observed_tokens"].([]any)
	if len(observedTokens) != 4 ||
		observedTokens[0] != "memory_recall" ||
		observedTokens[1] != "selected_memory" ||
		observedTokens[2] != "memory_reflect" ||
		observedTokens[3] != "reflect_based_on_facts" {
		t.Fatalf("memory.observed_tokens = %#v", memory["observed_tokens"])
	}
	memoryProjection, err := json.Marshal(memory)
	if err != nil {
		t.Fatalf("marshal memory projection: %v", err)
	}
	for _, forbidden := range []string{
		"must not leak raw memory text",
		"op-must-not-leak",
		"doc-must-not-leak",
		"must not leak compact text",
		"memory-id-must-not-leak",
		"reflect-op-must-not-leak",
		"must not leak reflection text",
	} {
		if strings.Contains(string(memoryProjection), forbidden) {
			t.Fatalf("derived eval projection leaked forbidden memory payload %q: %s", forbidden, string(memoryProjection))
		}
	}
}
