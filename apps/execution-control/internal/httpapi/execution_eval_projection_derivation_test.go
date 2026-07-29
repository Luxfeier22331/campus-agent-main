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
		agentRequestForDurableWorkerTest("国家奖学金申请需要满足什么基本条件"),
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
	run, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-eval",
		execution.DurableRunStatusRunning,
		"",
		now,
	)
	if err != nil {
		t.Fatalf("start run: %v", err)
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
		},
	}); err != nil {
		t.Fatalf("upsert agent result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "grounding.prepare:result:1",
		StepID:               "grounding.prepare",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "grounding.prepare", 1),
		Status:               "completed",
		ResultKind:           "grounding_context",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/grounding/context",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
			"covered_scopes":   []string{"student_rules"},
			"evidence_count":   1,
			"grounding_mode":   "single_scope",
			"selected_scopes":  []string{"student_rules"},
			"status":           "ready",
			"token_count":      64,
		},
	}); err != nil {
		t.Fatalf("upsert SDK tool result: %v", err)
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
							"document_id":   "handbook:scholarship-policy",
							"snippet":       "国家奖学金评审需要满足学习成绩和综合测评要求。",
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
	if rag["grounding_mode"] != "single_scope" || rag["grounding_status"] != "ready" ||
		!equalStringSlices(stringSliceFromAny(rag["selected_scopes"]), []string{"student_rules"}) ||
		!equalStringSlices(stringSliceFromAny(rag["covered_scopes"]), []string{"student_rules"}) {
		t.Fatalf("rag grounding route = %#v", rag)
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
	toolSequence, _ := planning["tool_sequence"].([]any)
	if len(toolSequence) != 0 {
		t.Fatalf("grounding must not appear as a model tool: %#v", planning["tool_sequence"])
	}
	if steps, _ := planning["planned_steps"].([]any); len(steps) != 3 ||
		steps[0] != "grounding.prepare" || steps[1] != "agent.primary" || steps[2] != "finalization.write" {
		t.Fatalf("planning.planned_steps = %#v", planning["planned_steps"])
	}
	memory := expectRecord(t, evalProjection["memory"], "agent_runtime_eval_projection.memory")
	if len(memory) != 0 {
		t.Fatalf("memory projection inferred retired evidence reuse: %#v", memory)
	}
	if strings.Contains(response.Body.String(), "must not leak") ||
		strings.Contains(response.Body.String(), "source_body") {
		t.Fatalf("derived eval projection leaked forbidden source body: %s", response.Body.String())
	}
}

func TestProjectedEvalDirectRouteDoesNotRequireGroundingStep(t *testing.T) {
	results := []execution.StepResultProjection{
		{
			StepID: "agent.primary",
			Status: "completed",
			SanitizedPayload: map[string]any{
				"grounding_mode":            "none",
				"grounding_status":          "not_required",
				"grounding_selected_scopes": []string{},
				"grounding_covered_scopes":  []string{},
			},
		},
		{StepID: "finalization.write", Status: "completed"},
	}
	planning := projectedPlanningForEval(results)
	steps := stringSliceFromAny(planning["planned_steps"])
	if !equalStringSlices(steps, []string{"agent.primary", "finalization.write"}) {
		t.Fatalf("direct planned steps = %#v", steps)
	}
	rag := projectedRAGForEval(results)
	if rag["grounding_mode"] != "none" || rag["grounding_status"] != "not_required" ||
		len(stringSliceFromAny(rag["selected_scopes"])) != 0 ||
		len(stringSliceFromAny(rag["covered_scopes"])) != 0 {
		t.Fatalf("direct grounding projection = %#v", rag)
	}
}

func TestExecutionRunStepsAgentRuntimeEvalProjectionKeepsGroundingOutOfToolTrajectory(t *testing.T) {
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
		agentRequestForDurableWorkerTest("2024 年 9 月时学生公寓管理规则是什么"),
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
	run, err := store.TransitionRun(
		context.Background(),
		"run-temporal-derived-history-eval",
		execution.DurableRunStatusRunning,
		"",
		now,
	)
	if err != nil {
		t.Fatalf("start run: %v", err)
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
		},
	}); err != nil {
		t.Fatalf("upsert agent result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "grounding.prepare:result:1",
		StepID:               "grounding.prepare",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "grounding.prepare", 1),
		Status:               "completed",
		ResultKind:           "grounding_context",
		ProjectionRef:        "projection://runs/run-temporal-derived-history-eval/grounding/context",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
			"evidence_count":   1,
			"status":           "ready",
			"token_count":      32,
		},
	}); err != nil {
		t.Fatalf("upsert grounding result: %v", err)
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
	toolSequence, _ := planning["tool_sequence"].([]any)
	if len(toolSequence) != 0 {
		t.Fatalf("grounding must not appear as a model tool: %#v", planning["tool_sequence"])
	}
	steps, _ := planning["planned_steps"].([]any)
	if len(steps) != 2 || steps[0] != "grounding.prepare" || steps[1] != "agent.primary" {
		t.Fatalf("planning.planned_steps = %#v", planning["planned_steps"])
	}
}

func TestExecutionRunStepsAgentRuntimeEvalProjectionDerivesSanitizedPersonalMemoryToolSignals(t *testing.T) {
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
		agentRequestForDurableWorkerTest("我之前关注哪个校区的培养方案？"),
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
	run, err := store.TransitionRun(
		context.Background(),
		"run-temporal-memory-derived-eval",
		execution.DurableRunStatusRunning,
		"",
		now,
	)
	if err != nil {
		t.Fatalf("start run: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             temporalStepResultID(run.RunID, "agent.primary", 1),
		StepID:               "agent.primary",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "agent.primary", 1),
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        "projection://runs/run-temporal-memory-derived-eval/agent/primary/result",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
		},
	}); err != nil {
		t.Fatalf("upsert primary agent result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             temporalStepResultID(run.RunID, "sdk_tool.execute.personal_memory_recall.1", 1),
		StepID:               "sdk_tool.execute.personal_memory_recall.1",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "sdk_tool.execute.personal_memory_recall.1", 1),
		Status:               "completed",
		ResultKind:           "typed_tool_result",
		ProjectionRef:        "projection://runs/run-temporal-memory-derived-eval/sdk-tools/personal_memory_recall/1",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"arguments_json_sha256": "sha256:memory-query",
			"outcome":               "matched",
			"result_sha256":         "sha256:memory-result",
			"runtime_surface":       "openai_agents_sdk_tool",
			"sdk_result_ref":        "agent-runtime://run-temporal-memory-derived-eval/tools/personal_memory_recall/1",
			"tool_name":             "personal_memory_recall",
			"tool_status":           "completed",
		},
	}); err != nil {
		t.Fatalf("upsert personal memory tool result: %v", err)
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
	if memory["recall_status"] != "completed" || memory["recall_outcome"] != "matched" {
		t.Fatalf("memory recall summary = %#v", memory)
	}
	if _, exists := memory["selected_memory_count"]; exists {
		t.Fatalf("memory eval projection must not recreate retired selection counts: %#v", memory)
	}
	observedTokens, _ := memory["observed_tokens"].([]any)
	if len(observedTokens) != 2 ||
		observedTokens[0] != "memory_recall" ||
		observedTokens[1] != "selected_memory" {
		t.Fatalf("memory.observed_tokens = %#v", memory["observed_tokens"])
	}
	memoryProjection, err := json.Marshal(memory)
	if err != nil {
		t.Fatalf("marshal memory projection: %v", err)
	}
	for _, forbidden := range []string{
		"agent-runtime://run-temporal-memory-derived-eval/tools/personal_memory_recall/1",
		"sha256:memory-query",
		"sha256:memory-result",
	} {
		if strings.Contains(string(memoryProjection), forbidden) {
			t.Fatalf("derived eval projection leaked forbidden memory payload %q: %s", forbidden, string(memoryProjection))
		}
	}
}
