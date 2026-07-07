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
		AttemptID:            "agent.primary:attempt:1",
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/agent/primary/result",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"context_usage": map[string]any{
				"memory_recall_state":                 "completed",
				"previous_tool_result_count":          float64(1),
				"previous_evidence_count":             float64(1),
				"previous_evidence_source_hash_count": float64(1),
			},
			"selected_tools": []any{"knowledge_query"},
		},
	}); err != nil {
		t.Fatalf("upsert agent result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "rag.plan:result:1",
		StepID:               "rag.plan",
		RunID:                run.RunID,
		AttemptID:            "rag.plan:attempt:1",
		Status:               "completed",
		ResultKind:           "rag_plan",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/rag/plan",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"collection_alias": "student_rules",
			"query_mode":       "current",
			"steps": []any{
				map[string]any{"stage": "indexed_lookup"},
				map[string]any{"stage": "supporting_evidence_selection"},
			},
		},
	}); err != nil {
		t.Fatalf("upsert rag plan result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "retrieval.indexed_lookup:result:1",
		StepID:               "retrieval.indexed_lookup",
		RunID:                run.RunID,
		AttemptID:            "retrieval.indexed_lookup:attempt:1",
		Status:               "completed",
		ResultKind:           "retrieval_result",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/retrieval/indexed-lookup",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{},
	}); err != nil {
		t.Fatalf("upsert indexed lookup result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "evidence.selection:result:1",
		StepID:               "evidence.selection",
		RunID:                run.RunID,
		AttemptID:            "evidence.selection:attempt:1",
		Status:               "completed",
		ResultKind:           "evidence_selection",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/evidence/selection",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{},
	}); err != nil {
		t.Fatalf("upsert evidence selection result: %v", err)
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
					"evidence": map[string]any{
						"sources": []any{
							map[string]any{
								"source_title": "本科生国家奖学金评审办法",
								"source_body":  "must not leak",
							},
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
	planning := expectRecord(t, evalProjection["planning"], "agent_runtime_eval_projection.planning")
	if steps, _ := planning["planned_steps"].([]any); len(steps) != 2 ||
		steps[0] != "indexed_lookup" || steps[1] != "supporting_evidence_selection" {
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

func TestExecutionRunStepsAgentRuntimeEvalProjectionDerivesNonCurrentPlanningTokens(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Now().UTC()
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-derived-as-of-eval",
		"conv-temporal-derived-as-of-eval",
		now,
		ragHandoffForDurableWorkerTest("2024 年 9 月时学生公寓管理规则是什么"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-as-of-eval",
		execution.DurableRunStatusAdmitted,
		"",
		now,
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-as-of-eval",
		execution.DurableRunStatusRunning,
		"",
		now,
	); err != nil {
		t.Fatalf("start run: %v", err)
	}
	run, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-as-of-eval",
		execution.DurableRunStatusCompleted,
		execution.DurableTerminalReasonAnswerCompleted,
		now,
	)
	if err != nil {
		t.Fatalf("complete run: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "rag.plan:result:1",
		StepID:               "rag.plan",
		RunID:                run.RunID,
		AttemptID:            "rag.plan:attempt:1",
		Status:               "completed",
		ResultKind:           "rag_plan",
		ProjectionRef:        "projection://runs/run-temporal-derived-as-of-eval/rag/plan",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"collection_alias": "student_rules",
			"query_mode":       "as_of",
			"version_query": map[string]any{
				"as_of": "2024-09",
			},
		},
	}); err != nil {
		t.Fatalf("upsert rag plan result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "retrieval.indexed_lookup:result:1",
		StepID:               "retrieval.indexed_lookup",
		RunID:                run.RunID,
		AttemptID:            "retrieval.indexed_lookup:attempt:1",
		Status:               "completed",
		ResultKind:           "retrieval_result",
		ProjectionRef:        "projection://runs/run-temporal-derived-as-of-eval/retrieval/indexed-lookup",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{},
	}); err != nil {
		t.Fatalf("upsert indexed lookup result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "evidence.selection:result:1",
		StepID:               "evidence.selection",
		RunID:                run.RunID,
		AttemptID:            "evidence.selection:attempt:1",
		Status:               "completed",
		ResultKind:           "evidence_selection",
		ProjectionRef:        "projection://runs/run-temporal-derived-as-of-eval/evidence/selection",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{},
	}); err != nil {
		t.Fatalf("upsert evidence selection result: %v", err)
	}

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/runs/run-temporal-derived-as-of-eval/steps",
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
	if planning["freshness_branch"] != "as_of" {
		t.Fatalf("planning.freshness_branch = %#v", planning["freshness_branch"])
	}
	decomposition, _ := planning["decomposition"].([]any)
	if len(decomposition) != 2 || decomposition[0] != "student_rules" || decomposition[1] != "as_of:2024-09" {
		t.Fatalf("planning.decomposition = %#v", planning["decomposition"])
	}
	for _, token := range decomposition {
		if token == "current_policy" {
			t.Fatalf("planning.decomposition must not mark as_of as current: %#v", decomposition)
		}
	}
	steps, _ := planning["planned_steps"].([]any)
	if len(steps) != 2 || steps[0] != "indexed_lookup" || steps[1] != "supporting_evidence_selection" {
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
