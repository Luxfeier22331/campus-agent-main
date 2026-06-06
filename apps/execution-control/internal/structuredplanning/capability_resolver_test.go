package structuredplanning

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

func TestResolveCapabilityPlanBuildsNoticeKnowledgeWorkflowPlan(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)

	plan, err := ResolveCapabilityPlan(
		selectedNoticeKnowledgeFollowthroughCapabilityPlan(Request{
			EffectiveCapability: "knowledge",
			UserGoal:            "这条通知依据学生手册哪条规定？",
			HasRequestedScope:   true,
			RequestedScope: Scope{
				Corpus:     "regulations",
				Collection: "student_rules",
			},
			SelectedNoticeRef: SelectedNoticeRef{
				NoticeID:      "notice:smoke:001",
				SourceFamily:  "wechat_public_notice",
				TargetSurface: "regulations/student_rules",
			},
		}),
		agents,
		tools,
		artifacts,
	)
	if err != nil {
		t.Fatalf("ResolveCapabilityPlan failed: %v", err)
	}
	if plan.WorkflowMode != WorkflowModeMultiStep {
		t.Fatalf("workflow mode = %q, want multi_step", plan.WorkflowMode)
	}
	handoffs := plan.Handoffs()
	if len(handoffs) != 2 {
		t.Fatalf("handoff count = %d, want 2", len(handoffs))
	}
	if handoffs[0].Target != "notice-agent" || handoffs[0].PayloadKind != "campus_notice_get" {
		t.Fatalf("first handoff = %#v", handoffs[0])
	}
	if len(handoffs[0].AllowedTools) != 0 {
		t.Fatalf("first handoff allowed tools = %#v, want none", handoffs[0].AllowedTools)
	}
	if handoffs[1].Target != "rag-agent" || handoffs[1].PayloadKind != "rag_request" {
		t.Fatalf("second handoff = %#v", handoffs[1])
	}
	if len(handoffs[1].AllowedTools) != 0 {
		t.Fatalf("second handoff allowed tools = %#v, want none", handoffs[1].AllowedTools)
	}
	if plan.CapabilityPlan() == nil {
		t.Fatal("resolved workflow plan must retain capability plan reference")
	}
}

func TestResolveCapabilityPlanBuildsTransportNoticeOverrideWorkflowPlan(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)

	plan, err := ResolveCapabilityPlan(
		transportNoticeOverrideCapabilityPlan(Request{
			EffectiveCapability: "campus_services",
			UserGoal:            "2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
			SelectedNoticeRef: SelectedNoticeRef{
				NoticeID:      "353903",
				SourceFamily:  "internal_notice_restricted",
				TargetSurface: "campus_services/service_status_candidate",
			},
		}),
		agents,
		tools,
		artifacts,
	)
	if err != nil {
		t.Fatalf("ResolveCapabilityPlan failed: %v", err)
	}
	if plan.WorkflowMode != WorkflowModeMultiStep {
		t.Fatalf("workflow mode = %q, want multi_step", plan.WorkflowMode)
	}
	handoffs := plan.Handoffs()
	if len(handoffs) != 3 {
		t.Fatalf("handoff count = %d, want 3", len(handoffs))
	}
	if handoffs[0].PayloadKind != "transport_schedule_lookup" {
		t.Fatalf("first handoff = %#v", handoffs[0])
	}
	serviceTimeQuery := handoffs[0].Payload["service_time_query"].(map[string]any)
	if serviceTimeQuery["date_mode"] != "date" ||
		serviceTimeQuery["service_date"] != "2026-05-07" {
		t.Fatalf(
			"service_time_query = %#v, want explicit fixture service date",
			serviceTimeQuery,
		)
	}
	routeSelector := handoffs[0].Payload["route_selector"].(map[string]any)
	if routeSelector["origin_campus"] != "fengtai" ||
		routeSelector["destination_campus"] != "haidian" {
		t.Fatalf("route_selector = %#v, want fengtai -> haidian", routeSelector)
	}
	if handoffs[1].PayloadKind != "campus_notice_change_set_lookup" {
		t.Fatalf("second handoff = %#v", handoffs[1])
	}
	if handoffs[1].Payload["service_date"] != "2026-05-07" ||
		handoffs[1].Payload["query_time_anchor"] != "today" {
		t.Fatalf("change-set payload = %#v, want explicit date plus today anchor", handoffs[1].Payload)
	}
	if handoffs[2].PayloadKind != "rag_request" {
		t.Fatalf("third handoff = %#v", handoffs[2])
	}
	if len(plan.Edges) != 2 {
		t.Fatalf("workflow edges = %#v, want two dependency edges", plan.Edges)
	}
	if plan.Edges[0].RequiredProjectionKind != "schedule_baseline" {
		t.Fatalf("first edge required projection = %q", plan.Edges[0].RequiredProjectionKind)
	}
	if plan.Edges[1].RequiredProjectionKind != "notice_change_set" {
		t.Fatalf("second edge required projection = %q", plan.Edges[1].RequiredProjectionKind)
	}
}

func TestResolveCapabilityPlanFailsClosedWhenArtifactOwnerIsMissing(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)
	deleteArtifactBindingsForKinds(&artifacts, "notice_context")

	_, err := ResolveCapabilityPlan(sampleResolverCapabilityPlan(), agents, tools, artifacts)
	assertResolverFailure(t, err, "artifact_owner_missing")
}

func TestResolveCapabilityPlanFailsClosedWhenProducerIsClosed(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)
	plan := sampleResolverCapabilityPlan()
	plan.RequiredArtifacts = []string{"place_context"}

	_, err := ResolveCapabilityPlan(plan, agents, tools, artifacts)
	assertResolverFailure(t, err, "producer_closed")
}

func TestResolveCapabilityPlanFailsClosedWhenToolGateIsClosed(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)
	closeTool(&tools, "campus_notice_get")

	_, err := ResolveCapabilityPlan(sampleResolverCapabilityPlan(), agents, tools, artifacts)
	assertResolverFailure(t, err, "tool_gate_closed")
}

func TestResolveCapabilityPlanFailsClosedWhenArtifactProducerIsAmbiguous(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)
	appendAmbiguousBinding(&artifacts, "notice_context")

	_, err := ResolveCapabilityPlan(sampleResolverCapabilityPlan(), agents, tools, artifacts)
	assertResolverFailure(t, err, "ambiguous_producer")
}

func TestResolveCapabilityPlanFailsClosedWhenDependencyCycleExists(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)
	introduceCycle(&artifacts)

	_, err := ResolveCapabilityPlan(sampleResolverCapabilityPlan(), agents, tools, artifacts)
	assertResolverFailure(t, err, "dependency_cycle")
}

func TestResolveCapabilityPlanFailsClosedWhenBudgetIsExceeded(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)
	plan := sampleResolverCapabilityPlan()
	plan.Budget.MaxSteps = 1

	_, err := ResolveCapabilityPlan(plan, agents, tools, artifacts)
	assertResolverFailure(t, err, "budget_exceeded")
}

func TestResolveCapabilityPlanFailsClosedWhenArtifactIsNotAnswerEligible(t *testing.T) {
	agents, tools, artifacts := loadResolverRegistries(t)
	plan := sampleResolverCapabilityPlan()
	plan.RequiredArtifacts = []string{"grounding_verdict"}

	_, err := ResolveCapabilityPlan(plan, agents, tools, artifacts)
	assertResolverFailure(t, err, "ineligible_artifact_for_answer")
}

func loadResolverRegistries(
	t *testing.T,
) (runtimepolicy.AgentSpecRegistry, runtimepolicy.ToolSpecRegistry, runtimepolicy.WorkflowArtifactRegistry) {
	t.Helper()
	agents, err := runtimepolicy.LoadAgentSpecRegistry("")
	if err != nil {
		t.Fatalf("load agent spec: %v", err)
	}
	tools, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load tool spec: %v", err)
	}
	artifacts, err := runtimepolicy.LoadWorkflowArtifactRegistry("")
	if err != nil {
		t.Fatalf("load workflow artifact registry: %v", err)
	}
	return agents, tools, artifacts
}

func sampleResolverCapabilityPlan() CapabilityPlan {
	return selectedNoticeKnowledgeFollowthroughCapabilityPlan(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "这条通知依据学生手册哪条规定？",
		HasRequestedScope:   true,
		RequestedScope: Scope{
			Corpus:     "regulations",
			Collection: "student_rules",
		},
		SelectedNoticeRef: SelectedNoticeRef{
			NoticeID:      "notice:smoke:001",
			SourceFamily:  "wechat_public_notice",
			TargetSurface: "regulations/student_rules",
		},
	})
}

func assertResolverFailure(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected resolver error %q", code)
	}
	if !strings.Contains(err.Error(), code) {
		t.Fatalf("resolver error = %q, want code %q", err.Error(), code)
	}
}

func deleteArtifactBindingsForKinds(
	registry *runtimepolicy.WorkflowArtifactRegistry,
	kinds ...string,
) {
	filtered := make([]runtimepolicy.WorkflowCapabilityBinding, 0, len(registry.Bindings))
	for _, binding := range registry.Bindings {
		drop := false
		for _, kind := range binding.Produces {
			for _, target := range kinds {
				if kind == target {
					drop = true
					break
				}
			}
			if drop {
				break
			}
		}
		if !drop {
			filtered = append(filtered, binding)
		}
	}
	registry.Bindings = filtered
}

func closeTool(
	registry *runtimepolicy.ToolSpecRegistry,
	toolName string,
) {
	for index, tool := range registry.Tools {
		if tool.Name != toolName {
			continue
		}
		registry.Tools[index].Active = false
		registry.Tools[index].RuntimePosture = "closed"
		return
	}
}

func appendAmbiguousBinding(
	registry *runtimepolicy.WorkflowArtifactRegistry,
	artifactKind string,
) {
	registry.Bindings = append(
		registry.Bindings,
		runtimepolicy.WorkflowCapabilityBinding{
			BindingID:       "duplicate." + artifactKind,
			OwnerAgent:      "notice-agent",
			ToolName:        "campus_notice_get",
			Produces:        []string{artifactKind},
			Consumes:        []string{},
			RequiredInputs:  []string{"request:selected_notice_id"},
			StateChanging:   false,
			OpeningGate:     "open",
			EvalDenominator: []string{"workflow_trace"},
			Priority:        1,
			Notes:           "fixture",
		},
	)
}

func introduceCycle(registry *runtimepolicy.WorkflowArtifactRegistry) {
	for index, binding := range registry.Bindings {
		switch binding.BindingID {
		case "notice.notice_context.selected_notice_get":
			registry.Bindings[index].Consumes = []string{"grounding_verdict"}
		case "rag.grounding_verdict.retrieval_query":
			registry.Bindings[index].Consumes = []string{"notice_context"}
		}
	}
}
