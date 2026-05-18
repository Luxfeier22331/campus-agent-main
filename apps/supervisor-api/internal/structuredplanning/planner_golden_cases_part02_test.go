package structuredplanning

func plannerGoldenCasesPart02() []plannerGoldenCase {
	return []plannerGoldenCase{
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
			name: "service status clinic office hours",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校医院办公时间",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"subject_query": "校医院办公时间"},
		},
		{
			name: "service status public medical office hours",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "公费医疗办公时间",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"subject_query": "公费医疗办公时间"},
		},
		{
			name: "service status campus card open question",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园卡服务开放吗",
			},
			wantTarget:  "campus-services-agent",
			wantKind:    "service_status_lookup",
			wantTool:    "service_status_lookup",
			wantPayload: map[string]any{"subject_query": "校园卡服务开放吗"},
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
			name: "contact directory logistics hotline",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "后勤服务热线是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "contact_directory_lookup",
			wantTool:   "contact_directory_lookup",
			wantPayload: map[string]any{
				"query_text":    "后勤服务热线是多少",
				"contact_focus": "phone",
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
			name: "information disclosure required materials",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "信息公开申请要准备什么",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "信息公开申请要准备什么",
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
			name: "campus card management center phone",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园卡管理中心电话是多少",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园卡管理中心电话是多少",
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
				"guide_focus":   "procedure",
			},
		},
		{
			name: "campus card lost alias remains procedure",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园卡遗失怎么办",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园卡遗失怎么办",
				"guide_focus":   "procedure",
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
	}
}
