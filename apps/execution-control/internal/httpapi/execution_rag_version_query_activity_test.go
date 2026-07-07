package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestPlanRAGActivityPreservesExplicitHistoricalVersionQuery(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-historical-version",
		"conv-rag-historical-version",
		now,
		ragHandoffForDurableWorkerTest("旧版国奖评审办法"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-historical-version", "regulations", "student_rules")
	addVersionQueryForRunTest(t, store, "run-rag-historical-version", map[string]any{
		"mode":       "historical",
		"version_id": "v1:national-scholarship",
	})
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-historical-version",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-historical-version",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-historical-version",
			WorkflowID:     "campus-agent.chat.run-rag-historical-version",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}

	output, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-historical-version",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-rag-historical-version")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	plan, err := temporalRAGPlanProjectionFromRun(run, output.PlanRef)
	if err != nil {
		t.Fatalf("decode rag plan: %v", err)
	}
	if plan.QueryMode != "historical" {
		t.Fatalf("query mode = %q, want historical", plan.QueryMode)
	}
	if plan.VersionQuery == nil || plan.VersionQuery.VersionID != "v1:national-scholarship" {
		t.Fatalf("version query = %#v, want explicit version id", plan.VersionQuery)
	}
}

func TestPlanRAGActivityRejectsCurrentVersionQueryWithVersionFields(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-current-version-field",
		"conv-rag-current-version-field",
		now,
		ragHandoffForDurableWorkerTest("学生请假手续"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-current-version-field", "regulations", "student_rules")
	addVersionQueryForRunTest(t, store, "run-rag-current-version-field", map[string]any{
		"mode":       "current",
		"version_id": "v1:must-not-be-silently-dropped",
	})
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-current-version-field",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-current-version-field",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-current-version-field",
			WorkflowID:     "campus-agent.chat.run-rag-current-version-field",
		},
	)
	if err != nil {
		t.Fatalf("plan chat answer: %v", err)
	}

	_, err = server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-current-version-field",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err == nil {
		t.Fatal("current version query with version fields must fail closed")
	}
}

func addVersionQueryForRunTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	versionQuery map[string]any,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run for version query update: %v", err)
	}
	metadata := cloneTemporalMetadata(run.Metadata)
	payload, _ := metadata["execution_payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	payload["version_query"] = versionQuery
	metadata["execution_payload"] = payload
	if err := store.ReplaceRunMetadata(context.Background(), runID, metadata); err != nil {
		t.Fatalf("replace run metadata: %v", err)
	}
}
