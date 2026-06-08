package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func semanticWorkerSynthesisPacketResponseForTest(t *testing.T) bridge.ExecuteResponse {
	t.Helper()
	return semanticWorkerSynthesisPacketResponseForRunTest(t, "run-go-synthesis")
}

func semanticWorkerSynthesisPacketResponseForRunTest(t *testing.T, runID string) bridge.ExecuteResponse {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"target":             "rag-agent",
		"status":             "error",
		"answer_text":        "",
		"follow_up_question": "",
		"confidence":         "low",
		"error": map[string]any{
			"code":      "go_provider_synthesis_required",
			"message":   "RAG synthesis must be executed by execution-control provider adapter.",
			"retryable": false,
		},
		"agent_observability": map[string]any{
			"safe_details": map[string]any{
				"rag_synthesis_packet": map[string]any{
					"run_id":           runID,
					"step_id":          "synthesis",
					"request_id":       "req-executor-001",
					"query_intent":     "policy_answer",
					"output_schema_id": "rag_answer_v1",
					"payload_sha256":   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					"prompt_refs": []string{
						"prompt://rag/rag_answer_v1",
						"template://rag/rag_answer_v1@provider-pricing-v1",
					},
					"selected_evidence": []map[string]any{{
						"source_id":  "student_rules",
						"chunk_id":   "student_rules:chunk-1",
						"span_ref":   "span://student_rules/chunk-1#0-24",
						"excerpt":    "学生应当按照学校规定办理请假手续。",
						"source_ref": "source://regulations/student_rules/student_rules",
						"title":      "学生手册",
					}},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal synthesis packet response: %v", err)
	}
	return bridge.ExecuteResponse{
		StatusCode: 200,
		Kind:       "semantic_agent_response",
		Body:       body,
	}
}

type fakeRAGSynthesisExecutor struct {
	answerText    string
	calls         int
	err           error
	runID         string
	summary       provider.ExecutionSummary
	waitForCancel bool
}

func (f *fakeRAGSynthesisExecutor) ExecuteRAGSynthesis(
	ctx context.Context,
	packet ragSynthesisPacket,
) (ragSynthesisResult, error) {
	f.calls++
	expectedRunID := f.runID
	if expectedRunID == "" {
		expectedRunID = "run-go-synthesis"
	}
	if packet.RunID != expectedRunID || packet.StepID != "synthesis" {
		return ragSynthesisResult{}, errors.New("unexpected synthesis packet")
	}
	if f.err != nil {
		if f.waitForCancel {
			<-ctx.Done()
		}
		return ragSynthesisResult{ProviderSummary: f.summary}, f.err
	}
	answerText := f.answerText
	if answerText == "" {
		answerText = "学生应按学校规定办理请假手续。"
	}
	return ragSynthesisResult{
		AnswerText:      answerText,
		Confidence:      "high",
		ProviderSummary: f.summary,
	}, nil
}

func useFakeRAGSynthesisExecutorForRunTest(
	server *Server,
	runID string,
) *fakeRAGSynthesisExecutor {
	executor := &fakeRAGSynthesisExecutor{
		runID: runID,
		summary: provider.ExecutionSummary{
			CachedInputTokens:     20,
			CancelOutcome:         provider.CancelOutcomeNotRequested,
			DiagnosticStatus:      provider.DiagnosticComplete,
			EstimatedCostMicroUSD: 320,
			InputTokens:           400,
			ModelName:             "gpt-5-mini",
			ModelProvider:         "openai",
			OutputTokens:          100,
			PricingVersion:        "provider-pricing-v1",
			ProviderRequestRef:    "provider://requests/" + runID + "/synthesis",
			ProviderResponseID:    "resp_" + runID,
			SchemaVersion:         "provider_execution_summary_v1",
			TimeoutOutcome:        provider.TimeoutOutcomeNotTimedOut,
		},
	}
	server.ragSynthesisExecutor = executor
	server.ragSynthesisErr = nil
	return executor
}

func TestProjectTemporalStepMapsProviderSummaryIntoAttemptEvidence(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{
		TemporalWorkerIdentity: "test:rag:worker",
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-provider-summary",
		"conv-provider-summary",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	run, err := store.GetRun(context.Background(), "run-provider-summary")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}

	err = server.projectTemporalStep(context.Background(), temporalStepProjection{
		Attempt:       2,
		Capability:    "knowledge",
		CompletedAt:   now.Add(2 * time.Second),
		Run:           run,
		Status:        "completed",
		StepID:        "synthesis",
		StepKind:      "synthesis",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      "test:rag:worker",
		StartedAt:     now,
		UpdatedAt:     now.Add(2 * time.Second),
		ResultKind:    "provider_execution_summary",
		ProjectionRef: "projection://runs/run-provider-summary/synthesis/provider",
		ProviderSummary: &provider.ExecutionSummary{
			CachedInputTokens:     200,
			CancelOutcome:         provider.CancelOutcomeNotRequested,
			DiagnosticStatus:      provider.DiagnosticComplete,
			EstimatedCostMicroUSD: 1205,
			InputTokens:           1000,
			ModelName:             "gpt-5-mini",
			ModelProvider:         "openai",
			OutputTokens:          500,
			PricingVersion:        "provider-pricing-v1",
			ProviderRequestRef:    "provider://requests/run-provider-summary/synthesis",
			ProviderResponseID:    "resp_123",
			SchemaVersion:         "provider_execution_summary_v1",
			TimeoutOutcome:        provider.TimeoutOutcomeNotTimedOut,
		},
		Payload: map[string]any{
			"summary_ref": "projection://runs/run-provider-summary/synthesis/provider",
		},
	})
	if err != nil {
		t.Fatalf("project temporal step: %v", err)
	}

	attempts, err := store.ListStepAttempts(context.Background(), "run-provider-summary")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 1 {
		t.Fatalf("attempt count = %d, want 1", len(attempts))
	}
	attempt := attempts[0]
	if attempt.Attempt != 2 {
		t.Fatalf("attempt = %d, want 2", attempt.Attempt)
	}
	if attempt.ProviderRequestRef != "provider://requests/run-provider-summary/synthesis" ||
		attempt.ProviderResponseID != "resp_123" {
		t.Fatalf("provider refs = %q / %q", attempt.ProviderRequestRef, attempt.ProviderResponseID)
	}
	if attempt.ModelProvider != "openai" || attempt.ModelName != "gpt-5-mini" {
		t.Fatalf("model = %q/%q", attempt.ModelProvider, attempt.ModelName)
	}
	if attempt.InputTokens != 1000 ||
		attempt.OutputTokens != 500 ||
		attempt.CachedInputTokens != 200 ||
		attempt.EstimatedCostMicroUSD != 1205 {
		t.Fatalf("usage/cost = %#v", attempt)
	}
	if attempt.PricingVersion != "provider-pricing-v1" {
		t.Fatalf("pricing version = %q", attempt.PricingVersion)
	}
	if attempt.CancelOutcome != execution.CancelOutcomeNotRequested {
		t.Fatalf("cancel outcome = %q", attempt.CancelOutcome)
	}
	if attempt.TimeoutOutcome != execution.TimeoutOutcomeNotTimedOut {
		t.Fatalf("timeout outcome = %q", attempt.TimeoutOutcome)
	}
	results, err := store.ListStepResults(context.Background(), "run-provider-summary")
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	if len(results) != 1 || results[0].ResultKind != "provider_execution_summary" {
		t.Fatalf("results = %#v", results)
	}
}

func TestSynthesizeRAGAnswerActivityExecutesGoProviderForSynthesisPacket(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	executor := &fakeRAGSynthesisExecutor{
		summary: provider.ExecutionSummary{
			CachedInputTokens:     20,
			CancelOutcome:         provider.CancelOutcomeNotRequested,
			DiagnosticStatus:      provider.DiagnosticComplete,
			EstimatedCostMicroUSD: 320,
			InputTokens:           400,
			ModelName:             "gpt-5-mini",
			ModelProvider:         "openai",
			OutputTokens:          100,
			PricingVersion:        "provider-pricing-v1",
			ProviderRequestRef:    "provider://requests/run-go-synthesis/synthesis",
			ProviderResponseID:    "resp_go_synthesis",
			SchemaVersion:         "provider_execution_summary_v1",
			TimeoutOutcome:        provider.TimeoutOutcomeNotTimedOut,
		},
	}
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			return semanticWorkerSynthesisPacketResponseForTest(t), nil
		},
	})
	server.ragSynthesisExecutor = executor
	server.ragSynthesisErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-go-synthesis",
		"conv-go-synthesis",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-go-synthesis",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-go-synthesis",
		RunID:          "run-go-synthesis",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-go-synthesis",
		WorkflowID:     "campus-agent.chat.run-go-synthesis",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}

	semantic, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-go-synthesis",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("semantic activity: %v", err)
	}
	if semantic.BridgeRef != "projection://runs/run-go-synthesis/semantic/rag" {
		t.Fatalf("bridge ref = %q", semantic.BridgeRef)
	}
	if executor.calls != 0 {
		t.Fatalf("semantic activity must not execute provider, calls = %d", executor.calls)
	}
	synthesis, err := server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-go-synthesis",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("synthesis activity: %v", err)
	}
	if synthesis.Status != "completed" {
		t.Fatalf("synthesis status = %q, want completed", synthesis.Status)
	}
	if executor.calls != 1 {
		t.Fatalf("go synthesis executor calls = %d, want 1", executor.calls)
	}
	finalization, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: synthesis.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-go-synthesis",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("finalization activity: %v", err)
	}
	if finalization.Status != "completed" {
		t.Fatalf("finalization status = %q, want completed", finalization.Status)
	}
	attempts, err := store.ListStepAttempts(context.Background(), "run-go-synthesis")
	if err != nil {
		t.Fatalf("list step attempts: %v", err)
	}
	var synthesisAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "synthesis" {
			synthesisAttempt = &attempts[index]
		}
	}
	if synthesisAttempt == nil {
		t.Fatalf("synthesis attempt missing: %#v", attempts)
	}
	if synthesisAttempt.ProviderResponseID != "resp_go_synthesis" ||
		synthesisAttempt.InputTokens != 400 ||
		synthesisAttempt.OutputTokens != 100 ||
		synthesisAttempt.EstimatedCostMicroUSD != 320 {
		t.Fatalf("synthesis provider evidence = %#v", synthesisAttempt)
	}
	run, err := store.GetRun(context.Background(), "run-go-synthesis")
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	response, err := temporalFinalizedResponseFromRun(run, synthesis.BridgeRef)
	if err != nil {
		t.Fatalf("get finalized response: %v", err)
	}
	if response["answer_text"] != "学生应按学校规定办理请假手续。" {
		t.Fatalf("finalized answer_text = %v", response["answer_text"])
	}
}

func TestSynthesizeRAGAnswerActivityProjectsProviderCancelForGoSynthesis(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	executor := &fakeRAGSynthesisExecutor{
		err:           context.Canceled,
		runID:         "run-go-synthesis-cancel",
		waitForCancel: true,
		summary: provider.ExecutionSummary{
			CancelOutcome:      provider.CancelOutcomeProviderConnectionAborted,
			ModelName:          "gpt-5-mini",
			ModelProvider:      "openai",
			ProviderRequestRef: "provider://requests/run-go-synthesis-cancel/synthesis",
			SchemaVersion:      "provider_execution_summary_v1",
			TimeoutOutcome:     provider.TimeoutOutcomeNotTimedOut,
		},
	}
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			return semanticWorkerSynthesisPacketResponseForRunTest(t, "run-go-synthesis-cancel"), nil
		},
	})
	server.ragSynthesisExecutor = executor
	server.ragSynthesisErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-go-synthesis-cancel",
		"conv-go-synthesis-cancel",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-go-synthesis-cancel",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-go-synthesis-cancel",
		RunID:          "run-go-synthesis-cancel",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-go-synthesis-cancel",
		WorkflowID:     "campus-agent.chat.run-go-synthesis-cancel",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	semantic, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-go-synthesis-cancel",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("semantic activity: %v", err)
	}

	_, err = server.SynthesizeRAGAnswerActivity(
		ctx,
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-go-synthesis-cancel",
			TraceID:   "trace-executor-001",
		},
	)

	if err == nil {
		t.Fatal("go synthesis provider cancel must fail closed")
	}
	run, getErr := store.GetRun(context.Background(), "run-go-synthesis-cancel")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
	attempts, listErr := store.ListStepAttempts(context.Background(), "run-go-synthesis-cancel")
	if listErr != nil {
		t.Fatalf("list attempts: %v", listErr)
	}
	var synthesisAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "synthesis" && attempts[index].Status == "failed" {
			synthesisAttempt = &attempts[index]
		}
	}
	if synthesisAttempt == nil {
		t.Fatalf("failed synthesis attempt missing: %#v", attempts)
	}
	if synthesisAttempt.CancelOutcome != execution.CancelOutcomeProviderConnectionAborted {
		t.Fatalf("cancel outcome = %q, want provider_connection_aborted", synthesisAttempt.CancelOutcome)
	}
	if synthesisAttempt.ProviderRequestRef != "provider://requests/run-go-synthesis-cancel/synthesis" ||
		synthesisAttempt.ModelProvider != "openai" ||
		synthesisAttempt.ModelName != "gpt-5-mini" {
		t.Fatalf("provider evidence = %#v", synthesisAttempt)
	}
	if synthesisAttempt.TimeoutOutcome != execution.TimeoutOutcomeNotTimedOut {
		t.Fatalf("timeout outcome = %q, want not_timed_out", synthesisAttempt.TimeoutOutcome)
	}
	results, resultErr := store.ListStepResults(context.Background(), "run-go-synthesis-cancel")
	if resultErr != nil {
		t.Fatalf("list step results: %v", resultErr)
	}
	var synthesisResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "synthesis" && results[index].Status == "failed" {
			synthesisResult = &results[index]
		}
	}
	if synthesisResult == nil ||
		synthesisResult.ResultKind != "provider_execution_summary" ||
		synthesisResult.SanitizedPayload["provider_ref"] != "provider://requests/run-go-synthesis-cancel/synthesis" {
		t.Fatalf("failed synthesis result = %#v", synthesisResult)
	}
}

func TestSynthesizeRAGAnswerActivityProjectsProviderTimeoutForGoSynthesis(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	executor := &fakeRAGSynthesisExecutor{
		err:   context.DeadlineExceeded,
		runID: "run-go-synthesis-timeout",
		summary: provider.ExecutionSummary{
			CancelOutcome:      provider.CancelOutcomeNotRequested,
			ModelName:          "gpt-5-mini",
			ModelProvider:      "openai",
			ProviderRequestRef: "provider://requests/run-go-synthesis-timeout/synthesis",
			SchemaVersion:      "provider_execution_summary_v1",
			TimeoutOutcome:     provider.TimeoutOutcomeProviderTimeout,
		},
	}
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			return semanticWorkerSynthesisPacketResponseForRunTest(t, "run-go-synthesis-timeout"), nil
		},
	})
	server.ragSynthesisExecutor = executor
	server.ragSynthesisErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-go-synthesis-timeout",
		"conv-go-synthesis-timeout",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-go-synthesis-timeout",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-go-synthesis-timeout",
		RunID:          "run-go-synthesis-timeout",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-go-synthesis-timeout",
		WorkflowID:     "campus-agent.chat.run-go-synthesis-timeout",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	semantic, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-go-synthesis-timeout",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("semantic activity: %v", err)
	}

	_, err = server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-go-synthesis-timeout",
			TraceID:   "trace-executor-001",
		},
	)

	if err == nil {
		t.Fatal("go synthesis provider timeout must fail closed")
	}
	attempts, listErr := store.ListStepAttempts(context.Background(), "run-go-synthesis-timeout")
	if listErr != nil {
		t.Fatalf("list attempts: %v", listErr)
	}
	var synthesisAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "synthesis" && attempts[index].Status == "failed" {
			synthesisAttempt = &attempts[index]
		}
	}
	if synthesisAttempt == nil {
		t.Fatalf("failed synthesis attempt missing: %#v", attempts)
	}
	if synthesisAttempt.CancelOutcome != execution.CancelOutcomeNotRequested {
		t.Fatalf("cancel outcome = %q, want not_requested", synthesisAttempt.CancelOutcome)
	}
	if synthesisAttempt.TimeoutOutcome != execution.TimeoutOutcomeProviderTimeout {
		t.Fatalf("timeout outcome = %q, want provider_timeout", synthesisAttempt.TimeoutOutcome)
	}
	if synthesisAttempt.ProviderRequestRef != "provider://requests/run-go-synthesis-timeout/synthesis" {
		t.Fatalf("provider request ref = %q", synthesisAttempt.ProviderRequestRef)
	}
}
