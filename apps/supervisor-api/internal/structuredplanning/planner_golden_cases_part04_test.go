package structuredplanning

func plannerGoldenCasesPart04() []plannerGoldenCase {
	return []plannerGoldenCase{
		{
			name: "vpn login entry",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "VPN 去哪里登录",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "VPN 去哪里登录",
				"guide_focus":   "entry",
			},
		},
		{
			name: "information disclosure form entry",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "信息公开申请表在哪里下载",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "信息公开申请表在哪里下载",
				"guide_focus":   "entry",
			},
		},
		{
			name: "network account guide",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "上网账号申请去哪里办",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "上网账号申请去哪里办",
				"guide_focus":   "entry",
			},
		},
		{
			name: "staff campus card guide",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "教职工校园卡丢了怎么办",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "教职工校园卡丢了怎么办",
				"guide_focus":   "full_guide",
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
				UserGoal:            "信息公开申请联系电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "信息公开申请联系电话是多少",
				"guide_focus":   "contact",
			},
		},
		{
			name: "information disclosure department phone uses contact directory",
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
			name: "network service phone",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "网络服务电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"query_text":    "网络服务电话是多少",
				"contact_focus": "phone",
				"entity_selector": map[string]any{
					"department_query": "网络服务",
				},
			},
		},
		{
			name: "conference center phone",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "会务服务中心电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"query_text":    "会务服务中心电话是多少",
				"contact_focus": "phone",
				"entity_selector": map[string]any{
					"department_query": "会务服务中心",
				},
			},
		},
		{
			name: "dorm management center phone",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "学生公寓管理服务中心电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"query_text":    "学生公寓管理服务中心电话是多少",
				"contact_focus": "phone",
				"entity_selector": map[string]any{
					"department_query": "学生公寓管理服务中心",
				},
			},
		},
		{
			name: "card center office hours colloquial",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "卡务中心几点上班",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "卡务中心几点上班",
				"guide_focus":   "office_hours",
			},
		},
		{
			name: "public medical eligibility",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "公费医疗哪些学生能享受",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "公费医疗哪些学生能享受",
				"guide_focus":   "eligibility",
			},
		},
		{
			name: "campus card service full guide",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园卡服务有哪些内容",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园卡服务有哪些内容",
				"guide_focus":   "full_guide",
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
			name: "notice original transport adjustment boundary",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "最近有哪些班车调整通知",
			},
			wantTarget:  "notice-agent",
			wantKind:    "campus_notice_discover",
			wantTool:    "campus_notice_discover",
			wantPayload: map[string]any{"query_text": "最近有哪些班车调整通知"},
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
		}}
}
