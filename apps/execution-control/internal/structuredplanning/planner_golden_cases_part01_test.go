package structuredplanning

func plannerGoldenCasesPart01() []plannerGoldenCase {
	return []plannerGoldenCase{
		{
			name: "transport snapshot metadata",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "最近的校车时刻表是什么",
			},
			wantCapability: "campus_services",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayload:    map[string]any{"intent": "schedule_snapshot_metadata"},
		},
		{
			name: "transport timetable",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校车时刻表",
			},
			wantCapability: "campus_services",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayload:    map[string]any{"intent": "timetable"},
		},
		{
			name: "transport last departure",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "回海淀最后一班校车几点",
			},
			wantCapability: "campus_services",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayload:    map[string]any{"intent": "last_departure"},
		},
		{
			name: "transport departure list",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "下午去丰台校车还有哪些班次",
			},
			wantCapability: "campus_services",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayload:    map[string]any{"intent": "departure_list"},
		},
		{
			name: "transport service window",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "校车今天还跑不跑",
			},
			wantCapability: "campus_services",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayload:    map[string]any{"intent": "service_window"},
		},
		{
			name: "academic calendar teaching week",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "今天第几教学周",
			},
			wantCapability: "campus_services",
			wantKind:       "academic_calendar_lookup",
			wantTool:       "academic_calendar_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "academic_calendar_lookup",
			wantTool:       "academic_calendar_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "academic_calendar_lookup",
			wantTool:       "academic_calendar_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "academic_calendar_lookup",
			wantTool:       "academic_calendar_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "academic_calendar_lookup",
			wantTool:       "academic_calendar_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "academic_calendar_lookup",
			wantTool:       "academic_calendar_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "academic_calendar_lookup",
			wantTool:       "academic_calendar_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "academic_calendar_lookup",
			wantTool:       "academic_calendar_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "service_guide_lookup",
			wantTool:       "service_guide_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "service_guide_lookup",
			wantTool:       "service_guide_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
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
			wantCapability: "campus_services",
			wantKind:       "service_status_lookup",
			wantTool:       "service_status_lookup",
			wantPayload:    map[string]any{"campus_scope": "fengtai"},
		},
		{
			name: "service status card center open alias",
			request: Request{
				EffectiveCapability: "campus_services",
				UserGoal:            "卡务中心今天开不开",
			},
			wantCapability: "campus_services",
			wantKind:       "service_status_lookup",
			wantTool:       "service_status_lookup",
			wantPayload:    map[string]any{"subject_query": "卡务中心今天开不开"},
		},
	}
}
