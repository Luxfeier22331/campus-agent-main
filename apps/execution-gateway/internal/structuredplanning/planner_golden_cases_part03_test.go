package structuredplanning

func plannerGoldenCasesPart03() []plannerGoldenCase {
	return []plannerGoldenCase{
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
			name: "unified auth password reset",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "统一身份认证密码怎么改",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "统一身份认证密码怎么改",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "portal forgot password",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "智慧门户忘记密码怎么办",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "智慧门户忘记密码怎么办",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "network auth login entry",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园网怎么认证登录",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园网怎么认证登录",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "network auth website",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园网认证网址是什么",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园网认证网址是什么",
				"guide_focus":   "entry",
			},
		},
		{
			name: "vpn address",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "VPN地址是什么",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "VPN地址是什么",
				"guide_focus":   "entry",
			},
		},
		{
			name: "email application form download",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校园邮箱申请表在哪里下载",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校园邮箱申请表在哪里下载",
				"guide_focus":   "entry",
			},
		},
		{
			name: "enterprise wechat onboarding",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "企业微信怎么绑定",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "企业微信怎么绑定",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "enterprise wechat faq",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "企业微信提示需要同事扫码验证怎么办",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "企业微信提示需要同事扫码验证怎么办",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "enterprise wechat phone update",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "企业微信绑定手机号怎么改",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "企业微信绑定手机号怎么改",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "directory lookup guide",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "办公电话怎么查",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "办公电话怎么查",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "directory lookup guide alias",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "通讯录在哪里找",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "通讯录在哪里找",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "academic calendar guide",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校历怎么看",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校历怎么看",
				"guide_focus":   "procedure",
			},
		},
		{
			name: "academic calendar guide entry",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校历在哪里看",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校历在哪里看",
				"guide_focus":   "entry",
			},
		},
		{
			name: "academic calendar guide entry url short",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校历网址是什么",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "service_guide_lookup",
			wantTool:   "service_guide_lookup",
			wantPayload: map[string]any{
				"service_query": "校历网址是什么",
				"guide_focus":   "entry",
			},
		},
	}
}
