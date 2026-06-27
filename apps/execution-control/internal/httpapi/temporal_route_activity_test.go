package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestPlanRouteActivityPlansCampusServicesTransportTool(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 9, 1, 2, 3, 0, time.UTC)
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          "run-route-campus-services",
		ConversationID: "conv-route-campus-services",
		TurnID:         "turn-route-campus-services",
		RequestID:      "req-route-campus-services",
		TraceID:        "trace-route-campus-services",
		OwnerUserID:    "user-route-campus-services",
		Surface:        "campus-web",
		RequestedTool:  "transport_schedule_lookup",
		SelectedTool:   "transport_schedule_lookup",
		TaskQueue:      "campus-agent.workflow",
		Status:         execution.DurableRunStatusQueued,
		CreatedAt:      now,
		QueuedAt:       now,
		UpdatedAt:      now,
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
				"conversation_id": "conv-route-campus-services",
				"effective_tool":  "transport_schedule_lookup",
				"task_queue":      "campus-agent.workflow",
				"request_id":      "req-route-campus-services",
				"requested_tool":  "transport_schedule_lookup",
				"requested_scope": nil,
				"trace":           map[string]any{"trace_id": "trace-route-campus-services"},
				"user_goal":       "今天丰台到海淀通勤车乘车点有没有调整",
				"version_query":   map[string]any{"mode": "current"},
			},
		},
	}); err != nil {
		t.Fatalf("create run: %v", err)
	}

	route, err := server.PlanRouteActivity(context.Background(), temporalruntime.PlanRouteActivityInput{
		ConversationID: "conv-route-campus-services",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		RequestID:      "req-route-campus-services",
		RequestedTool:  "transport_schedule_lookup",
		RunID:          "run-route-campus-services",
		TraceID:        "trace-route-campus-services",
		TurnID:         "turn-route-campus-services",
		WorkflowID:     "campus-agent.chat.run-route-campus-services",
	})
	if err != nil {
		t.Fatalf("PlanRouteActivity failed: %v", err)
	}
	if route.WorkflowMode != "single_step" ||
		route.ToolTarget != "transport_schedule_lookup" ||
		len(route.Steps) != 1 ||
		route.ToolName != "transport_schedule_lookup" ||
		len(route.AllowedTools) != 1 ||
		route.AllowedTools[0] != "transport_schedule_lookup" {
		t.Fatalf("route = %#v, want campus_services single transport tool step", route)
	}
	first := route.Steps[0]
	if first.ToolTarget != "transport_schedule_lookup" ||
		first.PayloadKind != "transport_schedule_lookup" ||
		first.ToolName != "transport_schedule_lookup" {
		t.Fatalf("first route step = %#v", first)
	}
}

func TestPlanRouteActivityRejectsLegacyHandoffOnlyMetadata(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 9, 1, 2, 3, 0, time.UTC)
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          "run-route-legacy-handoff-only",
		ConversationID: "conv-route-legacy-handoff-only",
		TurnID:         "turn-route-legacy-handoff-only",
		RequestID:      "req-route-legacy-handoff-only",
		TraceID:        "trace-route-legacy-handoff-only",
		OwnerUserID:    "user-route-legacy-handoff-only",
		Surface:        "campus-web",
		RequestedTool:  "knowledge_query",
		SelectedTool:   "knowledge_query",
		TaskQueue:      "campus-agent.workflow",
		Status:         execution.DurableRunStatusQueued,
		CreatedAt:      now,
		QueuedAt:       now,
		UpdatedAt:      now,
		Metadata: map[string]any{
			"handoff": map[string]any{
				"allowed_tools": []any{"knowledge_query"},
				"tool":          "knowledge_query",
				"payload":       map[string]any{"query_text": "学生请假手续"},
				"payload_kind":  "rag_request",
			},
		},
	}); err != nil {
		t.Fatalf("create run: %v", err)
	}

	_, err := server.PlanRouteActivity(context.Background(), temporalruntime.PlanRouteActivityInput{
		ConversationID: "conv-route-legacy-handoff-only",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		RequestID:      "req-route-legacy-handoff-only",
		RequestedTool:  "knowledge_query",
		RunID:          "run-route-legacy-handoff-only",
		TraceID:        "trace-route-legacy-handoff-only",
		TurnID:         "turn-route-legacy-handoff-only",
		WorkflowID:     "campus-agent.chat.run-route-legacy-handoff-only",
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

func TestPlanRAGActivityRewritesFollowupFromConversationEvidence(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-followup-rewrite",
		"conv-rag-followup-rewrite",
		now,
		ragHandoffForDurableWorkerTest("这个第二点具体是什么要求"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-followup-rewrite", "regulations", "student_rules")
	setExecutionPayloadConversationContextForRunTest(t, store, "run-rag-followup-rewrite", map[string]any{
		"previous_answer_summary": "上一轮回答提到转专业申请条件和学院审核。",
		"previous_evidence_refs": []any{
			map[string]any{
				"collection":    "student_rules",
				"document_id":   "student_rules",
				"evidence_id":   "ev-transfer-001",
				"section_title": "转专业条件",
				"snippet":       "学生申请转专业应符合年级、成绩、名额和学院审核要求。",
				"source_id":     "student_rules",
				"title":         "本科生学籍管理规定",
				"version_id":    "student_rules:v-current",
			},
		},
		"previous_tool_results": []any{},
		"recent_turns": []any{
			map[string]any{
				"message_id": "msg-prev-user",
				"role":       "user",
				"content":    "转专业有哪些条件？",
			},
			map[string]any{
				"message_id": "msg-prev-assistant",
				"role":       "assistant",
				"summary":    "转专业需要满足年级、成绩、名额和学院审核要求。",
			},
		},
	})
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-followup-rewrite",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-followup-rewrite",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-followup-rewrite",
			WorkflowID:     "campus-agent.chat.run-rag-followup-rewrite",
		},
	)
	if err != nil {
		t.Fatalf("plan route: %v", err)
	}
	output, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-followup-rewrite",
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
	if !strings.Contains(plan.QueryText, "上一轮证据") || !strings.Contains(plan.QueryText, "转专业条件") {
		t.Fatalf("rag query text = %q, want previous evidence context", plan.QueryText)
	}
	if plan.QueryRewrite == nil || plan.QueryRewrite.FollowupReference.Type != "previous_evidence" {
		t.Fatalf("query rewrite = %#v, want previous_evidence reference", plan.QueryRewrite)
	}
	if !strings.HasPrefix(plan.QueryRewrite.StandaloneQueryHash, "sha256:") {
		t.Fatalf("standalone query hash = %q, want sha256 ref", plan.QueryRewrite.StandaloneQueryHash)
	}
	if plan.PreviousEvidenceReuse == nil ||
		plan.PreviousEvidenceReuse.Decision != "contextual_anchor_for_new_retrieval" {
		t.Fatalf("previous evidence reuse = %#v, want contextual anchor", plan.PreviousEvidenceReuse)
	}
	if len(plan.Steps) == 0 || len(plan.Steps[0].Selector.PreferredDocumentIDs) != 1 ||
		plan.Steps[0].Selector.PreferredDocumentIDs[0] != "student_rules" {
		t.Fatalf("step selector = %#v, want previous evidence preferred document", plan.Steps)
	}
}

func TestRAGSynthesisPacketCarriesPreviousEvidenceContextFromRewrite(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-followup-synthesis-context",
		"conv-rag-followup-synthesis-context",
		now,
		ragHandoffForDurableWorkerTest("这个第二点具体是什么要求"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-followup-synthesis-context", "regulations", "student_rules")
	setExecutionPayloadConversationContextForRunTest(t, store, "run-rag-followup-synthesis-context", map[string]any{
		"previous_answer_summary": "上一轮回答提到转专业申请条件和学院审核。",
		"previous_evidence_refs": []any{
			map[string]any{
				"access_scope":  "public_student_rule",
				"collection":    "student_rules",
				"content_hash":  "sha256:transfer-major-evidence-example",
				"document_id":   "student_rules",
				"evidence_id":   "ev-transfer-001",
				"section_title": "转专业条件",
				"snippet":       "学生申请转专业应符合年级、成绩、名额和学院审核要求。",
				"source_id":     "student_rules",
				"title":         "本科生学籍管理规定",
				"version_id":    "student_rules:v-current",
			},
		},
		"previous_tool_results": []any{},
		"recent_turns":          []any{},
	})
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-followup-synthesis-context",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-followup-synthesis-context",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-followup-synthesis-context",
			WorkflowID:     "campus-agent.chat.run-rag-followup-synthesis-context",
		},
	)
	if err != nil {
		t.Fatalf("plan route: %v", err)
	}
	planOutput, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-followup-synthesis-context",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}
	run, getErr := store.GetRun(context.Background(), planOutput.RunID)
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	selection := ragruntime.EvidenceSelectionResult{
		CandidateCount: 1,
		CoverageStatus: "supported",
		EvidenceRef:    temporalProjectionRef(run.RunID, "evidence/selection"),
		RunID:          run.RunID,
		SchemaVersion:  "evidence_selection_result_v1",
		SelectedEvidence: []ragruntime.EvidenceRef{{
			ChunkID:   "student_rules:chunk-1",
			Excerpt:   "学生申请转专业应符合年级要求。",
			SourceID:  "student_rules",
			SourceRef: "source://regulations/student_rules/student_rules",
			SpanRef:   "span://student_rules/chunk-1#0-24",
		}},
		SupportingEvidenceCount: 1,
	}
	hash, err := ragruntime.HashProjection(selection)
	if err != nil {
		t.Fatalf("hash evidence selection: %v", err)
	}
	selection.PayloadSHA256 = hash
	if err := server.replaceTemporalRAGMetadata(context.Background(), run, func(metadata map[string]any) {
		metadata["evidence_ref"] = selection.EvidenceRef
		metadata["evidence_selection"] = selection
	}); err != nil {
		t.Fatalf("replace rag metadata: %v", err)
	}
	run, getErr = store.GetRun(context.Background(), planOutput.RunID)
	if getErr != nil {
		t.Fatalf("get updated run: %v", getErr)
	}

	packet, err := temporalRAGSynthesisPacketForRun(run, planOutput.PlanRef, selection.EvidenceRef)
	if err != nil {
		t.Fatalf("synthesis packet: %v", err)
	}
	if len(packet.PreviousEvidenceContext) != 1 ||
		packet.PreviousEvidenceContext[0].EvidenceID != "ev-transfer-001" ||
		packet.PreviousEvidenceContext[0].ContentHash != "sha256:transfer-major-evidence-example" {
		t.Fatalf("previous evidence context = %#v", packet.PreviousEvidenceContext)
	}
	providerInput := ragProviderInput(packet)
	userPayload := providerInput[1]["content"].(string)
	if !strings.Contains(userPayload, "previous_evidence_context") ||
		!strings.Contains(userPayload, "ev-transfer-001") {
		t.Fatalf("provider payload missing previous evidence context: %s", userPayload)
	}
}

func TestPlanRAGActivityFailsClosedWhenFollowupHasNoConversationAnchor(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-followup-unresolved",
		"conv-rag-followup-unresolved",
		now,
		ragHandoffForDurableWorkerTest("这个具体是什么要求"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-followup-unresolved", "regulations", "student_rules")
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-followup-unresolved",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-executor-001",
			RunID:          "run-rag-followup-unresolved",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-run-rag-followup-unresolved",
			WorkflowID:     "campus-agent.chat.run-rag-followup-unresolved",
		},
	)
	if err != nil {
		t.Fatalf("plan route: %v", err)
	}
	_, err = server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-followup-unresolved",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err == nil || !strings.Contains(err.Error(), "rag follow-up query requires resolvable conversation context") {
		t.Fatalf("plan rag error = %v, want unresolved follow-up failure", err)
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

func setExecutionPayloadConversationContextForRunTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	conversationContext map[string]any,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run for conversation context update: %v", err)
	}
	metadata := cloneTemporalMetadata(run.Metadata)
	payload, _ := metadata["execution_payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	contextProjection, _ := payload["context"].(map[string]any)
	if contextProjection == nil {
		contextProjection = map[string]any{}
	}
	contextProjection["conversation"] = conversationContext
	payload["context"] = contextProjection
	metadata["execution_payload"] = payload
	if err := store.ReplaceRunMetadata(context.Background(), runID, metadata); err != nil {
		t.Fatalf("replace run metadata: %v", err)
	}
}
