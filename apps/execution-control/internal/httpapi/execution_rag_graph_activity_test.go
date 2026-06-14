package httpapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type fakeRAGLookupExecutor struct {
	err      error
	result   ragruntime.RetrievalLookupResult
	seenPlan ragruntime.PlanProjection
}

func (f *fakeRAGLookupExecutor) HealthCheck(context.Context) error {
	return f.err
}

func (f *fakeRAGLookupExecutor) Lookup(
	_ context.Context,
	plan ragruntime.PlanProjection,
) (ragruntime.RetrievalLookupResult, error) {
	f.seenPlan = plan
	if f.err != nil {
		return ragruntime.RetrievalLookupResult{}, f.err
	}
	result := f.result
	if result.SchemaVersion == "" {
		result = validLookupResultForTest(plan)
	}
	return result, nil
}

type fakeRAGSynthesisExecutor struct {
	answerText string
	calls      int
	err        error
	onExecute  func(context.Context)
	seenPacket ragSynthesisPacket
	summary    provider.ExecutionSummary
}

func (f *fakeRAGSynthesisExecutor) HealthCheck(context.Context) error {
	return f.err
}

func (f *fakeRAGSynthesisExecutor) ExecuteRAGSynthesis(
	ctx context.Context,
	packet ragSynthesisPacket,
) (ragSynthesisResult, error) {
	f.calls++
	f.seenPacket = packet
	if f.onExecute != nil {
		f.onExecute(ctx)
	}
	if f.err != nil {
		return ragSynthesisResult{ProviderSummary: f.summary}, f.err
	}
	answerText := f.answerText
	if answerText == "" {
		answerText = "学生应按学校规定办理请假手续。"
	}
	return ragSynthesisResult{
		AnswerText:       answerText,
		Confidence:       "high",
		GroundingVerdict: "supported",
		ProviderSummary:  f.summary,
		SemanticOutcome:  "grounded_answer",
	}, nil
}

func TestTemporalRAGGraphActivitiesProjectSevenStepTrajectory(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	lookup := &fakeRAGLookupExecutor{}
	server.ragLookupExecutor = lookup
	server.ragLookupErr = nil
	server.personalMemoryExecutor = &fakePersonalMemoryExecutor{}
	server.personalMemoryErr = nil
	synthesis := &fakeRAGSynthesisExecutor{
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
			ProviderRequestRef:    "provider://requests/run-rag-graph/synthesis",
			ProviderResponseID:    "resp_run_rag_graph",
			SchemaVersion:         "provider_execution_summary_v1",
			TimeoutOutcome:        provider.TimeoutOutcomeNotTimedOut,
		},
	}
	server.ragSynthesisExecutor = synthesis
	server.ragSynthesisErr = nil

	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-graph",
		"conv-rag-graph",
		now,
		ragHandoffForDurableWorkerTest("学生请假手续"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-graph", "regulations", "student_rules")

	memoryRecall, err := server.MemoryRecallActivity(
		context.Background(),
		temporalruntime.MemoryRecallActivityInput{
			RequestID:           "req-executor-001",
			RequestedCapability: "knowledge",
			RunID:               "run-rag-graph",
			TraceID:             "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("memory recall: %v", err)
	}
	if memoryRecall.MemoryRef != temporalProjectionRef("run-rag-graph", "memory/recall") {
		t.Fatalf("memory ref = %q", memoryRecall.MemoryRef)
	}

	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-graph",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-graph",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-graph",
			WorkflowID:     "campus-agent.chat.run-rag-graph",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-graph",
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
			RunID:      "run-rag-graph",
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
			RunID:      "run-rag-graph",
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
			RunID:      "run-rag-graph",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("select evidence: %v", err)
	}
	synthesisOutput, err := server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			EvidenceRef: evidence.EvidenceRef,
			RAGPlanRef:  ragPlan.PlanRef,
			RunID:       "run-rag-graph",
			TraceID:     "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("synthesize rag answer: %v", err)
	}
	if synthesis.calls != 1 {
		t.Fatalf("synthesis calls after activity = %d, want 1", synthesis.calls)
	}
	afterSynthesis, getAfterSynthesisErr := store.GetRun(context.Background(), "run-rag-graph")
	if getAfterSynthesisErr != nil {
		t.Fatalf("get run after synthesis: %v", getAfterSynthesisErr)
	}
	if rawTemporalRAG, _ := afterSynthesis.Metadata["temporal_rag"].(map[string]any); rawTemporalRAG["finalized_response"] == nil {
		t.Fatalf("temporal_rag after synthesis missing finalized_response: %#v", rawTemporalRAG)
	}
	grounding, err := server.VerifyGroundingActivity(
		context.Background(),
		temporalruntime.VerifyGroundingActivityInput{
			EvidenceRef:  evidence.EvidenceRef,
			RunID:        "run-rag-graph",
			SynthesisRef: synthesisOutput.SynthesisRef,
			TraceID:      "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("verify grounding: %v", err)
	}
	finalization, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			GroundingRef: grounding.GroundingRef,
			RunID:        "run-rag-graph",
			SynthesisRef: synthesisOutput.SynthesisRef,
			TraceID:      "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	if finalization.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("finalization status = %q", finalization.Status)
	}
	completedRun, completedRunErr := store.GetRun(context.Background(), "run-rag-graph")
	if completedRunErr != nil {
		t.Fatalf("get completed run: %v", completedRunErr)
	}
	if completedRun.FinalResponseRef != finalization.ProjectionRef {
		t.Fatalf(
			"final response ref = %q, want %q",
			completedRun.FinalResponseRef,
			finalization.ProjectionRef,
		)
	}
	events, eventsErr := store.ListRunEvents(context.Background(), "run-rag-graph")
	if eventsErr != nil {
		t.Fatalf("list run events: %v", eventsErr)
	}
	var finalizationResponse map[string]any
	for _, event := range events {
		if event.EventType != execution.DurableRunEventTypeFinalizationCompleted {
			continue
		}
		response, ok := event.Payload["response"].(map[string]any)
		if !ok {
			t.Fatalf("finalization response payload = %#v", event.Payload["response"])
		}
		finalizationResponse = response
	}
	if finalizationResponse == nil {
		t.Fatal("finalization.completed event missing")
	}
	if _, ok := finalizationResponse["error"]; !ok {
		t.Fatalf("finalization response missing required error field: %#v", finalizationResponse)
	}
	if finalizationResponse["error"] != nil {
		t.Fatalf("finalization response error = %#v, want nil", finalizationResponse["error"])
	}
	results, resultsErr := store.ListStepResults(context.Background(), "run-rag-graph")
	if resultsErr != nil {
		t.Fatalf("list step results: %v", resultsErr)
	}
	var finalizationResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "finalization.write" {
			finalizationResult = &results[index]
		}
	}
	if finalizationResult == nil {
		t.Fatal("finalization.write result missing")
	}
	projectedResponse, ok := finalizationResult.SanitizedPayload["finalized_response"].(map[string]any)
	if !ok {
		t.Fatalf(
			"finalization.write result must include finalized_response projection: %#v",
			finalizationResult.SanitizedPayload,
		)
	}
	if projectedResponse["answer_text"] != finalizationResponse["answer_text"] ||
		projectedResponse["trace_id"] != finalizationResponse["trace_id"] {
		t.Fatalf("finalization result response drifted from run event: %#v", projectedResponse)
	}
	if _, ok := projectedResponse["error"]; !ok {
		t.Fatalf("finalization.write response missing required error field: %#v", projectedResponse)
	}
	if projectedResponse["error"] != nil {
		t.Fatalf("finalization.write response error = %#v, want nil", projectedResponse["error"])
	}
	if lookup.seenPlan.Collection != "student_rules" || lookup.seenPlan.Corpus != "regulations" {
		t.Fatalf("lookup plan scope = %#v", lookup.seenPlan)
	}
	if synthesis.calls != 1 {
		t.Fatalf("synthesis calls = %d, want 1", synthesis.calls)
	}
	if synthesis.seenPacket.OutputSchemaID != "rag_answer_v2" {
		t.Fatalf("synthesis schema = %q, want rag_answer_v2", synthesis.seenPacket.OutputSchemaID)
	}

	steps, err := store.ListRunSteps(context.Background(), "run-rag-graph")
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	assertStepIDs(t, steps, []string{
		"memory.recall",
		"plan.route",
		"rag.plan",
		"retrieval.indexed_lookup",
		"retrieval.expand_or_rescue",
		"evidence.selection",
		"synthesis",
		"grounding.verify",
		"finalization.write",
	})
	attempts, err := store.ListStepAttempts(context.Background(), "run-rag-graph")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 9 {
		t.Fatalf("attempt count = %d, want 9: %#v", len(attempts), attempts)
	}
	var synthesisAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "synthesis" {
			synthesisAttempt = &attempts[index]
		}
		if attempts[index].StepID == "semantic.rag" {
			t.Fatalf("semantic.rag attempt must not be projected: %#v", attempts[index])
		}
	}
	if synthesisAttempt == nil {
		t.Fatal("synthesis attempt missing")
	}
	if synthesisAttempt.ProviderRequestRef != "provider://requests/run-rag-graph/synthesis" ||
		synthesisAttempt.InputTokens != 400 ||
		synthesisAttempt.OutputTokens != 100 ||
		synthesisAttempt.EstimatedCostMicroUSD != 320 {
		t.Fatalf("synthesis provider evidence = %#v", synthesisAttempt)
	}
}

func TestSynthesisLateSuccessAfterCancelDoesNotOverwriteTerminalProjection(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.ragLookupExecutor = &fakeRAGLookupExecutor{}
	server.ragLookupErr = nil
	server.ragSynthesisExecutor = &fakeRAGSynthesisExecutor{
		onExecute: func(ctx context.Context) {
			if _, err := store.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
				RunID:  "run-rag-late-cancel",
				Reason: "user_requested",
				Now:    time.Now().UTC(),
			}); err != nil {
				t.Fatalf("cancel run during synthesis: %v", err)
			}
		},
		summary: provider.ExecutionSummary{
			CancelOutcome:         provider.CancelOutcomeNotRequested,
			DiagnosticStatus:      provider.DiagnosticComplete,
			EstimatedCostMicroUSD: 320,
			InputTokens:           400,
			ModelName:             "gpt-5-mini",
			ModelProvider:         "openai",
			OutputTokens:          100,
			PricingVersion:        "provider-pricing-v1",
			ProviderRequestRef:    "provider://requests/run-rag-late-cancel/synthesis",
			ProviderResponseID:    "resp_late_success",
			SchemaVersion:         "provider_execution_summary_v1",
			TimeoutOutcome:        provider.TimeoutOutcomeNotTimedOut,
		},
	}
	server.ragSynthesisErr = nil
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-late-cancel",
		"conv-rag-late-cancel",
		now,
		ragHandoffForDurableWorkerTest("学生请假手续"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-late-cancel", "regulations", "student_rules")
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-late-cancel",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-late-cancel-001",
			RunID:          "run-rag-late-cancel",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-late-cancel",
			WorkflowID:     "campus-agent.chat.run-rag-late-cancel",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-late-cancel",
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
			RunID:      "run-rag-late-cancel",
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
			RunID:      "run-rag-late-cancel",
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
			RunID:      "run-rag-late-cancel",
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
			RunID:       "run-rag-late-cancel",
			TraceID:     "trace-executor-001",
		},
	)
	if err == nil {
		t.Fatal("late synthesis success after cancel must fail closed")
	}
	run, err := store.GetRun(context.Background(), "run-rag-late-cancel")
	if err != nil {
		t.Fatalf("get canceled run: %v", err)
	}
	if run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("run status = %q, want canceled", run.Status)
	}
	if rawTemporalRAG, _ := run.Metadata["temporal_rag"].(map[string]any); rawTemporalRAG["finalized_response"] != nil {
		t.Fatalf("late synthesis wrote finalized response after cancel: %#v", rawTemporalRAG)
	}
	attempts, err := store.ListStepAttempts(context.Background(), "run-rag-late-cancel")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	var lateSynthesisAttempt *execution.StepAttemptProjection
	for _, attempt := range attempts {
		if attempt.StepID == "synthesis" && attempt.Status == "completed" {
			t.Fatalf("late synthesis completed attempt after cancel: %#v", attempt)
		}
		if attempt.StepID == "synthesis" {
			copied := attempt
			lateSynthesisAttempt = &copied
		}
	}
	if lateSynthesisAttempt == nil {
		t.Fatal("late synthesis attempt evidence missing")
	}
	if lateSynthesisAttempt.LateCompletionOutcome != execution.LateCompletionOutcomeIgnoredAfterCancel ||
		lateSynthesisAttempt.TerminalReason != "late_completion_ignored" {
		t.Fatalf("late synthesis attempt = %#v, want ignored after cancel evidence", lateSynthesisAttempt)
	}
	results, err := store.ListStepResults(context.Background(), "run-rag-late-cancel")
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	for _, result := range results {
		if result.StepID == "finalization.write" || result.Status == "completed" &&
			result.ProjectionRef == temporalProjectionRef("run-rag-late-cancel", "synthesis/provider") {
			t.Fatalf("late success result after cancel: %#v", result)
		}
	}
}

func TestRetrieveIndexedLookupActivityFailsClosedWhenLookupUnavailable(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.ragLookupExecutor = &fakeRAGLookupExecutor{err: errors.New("qdrant unavailable")}
	server.ragLookupErr = nil
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-lookup-fail",
		"conv-rag-lookup-fail",
		now,
		ragHandoffForDurableWorkerTest("学生请假手续"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-lookup-fail", "regulations", "student_rules")
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-lookup-fail",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-lookup-fail",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-lookup-fail",
			WorkflowID:     "campus-agent.chat.run-rag-lookup-fail",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-lookup-fail",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}

	_, err = server.RetrieveIndexedLookupActivity(
		context.Background(),
		temporalruntime.RetrieveIndexedLookupActivityInput{
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-lookup-fail",
			TraceID:    "trace-executor-001",
		},
	)
	if err == nil {
		t.Fatal("lookup failure must fail closed")
	}
	run, getErr := store.GetRun(context.Background(), "run-rag-lookup-fail")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
}

func TestPlanRAGActivitySelectsStudentRuleScopeWithoutExplicitRequestedScope(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-scope-selection",
		"conv-rag-scope-selection",
		now,
		ragHandoffForDurableWorkerTest("中央民族大学本科学生国家奖学金评审办法"),
	)
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-scope-selection",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-scope-selection",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-scope-selection",
			WorkflowID:     "campus-agent.chat.run-rag-scope-selection",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}

	output, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-scope-selection",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}
	run, getErr := store.GetRun(context.Background(), output.RunID)
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	plan, planErr := temporalRAGPlanProjectionFromRun(run, output.PlanRef)
	if planErr != nil {
		t.Fatalf("get rag plan projection: %v", planErr)
	}
	if plan.Corpus != "regulations" ||
		plan.Collection != "student_rules" ||
		plan.CollectionAlias != "student_rules" {
		t.Fatalf("selected scope = %#v, want regulations/student_rules", plan)
	}
	if plan.PlanID != "rag:regulations:student_rules:current" {
		t.Fatalf("plan id = %q, want stable retrieval plan id", plan.PlanID)
	}
}

func TestPlanRAGActivityFailsClosedWhenScopeCannotBeSelected(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-scope-ambiguous",
		"conv-rag-scope-ambiguous",
		now,
		ragHandoffForDurableWorkerTest("这个问题怎么处理"),
	)
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-scope-ambiguous",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-scope-ambiguous",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-scope-ambiguous",
			WorkflowID:     "campus-agent.chat.run-rag-scope-ambiguous",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}

	_, err = server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-scope-ambiguous",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err == nil {
		t.Fatal("ambiguous rag scope must fail closed")
	}
	run, getErr := store.GetRun(context.Background(), "run-rag-scope-ambiguous")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
}

func validLookupResultForTest(plan ragruntime.PlanProjection) ragruntime.RetrievalLookupResult {
	result := ragruntime.RetrievalLookupResult{
		CandidateCount: 1,
		Candidates: []ragruntime.EvidenceRef{{
			ChunkID:   "student_rules:chunk-1",
			Excerpt:   "学生应当按照学校规定办理请假手续。",
			Score:     0.91,
			SourceID:  "student_rules",
			SourceRef: "source://regulations/student_rules/student_rules",
			SpanRef:   "span://student_rules/chunk-1#0-24",
			Title:     "学生手册",
		}},
		LookupRef:      temporalProjectionRef(plan.RunID, "retrieval/indexed-lookup"),
		QueryLatencyMS: 12,
		Request: ragruntime.RetrievalLookupRequest{
			CollectionAlias: plan.CollectionAlias,
			QueryMode:       plan.QueryMode,
			QueryText:       plan.QueryText,
			RunID:           plan.RunID,
			TopK:            plan.TopK,
		},
		SchemaVersion: "retrieval_lookup_result_v1",
	}
	hash, err := ragruntime.HashProjection(result)
	if err != nil {
		panic(err)
	}
	result.PayloadSHA256 = hash
	return result
}

func addRequestedScopeForRunTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	corpus string,
	collection string,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run for scope update: %v", err)
	}
	metadata := cloneTemporalMetadata(run.Metadata)
	payload, _ := metadata["execution_payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	payload["requested_scope"] = map[string]any{"corpus": corpus, "collection": collection}
	metadata["execution_payload"] = payload
	if err := store.ReplaceRunMetadata(context.Background(), runID, metadata); err != nil {
		t.Fatalf("replace run metadata: %v", err)
	}
}

func assertStepIDs(t *testing.T, steps []execution.RunStepProjection, expected []string) {
	t.Helper()
	if len(steps) != len(expected) {
		t.Fatalf("step count = %d, want %d: %#v", len(steps), len(expected), steps)
	}
	seen := map[string]bool{}
	for _, step := range steps {
		seen[step.StepID] = true
	}
	for _, stepID := range expected {
		if !seen[stepID] {
			t.Fatalf("step %q missing from %#v", stepID, steps)
		}
	}
}
