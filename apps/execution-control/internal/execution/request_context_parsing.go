package execution

import (
	"encoding/json"
	"fmt"
)

func parseRequestActor(raw json.RawMessage, authMode string) (actorContext, bool, error) {
	if len(raw) == 0 {
		return actorContext{}, false, nil
	}
	if authMode != "trusted-worker" {
		return actorContext{}, false, fmt.Errorf("actor projection is only accepted in trusted-worker mode")
	}
	actor, err := parseActorContext(raw, "actor")
	return actor, true, err
}

func parseContextProjection(raw json.RawMessage, authMode string) (contextProjection, bool, error) {
	if len(raw) == 0 {
		return contextProjection{}, false, nil
	}
	if authMode != "trusted-worker" {
		return contextProjection{}, false, fmt.Errorf("context projection is only accepted in trusted-worker mode")
	}
	rawContext, err := parseObject(raw, "context")
	if err != nil {
		return contextProjection{}, false, fmt.Errorf("context must be an object")
	}

	projectedActor, err := parseActorContext(rawContext["actor"], "context.actor")
	if err != nil {
		return contextProjection{}, false, err
	}
	authorization, err := parseAuthorizationProjection(
		rawContext["authorization"],
		projectedActor,
		true,
	)
	if err != nil {
		return contextProjection{}, false, err
	}
	profileMemory, err := parseProfileMemorySummary(rawContext["profile_memory"])
	if err != nil {
		return contextProjection{}, false, err
	}
	sessionSlots, selectedNoticeRef, turnCount, err := parseSessionSummary(rawContext["session"])
	if err != nil {
		return contextProjection{}, false, err
	}

	return contextProjection{
		Actor:             projectedActor,
		Authorization:     authorization,
		ProfileMemory:     profileMemory,
		SessionSlots:      sessionSlots,
		SelectedNoticeRef: selectedNoticeRef,
		TurnCount:         turnCount,
	}, true, nil
}

func parseActorContext(raw json.RawMessage, fieldPrefix string) (actorContext, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return actorContext{}, nil
	}
	rawActor, err := parseObject(raw, fieldPrefix)
	if err != nil {
		return actorContext{}, fmt.Errorf("%s must be an object", fieldPrefix)
	}
	if err := assertSupportedFields(
		rawActor,
		[]string{
			"user_id",
			"principal_id",
			"principal_type",
			"roles",
			"departments",
			"cohort",
			"major",
			"program",
		},
		fieldPrefix,
		"unsupported actor context fields are not allowed: %s",
	); err != nil {
		return actorContext{}, err
	}

	roles, err := parseStringArray(rawActor["roles"], fieldPrefix+".roles")
	if err != nil {
		return actorContext{}, err
	}
	departments, err := parseStringArray(rawActor["departments"], fieldPrefix+".departments")
	if err != nil {
		return actorContext{}, err
	}
	userID, err := parseOptionalString(rawActor["user_id"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.user_id must be a string", fieldPrefix)
	}
	principalID, err := parseOptionalString(rawActor["principal_id"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.principal_id must be a string", fieldPrefix)
	}
	principalType, err := parseOptionalString(rawActor["principal_type"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.principal_type must be a string", fieldPrefix)
	}
	cohort, err := parseOptionalString(rawActor["cohort"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.cohort must be a string", fieldPrefix)
	}
	major, err := parseOptionalString(rawActor["major"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.major must be a string", fieldPrefix)
	}
	program, err := parseOptionalString(rawActor["program"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.program must be a string", fieldPrefix)
	}

	return actorContext{
		UserID:        userID,
		PrincipalID:   principalID,
		PrincipalType: principalType,
		Roles:         roles,
		Departments:   departments,
		Cohort:        cohort,
		Major:         major,
		Program:       program,
	}, nil
}

func parseAuthorizationProjection(
	raw json.RawMessage,
	actor actorContext,
	requireExplicitFilter bool,
) (authorizationProjection, error) {
	if len(raw) == 0 || string(raw) == "null" {
		if requireExplicitFilter {
			return authorizationProjection{}, fmt.Errorf("context.authorization is required")
		}
		return newDefaultAuthorizationProjection(actor), nil
	}
	rawAuthorization, err := parseObject(raw, "context.authorization")
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization must be an object")
	}

	entitlementGroups, err := parseStringArray(
		rawAuthorization["entitlement_groups"],
		"context.authorization.entitlement_groups",
	)
	if err != nil {
		return authorizationProjection{}, err
	}
	visibilityScope, err := parseOptionalString(rawAuthorization["visibility_scope"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.visibility_scope must be a string")
	}
	projectionSource, err := parseOptionalString(rawAuthorization["projection_source"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.projection_source must be a string")
	}
	entitlementSnapshotID, err := parseOptionalString(rawAuthorization["entitlement_snapshot_id"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.entitlement_snapshot_id must be a string")
	}
	applicabilityScope, err := parseOptionalString(rawAuthorization["applicability_scope"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.applicability_scope must be a string")
	}
	approvalState, err := parseOptionalString(rawAuthorization["approval_state"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.approval_state must be a string")
	}
	ownershipScopes, err := parseStringArray(
		rawAuthorization["ownership_scopes"],
		"context.authorization.ownership_scopes",
	)
	if err != nil {
		return authorizationProjection{}, err
	}
	retrievalFilter, err := parseAuthorizedRetrievalFilter(
		rawAuthorization["retrieval_filter"],
		requireExplicitFilter,
	)
	if err != nil {
		return authorizationProjection{}, err
	}

	principalID, err := parseOptionalString(rawAuthorization["principal_id"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.principal_id must be a string")
	}
	if principalID == "" {
		if actor.PrincipalID != "" {
			principalID = actor.PrincipalID
		} else {
			principalID = actor.UserID
		}
	}

	return authorizationProjection{
		PrincipalID:           principalID,
		ProjectionSource:      projectionSource,
		EntitlementSnapshotID: entitlementSnapshotID,
		EntitlementGroups:     entitlementGroups,
		VisibilityScope:       visibilityScope,
		ApplicaibilityScope:   applicabilityScope,
		OwnershipScopes:       ownershipScopes,
		ApprovalState:         approvalState,
		RetrievalFilter:       retrievalFilter,
	}, nil
}

func parseAuthorizedRetrievalFilter(
	raw json.RawMessage,
	requireExplicit bool,
) (authorizedRetrievalFilter, error) {
	if len(raw) == 0 || string(raw) == "null" {
		if requireExplicit {
			return authorizedRetrievalFilter{}, fmt.Errorf("context.authorization.retrieval_filter is required")
		}
		return authorizedRetrievalFilter{
			VisibilityLevel:       "public",
			PolicyProjectionValue: defaultPolicyProjectionVersion,
		}, nil
	}
	rawFilter, err := parseObject(raw, "context.authorization.retrieval_filter")
	if err != nil {
		return authorizedRetrievalFilter{}, fmt.Errorf("context.authorization.retrieval_filter must be an object")
	}
	if err := assertSupportedFields(
		rawFilter,
		[]string{
			"entitlement_groups",
			"visibility_level",
			"visibility_scope",
			"policy_projection_version",
		},
		"context.authorization.retrieval_filter",
		"unsupported retrieval filter fields are not allowed: %s",
	); err != nil {
		return authorizedRetrievalFilter{}, err
	}

	entitlementGroups, err := parseStringArray(
		rawFilter["entitlement_groups"],
		"context.authorization.retrieval_filter.entitlement_groups",
	)
	if err != nil {
		return authorizedRetrievalFilter{}, err
	}
	visibilityLevel, err := parseOptionalString(rawFilter["visibility_level"])
	if err != nil {
		return authorizedRetrievalFilter{}, fmt.Errorf(
			"context.authorization.retrieval_filter.visibility_level must be a string",
		)
	}
	if visibilityLevel == "" {
		visibilityLevel = "public"
	}
	visibilityScope, err := parseOptionalString(rawFilter["visibility_scope"])
	if err != nil {
		return authorizedRetrievalFilter{}, fmt.Errorf(
			"context.authorization.retrieval_filter.visibility_scope must be a string",
		)
	}
	policyProjectionVersion, err := parseOptionalString(rawFilter["policy_projection_version"])
	if err != nil {
		return authorizedRetrievalFilter{}, fmt.Errorf(
			"context.authorization.retrieval_filter.policy_projection_version must be a string",
		)
	}
	if policyProjectionVersion == "" {
		policyProjectionVersion = defaultPolicyProjectionVersion
	}

	return authorizedRetrievalFilter{
		EntitlementGroups:     entitlementGroups,
		VisibilityLevel:       visibilityLevel,
		VisibilityScope:       visibilityScope,
		PolicyProjectionValue: policyProjectionVersion,
	}, nil
}

func parseProfileMemorySummary(raw json.RawMessage) ([]profileMemoryItem, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	rawMemory, err := parseObject(raw, "context.profile_memory")
	if err != nil {
		return nil, fmt.Errorf("context.profile_memory must be an object")
	}
	if len(rawMemory["items"]) == 0 {
		return nil, nil
	}
	rawItems, err := parseArray(rawMemory["items"], "context.profile_memory.items")
	if err != nil {
		return nil, err
	}

	items := make([]profileMemoryItem, 0, len(rawItems))
	for _, rawItem := range rawItems {
		objectItem, err := parseObject(rawItem, "context.profile_memory.items[]")
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items must only contain objects")
		}
		itemID, err := requireString(
			objectItem["item_id"],
			"context.profile_memory.items[].item_id",
		)
		if err != nil {
			return nil, err
		}
		key, err := requireString(objectItem["key"], "context.profile_memory.items[].key")
		if err != nil {
			return nil, err
		}
		value, err := requireString(objectItem["value"], "context.profile_memory.items[].value")
		if err != nil {
			return nil, err
		}
		sourceType, err := parseOptionalString(objectItem["source_type"])
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items[].source_type must be a string")
		}
		confidence, err := parseOptionalString(objectItem["confidence"])
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items[].confidence must be a string")
		}
		visibility, err := parseOptionalString(objectItem["visibility"])
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items[].visibility must be a string")
		}
		lastVerifiedAt, err := parseOptionalString(objectItem["last_verified_at"])
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items[].last_verified_at must be a string")
		}
		if sourceType == "" {
			sourceType = "user_declared"
		}
		if confidence == "" {
			confidence = "low"
		}
		if visibility == "" {
			visibility = "user_visible"
		}
		items = append(items, profileMemoryItem{
			ItemID:         itemID,
			Key:            key,
			Value:          value,
			SourceType:     sourceType,
			Confidence:     confidence,
			Visibility:     visibility,
			LastVerifiedAt: lastVerifiedAt,
		})
	}

	return items, nil
}

func parseSessionSummary(raw json.RawMessage) ([]sessionSlot, selectedNoticeRef, int, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, selectedNoticeRef{}, 0, nil
	}
	rawSession, err := parseObject(raw, "context.session")
	if err != nil {
		return nil, selectedNoticeRef{}, 0, fmt.Errorf("context.session must be an object")
	}

	var rawSlots []json.RawMessage
	if len(rawSession["confirmed_slots"]) > 0 {
		rawSlots, err = parseArray(rawSession["confirmed_slots"], "context.session.confirmed_slots")
		if err != nil {
			return nil, selectedNoticeRef{}, 0, err
		}
	}
	confirmedSlots := make([]sessionSlot, 0, len(rawSlots))
	for _, rawSlot := range rawSlots {
		objectSlot, err := parseObject(rawSlot, "context.session.confirmed_slots[]")
		if err != nil {
			return nil, selectedNoticeRef{}, 0, fmt.Errorf("context.session.confirmed_slots must only contain objects")
		}
		name, err := requireString(objectSlot["name"], "context.session.confirmed_slots[].name")
		if err != nil {
			return nil, selectedNoticeRef{}, 0, err
		}
		value, err := requireString(objectSlot["value"], "context.session.confirmed_slots[].value")
		if err != nil {
			return nil, selectedNoticeRef{}, 0, err
		}
		confirmed, err := parseOptionalBool(objectSlot["confirmed"], true)
		if err != nil {
			return nil, selectedNoticeRef{}, 0, fmt.Errorf("context.session.confirmed_slots[].confirmed must be a boolean")
		}
		confirmedSlots = append(confirmedSlots, sessionSlot{
			Name:      name,
			Value:     value,
			Confirmed: confirmed,
		})
	}

	selectedRef, err := parseSelectedNoticeRef(rawSession["selected_notice_ref"])
	if err != nil {
		return nil, selectedNoticeRef{}, 0, err
	}
	turnCount, err := parseOptionalInt(rawSession["turn_count"], 0)
	if err != nil {
		return nil, selectedNoticeRef{}, 0, fmt.Errorf("context.session.turn_count must be an integer")
	}
	return confirmedSlots, selectedRef, turnCount, nil
}

func parseSelectedNoticeRef(raw json.RawMessage) (selectedNoticeRef, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return selectedNoticeRef{}, nil
	}
	rawRef, err := parseObject(raw, "context.session.selected_notice_ref")
	if err != nil {
		return selectedNoticeRef{}, fmt.Errorf("context.session.selected_notice_ref must be an object")
	}
	noticeID, err := requireString(
		rawRef["notice_id"],
		"context.session.selected_notice_ref.notice_id",
	)
	if err != nil {
		return selectedNoticeRef{}, err
	}
	sourceFamily, err := parseOptionalString(rawRef["source_family"])
	if err != nil {
		return selectedNoticeRef{}, fmt.Errorf("context.session.selected_notice_ref.source_family must be a string")
	}
	title, err := parseOptionalString(rawRef["title"])
	if err != nil {
		return selectedNoticeRef{}, fmt.Errorf("context.session.selected_notice_ref.title must be a string")
	}
	targetSurface, err := parseOptionalString(rawRef["target_surface"])
	if err != nil {
		return selectedNoticeRef{}, fmt.Errorf("context.session.selected_notice_ref.target_surface must be a string")
	}
	return selectedNoticeRef{
		NoticeID:      noticeID,
		SourceFamily:  sourceFamily,
		Title:         title,
		TargetSurface: targetSurface,
	}, nil
}

func parseRequestedScope(raw json.RawMessage) (knowledgeScope, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return knowledgeScope{}, false, nil
	}
	rawScope, err := parseObject(raw, "requested_scope")
	if err != nil {
		return knowledgeScope{}, false, fmt.Errorf("requested_scope must be an object")
	}
	corpus, err := parseOptionalString(rawScope["corpus"])
	if err != nil {
		return knowledgeScope{}, false, fmt.Errorf("requested_scope requires corpus and collection")
	}
	collection, err := parseOptionalString(rawScope["collection"])
	if err != nil {
		return knowledgeScope{}, false, fmt.Errorf("requested_scope requires corpus and collection")
	}
	if corpus == "" || collection == "" {
		return knowledgeScope{}, false, fmt.Errorf("requested_scope requires corpus and collection")
	}
	return knowledgeScope{Corpus: corpus, Collection: collection}, true, nil
}

func parseVersionQuery(raw json.RawMessage) (versionQuery, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return versionQuery{Mode: "current"}, nil
	}
	rawVersionQuery, err := parseObject(raw, "version_query")
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query must be an object")
	}
	mode, err := parseOptionalString(rawVersionQuery["mode"])
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query.mode must be a string")
	}
	asOf, err := parseOptionalString(rawVersionQuery["as_of"])
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query.as_of must be a string")
	}
	versionID, err := parseOptionalString(rawVersionQuery["version_id"])
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query.version_id must be a string")
	}
	compareToVersionID, err := parseOptionalString(rawVersionQuery["compare_to_version_id"])
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query.compare_to_version_id must be a string")
	}
	if mode == "" {
		mode = "current"
	}
	query := versionQuery{
		Mode:               mode,
		AsOf:               asOf,
		VersionID:          versionID,
		CompareToVersionID: compareToVersionID,
	}
	return query, validateVersionQuery(query)
}

func validateVersionQuery(query versionQuery) error {
	switch query.Mode {
	case "current", "historical", "as_of", "compare":
	default:
		return fmt.Errorf("unsupported version mode: %s", query.Mode)
	}
	if query.Mode == "as_of" {
		if query.AsOf == "" {
			return fmt.Errorf("as_of is required when version mode is as_of")
		}
		if query.VersionID != "" {
			return fmt.Errorf("version_id is not allowed when version mode is as_of")
		}
		if query.CompareToVersionID != "" {
			return fmt.Errorf("compare_to_version_id is only allowed when version mode is compare")
		}
	} else if query.AsOf != "" {
		return fmt.Errorf("as_of is only allowed when version mode is as_of")
	}
	if query.Mode != "historical" && query.Mode != "compare" && query.VersionID != "" {
		return fmt.Errorf("version_id is only allowed when version mode is historical or compare")
	}
	if query.Mode != "compare" && query.CompareToVersionID != "" {
		return fmt.Errorf("compare_to_version_id is only allowed when version mode is compare")
	}
	if query.CompareToVersionID != "" && query.VersionID == "" {
		return fmt.Errorf("version_id is required when compare_to_version_id is set")
	}
	return nil
}
