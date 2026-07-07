package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestTemporalRAGGraphActivitiesProjectSevenStepTrajectory(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	lookup := &fakeRAGLookupExecutor{}
	server.ragLookupExecutor = lookup
	server.ragLookupErr = nil
	server.ragVersionResolver = fakeRAGVersionResolver{}
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
	setRunMemoryEnabledForTest(t, store, "run-rag-graph", true)
	addRequestedScopeForRunTest(t, store, "run-rag-graph", "regulations", "student_rules")

	memoryRecall, err := server.MemoryRecallActivity(
		context.Background(),
		temporalruntime.MemoryRecallActivityInput{
			RequestID:     "req-executor-001",
			RequestedTool: "knowledge_query",
			RunID:         "run-rag-graph",
			TraceID:       "trace-executor-001",
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
	evidence, err := server.SelectEvidenceActivity(
		context.Background(),
		temporalruntime.SelectEvidenceActivityInput{
			LookupRef:  lookupOutput.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
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
	if completedRun.SelectedTool != "knowledge_query" {
		t.Fatalf("run selected tool = %q, want knowledge_query", completedRun.SelectedTool)
	}
	events, eventsErr := store.ListRunEvents(context.Background(), "run-rag-graph")
	if eventsErr != nil {
		t.Fatalf("list run events: %v", eventsErr)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if _, ok := finalizationResponse["error"]; !ok {
		t.Fatalf("finalization response missing required error field: %#v", finalizationResponse)
	}
	if finalizationResponse["error"] != nil {
		t.Fatalf("finalization response error = %#v, want nil", finalizationResponse["error"])
	}
	stageTiming, ok := finalizationResponse["stage_timing"].(map[string]any)
	if !ok {
		t.Fatalf("stage_timing = %#v", finalizationResponse["stage_timing"])
	}
	for _, field := range []string{
		"memory.recall_ms",
		"rag.plan_ms",
		"rag.lookup_ms",
		"rag.synthesis_ms",
		"rag.grounding_ms",
		"tool.total_ms",
		"tool.knowledge_query_ms",
		"finalization.write_ms",
	} {
		if _, ok := stageTiming[field]; !ok {
			t.Fatalf("stage_timing missing %s: %#v", field, stageTiming)
		}
	}
	if _, ok := stageTiming["rag.rerank_ms"]; ok {
		t.Fatalf("stage_timing must not synthesize rag.rerank_ms without a rerank step: %#v", stageTiming)
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
		return
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
	diagnostics, _ := nestedMapValue(projectedResponse, "result", "diagnostics")
	diagnosticRecord, _ := diagnostics.(map[string]any)
	if diagnosticRecord["grounding_verdict"] == "grounded" {
		t.Fatalf("Go RAG diagnostics must not default to semantic grounded: %#v", diagnosticRecord)
	}
	if diagnosticRecord["verification_kind"] != "evidence_integrity" {
		t.Fatalf("diagnostic verification kind = %v, want evidence_integrity", diagnosticRecord["verification_kind"])
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
		"evidence.selection",
		"synthesis",
		"grounding.verify",
		"finalization.write",
	})
	attempts, err := store.ListStepAttempts(context.Background(), "run-rag-graph")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 8 {
		t.Fatalf("attempt count = %d, want 8: %#v", len(attempts), attempts)
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
		return
	}
	if synthesisAttempt.ProviderRequestRef != "provider://requests/run-rag-graph/synthesis" ||
		synthesisAttempt.InputTokens != 400 ||
		synthesisAttempt.OutputTokens != 100 ||
		synthesisAttempt.EstimatedCostMicroUSD != 320 {
		t.Fatalf("synthesis provider evidence = %#v", synthesisAttempt)
	}
	var groundingResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "grounding.verify" {
			groundingResult = &results[index]
		}
	}
	if groundingResult == nil {
		t.Fatal("grounding.verify result missing")
		return
	}
	if groundingResult.SanitizedPayload["verification_kind"] != "evidence_integrity" {
		t.Fatalf("grounding result verification kind = %v, want evidence_integrity: %#v", groundingResult.SanitizedPayload["verification_kind"], groundingResult.SanitizedPayload)
	}
}

func TestLiveSourceLookupActivityProjectsLiveOfficialWebLookup(t *testing.T) {
	var providerRequest map[string]any
	providerServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/search" {
			t.Fatalf("provider path = %s, want /search", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&providerRequest); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"results": []map[string]any{{
				"title":   "中央民族大学校园网通知",
				"url":     "https://it.example.edu/info/1001/1234.htm?utm_source=test#notice",
				"snippet": "校园网认证系统将于今晚维护，请提前保存工作。",
			}},
		})
	}))
	defer providerServer.Close()

	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTestWithPublicWebSearchDomains("example.edu")
	attachRunProjectionStoreForHandlerTest(server, store)
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "search-key",
			BaseURL:   providerServer.URL,
			Kind:      "search",
			Model:     "sonar",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "perplexity",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "perplexity_search",
		},
	}
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-live-lookup",
		"conv-rag-live-lookup",
		now,
		ragHandoffForDurableWorkerTest("中央民族大学今天校园网维护通知"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-live-lookup", "official_web", "fresh_news")
	setVersionQueryForRunTest(t, store, "run-rag-live-lookup", map[string]any{"mode": "freshness_sensitive"})
	setFreshnessIntentForRunTest(t, store, "run-rag-live-lookup", "latest")

	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-live-lookup",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-live-lookup",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-live-lookup",
			WorkflowID:     "campus-agent.chat.run-rag-live-lookup",
		},
	)
	if err != nil {
		t.Fatalf("plan route: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-live-lookup",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}
	runAfterPlan, err := store.GetRun(context.Background(), "run-rag-live-lookup")
	if err != nil {
		t.Fatalf("get run after rag plan: %v", err)
	}
	planProjection, err := temporalRAGPlanProjectionFromRun(runAfterPlan, ragPlan.PlanRef)
	if err != nil {
		t.Fatalf("rag plan projection: %v", err)
	}
	if planProjection.ResolvedVersionQuery != nil {
		t.Fatalf("fresh/live plan must not resolve indexed version query: %#v", planProjection.ResolvedVersionQuery)
	}
	lookupOutput, err := server.LiveSourceLookupActivity(
		context.Background(),
		temporalruntime.LiveSourceLookupActivityInput{
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-live-lookup",
			StepTypes:  []string{"freshness_gate", "live_source_lookup"},
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("live source lookup: %v", err)
	}
	if lookupOutput.LookupRef != temporalProjectionRef("run-rag-live-lookup", "retrieval/live-source-lookup") {
		t.Fatalf("lookup ref = %q", lookupOutput.LookupRef)
	}
	if providerRequest == nil {
		t.Fatal("public web search provider was not called")
	}
	run, err := store.GetRun(context.Background(), "run-rag-live-lookup")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	lookup, err := temporalRAGLookupResultFromRun(run, lookupOutput.LookupRef)
	if err != nil {
		t.Fatalf("lookup projection: %v", err)
	}
	if lookup.Request.QueryMode != "freshness_sensitive" || lookup.Request.CollectionAlias != "official_web/fresh_news" {
		t.Fatalf("lookup request = %#v", lookup.Request)
	}
	if lookup.FreshnessGate == nil ||
		lookup.FreshnessGate.Decision != "allowed" ||
		lookup.FreshnessGate.SourcePolicy != "official_web_public_only" ||
		lookup.FreshnessGate.VerifiedAt == "" {
		t.Fatalf("freshness gate verdict = %#v, want allowed official-web verdict", lookup.FreshnessGate)
	}
	if lookup.CandidateCount != 1 {
		t.Fatalf("candidate count = %d, want 1", lookup.CandidateCount)
	}
	candidate := lookup.Candidates[0]
	if candidate.RetrievalMode != "live_assisted" ||
		candidate.CanonicalIndexTruth ||
		candidate.AsOf == "" ||
		candidate.SourcePolicyVerdict != "allowed" ||
		candidate.SourceTrustTier != "T2" {
		t.Fatalf("live evidence metadata = %#v", candidate)
	}
	if candidate.CanonicalURL != "https://it.example.edu/info/1001/1234.htm" ||
		candidate.SourceChannel != "official_web" ||
		!candidate.IsAnswerBearing {
		t.Fatalf("live evidence source = %#v", candidate)
	}
}

func TestLiveSourceLookupActivityRejectsLiveBranchWithoutExecutableStep(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-live-invalid-step",
		"conv-rag-live-invalid-step",
		now,
		ragHandoffForDurableWorkerTest("中央民族大学今天校园网维护通知"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-live-invalid-step", "official_web", "fresh_news")
	setVersionQueryForRunTest(t, store, "run-rag-live-invalid-step", map[string]any{"mode": "freshness_sensitive"})
	setFreshnessIntentForRunTest(t, store, "run-rag-live-invalid-step", "latest")

	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-live-invalid-step",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-invalid-step",
			RunID:          "run-rag-live-invalid-step",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-live-invalid-step",
			WorkflowID:     "campus-agent.chat.run-rag-live-invalid-step",
		},
	)
	if err != nil {
		t.Fatalf("plan route: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-live-invalid-step",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}

	_, err = server.LiveSourceLookupActivity(
		context.Background(),
		temporalruntime.LiveSourceLookupActivityInput{
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-live-invalid-step",
			StepTypes:  []string{"parent_context_expand"},
			TraceID:    "trace-executor-001",
		},
	)
	if err == nil {
		t.Fatal("live source lookup accepted non-executable step")
	}
	if !strings.Contains(err.Error(), "unsupported live_source_lookup step_type") {
		t.Fatalf("error = %v, want unsupported step_type", err)
	}
}

func TestSynthesisLateSuccessAfterCancelDoesNotOverwriteTerminalProjection(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
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
	evidence, err := server.SelectEvidenceActivity(
		context.Background(),
		temporalruntime.SelectEvidenceActivityInput{
			LookupRef:  lookupOutput.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
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
		return
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
	attachReadyRAGVersionResolverForTest(server)
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
	attachReadyRAGVersionResolverForTest(server)
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
