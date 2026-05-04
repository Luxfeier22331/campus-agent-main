package structuredplanning

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
)

func TestPlanGoldenCases(t *testing.T) {
	tests := []struct {
		name        string
		request     Request
		wantTarget  string
		wantKind    string
		wantTool    string
		wantPayload map[string]any
	}{
		{
			name: "transport first departure",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "明天早上去丰台最早的班车是几点",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "transport_schedule_lookup",
			wantTool:    "transport_schedule_lookup",
			wantPayload: map[string]any{"intent": "first_departure"},
		},
		{
			name: "transport snapshot metadata",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "最近的校车时刻表是什么",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "transport_schedule_lookup",
			wantTool:    "transport_schedule_lookup",
			wantPayload: map[string]any{"intent": "schedule_snapshot_metadata"},
		},
		{
			name: "transport timetable",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校车时刻表",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "transport_schedule_lookup",
			wantTool:    "transport_schedule_lookup",
			wantPayload: map[string]any{"intent": "timetable"},
		},
		{
			name: "transport last departure",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "回海淀最后一班校车几点",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "transport_schedule_lookup",
			wantTool:    "transport_schedule_lookup",
			wantPayload: map[string]any{"intent": "last_departure"},
		},
		{
			name: "transport departure list",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "下午去丰台校车还有哪些班次",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "transport_schedule_lookup",
			wantTool:    "transport_schedule_lookup",
			wantPayload: map[string]any{"intent": "departure_list"},
		},
		{
			name: "transport service window",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校车今天还跑不跑",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "transport_schedule_lookup",
			wantTool:    "transport_schedule_lookup",
			wantPayload: map[string]any{"intent": "service_window"},
		},
		{
			name: "transport how to board routes to service guide",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "地铁接驳车怎么预约",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "地铁接驳车怎么预约",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "transport boarding rule routes to service guide",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "通勤班车乘车规则是什么",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "通勤班车乘车规则是什么",
				"guide_focus":   "full_guide",
			},
		},
		{
			name: "transport route selector",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "海淀到丰台地铁接驳车明天上午还有哪些",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "transport_schedule_lookup",
			wantTool:   "transport_schedule_lookup",
			wantPayload: map[string]any{
				"intent": "departure_list",
				"route_selector": map[string]any{
					"service_family":     "metro_shuttle",
					"origin_campus":      "haidian",
					"destination_campus": "fengtai",
				},
			},
		},
		{
			name: "service status campus scope",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "丰台图书馆今天开门吗",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"campus_scope": "fengtai"},
		},
		{
			name: "service status card center open alias",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "卡务中心今天开不开",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"subject_query": "卡务中心今天开不开"},
		},
		{
			name: "service status clinic suspension alias",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校医院今天停诊了吗",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"subject_query": "校医院今天停诊了吗"},
		},
		{
			name: "service status canteen closed alias",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "食堂现在关门了吗",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"subject_query": "食堂现在关门了吗"},
		},
		{
			name: "service status bathroom open alias",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "静园10号楼女浴室现在开放吗",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"subject_query": "静园10号楼女浴室现在开放吗"},
		},
		{
			name: "service status transport boarding point change",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "丰台校区通勤班车在哪里上车",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"campus_scope": "fengtai"},
		},
		{
			name: "contact directory phone",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "研究生院招生办公室电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"query_text":    "研究生院招生办公室电话是多少",
				"contact_focus": "phone",
			},
		},
		{
			name: "contact directory email",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "国际合作处邮箱是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"contact_focus": "email",
			},
		},
		{
			name: "contact directory location with entity selector",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "信息化办办公地点在哪里",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"query_text":    "信息化办办公地点在哪里",
				"contact_focus": "location",
				"entity_selector": map[string]any{
					"department_query": "信息化办",
				},
			},
		},
		{
			name: "service guide procedure",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "宿舍入住怎么办理",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "宿舍入住怎么办理",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "service guide required materials",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "本科生退宿需要什么材料",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"guide_focus": "required_materials",
			},
		},
		{
			name: "public medical service guide required materials",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "公费医疗报销需要什么材料",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "公费医疗报销需要什么材料",
				"guide_focus":   "required_materials",
			},
		},
		{
			name: "public medical service guide contact",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "公费医疗报销联系电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "公费医疗报销联系电话是多少",
				"guide_focus":   "contact",
			},
		},
		{
			name: "campus card lost service guide full guide",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园卡丢了怎么办",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园卡丢了怎么办",
				"guide_focus":   "full_guide",
			},
		},
		{
			name: "campus card replacement entry",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园卡在哪里补办",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园卡在哪里补办",
				"guide_focus":   "entry",
			},
		},
		{
			name: "campus card loss contact",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "一卡通挂失电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "一卡通挂失电话是多少",
				"guide_focus":   "contact",
			},
		},
		{
			name: "vpn entry",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "VPN入口在哪里",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "VPN入口在哪里",
				"guide_focus":   "entry",
			},
		},
		{
			name: "vpn client install",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "VPN客户端怎么安装",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "VPN客户端怎么安装",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "network auth entry",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园网认证入口在哪里",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园网认证入口在哪里",
				"guide_focus":   "entry",
			},
		},
		{
			name: "email required materials",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园邮箱需要什么材料",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园邮箱需要什么材料",
				"guide_focus":   "required_materials",
			},
		},
		{
			name: "campus card office hours",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园卡补办办公时间是什么",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园卡补办办公时间是什么",
				"guide_focus":   "office_hours",
			},
		},
		{
			name: "campus card eligibility",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园卡补办哪些人能办",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园卡补办哪些人能办",
				"guide_focus":   "eligibility",
			},
		},
		{
			name: "information disclosure entry prefers service guide over contact directory",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "信息公开申请入口在哪里",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "信息公开申请入口在哪里",
				"guide_focus":   "entry",
			},
		},
		{
			name: "information disclosure phone",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "信息公开联系电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"query_text":    "信息公开联系电话是多少",
				"contact_focus": "phone",
			},
		},
		{
			name: "information service location",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "信息化服务办公地点在哪里",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"query_text":    "信息化服务办公地点在哪里",
				"contact_focus": "location",
			},
		},
		{
			name: "notice discover",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "找一下2026年春假通知",
			},
			wantTarget:  "notice-agent",
			wantKind:    "campus_notice_discover",
			wantTool:    "campus_notice_discover",
			wantPayload: map[string]any{"query_text": "找一下2026年春假通知"},
		},
		{
			name: "notice discover year hint",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "2026年春假通知",
			},
			wantTarget: "notice-agent",
			wantKind:   "campus_notice_discover",
			wantTool:   "campus_notice_discover",
			wantPayload: map[string]any{
				"temporal_query": map[string]any{
					"mode":      "current_year",
					"year_hint": "2026",
				},
			},
		},
		{
			name: "notice get selected ref",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "这条通知详情",
				SelectedNoticeRef: SelectedNoticeRef{
					NoticeID:     "notice:2026-spring-break",
					SourceFamily: "internal_notice_restricted",
				},
			},
			wantTarget:  "notice-agent",
			wantKind:    "campus_notice_get",
			wantTool:    "",
			wantPayload: map[string]any{"notice_id": "notice:2026-spring-break"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policy, err := runtimepolicy.LoadIntentPolicy("")
			if err != nil {
				t.Fatalf("load intent policy: %v", err)
			}
			plan := PlanWithPolicy(tt.request, policy)
			if plan == nil {
				t.Fatal("expected preplanned workflow plan")
			}
			if plan.WorkflowMode != WorkflowModeSingleHandoff {
				t.Fatalf("workflow mode = %q, want single_handoff", plan.WorkflowMode)
			}
			handoff := plan.SelectedHandoff()
			if handoff == nil {
				t.Fatal("expected preplanned handoff")
			}
			if handoff.Target != tt.wantTarget || handoff.PayloadKind != tt.wantKind {
				t.Fatalf("handoff = %#v", handoff)
			}
			if tt.wantTool == "" {
				if len(handoff.AllowedTools) != 0 {
					t.Fatalf("allowed tools = %#v, want none", handoff.AllowedTools)
				}
			} else if len(handoff.AllowedTools) != 1 || handoff.AllowedTools[0] != tt.wantTool {
				t.Fatalf("allowed tools = %#v, want %q", handoff.AllowedTools, tt.wantTool)
			}
			for key, want := range tt.wantPayload {
				assertPayloadValue(t, handoff.Payload, key, want)
			}
		})
	}
}

func TestPlanSkipsTransactionalStructuredRequests(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}
	for _, request := range []Request{
		{
			EffectiveCapability: "notice",
			UserGoal:            "帮我提交采购公告",
		},
		{
			EffectiveCapability: "campus_services",
			UserGoal:            "帮我打电话给研究生院招生办公室",
		},
		{
			EffectiveCapability: "campus_services",
			UserGoal:            "帮我发邮件给国际合作处",
		},
	} {
		plan := PlanWithPolicy(request, policy)
		if plan != nil {
			t.Fatalf("transactional request must not be preplanned for %q: %#v", request.UserGoal, plan)
		}
	}
}

func TestPlanWithPolicyProjectsCanonicalWorkflowPlan(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	plan := PlanWithPolicy(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "学生手册请假制度怎么规定？",
		HasRequestedScope:   true,
		RequestedScope: Scope{
			Corpus:     "regulations",
			Collection: "student_rules",
		},
	}, policy)

	if plan == nil {
		t.Fatal("expected workflow plan")
	}
	if plan.SchemaVersion != WorkflowPlanSchemaVersion {
		t.Fatalf("schema version = %q, want %q", plan.SchemaVersion, WorkflowPlanSchemaVersion)
	}
	if plan.WorkflowMode != WorkflowModeSingleHandoff {
		t.Fatalf("workflow mode = %q, want single_handoff", plan.WorkflowMode)
	}
	if plan.PlanID == "" {
		t.Fatal("plan id must not be empty")
	}
	if len(plan.Steps) != 1 {
		t.Fatalf("step count = %d, want 1", len(plan.Steps))
	}
	step := plan.Steps[0]
	if step.StepKind != WorkflowStepKindHandoff || step.Target != "rag-agent" {
		t.Fatalf("step = %#v, want rag handoff", step)
	}
	if step.SelectedTool != "retrieval.query" {
		t.Fatalf("selected tool = %q, want retrieval.query", step.SelectedTool)
	}
	if len(plan.Edges) != 0 {
		t.Fatalf("edges = %#v, want none for single handoff", plan.Edges)
	}
	if plan.SemanticRetryPolicy.MaxReplans != 0 {
		t.Fatalf("semantic retry max replans = %d, want 0", plan.SemanticRetryPolicy.MaxReplans)
	}
	projection := plan.Map()
	if projection["workflow_mode"] != "single_handoff" {
		t.Fatalf("projection workflow_mode = %v, want single_handoff", projection["workflow_mode"])
	}
	steps, ok := projection["steps"].([]map[string]any)
	if !ok || len(steps) != 1 || steps[0]["target"] != "rag-agent" {
		t.Fatalf("projection steps = %#v, want typed rag step", projection["steps"])
	}
}

func TestPlanWithPolicyBuildsMultiStepNoticeKnowledgeFollowthrough(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	plan := PlanWithPolicy(Request{
		EffectiveCapability:      "knowledge",
		UserGoal:                 "这条通知依据学生手册哪条规定？",
		HasRequestedScope:        true,
		MultiStepWorkflowEnabled: true,
		RequestedScope: Scope{
			Corpus:     "regulations",
			Collection: "student_rules",
		},
		SelectedNoticeRef: SelectedNoticeRef{
			NoticeID:     "notice:smoke:001",
			SourceFamily: "wechat_public_notice",
			Title:        "烟雾测试通知",
		},
	}, policy)

	if plan == nil {
		t.Fatal("expected workflow plan")
	}
	if plan.WorkflowMode != WorkflowModeMultiStep {
		t.Fatalf("workflow mode = %q, want multi_step", plan.WorkflowMode)
	}
	handoffs := plan.Handoffs()
	if len(handoffs) != 2 {
		t.Fatalf("handoff count = %d, want 2", len(handoffs))
	}
	if handoffs[0].Target != "notice-agent" || handoffs[0].PayloadKind != "campus_notice_get" {
		t.Fatalf("first handoff = %#v, want notice get", handoffs[0])
	}
	if len(handoffs[0].AllowedTools) != 0 {
		t.Fatalf("first handoff allowed tools = %#v, want none for internal notice context", handoffs[0].AllowedTools)
	}
	if handoffs[0].Payload["notice_id"] != "notice:smoke:001" {
		t.Fatalf("first handoff notice_id = %#v", handoffs[0].Payload["notice_id"])
	}
	if handoffs[1].Target != "rag-agent" || handoffs[1].PayloadKind != "rag_request" {
		t.Fatalf("second handoff = %#v, want rag request", handoffs[1])
	}
	if plan.ResumePolicy.ResumeSupported != true {
		t.Fatal("multi-step plan must declare resume support")
	}
	if plan.SemanticRetryPolicy.MaxReplans != 1 {
		t.Fatalf("semantic retry max replans = %d, want 1", plan.SemanticRetryPolicy.MaxReplans)
	}
	projection := plan.Map()
	if projection["workflow_mode"] != "multi_step" {
		t.Fatalf("projection workflow_mode = %v, want multi_step", projection["workflow_mode"])
	}
	steps, ok := projection["steps"].([]map[string]any)
	if !ok || len(steps) != 2 {
		t.Fatalf("projection steps = %#v, want two steps", projection["steps"])
	}
	edges, ok := projection["edges"].([]map[string]any)
	if !ok || len(edges) != 1 || edges[0]["condition"] != "completed" {
		t.Fatalf("projection edges = %#v, want completed edge", projection["edges"])
	}
	if edges[0]["required_projection_kind"] != "notice_context" {
		t.Fatalf(
			"projection edge required projection = %#v, want notice_context",
			edges[0]["required_projection_kind"],
		)
	}
}

func TestPlanWithPolicyUsesIntentPolicyArtifactSignals(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}
	policy.SignalGroups["structured_transport"] = []string{"摆渡车"}

	plan := PlanWithPolicy(Request{
		EffectiveCapability: "campus_services",
		UserGoal:            "摆渡车最早几点",
	}, policy)

	handoff := plan.SelectedHandoff()
	if handoff == nil {
		t.Fatal("expected policy-backed transport signal to produce handoff")
	}
	if handoff.PayloadKind != "transport_schedule_lookup" {
		t.Fatalf("payload kind = %q, want transport_schedule_lookup", handoff.PayloadKind)
	}
	if handoff.Payload["intent"] != "first_departure" {
		t.Fatalf("intent = %v, want first_departure", handoff.Payload["intent"])
	}
}

func assertPayloadValue(t *testing.T, payload map[string]any, key string, want any) {
	t.Helper()
	got := payload[key]
	wantMap, wantIsMap := want.(map[string]any)
	if !wantIsMap {
		if got != want {
			t.Fatalf("payload[%s] = %#v, want %#v", key, got, want)
		}
		return
	}
	gotMap, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("payload[%s] = %#v, want map", key, got)
	}
	for nestedKey, nestedWant := range wantMap {
		if gotMap[nestedKey] != nestedWant {
			t.Fatalf(
				"payload[%s][%s] = %#v, want %#v",
				key,
				nestedKey,
				gotMap[nestedKey],
				nestedWant,
			)
		}
	}
}
