package toolreadmodel

import (
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
	return strings.TrimSpace(row.CanonicalURL)
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
