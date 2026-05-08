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
			name: "academic calendar teaching week",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "今天第几教学周",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "academic_calendar_lookup",
			wantTool:   "academic_calendar_lookup",
			wantPayload: map[string]any{
				"query_text": "今天第几教学周",
				"query_kind": "date_week",
			},
		},
		{
			name: "academic calendar exact date teaching week",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "2026-05-07 是第几教学周",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "academic_calendar_lookup",
			wantTool:   "academic_calendar_lookup",
			wantPayload: map[string]any{
				"query_text":  "2026-05-07 是第几教学周",
				"query_kind":  "date_week",
				"target_date": "2026-05-07",
			},
		},
		{
			name: "academic calendar makeup class day",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "4月25日上周几的课",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "academic_calendar_lookup",
			wantTool:   "academic_calendar_lookup",
			wantPayload: map[string]any{
				"query_text": "4月25日上周几的课",
				"query_kind": "class_day_pattern",
			},
		},
		{
			name: "academic calendar class day pattern explicit date",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "2026-04-25 执行哪天课表",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "academic_calendar_lookup",
			wantTool:   "academic_calendar_lookup",
			wantPayload: map[string]any{
				"query_text":  "2026-04-25 执行哪天课表",
				"query_kind":  "class_day_pattern",
				"target_date": "2026-04-25",
			},
		},
		{
			name: "academic calendar date only day status",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "2026-05-01 上课吗",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "academic_calendar_lookup",
			wantTool:   "academic_calendar_lookup",
			wantPayload: map[string]any{
				"query_text":  "2026-05-01 上课吗",
				"query_kind":  "day_status",
				"target_date": "2026-05-01",
			},
		},
		{
			name: "academic calendar explicit year holiday arrangement",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "2026-2027学年春假怎么安排",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "academic_calendar_lookup",
			wantTool:   "academic_calendar_lookup",
			wantPayload: map[string]any{
				"query_text":          "2026-2027学年春假怎么安排",
				"academic_year_label": "2026-2027学年",
				"query_kind":          "named_event_range",
				"event_query":         "春假",
			},
		},
		{
			name: "academic calendar holiday boundary",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "五一放几天",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "academic_calendar_lookup",
			wantTool:   "academic_calendar_lookup",
			wantPayload: map[string]any{
				"query_text":  "五一放几天",
				"query_kind":  "named_event_range",
				"event_query": "五一",
			},
		},
		{
			name: "academic calendar term window",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "本学期什么时候结束",
			},
			wantTarget: "campus-services-agent",
			wantKind:   "academic_calendar_lookup",
			wantTool:   "academic_calendar_lookup",
			wantPayload: map[string]any{
				"query_text": "本学期什么时候结束",
				"query_kind": "term_window",
				"term_label": "春季学期",
			},
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
		{
			EffectiveCapability: "campus_services",
			UserGoal:            "帮我预约地铁接驳车",
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

func TestPlanWithPolicyBuildsCapabilityOnlyNoticeKnowledgeFollowthroughPreplan(t *testing.T) {
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
			NoticeID:      "notice:smoke:001",
			SourceFamily:  "wechat_public_notice",
			Title:         "烟雾测试通知",
			TargetSurface: "regulations/student_rules",
		},
	}, policy)

	if plan == nil {
		t.Fatal("expected workflow plan")
	}
	if plan.WorkflowMode != WorkflowModeMultiStep {
		t.Fatalf("workflow mode = %q, want multi_step", plan.WorkflowMode)
	}
	if handoff := plan.SelectedHandoff(); handoff != nil {
		t.Fatalf("capability preplan must not carry selected handoff: %#v", handoff)
	}
	handoffs := plan.Handoffs()
	if len(handoffs) != 0 {
		t.Fatalf("handoff count = %d, want 0 for capability preplan", len(handoffs))
	}
	if capabilityPlan := plan.CapabilityPlan(); capabilityPlan == nil {
		t.Fatal("selected notice followthrough must carry internal capability plan")
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
	if !ok || len(steps) != 0 {
		t.Fatalf("projection steps = %#v, want no baked steps", projection["steps"])
	}
	edges, ok := projection["edges"].([]map[string]any)
	if !ok || len(edges) != 0 {
		t.Fatalf("projection edges = %#v, want no baked dependency edges", projection["edges"])
	}
}

func TestPlanWithPolicyBuildsTransportNoticeOverrideCapabilityPreplan(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	plan := PlanWithPolicy(Request{
		EffectiveCapability:      "campus_services",
		UserGoal:                 "今天丰台到海淀通勤车乘车点有没有调整",
		MultiStepWorkflowEnabled: true,
		SelectedNoticeRef: SelectedNoticeRef{
			NoticeID:      "notice:transport:353903",
			SourceFamily:  "internal_notice_restricted",
			Title:         "关于通勤班车丰台校区乘车点调整的通知",
			TargetSurface: "campus_services/service_status_candidate",
		},
	}, policy)

	if plan == nil {
		t.Fatal("expected planner to emit capability preplan")
	}
	if plan.WorkflowMode != WorkflowModeMultiStep {
		t.Fatalf("workflow mode = %q, want multi_step", plan.WorkflowMode)
	}
	if handoff := plan.SelectedHandoff(); handoff != nil {
		t.Fatalf("capability preplan must not bake selected handoff: %#v", handoff)
	}
	if handoffs := plan.Handoffs(); len(handoffs) != 0 {
		t.Fatalf("capability preplan handoffs = %#v, want none", handoffs)
	}
	capabilityPlan := plan.CapabilityPlan()
	if capabilityPlan == nil {
		t.Fatal("expected internal capability plan")
	}
	if !sameCapabilityArtifacts(
		capabilityPlan.RequiredArtifacts,
		[]string{"schedule_baseline", "notice_change_set", "evidence_bundle", "grounding_verdict"},
	) {
		t.Fatalf("required artifacts = %#v", capabilityPlan.RequiredArtifacts)
	}
}

func TestValidateWorkflowPlanWithAgentSpecRejectsInactiveAgent(t *testing.T) {
	plan := SingleHandoffPlan(Handoff{
		Target:      "navigation-agent",
		PayloadKind: "place_lookup",
		Payload:     map[string]any{"query_text": "北楼在哪里"},
	})
	registry := runtimepolicy.AgentSpecRegistry{
		SchemaVersion:   runtimepolicy.AgentSpecSchemaVersion,
		RegistryVersion: "test",
		Agents: []runtimepolicy.AgentSpec{
			{
				ID:                            "navigation-agent",
				Capability:                    "place_lookup",
				OwnerPackage:                  "packages/navigation-agent",
				RuntimeAdapter:                "worker_dispatch",
				Active:                        false,
				OpeningGate:                   "closed",
				AllowedStructuredHandoffTools: []string{},
				ContextProjectionKinds:        []string{"place_context"},
				Description:                   "fixture",
			},
		},
	}
	toolRegistry, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load tool spec: %v", err)
	}

	err = ValidateWorkflowPlanWithAgentSpec(plan, registry, toolRegistry)

	if err == nil {
		t.Fatal("expected inactive agent plan validation to fail")
	}
}

func TestValidateWorkflowPlanWithAgentSpecRejectsPayloadKindOutsideAgentSpec(t *testing.T) {
	plan := SingleHandoffPlan(Handoff{
		Target:      "campus-services-agent",
		PayloadKind: "campus_notice_discover",
		Payload:     map[string]any{"query_text": "校历"},
	})
	registry, err := runtimepolicy.LoadAgentSpecRegistry("")
	if err != nil {
		t.Fatalf("load agent spec: %v", err)
	}
	toolRegistry, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load tool spec: %v", err)
	}

	err = ValidateWorkflowPlanWithAgentSpec(plan, registry, toolRegistry)

	if err == nil {
		t.Fatal("expected payload kind outside AgentSpec to fail")
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
