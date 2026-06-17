package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestPlanRouteActivityBuildsCampusServicesPlanFromExecutionPayload(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 9, 1, 2, 3, 0, time.UTC)
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:               "run-route-campus-services",
		ConversationID:      "conv-route-campus-services",
		TurnID:              "turn-route-campus-services",
		RequestID:           "req-route-campus-services",
		TraceID:             "trace-route-campus-services",
		OwnerUserID:         "user-route-campus-services",
		Surface:             "public-chat-web",
		RequestedCapability: "campus_services",
		SelectedCapability:  "campus_services",
		Lane:                execution.DurableLaneCampusServices,
		Status:              execution.DurableRunStatusQueued,
		CreatedAt:           now,
		QueuedAt:            now,
		UpdatedAt:           now,
		Metadata: map[string]any{
			"execution_payload": map[string]any{
				"context": map[string]any{
					"actor": map[string]any{
						"user_id": "user-route-campus-services",
					},
					"session": map[string]any{
						"confirmed_slots": []any{},
						"selected_notice_ref": map[string]any{
							"notice_id":      "notice:transport:353903",
							"source_family":  "internal_notice_restricted",
							"title":          "关于通勤班车丰台校区乘车点调整的通知",
							"target_surface": "campus_services/service_status_candidate",
						},
						"turn_count": 1,
					},
				},
				"conversation_id":      "conv-route-campus-services",
				"effective_capability": "campus_services",
				"lane":                 "campus_services",
				"request_id":           "req-route-campus-services",
				"requested_capability": "campus_services",
				"requested_scope":      nil,
				"trace":                map[string]any{"trace_id": "trace-route-campus-services"},
				"user_goal":            "今天丰台到海淀通勤车乘车点有没有调整",
				"version_query":        map[string]any{"mode": "current"},
			},
		},
	}); err != nil {
		t.Fatalf("create run: %v", err)
	}

	route, err := server.PlanRouteActivity(context.Background(), temporalruntime.PlanRouteActivityInput{
		ConversationID:      "conv-route-campus-services",
		Namespace:           "campus-agent-test",
		PayloadSHA256:       "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		RequestID:           "req-route-campus-services",
		RequestedCapability: "campus_services",
		RunID:               "run-route-campus-services",
		TraceID:             "trace-route-campus-services",
		TurnID:              "turn-route-campus-services",
		WorkflowID:          "campus-agent.chat.run-route-campus-services",
	})
	if err != nil {
		t.Fatalf("plan route: %v", err)
	}
	if route.Capability != "campus_services" || route.WorkflowMode != "multi_step" {
		t.Fatalf("route = %#v, want campus_services multi_step plan", route)
	}
	if len(route.Steps) != 3 {
		t.Fatalf("route steps = %#v, want schedule, notice change-set, knowledge", route.Steps)
	}
	if route.Steps[0].ToolName != "transport_schedule_lookup" ||
		route.Steps[1].ToolName != "campus_notice_change_set_lookup" ||
		route.Steps[2].Capability != "knowledge" {
		t.Fatalf("route steps = %#v, want typed tools followed by knowledge", route.Steps)
	}
}

func TestPlanRouteActivityRejectsLegacyHandoffOnlyMetadata(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 9, 1, 2, 3, 0, time.UTC)
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:               "run-route-legacy-handoff-only",
		ConversationID:      "conv-route-legacy-handoff-only",
		TurnID:              "turn-route-legacy-handoff-only",
		RequestID:           "req-route-legacy-handoff-only",
		TraceID:             "trace-route-legacy-handoff-only",
		OwnerUserID:         "user-route-legacy-handoff-only",
		Surface:             "public-chat-web",
		RequestedCapability: "knowledge",
		SelectedCapability:  "knowledge",
		Lane:                execution.DurableLaneRAG,
		Status:              execution.DurableRunStatusQueued,
		CreatedAt:           now,
		QueuedAt:            now,
		UpdatedAt:           now,
		Metadata: map[string]any{
			"handoff": map[string]any{
				"allowed_tools": []any{"retrieval.query"},
				"capability":    "knowledge",
				"payload":       map[string]any{"query_text": "学生请假手续"},
				"payload_kind":  "rag_request",
			},
		},
	}); err != nil {
		t.Fatalf("create run: %v", err)
	}

	_, err := server.PlanRouteActivity(context.Background(), temporalruntime.PlanRouteActivityInput{
		ConversationID:      "conv-route-legacy-handoff-only",
		Namespace:           "campus-agent-test",
		PayloadSHA256:       "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		RequestID:           "req-route-legacy-handoff-only",
		RequestedCapability: "knowledge",
		RunID:               "run-route-legacy-handoff-only",
		TraceID:             "trace-route-legacy-handoff-only",
		TurnID:              "turn-route-legacy-handoff-only",
		WorkflowID:          "campus-agent.chat.run-route-legacy-handoff-only",
	})
	if err == nil {
		t.Fatal("legacy handoff-only metadata must not be accepted by plan.route")
	}
}

func TestPlanRAGActivityUsesExecutionPayloadUserGoalOverLegacyHandoff(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-user-goal-source",
		"conv-rag-user-goal-source",
		now,
		ragHandoffForDurableWorkerTest("旧 handoff query 不应被使用"),
	)
	setExecutionPayloadUserGoalForRunTest(
		t,
		store,
		"run-rag-user-goal-source",
		"中央民族大学本科学生国家奖学金评审办法",
	)
	addRequestedScopeForRunTest(t, store, "run-rag-user-goal-source", "regulations", "student_rules")
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-user-goal-source",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-user-goal-source",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-user-goal-source",
			WorkflowID:     "campus-agent.chat.run-rag-user-goal-source",
		},
	)
	if err != nil {
		t.Fatalf("plan route: %v", err)
	}

	output, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-user-goal-source",
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
	if plan.QueryText != "中央民族大学本科学生国家奖学金评审办法" {
		t.Fatalf("rag query text = %q, want execution_payload.user_goal", plan.QueryText)
	}
}

func setExecutionPayloadUserGoalForRunTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	userGoal string,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run for user goal update: %v", err)
	}
	metadata := cloneTemporalMetadata(run.Metadata)
	payload, _ := metadata["execution_payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	payload["user_goal"] = userGoal
	metadata["execution_payload"] = payload
	if err := store.ReplaceRunMetadata(context.Background(), runID, metadata); err != nil {
		t.Fatalf("replace run metadata: %v", err)
	}
}
