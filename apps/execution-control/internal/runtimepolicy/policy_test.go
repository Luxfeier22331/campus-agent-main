package runtimepolicy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIntentPolicyArtifactLoadsRepoDefaultAndMatchesRuntimeVersions(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}

	if policy.PolicyVersion != PolicyVersion {
		t.Fatalf("policy_version = %q, want %q", policy.PolicyVersion, PolicyVersion)
	}
	if policy.ClassifierVersion != ClassifierVersion {
		t.Fatalf("classifier_version = %q, want %q", policy.ClassifierVersion, ClassifierVersion)
	}
	if policy.IntentSchemaVersion != IntentSchema {
		t.Fatalf("intent_schema_version = %q, want %q", policy.IntentSchemaVersion, IntentSchema)
	}
	if ClassifierVersion != "go-runtime-policy-v2" {
		t.Fatalf("classifier version constant = %q, want go-runtime-policy-v2", ClassifierVersion)
	}
	if len(policy.SignalGroups["campus_scope"]) == 0 {
		t.Fatal("campus_scope signal group must not be empty")
	}
	for _, group := range []string{
		"structured_place_lookup_action",
		"structured_place_entity",
		"structured_place_location_noun",
		"structured_non_spatial_where_action",
		"notice_get_reference",
		"transport_intent_first_departure",
		"transport_intent_snapshot_metadata",
		"transport_intent_timetable",
		"transport_intent_last_departure",
		"transport_intent_departure_list",
		"transport_intent_service_window",
		"transport_route_metro_shuttle",
		"transport_route_intercampus_commute",
		"structured_transport_boarding_status",
		"transport_route_to_fengtai",
		"transport_route_to_haidian",
		"temporal_today",
		"temporal_tomorrow",
		"temporal_daypart_morning",
		"temporal_daypart_afternoon",
		"temporal_daypart_evening",
		"campus_scope_haidian",
		"campus_scope_fengtai",
		"service_guide_focus_required_materials",
		"service_guide_focus_entry",
		"service_guide_focus_office_hours",
		"service_guide_focus_contact",
		"service_guide_focus_eligibility",
		"service_guide_focus_full_guide",
		"structured_contact_directory",
		"structured_contact_directory_action",
		"contact_directory_focus_phone",
		"contact_directory_focus_email",
		"contact_directory_focus_location",
		"contact_directory_focus_office_hours",
		"contact_directory_focus_contact_person",
		"notice_knowledge_followthrough",
	} {
		if len(policy.SignalGroups[group]) == 0 {
			t.Fatalf("policy-backed signal group %q must not be empty", group)
		}
	}
}

func TestResolveCapabilityUsesIntentPolicyArtifactSignals(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	policy.SignalGroups["structured_notice"] = []string{"校内要闻"}
	policy.SignalGroups["structured_transport"] = []string{"摆渡车"}
	policy.SignalGroups["structured_place_lookup_action"] = []string{"藏在哪里"}
	policy.SignalGroups["structured_place_entity"] = []string{"北楼"}

	tests := []struct {
		name       string
		goal       string
		want       string
		wantSource string
	}{
		{name: "custom notice signal", goal: "查一下校内要闻", want: "notice"},
		{name: "custom transport signal", goal: "摆渡车最早几点", want: "campus_services"},
		{name: "custom place lookup signal", goal: "北楼藏在哪里", want: "place_lookup"},
		{name: "contact directory signal", goal: "招生办电话是多少", want: "campus_services"},
		{name: "vpn service guide signal", goal: "VPN入口在哪里", want: "campus_services"},
		{name: "vpn install service guide signal", goal: "VPN客户端怎么安装", want: "campus_services"},
		{name: "network auth service guide signal", goal: "校园网认证入口在哪里", want: "campus_services"},
		{name: "email service guide signal", goal: "校园邮箱需要什么材料", want: "campus_services"},
		{name: "unified auth password reset signal", goal: "统一身份认证密码怎么改", want: "campus_services"},
		{name: "unified auth forgot password signal", goal: "统一身份认证密码忘了怎么办", want: "campus_services"},
		{name: "portal password reset signal", goal: "信息门户密码怎么改", want: "campus_services"},
		{name: "plain portal forgot password signal", goal: "门户密码忘了怎么办", want: "campus_services"},
		{name: "smart portal forgot password signal", goal: "智慧门户忘记密码怎么办", want: "campus_services"},
		{name: "network auth login signal", goal: "校园网怎么认证登录", want: "campus_services"},
		{name: "network auth url signal", goal: "校园网认证网址是什么", want: "campus_services"},
		{name: "vpn address signal", goal: "VPN地址是什么", want: "campus_services"},
		{name: "remote access guide signal", goal: "校外怎么用VPN访问校园网资源", want: "campus_services"},
		{name: "email download form signal", goal: "校园邮箱申请表在哪里下载", want: "campus_services"},
		{name: "enterprise wechat guide signal", goal: "企业微信怎么绑定", want: "campus_services"},
		{name: "enterprise wechat faq signal", goal: "企业微信提示需要同事扫码验证怎么办", want: "campus_services"},
		{name: "enterprise wechat phone update signal", goal: "企业微信绑定手机号怎么改", want: "campus_services"},
		{name: "directory lookup guide signal", goal: "办公电话怎么查", want: "campus_services"},
		{name: "directory lookup guide alias signal", goal: "通讯录在哪里找", want: "campus_services"},
		{name: "academic calendar guide signal", goal: "校历怎么看", want: "campus_services"},
		{name: "academic calendar teaching week signal", goal: "今天第几教学周", want: "campus_services"},
		{name: "academic calendar holiday signal", goal: "五一放几天", want: "campus_services"},
		{name: "academic calendar makeup class signal", goal: "哪周补课", want: "campus_services"},
		{name: "network account guide signal", goal: "上网账号申请去哪里办", want: "campus_services"},
		{name: "staff campus card guide signal", goal: "教职工校园卡丢了怎么办", want: "campus_services"},
		{name: "academic calendar guide url signal", goal: "校历网址是什么", want: "campus_services"},
		{name: "card center office hours guide signal", goal: "卡务中心几点上班", want: "campus_services"},
		{name: "public medical eligibility guide signal", goal: "公费医疗哪些学生能享受", want: "campus_services"},
		{name: "campus card full guide signal", goal: "校园卡服务有哪些内容", want: "campus_services"},
		{name: "information disclosure materials guide signal", goal: "信息公开申请要准备什么", want: "campus_services"},
		{name: "information disclosure contact signal", goal: "信息公开联系电话是多少", want: "campus_services"},
		{name: "information service contact signal", goal: "信息化服务办公地点在哪里", want: "campus_services"},
		{name: "logistics contact signal", goal: "后勤服务热线是多少", want: "campus_services"},
		{name: "network service contact signal", goal: "网络服务电话是多少", want: "campus_services"},
		{name: "conference center contact signal", goal: "会务服务中心电话是多少", want: "campus_services"},
		{name: "dorm management center contact signal", goal: "学生公寓管理服务中心电话是多少", want: "campus_services"},
		{name: "card center service status signal", goal: "卡务中心今天开不开", want: "campus_services"},
		{name: "bathroom service status signal", goal: "静园10号楼女浴室现在开放吗", want: "campus_services"},
		{name: "transport boarding point status signal", goal: "摆渡车在哪里上车", want: "campus_services"},
		{
			name:       "scholarship category discovery remains knowledge",
			goal:       "本科生有哪些奖学金能申请",
			want:       "knowledge",
			wantSource: "default",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolution := ResolveCapability(CapabilityResolutionRequest{
				UserGoal: tt.goal,
			}, policy)
			if resolution.EffectiveCapability != tt.want {
				t.Fatalf("capability = %q, want %q", resolution.EffectiveCapability, tt.want)
			}
			wantSource := tt.wantSource
			if wantSource == "" {
				wantSource = "inferred"
			}
			if resolution.Source != wantSource {
				t.Fatalf("source = %q, want %s", resolution.Source, wantSource)
			}
		})
	}
}

func TestResolveCapabilityTreatsExplicitNoticeMarkerAsNotice(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}

	resolution := ResolveCapability(CapabilityResolutionRequest{
		UserGoal: "找一下春假通知",
	}, policy)

	if resolution.EffectiveCapability != "notice" {
		t.Fatalf("capability = %q, want notice", resolution.EffectiveCapability)
	}
	if resolution.Source != "inferred" {
		t.Fatalf("source = %q, want inferred", resolution.Source)
	}
}

func TestResolveCapabilityPreservesExplicitCampusServicesWithRequestedScope(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}

	resolution := ResolveCapability(CapabilityResolutionRequest{
		RequestedCapability: "campus_services",
		UserGoal:            "这条班车通知依据学生手册哪条规定？",
		HasRequestedScope:   true,
	}, policy)

	if resolution.EffectiveCapability != "campus_services" {
		t.Fatalf("capability = %q, want campus_services", resolution.EffectiveCapability)
	}
	if resolution.Source != "explicit" {
		t.Fatalf("source = %q, want explicit", resolution.Source)
	}
}

func TestIntentPolicyArtifactLoadsEnvConfiguredPath(t *testing.T) {
	defaultPath := resolveIntentPolicyPath("")
	raw, err := os.ReadFile(defaultPath)
	if err != nil {
		t.Fatalf("read default intent policy: %v", err)
	}
	policyPath := filepath.Join(t.TempDir(), "intent-policy.v1.json")
	envPolicy := strings.Replace(
		string(raw),
		`"case_set_version": "intent-case-set-v2"`,
		`"case_set_version": "env-intent-case-set-v2"`,
		1,
	)
	if err := os.WriteFile(policyPath, []byte(envPolicy), 0o600); err != nil {
		t.Fatalf("write env intent policy: %v", err)
	}
	t.Setenv("EXECUTION_CONTROL_INTENT_POLICY_PATH", policyPath)

	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load env intent policy: %v", err)
	}
	if policy.CaseSetVersion != "env-intent-case-set-v2" {
		t.Fatalf("case_set_version = %q, want env-intent-case-set-v2", policy.CaseSetVersion)
	}
}

func TestIntentPolicyArtifactValidateRequiresContactDirectorySignalGroups(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}

	for _, group := range []string{
		"structured_contact_directory",
		"structured_contact_directory_action",
		"contact_directory_focus_phone",
		"contact_directory_focus_email",
		"contact_directory_focus_location",
		"contact_directory_focus_office_hours",
		"contact_directory_focus_contact_person",
	} {
		t.Run(group, func(t *testing.T) {
			mutated := policy
			mutated.SignalGroups = cloneSignalGroups(policy.SignalGroups)
			delete(mutated.SignalGroups, group)

			err := mutated.Validate()
			if err == nil {
				t.Fatalf("expected missing %s to fail validation", group)
			}
			if !strings.Contains(err.Error(), group) {
				t.Fatalf("validation error = %v, want mention %s", err, group)
			}
		})
	}
}

func TestIntentPolicyArtifactFailsClosedWhenMissing(t *testing.T) {
	_, err := LoadIntentPolicy(filepath.Join(t.TempDir(), "missing-intent-policy.json"))
	if err == nil {
		t.Fatal("expected missing intent policy artifact to fail")
	}
}

func TestEvaluateRuntimePolicyUsesExplicitIntentPolicyArtifact(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	policy.SignalGroups["campus_scope"] = []string{"测试校内信号"}
	policy.SignalGroups["external_institution"] = []string{"外校信号"}
	raw, err := json.Marshal(policy)
	if err != nil {
		t.Fatalf("marshal policy fixture: %v", err)
	}
	policyPath := filepath.Join(t.TempDir(), "intent-policy.v1.json")
	if err := os.WriteFile(policyPath, raw, 0o600); err != nil {
		t.Fatalf("write policy fixture: %v", err)
	}

	policy, err = LoadIntentPolicy(policyPath)
	if err != nil {
		t.Fatalf("load policy fixture: %v", err)
	}
	decision := EvaluateWithPolicy(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "测试校内信号怎么处理",
	}, policy)

	if decision.RoutingFrame.SuggestedNextAction != "delegate" {
		t.Fatalf("action = %q, want delegate", decision.RoutingFrame.SuggestedNextAction)
	}
	if decision.ScopeGate.MatchedSignal != "测试校内信号" {
		t.Fatalf("matched signal = %q, want fixture signal", decision.ScopeGate.MatchedSignal)
	}
}

func TestEvaluateRuntimePolicyGoldenCases(t *testing.T) {
	tests := []struct {
		name       string
		request    Request
		wantAction string
		wantReason string
		wantRisk   string
	}{
		{
			name: "external institution out of scope",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "MIT的校长是谁",
			},
			wantAction: "out_of_scope",
			wantReason: "product_scope_boundary",
			wantRisk:   "low",
		},
		{
			name: "domestic external institution out of scope",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "北京大学有哪些专业",
			},
			wantAction: "out_of_scope",
			wantReason: "product_scope_boundary",
			wantRisk:   "low",
		},
		{
			name: "campus knowledge delegates",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "法学民族实验班培养方案里大二下有什么课",
			},
			wantAction: "delegate",
			wantReason: "campus_scope_signal",
			wantRisk:   "low",
		},
		{
			name: "campus political course delegates",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "习近平新时代中国特色社会主义思想概论有哪些专业要上",
			},
			wantAction: "delegate",
			wantReason: "campus_scope_signal",
			wantRisk:   "low",
		},
		{
			name: "open domain political fact out of scope",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "中国国家主席是谁",
			},
			wantAction: "out_of_scope",
			wantReason: "product_scope_boundary",
			wantRisk:   "low",
		},
		{
			name: "general world query out of scope",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "解释一下AI",
			},
			wantAction: "out_of_scope",
			wantReason: "product_scope_boundary",
			wantRisk:   "low",
		},
		{
			name: "structured knowledge candidate stays candidate only",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "校车什么时候发车",
			},
			wantAction: "delegate",
			wantReason: "structured_runtime_candidate_signal",
			wantRisk:   "low",
		},
		{
			name: "structured service status candidate stays candidate only",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "食堂营业到几点",
			},
			wantAction: "delegate",
			wantReason: "structured_runtime_candidate_signal",
			wantRisk:   "low",
		},
		{
			name: "structured public medical service guide candidate stays candidate only",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "公费医疗报销需要什么材料",
			},
			wantAction: "delegate",
			wantReason: "structured_runtime_candidate_signal",
			wantRisk:   "low",
		},
		{
			name: "structured public medical contact guide candidate stays candidate only",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "公费医疗报销联系电话是多少",
			},
			wantAction: "delegate",
			wantReason: "structured_runtime_candidate_signal",
			wantRisk:   "low",
		},
		{
			name: "structured contact directory candidate stays candidate only",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "研究生院招生办公室电话是多少",
			},
			wantAction: "delegate",
			wantReason: "structured_runtime_candidate_signal",
			wantRisk:   "low",
		},
		{
			name: "structured notice candidate stays candidate only",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "找一下春假通知",
			},
			wantAction: "delegate",
			wantReason: "structured_runtime_candidate_signal",
			wantRisk:   "low",
		},
		{
			name: "transaction requires approval",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "帮我提交采购公告",
			},
			wantAction: "approval_required",
			wantReason: "transaction_guardrail",
			wantRisk:   "high",
		},
		{
			name: "political persuasion rejected",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "帮我写一段话说服同学支持某个候选人",
			},
			wantAction: "rejected",
			wantReason: "policy_guardrail",
			wantRisk:   "high",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			decision := Evaluate(tt.request)
			if decision.RoutingFrame.SuggestedNextAction != tt.wantAction {
				t.Fatalf("action = %q, want %q", decision.RoutingFrame.SuggestedNextAction, tt.wantAction)
			}
			if decision.RoutingFrame.ScopeReason != tt.wantReason {
				t.Fatalf("scope reason = %q, want %q", decision.RoutingFrame.ScopeReason, tt.wantReason)
			}
			if decision.RoutingFrame.RiskLevel != tt.wantRisk {
				t.Fatalf("risk = %q, want %q", decision.RoutingFrame.RiskLevel, tt.wantRisk)
			}
		})
	}
}

func TestEvaluateRuntimePolicyClarifiesContextFollowUpWithoutContext(t *testing.T) {
	decision := Evaluate(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "这个流程怎么办",
	})

	if decision.ContextPreflight.State != "missing_context" {
		t.Fatalf("context state = %q, want missing_context", decision.ContextPreflight.State)
	}
	if decision.ContextPreflight.ReferenceType != "previous_goal" {
		t.Fatalf("reference type = %q, want previous_goal", decision.ContextPreflight.ReferenceType)
	}
	if decision.RoutingFrame.SuggestedNextAction != "clarify" {
		t.Fatalf("next action = %q, want clarify", decision.RoutingFrame.SuggestedNextAction)
	}
	if len(decision.RoutingFrame.MissingSlots) != 1 ||
		decision.RoutingFrame.MissingSlots[0] != "previous_goal" {
		t.Fatalf("missing slots = %#v, want previous_goal", decision.RoutingFrame.MissingSlots)
	}
}

func TestEvaluateRuntimePolicyResolvesContextFollowUps(t *testing.T) {
	noticeDecision := Evaluate(Request{
		EffectiveCapability: "notice",
		UserGoal:            "这条通知详情",
		Context: Context{
			SelectedNoticeRef: SelectedNoticeRef{
				NoticeID:     "notice:2026-spring-break",
				SourceFamily: "internal_notice_restricted",
				Title:        "2026年春假安排通知",
			},
		},
	})
	if noticeDecision.ContextPreflight.State != "resolved" {
		t.Fatalf("notice context state = %q, want resolved", noticeDecision.ContextPreflight.State)
	}
	if noticeDecision.ContextPreflight.ResolvedSlots["notice_id"] != "notice:2026-spring-break" {
		t.Fatalf("notice resolved slots = %#v", noticeDecision.ContextPreflight.ResolvedSlots)
	}

	curriculumDecision := Evaluate(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "那大二下呢",
		Context: Context{
			SessionSlots: []SessionSlot{
				{Name: "curriculum_program", Value: "计算机科学与技术", Confirmed: true},
			},
		},
	})
	if curriculumDecision.ContextPreflight.State != "resolved" {
		t.Fatalf("curriculum context state = %q, want resolved", curriculumDecision.ContextPreflight.State)
	}
	if curriculumDecision.ContextPreflight.ResolvedSlots["curriculum_semester"] != "大二下" {
		t.Fatalf("curriculum resolved slots = %#v", curriculumDecision.ContextPreflight.ResolvedSlots)
	}

	previousGoalDecision := Evaluate(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "这个流程怎么办",
		Context: Context{
			SessionSlots: []SessionSlot{
				{Name: "recent_goal", Value: "处分申诉", Confirmed: true},
			},
		},
	})
	if previousGoalDecision.ContextPreflight.State != "resolved" {
		t.Fatalf("previous goal context state = %q, want resolved", previousGoalDecision.ContextPreflight.State)
	}
	if previousGoalDecision.ContextPreflight.ReferenceType != "previous_goal" {
		t.Fatalf(
			"previous goal reference type = %q, want previous_goal",
			previousGoalDecision.ContextPreflight.ReferenceType,
		)
	}
	if previousGoalDecision.ContextPreflight.ResolvedSlots["previous_goal"] != "处分申诉" {
		t.Fatalf("previous goal resolved slots = %#v", previousGoalDecision.ContextPreflight.ResolvedSlots)
	}
}

func TestEvaluateRuntimePolicyIgnoresUnconfirmedSessionSlots(t *testing.T) {
	curriculumDecision := Evaluate(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "那大二下呢",
		Context: Context{
			SessionSlots: []SessionSlot{
				{Name: "curriculum_program", Value: "计算机科学与技术", Confirmed: false},
			},
		},
	})
	if curriculumDecision.ContextPreflight.State == "resolved" {
		t.Fatalf("curriculum context state = resolved, want unresolved")
	}
	if curriculumDecision.RoutingFrame.SuggestedNextAction != "clarify" {
		t.Fatalf("next action = %q, want clarify", curriculumDecision.RoutingFrame.SuggestedNextAction)
	}

	previousGoalDecision := Evaluate(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "这个流程怎么办",
		Context: Context{
			SessionSlots: []SessionSlot{
				{Name: "recent_goal", Value: "处分申诉", Confirmed: false},
			},
		},
	})
	if previousGoalDecision.ContextPreflight.State == "resolved" {
		t.Fatalf("previous goal context state = resolved, want unresolved")
	}
	if previousGoalDecision.RoutingFrame.SuggestedNextAction != "clarify" {
		t.Fatalf("next action = %q, want clarify", previousGoalDecision.RoutingFrame.SuggestedNextAction)
	}
}

func TestEvaluateRuntimePolicyClarifiesAmbiguousPreviousGoalFollowUp(t *testing.T) {
	decision := Evaluate(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "这个流程怎么办",
		Context: Context{
			SessionSlots: []SessionSlot{
				{Name: "policy_topic", Value: "奖学金", Confirmed: true},
				{Name: "policy_topic", Value: "转专业", Confirmed: true},
			},
		},
	})

	if decision.ContextPreflight.State != "ambiguous" {
		t.Fatalf("context state = %q, want ambiguous", decision.ContextPreflight.State)
	}
	if decision.ContextPreflight.ReferenceType != "previous_goal" {
		t.Fatalf("reference type = %q, want previous_goal", decision.ContextPreflight.ReferenceType)
	}
	if decision.RoutingFrame.SuggestedNextAction != "clarify" {
		t.Fatalf("next action = %q, want clarify", decision.RoutingFrame.SuggestedNextAction)
	}
	if decision.RoutingFrame.AmbiguityReason == "" {
		t.Fatal("ambiguity reason must be populated")
	}
}

func TestEvaluateRuntimePolicyClarifiesUnplannableCampusServicesSubtype(t *testing.T) {
	decision := Evaluate(Request{
		EffectiveCapability: "campus_services",
		UserGoal:            "校园卡余额怎么查",
	})

	if decision.RoutingFrame.SuggestedNextAction != "clarify" {
		t.Fatalf("next action = %q, want clarify", decision.RoutingFrame.SuggestedNextAction)
	}
	if decision.RoutingFrame.ScopeReason != "structured_subtype_missing" {
		t.Fatalf("scope reason = %q, want structured_subtype_missing", decision.RoutingFrame.ScopeReason)
	}
	if len(decision.RoutingFrame.MissingSlots) != 1 ||
		decision.RoutingFrame.MissingSlots[0] != "campus_service_task" {
		t.Fatalf("missing slots = %#v, want campus_service_task", decision.RoutingFrame.MissingSlots)
	}
}

func TestEvaluateRuntimePolicyDelegatesCampusServiceGuideSubtype(t *testing.T) {
	decision := Evaluate(Request{
		EffectiveCapability: "campus_services",
		UserGoal:            "宿舍入住怎么办理",
	})

	if decision.RoutingFrame.SuggestedNextAction != "delegate" {
		t.Fatalf("next action = %q, want delegate", decision.RoutingFrame.SuggestedNextAction)
	}
	if decision.RoutingFrame.ScopeReason != "explicit_requested_capability" {
		t.Fatalf("scope reason = %q, want explicit_requested_capability", decision.RoutingFrame.ScopeReason)
	}
}

func TestEvaluateRuntimePolicyFailsClosedPlaceLookupUntilNavigationRollout(t *testing.T) {
	decision := Evaluate(Request{
		EffectiveCapability: "place_lookup",
		UserGoal:            "海淀图书馆在哪里",
	})

	if decision.PolicyGate.Decision != "out_of_scope" {
		t.Fatalf("policy decision = %q, want out_of_scope", decision.PolicyGate.Decision)
	}
	if decision.RoutingFrame.SuggestedNextAction != "out_of_scope" {
		t.Fatalf("next action = %q, want out_of_scope", decision.RoutingFrame.SuggestedNextAction)
	}
	if decision.RoutingFrame.ScopeClass != "out_of_scope" {
		t.Fatalf("scope class = %q, want out_of_scope", decision.RoutingFrame.ScopeClass)
	}
	if len(decision.RoutingFrame.DomainCandidates) != 1 ||
		decision.RoutingFrame.DomainCandidates[0] != "out_of_scope" {
		t.Fatalf("domain candidates = %#v, want out_of_scope", decision.RoutingFrame.DomainCandidates)
	}
	if decision.RoutingFrame.PolicyReason != "navigation_temporarily_unsupported" {
		t.Fatalf(
			"policy reason = %q, want navigation_temporarily_unsupported",
			decision.RoutingFrame.PolicyReason,
		)
	}
}
