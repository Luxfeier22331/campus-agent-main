package structuredquery

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

func noticePublicCardDisplayPolicy() noticeDisplayPolicy {
	return noticeDisplayPolicy{
		PublicSurface:     "card_only",
		FullBodyForbidden: true,
		BodyAccess:        "none",
	}
}

func decodeNoticeEnvelope(rawBody []byte) (noticeQueryEnvelope, error) {
	var envelope noticeQueryEnvelope
	if err := json.Unmarshal(rawBody, &envelope); err != nil {
		return noticeQueryEnvelope{}, err
	}
	if len(envelope.Payload) == 0 {
		return noticeQueryEnvelope{}, errors.New("payload is required")
	}
	return envelope, nil
}

func normalizeNoticeDiscoverRequest(request *noticeDiscoverRequest) {
	request.QueryText = strings.TrimSpace(request.QueryText)
	for index, value := range request.SourceFamilies {
		request.SourceFamilies[index] = strings.TrimSpace(value)
	}
	request.TargetSurfaces = normalizeNoticeTargetSurfaces(request.TargetSurfaces)
}

func normalizeNoticeTargetSurfaces(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		normalized = append(normalized, item)
	}
	return normalized
}

func normalizeTransportScopeStrings(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		normalized = append(normalized, item)
	}
	return normalized
}

func transportRouteMatchesChangeSetQuery(
	route transportRouteRecord,
	request noticeChangeSetLookupRequest,
) bool {
	if len(request.RouteLabels) == 0 {
		return true
	}
	candidates := append([]string{route.DisplayName}, route.Aliases...)
	for _, label := range request.RouteLabels {
		for _, candidate := range candidates {
			if strings.TrimSpace(candidate) == strings.TrimSpace(label) {
				return true
			}
		}
	}
	return false
}

func transportOperationalNoticeIDs(notices []transportOperationalNotice) []string {
	ids := make([]string, 0, len(notices))
	for _, notice := range notices {
		if strings.TrimSpace(notice.NoticeID) != "" {
			ids = append(ids, strings.TrimSpace(notice.NoticeID))
		}
	}
	return ids
}

func noticeRowsForIDs(
	rows []noticeReadModelRecord,
	noticeIDs []string,
) []noticeReadModelRecord {
	selected := make([]noticeReadModelRecord, 0, len(noticeIDs))
	seen := map[string]bool{}
	for _, id := range noticeIDs {
		seen[strings.TrimSpace(id)] = true
	}
	for _, row := range rows {
		if seen[strings.TrimSpace(row.SourceNoticeID)] {
			selected = append(selected, row)
		}
	}
	return selected
}

func buildTransportNoticeChangeSet(
	request noticeChangeSetLookupRequest,
	route transportRouteRecord,
	notices []transportOperationalNotice,
	rows []noticeReadModelRecord,
) noticeChangeSet {
	sourceRefs := make([]noticeChangeSetSourceRef, 0, len(rows))
	facts := make([]noticeChangeSetFact, 0, len(notices))
	sourceRefIDs := map[string]string{}
	for _, row := range rows {
		sourceRefID := "notice-ref:" + strings.TrimSpace(row.SourceNoticeID)
		sourceRefIDs[strings.TrimSpace(row.SourceNoticeID)] = sourceRefID
		sourceRefs = append(sourceRefs, noticeChangeSetSourceRef{
			SourceRefID: sourceRefID,
			NoticeID:    strings.TrimSpace(row.SourceNoticeID),
			Title:       strings.TrimSpace(row.Title),
			SourceURL:   strings.TrimSpace(row.SourceURL),
			PublishedAt: strings.TrimSpace(row.PublishedAt),
			Excerpt:     strings.TrimSpace(row.BodyExcerpt),
		})
	}
	changeKind := "temporary_overlay"
	for index, notice := range notices {
		factKind := "baseline_delta_summary"
		switch strings.TrimSpace(notice.NoticeKind) {
		case "boarding_point_change":
			factKind = "stop_changed"
			changeKind = "stop_or_boarding_point_change"
		case "service_suspension":
			factKind = "service_suspended"
			changeKind = "service_suspension"
		case "service_restoration":
			factKind = "service_restored"
			changeKind = "service_restoration"
		}
		noticeID := strings.TrimSpace(notice.NoticeID)
		facts = append(facts, noticeChangeSetFact{
			FactID:         "fact:" + noticeID + ":" + route.RouteID + ":" + strings.TrimSpace(notice.NoticeKind),
			FactKind:       factKind,
			ChangeText:     strings.TrimSpace(notice.OperationalComment),
			SourceNoticeID: noticeID,
			SourceRefID:    sourceRefIDs[noticeID],
			RouteLabel:     strings.TrimSpace(route.DisplayName),
			ServiceWindow: map[string]string{
				"effective_from":  strings.TrimSpace(notice.EffectiveFrom),
				"effective_until": strings.TrimSpace(notice.EffectiveUntil),
			},
			Confidence: "deterministic",
		})
		_ = index
	}
	payload := map[string]any{
		"query_text":        request.QueryText,
		"route_label":       route.DisplayName,
		"service_date":      request.ServiceDate,
		"source_notice_ids": transportOperationalNoticeIDs(notices),
		"change_kind":       changeKind,
	}
	return noticeChangeSet{
		SchemaVersion: "notice-change-set-v1",
		ChangeSetID:   "notice-change-set:" + route.RouteID + ":" + request.ServiceDate,
		TargetFamily:  "transport_schedule",
		QueryScope: noticeChangeSetQueryScope{
			ServiceKind:     "transport_schedule",
			RouteLabels:     []string{strings.TrimSpace(route.DisplayName)},
			DirectionLabels: append([]string{}, request.DirectionLabels...),
			StopLabels:      append([]string{}, request.StopLabels...),
			QueryTimeAnchor: request.QueryTimeAnchor,
			ServiceDate:     request.ServiceDate,
		},
		EffectiveWindow: noticeChangeSetEffectiveWindow{
			StartsAt:           strings.TrimSpace(notices[0].EffectiveFrom),
			EndsAt:             strings.TrimSpace(notices[0].EffectiveUntil),
			Timezone:           "Asia/Shanghai",
			CurrentAtQueryTime: true,
		},
		ChangeKind:     changeKind,
		AnswerEligible: true,
		AdmissionState: "answer_eligible",
		ContentHash:    noticeChangeSetContentHash(payload),
		Facts:          facts,
		SourceRefs:     sourceRefs,
		Conflicts:      []noticeChangeSetConflict{},
		SafetySummary: noticeChangeSetSafetySummary{
			RawPayloadAbsent: true,
			PayloadKeyNames:  []string{"schema_version", "query_scope", "effective_window", "facts", "source_refs"},
			Redacted:         false,
			Notes:            []string{"bounded_transport_notice_override"},
		},
	}
}

func hasInternalNoticeAccess(accessContext noticeAccessContext) bool {
	authorization := accessContext.Authorization
	if !hasNoticePrincipal(accessContext) {
		return false
	}
	if strings.TrimSpace(authorization.RetrievalFilter.VisibilityLevel) != "restricted" {
		return false
	}
	for _, value := range authorization.EntitlementGroups {
		if strings.TrimSpace(value) != "" {
			return true
		}
	}
	for _, value := range authorization.RetrievalFilter.EntitlementGroups {
		if strings.TrimSpace(value) != "" {
			return true
		}
	}
	return false
}

func hasNoticePrincipal(accessContext noticeAccessContext) bool {
	return strings.TrimSpace(accessContext.Authorization.PrincipalID) != ""
}

func noticeAuthorizationFilterForAccessContext(
	accessContext noticeAccessContext,
) noticeReadModelAuthorizationFilter {
	authorization := accessContext.Authorization
	groups := normalizeNoticeEntitlementGroups(authorization.RetrievalFilter.EntitlementGroups)
	if len(groups) == 0 {
		groups = normalizeNoticeEntitlementGroups(authorization.EntitlementGroups)
	}
	return noticeReadModelAuthorizationFilter{
		VisibilityLevel:   strings.TrimSpace(authorization.RetrievalFilter.VisibilityLevel),
		EntitlementGroups: groups,
	}
}

func normalizeNoticeEntitlementGroups(values []string) []string {
	normalized := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		normalized = append(normalized, item)
	}
	return normalized
}

func noticeReadModelRowsAuthorized(
	rows []noticeReadModelRecord,
	filter noticeReadModelAuthorizationFilter,
) bool {
	for _, row := range rows {
		if !noticeReadModelRowAuthorized(row, filter) {
			return false
		}
	}
	return true
}

func noticeReadModelRowsHaveMinimumCardFields(rows []noticeReadModelRecord) bool {
	for _, row := range rows {
		if strings.TrimSpace(row.SourceNoticeID) == "" {
			return false
		}
		if strings.TrimSpace(row.SourceFamily) == "" {
			return false
		}
		if strings.TrimSpace(row.Title) == "" {
			return false
		}
		if strings.TrimSpace(row.SourceURL) == "" {
			return false
		}
		if strings.TrimSpace(row.TargetSurface) == "" {
			return false
		}
	}
	return true
}

func noticeReadModelRowAuthorized(
	row noticeReadModelRecord,
	filter noticeReadModelAuthorizationFilter,
) bool {
	sourceFamily := strings.TrimSpace(row.SourceFamily)
	if sourceFamily == "" {
		sourceFamily = internalNoticeRestrictedSourceFamily
	}
	if isPublicNoticeSourceFamily(sourceFamily) {
		visibilityLevel := strings.TrimSpace(row.VisibilityLevel)
		return visibilityLevel == "" || visibilityLevel == "public"
	}
	if sourceFamily != internalNoticeRestrictedSourceFamily {
		return false
	}
	if strings.TrimSpace(filter.VisibilityLevel) != "restricted" {
		return false
	}
	if strings.TrimSpace(row.VisibilityLevel) != "restricted" {
		return false
	}
	if strings.TrimSpace(row.PolicyProjectionVersion) == "" {
		return false
	}
	return noticeEntitlementGroupsOverlap(row.EntitlementGroups, filter.EntitlementGroups)
}

func noticeCanonicalURL(row noticeReadModelRecord) string {
	canonicalURL := strings.TrimSpace(row.CanonicalURL)
	if canonicalURL != "" {
		return canonicalURL
	}
	return strings.TrimSpace(row.SourceURL)
}

func noticeEntitlementGroupsOverlap(left []string, right []string) bool {
	rightSet := map[string]bool{}
	for _, value := range right {
		item := strings.TrimSpace(value)
		if item != "" {
			rightSet[item] = true
		}
	}
	if len(rightSet) == 0 {
		return false
	}
	for _, value := range left {
		if rightSet[strings.TrimSpace(value)] {
			return true
		}
	}
	return false
}

func admittedNoticeSourceFamilies(accessContext noticeAccessContext) []string {
	if !hasNoticePrincipal(accessContext) {
		return nil
	}
	admitted := []string{
		officialWebPublicNoticeSourceFamily,
		wechatPublicNoticeSourceFamily,
	}
	if hasInternalNoticeAccess(accessContext) {
		admitted = append(admitted, internalNoticeRestrictedSourceFamily)
	}
	return admitted
}

func resolveNoticeSourceFamilies(requested []string, admitted []string) ([]string, bool) {
	admittedSet := map[string]bool{}
	for _, family := range admitted {
		if isKnownNoticeSourceFamily(family) {
			admittedSet[family] = true
		}
	}
	if len(admittedSet) == 0 {
		return nil, false
	}
	if len(requested) == 0 {
		resolved := make([]string, 0, len(admittedSet))
		for _, family := range admitted {
			if admittedSet[family] {
				resolved = append(resolved, family)
				delete(admittedSet, family)
			}
		}
		return resolved, false
	}
	invalid := false
	resolved := make([]string, 0, len(requested))
	seen := map[string]bool{}
	for _, value := range requested {
		family := strings.TrimSpace(value)
		if family == "" {
			continue
		}
		if !isKnownNoticeSourceFamily(family) {
			invalid = true
			continue
		}
		if !admittedSet[family] || seen[family] {
			continue
		}
		seen[family] = true
		resolved = append(resolved, family)
	}
	return resolved, invalid
}

func isNoticeSourceFamilyAdmitted(sourceFamily string, accessContext noticeAccessContext) bool {
	for _, admitted := range admittedNoticeSourceFamilies(accessContext) {
		if admitted == sourceFamily {
			return true
		}
	}
	return false
}

func isKnownNoticeSourceFamily(sourceFamily string) bool {
	switch strings.TrimSpace(sourceFamily) {
	case internalNoticeRestrictedSourceFamily, officialWebPublicNoticeSourceFamily, wechatPublicNoticeSourceFamily:
		return true
	default:
		return false
	}
}

func isPublicNoticeSourceFamily(sourceFamily string) bool {
	switch strings.TrimSpace(sourceFamily) {
	case officialWebPublicNoticeSourceFamily, wechatPublicNoticeSourceFamily:
		return true
	default:
		return false
	}
}

func failClosedNoticeDiscover(queryText string, sourceFamilies []string, timeAnchor string, reason string) Response {
	body := noticeDiscoverResult{
		QueryText:         queryText,
		Outcome:           "temporarily_unverifiable",
		SourceFamilies:    sourceFamilies,
		QueriedTimeAnchor: timeAnchor,
		FailCloseReason:   reason,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func failClosedNoticeGet(noticeID string, sourceFamily string, reason string) Response {
	body := noticeGetResult{
		NoticeID:        noticeID,
		Outcome:         "temporarily_unverifiable",
		SourceFamily:    sourceFamily,
		DisplayPolicy:   noticePublicCardDisplayPolicy(),
		FailCloseReason: reason,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func failClosedNoticeChangeSet(queryText string, reason string) Response {
	body := noticeChangeSetLookupResult{
		QueryText:       queryText,
		Outcome:         "temporarily_unverifiable",
		FailCloseReason: reason,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func noticeChangeSetContentHash(payload map[string]any) string {
	raw, err := json.Marshal(payload)
	if err != nil {
		raw = []byte("{}")
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}
