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
		ResultID:             "sdk_tool.execute.campus_search.1:result:1",
		StepID:               "sdk_tool.execute.campus_search.1",
		RunID:                run.RunID,
		AttemptID:            temporalStepAttemptID(run.RunID, "sdk_tool.execute.campus_search.1", 1),
		Status:               "completed",
		ResultKind:           "typed_tool_result",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/sdk-tools/campus_search/1",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"result": campusSearchResult([]campusSearchEvidence{
				{EvidenceRef: "evidence://" + strings.Repeat("a", 64), SourceKind: "document", DocumentID: "handbook:scholarship-policy", Title: "本科生国家奖学金评审办法", SectionRef: "/docs/regulations/student_rules/scholarship/v/2026-current#eligibility", SectionTitle: "申请条件", RootUnitIDs: []string{"scholarship-eligibility"}, VersionID: "version-scholarship-2026", VersionLabel: "2026 版", VersionSlug: "2026-current", Text: "国家奖学金评审需要满足学习成绩和综合测评要求。"},
				{EvidenceRef: "evidence://" + strings.Repeat("b", 64), SourceKind: "document", DocumentID: "handbook:scholarship-policy", Title: "本科生国家奖学金评审办法", SectionRef: "/docs/regulations/student_rules/scholarship/v/2026-current#award", SectionTitle: "奖励标准", RootUnitIDs: []string{"scholarship-award"}, VersionID: "version-scholarship-2026", VersionLabel: "2026 版", VersionSlug: "2026-current", Text: "国家奖学金奖励标准按照学校当年评审办法执行。"},
			}),
		},
	}); err != nil {
		t.Fatalf("upsert campus search result: %v", err)
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
							"document_id":   "handbook:scholarship-policy",
							"evidence_ref":  "evidence://" + strings.Repeat("a", 64),
							"kind":          "campus_document",
							"root_unit_ids": []any{"scholarship-eligibility"},
							"section_ref":   "/docs/regulations/student_rules/scholarship/v/2026-current#eligibility",
							"section_title": "申请条件",
							"snippet":       "国家奖学金评审需要满足学习成绩和综合测评要求。",
							"source_body":   "must not leak",
							"title":         "本科生国家奖学金评审办法",
							"version_id":    "version-scholarship-2026",
							"version_label": "2026 版",
							"version_slug":  "2026-current",
						},
						map[string]any{
							"document_id":   "handbook:scholarship-policy",
							"evidence_ref":  "evidence://" + strings.Repeat("b", 64),
							"kind":          "campus_document",
							"root_unit_ids": []any{"scholarship-award"},
							"section_ref":   "/docs/regulations/student_rules/scholarship/v/2026-current#award",
							"section_title": "奖励标准",
							"snippet":       "国家奖学金奖励标准按照学校当年评审办法执行。",
							"title":         "本科生国家奖学金评审办法",
							"version_id":    "version-scholarship-2026",
							"version_label": "2026 版",
							"version_slug":  "2026-current",
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
	if _, exists := evalProjection["campus_docs_retrieval"]; exists {
		t.Fatalf("eval projection leaked retrieval internals: %#v", evalProjection)
	}
	contexts, _ := rag["retrieved_contexts"].([]any)
	if len(contexts) != 2 ||
		contexts[0] != "国家奖学金评审需要满足学习成绩和综合测评要求。" ||
		contexts[1] != "国家奖学金奖励标准按照学校当年评审办法执行。" {
		t.Fatalf("rag.retrieved_contexts = %#v", rag["retrieved_contexts"])
	}
	contextIDs, _ := rag["retrieved_context_ids"].([]any)
	if len(contextIDs) != 2 ||
		contextIDs[0] != "evidence://"+strings.Repeat("a", 64) ||
		contextIDs[1] != "evidence://"+strings.Repeat("b", 64) {
		t.Fatalf("rag.retrieved_context_ids = %#v", rag["retrieved_context_ids"])
	}
	sourceRefs, _ := rag["source_refs"].([]any)
	if len(sourceRefs) != 2 {
		t.Fatalf("rag.source_refs = %#v", rag["source_refs"])
	}
	sourceRef := expectRecord(t, sourceRefs[0], "agent_runtime_eval_projection.rag.source_refs[0]")
	if sourceRef["document_id"] != "handbook:scholarship-policy" ||
		sourceRef["evidence_ref"] != "evidence://"+strings.Repeat("a", 64) ||
		sourceRef["source_kind"] != "campus_document" ||
		sourceRef["title"] != "本科生国家奖学金评审办法" || len(sourceRef) != 4 {
		t.Fatalf("rag.source_refs[0] = %#v", sourceRef)
	}
	secondSourceRef := expectRecord(t, sourceRefs[1], "agent_runtime_eval_projection.rag.source_refs[1]")
	if secondSourceRef["document_id"] != "handbook:scholarship-policy" ||
		secondSourceRef["evidence_ref"] != "evidence://"+strings.Repeat("b", 64) ||
		secondSourceRef["source_kind"] != "campus_document" ||
		secondSourceRef["title"] != "本科生国家奖学金评审办法" || len(secondSourceRef) != 4 {
		t.Fatalf("rag.source_refs[1] = %#v", secondSourceRef)
	}
	planning := expectRecord(t, evalProjection["planning"], "agent_runtime_eval_projection.planning")
	toolSequence, _ := planning["tool_sequence"].([]any)
	if len(toolSequence) != 1 {
		t.Fatalf("tool sequence = %#v, want campus search", planning["tool_sequence"])
	}
	if steps, _ := planning["planned_steps"].([]any); len(steps) != 3 ||
		steps[0] != "agent.primary" || steps[1] != "sdk_tool.execute" || steps[2] != "finalization.write" {
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

func TestExecutionRunStepsAgentRuntimeEvalProjectionKeepsRetrievalOutOfToolTrajectory(t *testing.T) {
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
		t.Fatalf("tool sequence = %#v, want no tool calls", planning["tool_sequence"])
	}
	steps, _ := planning["planned_steps"].([]any)
	if len(steps) != 1 || steps[0] != "agent.primary" {
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
