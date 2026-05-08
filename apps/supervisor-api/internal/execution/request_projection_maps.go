package execution

import "slices"

func (a actorContext) isZero() bool {
	return a.UserID == "" &&
		a.PrincipalID == "" &&
		a.PrincipalType == "" &&
		len(a.Roles) == 0 &&
		len(a.Departments) == 0 &&
		a.Cohort == "" &&
		a.Major == "" &&
		a.Program == ""
}

func (a actorContext) equal(other actorContext) bool {
	return a.UserID == other.UserID &&
		a.PrincipalID == other.PrincipalID &&
		a.PrincipalType == other.PrincipalType &&
		slices.Equal(a.Roles, other.Roles) &&
		slices.Equal(a.Departments, other.Departments) &&
		a.Cohort == other.Cohort &&
		a.Major == other.Major &&
		a.Program == other.Program
}

func (a actorContext) toMap() map[string]any {
	result := map[string]any{}
	if a.UserID != "" {
		result["user_id"] = a.UserID
	}
	if a.PrincipalID != "" {
		result["principal_id"] = a.PrincipalID
	}
	if a.PrincipalType != "" {
		result["principal_type"] = a.PrincipalType
	}
	if len(a.Roles) > 0 {
		result["roles"] = a.Roles
	}
	if len(a.Departments) > 0 {
		result["departments"] = a.Departments
	}
	if a.Cohort != "" {
		result["cohort"] = a.Cohort
	}
	if a.Major != "" {
		result["major"] = a.Major
	}
	if a.Program != "" {
		result["program"] = a.Program
	}
	return result
}

func (a authorizationProjection) isZero() bool {
	return a.PrincipalID == "" &&
		a.ProjectionSource == "" &&
		a.EntitlementSnapshotID == "" &&
		len(a.EntitlementGroups) == 0 &&
		a.VisibilityScope == "" &&
		a.ApplicaibilityScope == "" &&
		len(a.OwnershipScopes) == 0 &&
		a.ApprovalState == "" &&
		len(a.RetrievalFilter.EntitlementGroups) == 0 &&
		a.RetrievalFilter.VisibilityLevel == "" &&
		a.RetrievalFilter.VisibilityScope == "" &&
		a.RetrievalFilter.PolicyProjectionValue == ""
}

func (a authorizationProjection) toMap() map[string]any {
	result := map[string]any{
		"principal_id": a.PrincipalID,
		"retrieval_filter": map[string]any{
			"visibility_level": defaultIfEmpty(a.RetrievalFilter.VisibilityLevel, "public"),
			"policy_projection_version": defaultIfEmpty(
				a.RetrievalFilter.PolicyProjectionValue,
				defaultPolicyProjectionVersion,
			),
		},
	}
	if a.ProjectionSource != "" {
		result["projection_source"] = a.ProjectionSource
	}
	if a.EntitlementSnapshotID != "" {
		result["entitlement_snapshot_id"] = a.EntitlementSnapshotID
	}
	if len(a.EntitlementGroups) > 0 {
		result["entitlement_groups"] = a.EntitlementGroups
	}
	if a.VisibilityScope != "" {
		result["visibility_scope"] = a.VisibilityScope
	}
	if a.ApplicaibilityScope != "" {
		result["applicability_scope"] = a.ApplicaibilityScope
	}
	if len(a.OwnershipScopes) > 0 {
		result["ownership_scopes"] = a.OwnershipScopes
	}
	if a.ApprovalState != "" {
		result["approval_state"] = a.ApprovalState
	}
	retrievalFilter := result["retrieval_filter"].(map[string]any)
	if len(a.RetrievalFilter.EntitlementGroups) > 0 {
		retrievalFilter["entitlement_groups"] = a.RetrievalFilter.EntitlementGroups
	}
	if a.RetrievalFilter.VisibilityScope != "" {
		retrievalFilter["visibility_scope"] = a.RetrievalFilter.VisibilityScope
	}
	return result
}

func (c contextProjection) toMap() map[string]any {
	session := map[string]any{
		"confirmed_slots": sessionSlotsToMaps(c.SessionSlots),
		"turn_count":      c.TurnCount,
	}
	if c.SelectedNoticeRef.NoticeID != "" {
		session["selected_notice_ref"] = c.SelectedNoticeRef.toMap()
	}
	result := map[string]any{
		"actor":         c.Actor.toMap(),
		"authorization": c.Authorization.toMap(),
		"profile_memory": map[string]any{
			"items": profileMemoryItemsToMaps(c.ProfileMemory),
		},
		"session": session,
	}
	return result
}

func (c contextProjection) noticeAccessContextMap() map[string]any {
	authorization := c.Authorization
	retrievalFilter := authorization.RetrievalFilter
	return map[string]any{
		"authorization": map[string]any{
			"principal_id":       authorization.PrincipalID,
			"entitlement_groups": append([]string(nil), authorization.EntitlementGroups...),
			"retrieval_filter": map[string]any{
				"entitlement_groups": append([]string(nil), retrievalFilter.EntitlementGroups...),
				"visibility_level": defaultIfEmpty(
					retrievalFilter.VisibilityLevel,
					"public",
				),
			},
		},
	}
}

func (r selectedNoticeRef) toMap() map[string]any {
	result := map[string]any{
		"notice_id": r.NoticeID,
	}
	if r.SourceFamily != "" {
		result["source_family"] = r.SourceFamily
	}
	if r.Title != "" {
		result["title"] = r.Title
	}
	if r.TargetSurface != "" {
		result["target_surface"] = r.TargetSurface
	}
	return result
}

func profileMemoryItemsToMaps(items []profileMemoryItem) []map[string]any {
	results := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result := map[string]any{
			"item_id":     item.ItemID,
			"key":         item.Key,
			"value":       item.Value,
			"source_type": defaultIfEmpty(item.SourceType, "user_declared"),
			"confidence":  defaultIfEmpty(item.Confidence, "low"),
			"visibility":  defaultIfEmpty(item.Visibility, "user_visible"),
		}
		if item.LastVerifiedAt != "" {
			result["last_verified_at"] = item.LastVerifiedAt
		}
		results = append(results, result)
	}
	return results
}

func sessionSlotsToMaps(slots []sessionSlot) []map[string]any {
	results := make([]map[string]any, 0, len(slots))
	for _, slot := range slots {
		results = append(results, map[string]any{
			"name":      slot.Name,
			"value":     slot.Value,
			"confirmed": slot.Confirmed,
		})
	}
	return results
}

func defaultIfEmpty(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
