package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestSynthesisProviderCancellationProjectsAbortOutcome(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.ragLookupExecutor = &fakeRAGLookupExecutor{}
	server.ragLookupErr = nil
	server.ragSynthesisExecutor = &fakeRAGSynthesisExecutor{
		err: context.Canceled,
		summary: provider.ExecutionSummary{
			CancelOutcome:      provider.CancelOutcomeProviderConnectionAborted,
			DiagnosticStatus:   provider.DiagnosticProviderUsageMissing,
			ModelName:          "gpt-5-mini",
			ModelProvider:      "openai",
			ProviderRequestRef: "provider://requests/run-rag-provider-cancel/synthesis",
			SchemaVersion:      "provider_execution_summary_v1",
			TimeoutOutcome:     provider.TimeoutOutcomeNotTimedOut,
		},
	}
	server.ragSynthesisErr = nil
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-provider-cancel",
		"conv-rag-provider-cancel",
		now,
		ragHandoffForDurableWorkerTest("学生请假手续"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-provider-cancel", "regulations", "student_rules")

	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-provider-cancel",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-provider-cancel-001",
			RunID:          "run-rag-provider-cancel",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-provider-cancel",
			WorkflowID:     "campus-agent.chat.run-rag-provider-cancel",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-provider-cancel",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}
	lookupOutput, err := server.RetrieveIndexedLookupActivity(
		context.Background(),
		temporalruntime.RetrieveIndexedLookupActivityInput{
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-provider-cancel",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("retrieve indexed lookup: %v", err)
	}
	rescue, err := server.ExpandOrRescueRetrievalActivity(
		context.Background(),
		temporalruntime.ExpandOrRescueRetrievalActivityInput{
			LookupRef:  lookupOutput.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-provider-cancel",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("expand or rescue: %v", err)
	}
	evidence, err := server.SelectEvidenceActivity(
		context.Background(),
		temporalruntime.SelectEvidenceActivityInput{
			LookupRef:  lookupOutput.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
			RescueRef:  rescue.RescueRef,
			RunID:      "run-rag-provider-cancel",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("select evidence: %v", err)
	}

	_, err = server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			EvidenceRef: evidence.EvidenceRef,
			RAGPlanRef:  ragPlan.PlanRef,
			RunID:       "run-rag-provider-cancel",
			TraceID:     "trace-executor-001",
		},
	)
	if err == nil {
		t.Fatal("provider cancellation must fail synthesis activity")
	}
	attempts, err := store.ListStepAttempts(context.Background(), "run-rag-provider-cancel")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	var synthesisAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "synthesis" {
			synthesisAttempt = &attempts[index]
		}
	}
	if synthesisAttempt == nil {
		t.Fatal("synthesis attempt missing")
	}
	if synthesisAttempt.Status != "failed" ||
		synthesisAttempt.CancelOutcome != execution.CancelOutcomeProviderConnectionAborted ||
		synthesisAttempt.ProviderRequestRef != "provider://requests/run-rag-provider-cancel/synthesis" ||
		synthesisAttempt.ProviderResponseID != "" {
		t.Fatalf("synthesis cancel evidence = %#v", synthesisAttempt)
	}
	results, err := store.ListStepResults(context.Background(), "run-rag-provider-cancel")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	for _, result := range results {
		if result.StepID == "finalization.write" {
			t.Fatalf("provider cancel wrote finalization result: %#v", result)
		}
	}
}

func TestSynthesisProviderTimeoutProjectsTimeoutOutcome(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.ragLookupExecutor = &fakeRAGLookupExecutor{}
	server.ragLookupErr = nil
	server.ragSynthesisExecutor = &fakeRAGSynthesisExecutor{
		err: context.DeadlineExceeded,
		summary: provider.ExecutionSummary{
			CancelOutcome:      provider.CancelOutcomeNotRequested,
			DiagnosticStatus:   provider.DiagnosticProviderUsageMissing,
			ModelName:          "gpt-5-mini",
			ModelProvider:      "openai",
			ProviderRequestRef: "provider://requests/run-rag-provider-timeout/synthesis",
			SchemaVersion:      "provider_execution_summary_v1",
			TimeoutOutcome:     provider.TimeoutOutcomeProviderTimeout,
		},
	}
	server.ragSynthesisErr = nil
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-provider-timeout",
		"conv-rag-provider-timeout",
		now,
		ragHandoffForDurableWorkerTest("学生请假手续"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-provider-timeout", "regulations", "student_rules")

	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-provider-timeout",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-provider-timeout-001",
			RunID:          "run-rag-provider-timeout",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-provider-timeout",
			WorkflowID:     "campus-agent.chat.run-rag-provider-timeout",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-provider-timeout",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}
	lookupOutput, err := server.RetrieveIndexedLookupActivity(
		context.Background(),
		temporalruntime.RetrieveIndexedLookupActivityInput{
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-provider-timeout",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("retrieve indexed lookup: %v", err)
	}
	rescue, err := server.ExpandOrRescueRetrievalActivity(
		context.Background(),
		temporalruntime.ExpandOrRescueRetrievalActivityInput{
			LookupRef:  lookupOutput.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-provider-timeout",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("expand or rescue: %v", err)
	}
	evidence, err := server.SelectEvidenceActivity(
		context.Background(),
		temporalruntime.SelectEvidenceActivityInput{
			LookupRef:  lookupOutput.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
			RescueRef:  rescue.RescueRef,
			RunID:      "run-rag-provider-timeout",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("select evidence: %v", err)
	}

	_, err = server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			EvidenceRef: evidence.EvidenceRef,
			RAGPlanRef:  ragPlan.PlanRef,
			RunID:       "run-rag-provider-timeout",
			TraceID:     "trace-executor-001",
		},
	)
	if err == nil {
		t.Fatal("provider timeout must fail synthesis activity")
	}
	run, err := store.GetRun(context.Background(), "run-rag-provider-timeout")
	if err != nil {
		t.Fatalf("get timeout run: %v", err)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
	attempts, err := store.ListStepAttempts(context.Background(), "run-rag-provider-timeout")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	var synthesisAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "synthesis" {
			synthesisAttempt = &attempts[index]
		}
	}
	if synthesisAttempt == nil {
		t.Fatal("synthesis attempt missing")
	}
	if synthesisAttempt.Status != "failed" ||
		synthesisAttempt.CancelOutcome != execution.CancelOutcomeNotRequested ||
		synthesisAttempt.TimeoutOutcome != execution.TimeoutOutcomeProviderTimeout ||
		synthesisAttempt.ProviderRequestRef != "provider://requests/run-rag-provider-timeout/synthesis" {
		t.Fatalf("synthesis timeout evidence = %#v", synthesisAttempt)
	}
}
