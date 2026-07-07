package httpapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

func TestSynthesisProviderFailureProjectsPacketSummary(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.ragLookupExecutor = &fakeRAGLookupExecutor{}
	server.ragLookupErr = nil
	server.ragSynthesisExecutor = &fakeRAGSynthesisExecutor{
		err:    errors.New("provider responses status 502"),
		status: 502,
		summary: provider.ExecutionSummary{
			CancelOutcome:      provider.CancelOutcomeNotRequested,
			DiagnosticStatus:   provider.DiagnosticProviderHTTPError,
			ModelName:          "gpt-5.5",
			ModelProvider:      "openai",
			ProviderRequestRef: "provider://requests/run-rag-provider-failure/synthesis",
			SchemaVersion:      "provider_execution_summary_v1",
			TimeoutOutcome:     provider.TimeoutOutcomeNotTimedOut,
		},
	}
	server.ragSynthesisErr = nil
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-provider-failure",
		"conv-rag-provider-failure",
		now,
		ragHandoffForDurableWorkerTest("学生请假手续"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-provider-failure", "regulations", "student_rules")
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-provider-failure",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-provider-failure-001",
			RunID:          "run-rag-provider-failure",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-provider-failure",
			WorkflowID:     "campus-agent.chat.run-rag-provider-failure",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-provider-failure",
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
			RunID:      "run-rag-provider-failure",
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
			RunID:      "run-rag-provider-failure",
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
			RunID:       "run-rag-provider-failure",
			TraceID:     "trace-executor-001",
		},
	)
	if err == nil {
		t.Fatal("expected provider synthesis failure")
	}
	var applicationErr *temporal.ApplicationError
	if !errors.As(err, &applicationErr) || !applicationErr.NonRetryable() {
		t.Fatalf("provider terminal projection error must be non-retryable: %#v", err)
	}
	run, err := store.GetRun(context.Background(), "run-rag-provider-failure")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
	if run.TerminalReason != execution.DurableTerminalReasonProviderUnavailable {
		t.Fatalf("terminal reason = %q, want provider_unavailable", run.TerminalReason)
	}
	if run.SelectedTool != "knowledge_query" {
		t.Fatalf("selected tool = %q, want knowledge_query", run.SelectedTool)
	}
	results, err := store.ListStepResults(context.Background(), "run-rag-provider-failure")
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	var payload map[string]any
	for _, result := range results {
		if result.StepID == "synthesis" {
			payload = result.SanitizedPayload
			break
		}
	}
	if payload == nil {
		t.Fatal("synthesis failure result missing")
	}
	packetSummary, ok := payload["packet_summary"].(map[string]any)
	if !ok {
		t.Fatalf("packet_summary missing from payload: %#v", payload)
	}
	if packetSummary["evidence_count"] != 1 ||
		packetSummary["output_schema_id"] != "rag_answer_v2" ||
		packetSummary["query_intent_chars"] == 0 ||
		packetSummary["packet_ref"] != temporalProjectionRef("run-rag-provider-failure", "synthesis/packet") {
		t.Fatalf("packet_summary = %#v", packetSummary)
	}
	if _, leaksExcerpt := packetSummary["selected_evidence"]; leaksExcerpt {
		t.Fatalf("packet_summary must not include selected evidence body: %#v", packetSummary)
	}
	if payload["provider_status"] != provider.DiagnosticProviderHTTPError {
		t.Fatalf("provider_status = %#v, want provider_http_error", payload["provider_status"])
	}
	if payload["provider_http_status"] != 502 {
		t.Fatalf("provider_http_status = %#v, want 502", payload["provider_http_status"])
	}
}
