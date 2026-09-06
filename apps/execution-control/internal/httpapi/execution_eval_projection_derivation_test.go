package httpapi

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestExecutionRunStepsAgentRuntimeEvalProjectionDerivesAnswerAndContexts(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
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
		ResultID:             "task.step.scholarship:result:1",
		StepID:               "task.step.scholarship",
		RequestID:            run.RequestID,
		AttemptID:            temporalStepAttemptID(run.RequestID, "task.step.scholarship", 1),
		Status:               "completed",
		ResultKind:           "task_step_result",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/task/step/scholarship/result",
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
		RequestID:            run.RequestID,
		AttemptID:            temporalStepAttemptID(run.RequestID, "sdk_tool.execute.campus_search.1", 1),
		Status:               "completed",
		ResultKind:           "typed_tool_result",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/sdk-tools/campus_search/1",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
			"parent_step_id":   "task.step.scholarship",
			"result": campusdocs.EncodeSearchResult([]campusdocs.SearchResultItem{
				{ResultRef: "result://" + strings.Repeat("a", 64), SourceKind: "document", DocumentID: "handbook:scholarship-policy", Title: "本科生国家奖学金评审办法", SectionRef: "/docs/regulations/student_rules/scholarship/v/2026#eligibility", SectionTitle: "申请条件", RootUnitIDs: []string{"scholarship-eligibility"}, VersionID: "version-scholarship-2026", VersionSlug: "2026", Text: "国家奖学金评审需要满足学习成绩和综合测评要求。"},
				{ResultRef: "result://" + strings.Repeat("b", 64), SourceKind: "document", DocumentID: "handbook:scholarship-policy", Title: "本科生国家奖学金评审办法", SectionRef: "/docs/regulations/student_rules/scholarship/v/2026#award", SectionTitle: "奖励标准", RootUnitIDs: []string{"scholarship-award"}, VersionID: "version-scholarship-2026", VersionSlug: "2026", Text: "国家奖学金奖励标准按照学校当年评审办法执行。"},
			}, 1),
		},
	}); err != nil {
		t.Fatalf("upsert campus search result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "finalization.write:result:1",
		StepID:               "finalization.write",
		RequestID:            run.RequestID,
		AttemptID:            "finalization.write:attempt:1",
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        "projection://runs/run-temporal-derived-eval/finalization/write",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"finalization_summary": map[string]any{
				"answer_text":         "学习成绩和综合测评需要满足 [1]。",
				"campus_source_count": 2,
				"response_sha256":     "sha256:finalized-response",
				"source_count":        2,
				"status":              "completed",
				"web_source_count":    0,
			},
		},
	}); err != nil {
		t.Fatalf("upsert finalization result: %v", err)
	}

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/requests/run-temporal-derived-eval/steps",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	evalProjection := expectRecord(t, body["agent_runtime_eval_projection"], "agent_runtime_eval_projection")
	if evalProjection["schema_version"] != "agent_runtime_eval_projection.v5" ||
		evalProjection["request_id"] != "run-temporal-derived-eval" {
		t.Fatalf("eval projection identity = %#v", evalProjection)
	}
	if evalProjection["answer"] != "学习成绩和综合测评需要满足 [1]。" {
		t.Fatalf("answer = %#v", evalProjection["answer"])
	}
	contexts, _ := evalProjection["retrieved_contexts"].([]any)
	if len(contexts) != 2 ||
		contexts[0] != "国家奖学金评审需要满足学习成绩和综合测评要求。" ||
		contexts[1] != "国家奖学金奖励标准按照学校当年评审办法执行。" {
		t.Fatalf("retrieved_contexts = %#v", evalProjection["retrieved_contexts"])
	}
	contextIDs, _ := evalProjection["retrieved_context_ids"].([]any)
	if len(contextIDs) != 2 ||
		contextIDs[0] != "result://"+strings.Repeat("a", 64) ||
		contextIDs[1] != "result://"+strings.Repeat("b", 64) {
		t.Fatalf("retrieved_context_ids = %#v", evalProjection["retrieved_context_ids"])
	}
	citedContexts, _ := evalProjection["cited_contexts"].([]any)
	if len(citedContexts) != 1 || citedContexts[0] != contexts[0] {
		t.Fatalf("cited_contexts = %#v", evalProjection["cited_contexts"])
	}
	trajectory := expectRecord(t, evalProjection["tool_trajectory"], "tool_trajectory")
	calls, _ := trajectory["tool_calls"].([]any)
	if trajectory["decision_kind"] != "tool_assisted" || len(calls) != 1 ||
		expectRecord(t, calls[0], "tool_calls[0]")["tool_name"] != "campus_search" {
		t.Fatalf("tool trajectory = %#v", trajectory)
	}
}

func TestExecutionRunStepsAgentRuntimeEvalProjectionProjectsDirectAnswer(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
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
		ResultID:             "answer.synthesize:result:1",
		StepID:               "answer.synthesize",
		RequestID:            run.RequestID,
		AttemptID:            temporalStepAttemptID(run.RequestID, "answer.synthesize", 1),
		Status:               "completed",
		ResultKind:           "answer_synthesis",
		ProjectionRef:        "projection://runs/run-temporal-derived-history-eval/answer/synthesize/result",
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
		"/internal/execution/requests/run-temporal-derived-history-eval/steps",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	evalProjection := expectRecord(t, body["agent_runtime_eval_projection"], "agent_runtime_eval_projection")
	trajectory := expectRecord(t, evalProjection["tool_trajectory"], "tool_trajectory")
	calls, _ := trajectory["tool_calls"].([]any)
	if trajectory["decision_kind"] != "direct_answer" || len(calls) != 0 {
		t.Fatalf("tool trajectory = %#v", trajectory)
	}
}

func TestExecutionRunStepsAgentRuntimeEvalProjectionProjectsPersonalMemoryToolCall(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
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
		ResultID:             temporalStepResultIDForHTTPTest(run.RequestID, "task.step.memory", 1),
		StepID:               "task.step.memory",
		RequestID:            run.RequestID,
		AttemptID:            temporalStepAttemptID(run.RequestID, "task.step.memory", 1),
		Status:               "completed",
		ResultKind:           "task_step_result",
		ProjectionRef:        "projection://runs/run-temporal-memory-derived-eval/task/step/memory/result",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
		},
	}); err != nil {
		t.Fatalf("upsert workflow step result: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             temporalStepResultIDForHTTPTest(run.RequestID, "sdk_tool.execute.personal_memory_recall.1", 1),
		StepID:               "sdk_tool.execute.personal_memory_recall.1",
		RequestID:            run.RequestID,
		AttemptID:            temporalStepAttemptID(run.RequestID, "sdk_tool.execute.personal_memory_recall.1", 1),
		Status:               "completed",
		ResultKind:           "typed_tool_result",
		ProjectionRef:        "projection://runs/run-temporal-memory-derived-eval/sdk-tools/personal_memory_recall/1",
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"arguments_json_sha256": "sha256:memory-query",
			"activity_attempt":      1,
			"outcome":               "matched",
			"parent_step_id":        "task.step.memory",
			"result_sha256":         "sha256:memory-result",
			"tool_name":             "personal_memory_recall",
			"tool_status":           "completed",
		},
	}); err != nil {
		t.Fatalf("upsert personal memory tool result: %v", err)
	}
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/requests/run-temporal-memory-derived-eval/steps",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	evalProjection := expectRecord(t, body["agent_runtime_eval_projection"], "agent_runtime_eval_projection")
	trajectory := expectRecord(t, evalProjection["tool_trajectory"], "tool_trajectory")
	calls, _ := trajectory["tool_calls"].([]any)
	if trajectory["decision_kind"] != "tool_assisted" || len(calls) != 1 {
		t.Fatalf("tool trajectory = %#v", trajectory)
	}
	call := expectRecord(t, calls[0], "tool_calls[0]")
	if call["tool_name"] != "personal_memory_recall" || len(call) != 1 {
		t.Fatalf("tool call = %#v", call)
	}
	serialized := stringifyForTest(trajectory)
	for _, forbidden := range []string{
		"agent-runtime://run-temporal-memory-derived-eval/tools/personal_memory_recall/1",
		"sha256:memory-query",
		"sha256:memory-result",
	} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("tool trajectory leaked %q: %s", forbidden, serialized)
		}
	}
}
