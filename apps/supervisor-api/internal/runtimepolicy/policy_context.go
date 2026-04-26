package runtimepolicy

func resolveContextFollowUp(context Context, normalizedGoal string, policy IntentPolicyArtifact) ContextPreflight {
	if signal := firstMatch(normalizedGoal, policy.Signals("contextual_follow_up")); signal != "" {
		candidates := previousGoalContextCandidates(context, policy)
		if len(candidates) == 0 {
			return ContextPreflight{
				State:         "missing_context",
				ReferenceType: "previous_goal",
				MissingSlots:  []string{"previous_goal"},
				ResolvedSlots: map[string]string{},
				MatchedSignal: signal,
			}
		}
		if len(candidates) > 1 {
			return ContextPreflight{
				State:           "ambiguous",
				ReferenceType:   "previous_goal",
				MissingSlots:    []string{"previous_goal"},
				ResolvedSlots:   map[string]string{},
				AmbiguityReason: "multiple_previous_goal_candidates",
				MatchedSignal:   signal,
			}
		}
		return ContextPreflight{
			State:         "resolved",
			ReferenceType: "previous_goal",
			ResolvedSlots: map[string]string{
				"previous_goal": candidates[0],
			},
			MissingSlots:  []string{},
			MatchedSignal: signal,
		}
	}

	if signal := firstMatch(normalizedGoal, policy.Signals("notice_context_reference")); signal != "" {
		if context.SelectedNoticeRef.NoticeID == "" {
			return ContextPreflight{
				State:         "missing_context",
				ReferenceType: "selected_notice",
				MissingSlots:  []string{"selected_notice_ref"},
				ResolvedSlots: map[string]string{},
				MatchedSignal: signal,
			}
		}
		resolvedSlots := map[string]string{"notice_id": context.SelectedNoticeRef.NoticeID}
		if context.SelectedNoticeRef.SourceFamily != "" {
			resolvedSlots["notice_source_family"] = context.SelectedNoticeRef.SourceFamily
		}
		if context.SelectedNoticeRef.Title != "" {
			resolvedSlots["notice_title"] = context.SelectedNoticeRef.Title
		}
		return ContextPreflight{
			State:         "resolved",
			ReferenceType: "selected_notice",
			ResolvedSlots: resolvedSlots,
			MissingSlots:  []string{},
			MatchedSignal: signal,
		}
	}

	if signal := firstMatch(normalizedGoal, policy.Signals("curriculum_semester")); signal != "" &&
		looksLikeContextualSemesterFollowUp(normalizedGoal, policy) {
		program := sessionSlotValue(context.SessionSlots, curriculumProgramSlot)
		programFamily := sessionSlotValue(context.SessionSlots, curriculumProgramFamilySlot)
		if program == "" && programFamily == "" {
			return ContextPreflight{
				State:         "missing_context",
				ReferenceType: "curriculum_slot",
				MissingSlots:  []string{curriculumProgramSlot},
				ResolvedSlots: map[string]string{},
				MatchedSignal: signal,
			}
		}
		resolvedSlots := map[string]string{curriculumSemesterSlot: signal}
		if program != "" {
			resolvedSlots[curriculumProgramSlot] = program
		}
		if programFamily != "" {
			resolvedSlots[curriculumProgramFamilySlot] = programFamily
		}
		return ContextPreflight{
			State:         "resolved",
			ReferenceType: "curriculum_slot",
			ResolvedSlots: resolvedSlots,
			MissingSlots:  []string{},
			MatchedSignal: signal,
		}
	}

	return ContextPreflight{
		State:         "not_follow_up",
		ReferenceType: "none",
		ResolvedSlots: map[string]string{},
		MissingSlots:  []string{},
	}
}
