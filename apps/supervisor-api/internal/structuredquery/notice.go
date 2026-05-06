package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

const (
	internalNoticeRestrictedSourceFamily = "internal_notice_restricted"
	officialWebPublicNoticeSourceFamily  = "official_web_public_notice"
	wechatPublicNoticeSourceFamily       = "wechat_public_notice"
	defaultNoticeDiscoverMaxResults      = 5
	noticeDiscoverMaxResultsLimit        = 20
)

var errNoticeBodyUnavailable = errors.New("notice body unavailable")

type NoticeReadModelStore interface {
	SearchNotices(
		ctx context.Context,
		criteria noticeSearchCriteria,
	) ([]noticeReadModelRecord, error)
	GetNoticeByID(
		ctx context.Context,
		criteria noticeGetCriteria,
	) (noticeReadModelRecord, bool, error)
}

type NoticeBodyStore interface {
	GetNoticeBody(ctx context.Context, objectKey string) (string, error)
}

type noticeQueryEnvelope struct {
	Payload       json.RawMessage     `json:"payload"`
	AccessContext noticeAccessContext `json:"access_context"`
}

type noticeAccessContext struct {
	Authorization noticeAuthorization `json:"authorization"`
}

type noticeAuthorization struct {
	PrincipalID       string                `json:"principal_id"`
	EntitlementGroups []string              `json:"entitlement_groups"`
	RetrievalFilter   noticeRetrievalFilter `json:"retrieval_filter"`
}

type noticeRetrievalFilter struct {
	EntitlementGroups []string `json:"entitlement_groups"`
	VisibilityLevel   string   `json:"visibility_level"`
}

type noticeDiscoverRequest struct {
	QueryText      string        `json:"query_text"`
	TemporalQuery  temporalQuery `json:"temporal_query"`
	SourceFamilies []string      `json:"source_families"`
	TargetSurfaces []string      `json:"target_surfaces"`
	MaxResults     int           `json:"max_results"`
}

type noticeGetRequest struct {
	NoticeID       string   `json:"notice_id"`
	SourceFamily   string   `json:"source_family"`
	TargetSurfaces []string `json:"target_surfaces"`
}

type noticeSearchCriteria struct {
	SourceFamilies []string
	QueryText      string
	TargetSurfaces []string
	MaxResults     int
	Authorization  noticeReadModelAuthorizationFilter
}

type noticeGetCriteria struct {
	NoticeID       string
	SourceFamily   string
	TargetSurfaces []string
	Authorization  noticeReadModelAuthorizationFilter
}

type noticeReadModelAuthorizationFilter struct {
	VisibilityLevel   string
	EntitlementGroups []string
}

type noticeReadModelRecord struct {
	SourceFamily               string   `json:"source_family"`
	SourceNoticeID             string   `json:"source_notice_id"`
	Title                      string   `json:"title"`
	VisibilityLevel            string   `json:"visibility_level"`
	EntitlementGroups          []string `json:"entitlement_groups"`
	PolicyProjectionVersion    string   `json:"policy_projection_version"`
	SourceURL                  string   `json:"source_url"`
	CanonicalURL               string   `json:"canonical_url"`
	PublishedAt                string   `json:"published_at"`
	EffectiveAt                string   `json:"effective_at"`
	TargetSurface              string   `json:"target_surface"`
	PrimaryRole                string   `json:"primary_role"`
	CanonicalMarkdownObjectKey string   `json:"canonical_markdown_object_key"`
	BodyExcerpt                string   `json:"body_excerpt"`
	AttachmentRefs             []string `json:"attachment_refs"`
	ProvenanceRefs             []string `json:"provenance_refs"`
}

type noticeDisplayPolicy struct {
	PublicSurface     string `json:"public_surface"`
	FullBodyForbidden bool   `json:"full_body_forbidden"`
	BodyAccess        string `json:"body_access"`
}

type noticeCard struct {
	NoticeID      string              `json:"notice_id"`
	Title         string              `json:"title"`
	SourceFamily  string              `json:"source_family"`
	SourceURL     string              `json:"source_url"`
	CanonicalURL  string              `json:"canonical_url,omitempty"`
	PublishedAt   string              `json:"published_at,omitempty"`
	EffectiveAt   string              `json:"effective_at,omitempty"`
	TargetSurface string              `json:"target_surface,omitempty"`
	PrimaryRole   string              `json:"primary_role,omitempty"`
	BodyExcerpt   string              `json:"body_excerpt,omitempty"`
	IsCurrent     bool                `json:"is_current"`
	DisplayPolicy noticeDisplayPolicy `json:"display_policy"`
}

type noticeDiscoverResult struct {
	QueryText                 string       `json:"query_text"`
	Outcome                   string       `json:"outcome"`
	SourceFamilies            []string     `json:"source_families,omitempty"`
	NoticeCards               []noticeCard `json:"notice_cards,omitempty"`
	QueriedTimeAnchor         string       `json:"queried_time_anchor,omitempty"`
	HistoricalDowngradeReason string       `json:"historical_downgrade_reason,omitempty"`
	FailCloseReason           string       `json:"fail_close_reason,omitempty"`
}

type noticeGetResult struct {
	NoticeID                  string              `json:"notice_id"`
	Outcome                   string              `json:"outcome"`
	Title                     string              `json:"title,omitempty"`
	SourceFamily              string              `json:"source_family,omitempty"`
	SourceURL                 string              `json:"source_url,omitempty"`
	CanonicalURL              string              `json:"canonical_url,omitempty"`
	NormalizedBody            string              `json:"normalized_body,omitempty"`
	ReferenceOnly             bool                `json:"reference_only,omitempty"`
	DisplayPolicy             noticeDisplayPolicy `json:"display_policy"`
	BodyExcerpt               string              `json:"body_excerpt,omitempty"`
	BoundedSummary            string              `json:"bounded_summary,omitempty"`
	ExtractedFacts            []string            `json:"extracted_facts,omitempty"`
	PublishedAt               string              `json:"published_at,omitempty"`
	EffectiveAt               string              `json:"effective_at,omitempty"`
	TargetSurface             string              `json:"target_surface,omitempty"`
	PrimaryRole               string              `json:"primary_role,omitempty"`
	AttachmentRefs            []string            `json:"attachment_refs,omitempty"`
	ProvenanceRefs            []string            `json:"provenance_refs,omitempty"`
	HistoricalDowngradeReason string              `json:"historical_downgrade_reason,omitempty"`
	FailCloseReason           string              `json:"fail_close_reason,omitempty"`
}

func (r *Runtime) LookupCampusNoticeDiscover(ctx context.Context, rawBody []byte) Response {
	envelope, err := decodeNoticeEnvelope(rawBody)
	if err != nil {
		return invalidRequest("Campus notice discover request body must be a JSON object.")
	}
	var request noticeDiscoverRequest
	if err := json.Unmarshal(envelope.Payload, &request); err != nil {
		return invalidRequest("Campus notice discover payload must be a JSON object.")
	}
	normalizeNoticeDiscoverRequest(&request)
	if request.QueryText == "" {
		return invalidRequest("query_text is required.")
	}
	if request.MaxResults <= 0 {
		request.MaxResults = defaultNoticeDiscoverMaxResults
	}
	if request.MaxResults > noticeDiscoverMaxResultsLimit {
		request.MaxResults = noticeDiscoverMaxResultsLimit
	}
	sourceFamilies, invalidSourceFamily := resolveNoticeSourceFamilies(
		request.SourceFamilies,
		admittedNoticeSourceFamilies(envelope.AccessContext),
	)
	if invalidSourceFamily || len(sourceFamilies) == 0 {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_family_unavailable")
	}
	if r.noticeReadModelStore == nil {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_truth_unavailable")
	}
	if err := ctx.Err(); err != nil {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_truth_unavailable")
	}
	authorizationFilter := noticeAuthorizationFilterForAccessContext(envelope.AccessContext)
	rows, err := r.noticeReadModelStore.SearchNotices(
		ctx,
		noticeSearchCriteria{
			SourceFamilies: sourceFamilies,
			QueryText:      request.QueryText,
			TargetSurfaces: request.TargetSurfaces,
			MaxResults:     request.MaxResults,
			Authorization:  authorizationFilter,
		},
	)
	if err != nil {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_truth_unavailable")
	}
	if !noticeReadModelRowsAuthorized(rows, authorizationFilter) {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_truth_unavailable")
	}
	if !noticeReadModelRowsHaveMinimumCardFields(rows) {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_truth_unavailable")
	}
	if len(rows) == 0 {
		body := noticeDiscoverResult{
			QueryText:         request.QueryText,
			Outcome:           "not_found",
			SourceFamilies:    sourceFamilies,
			QueriedTimeAnchor: r.timeAnchor(),
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	cards := make([]noticeCard, 0, len(rows))
	for _, row := range rows {
		cards = append(cards, noticeCard{
			NoticeID:      row.SourceNoticeID,
			Title:         row.Title,
			SourceFamily:  row.SourceFamily,
			SourceURL:     row.SourceURL,
			CanonicalURL:  noticeCanonicalURL(row),
			PublishedAt:   row.PublishedAt,
			EffectiveAt:   row.EffectiveAt,
			TargetSurface: row.TargetSurface,
			PrimaryRole:   row.PrimaryRole,
			BodyExcerpt:   row.BodyExcerpt,
			IsCurrent:     true,
			DisplayPolicy: noticePublicCardDisplayPolicy(),
		})
	}
	body := noticeDiscoverResult{
		QueryText:         request.QueryText,
		Outcome:           "resolved_current",
		SourceFamilies:    sourceFamilies,
		NoticeCards:       cards,
		QueriedTimeAnchor: r.timeAnchor(),
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func (r *Runtime) LookupCampusNoticeGet(ctx context.Context, rawBody []byte) Response {
	envelope, err := decodeNoticeEnvelope(rawBody)
	if err != nil {
		return invalidRequest("Campus notice get request body must be a JSON object.")
	}
	var request noticeGetRequest
	if err := json.Unmarshal(envelope.Payload, &request); err != nil {
		return invalidRequest("Campus notice get payload must be a JSON object.")
	}
	request.NoticeID = strings.TrimSpace(request.NoticeID)
	request.SourceFamily = strings.TrimSpace(request.SourceFamily)
	request.TargetSurfaces = normalizeNoticeTargetSurfaces(request.TargetSurfaces)
	if request.NoticeID == "" {
		return invalidRequest("notice_id is required.")
	}
	sourceFamily := request.SourceFamily
	if sourceFamily == "" {
		sourceFamily = internalNoticeRestrictedSourceFamily
	}
	if !isKnownNoticeSourceFamily(sourceFamily) || !isNoticeSourceFamilyAdmitted(
		sourceFamily,
		envelope.AccessContext,
	) {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_family_unavailable")
	}
	if r.noticeReadModelStore == nil {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_truth_unavailable")
	}
	if err := ctx.Err(); err != nil {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_truth_unavailable")
	}
	authorizationFilter := noticeAuthorizationFilterForAccessContext(envelope.AccessContext)
	row, ok, err := r.noticeReadModelStore.GetNoticeByID(
		ctx,
		noticeGetCriteria{
			NoticeID:       request.NoticeID,
			SourceFamily:   sourceFamily,
			TargetSurfaces: request.TargetSurfaces,
			Authorization:  authorizationFilter,
		},
	)
	if err != nil {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_truth_unavailable")
	}
	if !ok {
		body := noticeGetResult{
			NoticeID:      request.NoticeID,
			Outcome:       "not_found",
			SourceFamily:  sourceFamily,
			DisplayPolicy: noticePublicCardDisplayPolicy(),
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	resolvedSourceFamily := strings.TrimSpace(row.SourceFamily)
	if resolvedSourceFamily == "" {
		resolvedSourceFamily = sourceFamily
	}
	if !isKnownNoticeSourceFamily(resolvedSourceFamily) {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_family_unavailable")
	}
	if !noticeReadModelRowAuthorized(row, authorizationFilter) {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_truth_unavailable")
	}
	resolvedNoticeID := strings.TrimSpace(row.SourceNoticeID)
	if resolvedNoticeID == "" {
		resolvedNoticeID = request.NoticeID
	}
	title := strings.TrimSpace(row.Title)
	if title == "" {
		return failClosedNoticeGet(request.NoticeID, resolvedSourceFamily, "source_truth_unavailable")
	}
	sourceURL := strings.TrimSpace(row.SourceURL)
	if sourceURL == "" {
		return failClosedNoticeGet(request.NoticeID, resolvedSourceFamily, "source_truth_unavailable")
	}
	body := noticeGetResult{
		NoticeID:       resolvedNoticeID,
		Outcome:        "resolved_current",
		Title:          title,
		SourceFamily:   resolvedSourceFamily,
		SourceURL:      sourceURL,
		CanonicalURL:   noticeCanonicalURL(row),
		ReferenceOnly:  true,
		DisplayPolicy:  noticePublicCardDisplayPolicy(),
		BodyExcerpt:    strings.TrimSpace(row.BodyExcerpt),
		PublishedAt:    row.PublishedAt,
		EffectiveAt:    row.EffectiveAt,
		TargetSurface:  row.TargetSurface,
		PrimaryRole:    row.PrimaryRole,
		AttachmentRefs: append([]string(nil), row.AttachmentRefs...),
		ProvenanceRefs: append([]string(nil), row.ProvenanceRefs...),
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

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
