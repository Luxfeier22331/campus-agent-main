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
	}
}
