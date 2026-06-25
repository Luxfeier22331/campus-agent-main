package structuredplanning

func plannerGoldenCasesPart04() []plannerGoldenCase {
	return []plannerGoldenCase{
		{
			name: "notice discover",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "找一下2026年春假通知",
			},
			wantCapability: "notice",
			wantKind:       "campus_notice_discover",
			wantTool:       "campus_notice_discover",
			wantPayload:    map[string]any{"query_text": "找一下2026年春假通知"},
		},
		{
			name: "notice original transport adjustment boundary",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "最近有哪些班车调整通知",
			},
			wantCapability: "notice",
			wantKind:       "campus_notice_discover",
			wantTool:       "campus_notice_discover",
			wantPayload:    map[string]any{"query_text": "最近有哪些班车调整通知"},
		},
		{
			name: "notice discover year hint",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "2026年春假通知",
			},
			wantCapability: "notice",
			wantKind:       "campus_notice_discover",
			wantTool:       "campus_notice_discover",
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
			wantCapability: "notice",
			wantKind:       "campus_notice_get",
			wantTool:       "",
			wantPayload:    map[string]any{"notice_id": "notice:2026-spring-break"},
		},
	}
}
