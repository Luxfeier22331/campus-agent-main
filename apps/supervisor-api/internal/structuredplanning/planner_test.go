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
			wantTool:    "campus_notice_get",
			wantPayload: map[string]any{"notice_id": "notice:2026-spring-break"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policy, err := runtimepolicy.LoadIntentPolicy("")
			if err != nil {
				t.Fatalf("load intent policy: %v", err)
			}
			handoff := PlanWithPolicy(tt.request, policy)
			if handoff == nil {
				t.Fatal("expected preplanned handoff")
			}
			if handoff.Target != tt.wantTarget || handoff.PayloadKind != tt.wantKind {
				t.Fatalf("handoff = %#v", handoff)
			}
			if len(handoff.AllowedTools) != 1 || handoff.AllowedTools[0] != tt.wantTool {
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
	handoff := PlanWithPolicy(Request{
		EffectiveCapability: "notice",
		UserGoal:            "帮我提交采购公告",
	}, policy)
	if handoff != nil {
		t.Fatalf("transactional request must not be preplanned: %#v", handoff)
	}
}

func TestPlanWithPolicyUsesIntentPolicyArtifactSignals(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}
	policy.SignalGroups["structured_transport"] = []string{"摆渡车"}

	handoff := PlanWithPolicy(Request{
		EffectiveCapability: "campus_services",
		UserGoal:            "摆渡车最早几点",
	}, policy)

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
