package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

const internalNoticeRestrictedSourceFamily = "internal_notice_restricted"

var errNoticeBodyUnavailable = errors.New("notice body unavailable")

type NoticeReadModelStore interface {
	SearchNotices(
		ctx context.Context,
		sourceFamilies []string,
		queryText string,
		maxResults int,
	) ([]noticeReadModelRecord, error)
	GetNoticeByID(
		ctx context.Context,
		noticeID string,
		sourceFamily string,
	) (noticeReadModelRecord, bool, error)
}

type NoticeBodyStore interface {
	GetNoticeBody(ctx context.Context, objectKey string) (string, error)
}

type noticeQueryEnvelope struct {
	Payload       json.RawMessage      `json:"payload"`
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
	MaxResults     int           `json:"max_results"`
}

type noticeGetRequest struct {
	NoticeID     string `json:"notice_id"`
	SourceFamily string `json:"source_family"`
}

type noticeReadModelRecord struct {
	SourceFamily               string
	SourceNoticeID             string
	Title                      string
	SourceURL                  string
	CanonicalURL               string
	PublishedAt                string
	EffectiveAt                string
	TargetSurface              string
	PrimaryRole                string
	CanonicalMarkdownObjectKey string
	AttachmentRefs             []string
	ProvenanceRefs             []string
}

type noticeCard struct {
	NoticeID     string `json:"notice_id"`
	Title        string `json:"title"`
	SourceFamily string `json:"source_family"`
	SourceURL    string `json:"source_url"`
	CanonicalURL string `json:"canonical_url,omitempty"`
	PublishedAt  string `json:"published_at,omitempty"`
	EffectiveAt  string `json:"effective_at,omitempty"`
	IsCurrent    bool   `json:"is_current"`
}

type noticeDiscoverResult struct {
	QueryText                   string       `json:"query_text"`
	Outcome                     string       `json:"outcome"`
	SourceFamilies              []string     `json:"source_families,omitempty"`
	NoticeCards                 []noticeCard `json:"notice_cards,omitempty"`
	QueriedTimeAnchor           string       `json:"queried_time_anchor,omitempty"`
	HistoricalDowngradeReason   string       `json:"historical_downgrade_reason,omitempty"`
	FailCloseReason             string       `json:"fail_close_reason,omitempty"`
}

type noticeGetResult struct {
	NoticeID                    string   `json:"notice_id"`
	Outcome                     string   `json:"outcome"`
	Title                       string   `json:"title,omitempty"`
	SourceFamily                string   `json:"source_family,omitempty"`
	SourceURL                   string   `json:"source_url,omitempty"`
	CanonicalURL                string   `json:"canonical_url,omitempty"`
	NormalizedBody              string   `json:"normalized_body,omitempty"`
	PublishedAt                 string   `json:"published_at,omitempty"`
	EffectiveAt                 string   `json:"effective_at,omitempty"`
	AttachmentRefs              []string `json:"attachment_refs,omitempty"`
	ProvenanceRefs              []string `json:"provenance_refs,omitempty"`
	HistoricalDowngradeReason   string   `json:"historical_downgrade_reason,omitempty"`
	FailCloseReason             string   `json:"fail_close_reason,omitempty"`
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
		request.MaxResults = 5
	}
	sourceFamilies := internalNoticeSourceFamilies(request.SourceFamilies)
	if len(sourceFamilies) == 0 || !hasInternalNoticeAccess(envelope.AccessContext) {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_family_unavailable")
	}
	if r.noticeReadModelStore == nil {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_truth_unavailable")
	}
	if err := ctx.Err(); err != nil {
		return failClosedNoticeDiscover(request.QueryText, sourceFamilies, r.timeAnchor(), "source_truth_unavailable")
	}
	rows, err := r.noticeReadModelStore.SearchNotices(
		ctx,
		sourceFamilies,
		request.QueryText,
		request.MaxResults,
	)
	if err != nil {
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
			NoticeID:     row.SourceNoticeID,
			Title:        row.Title,
			SourceFamily: row.SourceFamily,
			SourceURL:    row.SourceURL,
			CanonicalURL: row.CanonicalURL,
			PublishedAt:  row.PublishedAt,
			EffectiveAt:  row.EffectiveAt,
			IsCurrent:    true,
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
	if request.NoticeID == "" {
		return invalidRequest("notice_id is required.")
	}
	sourceFamily := request.SourceFamily
	if sourceFamily == "" {
		sourceFamily = internalNoticeRestrictedSourceFamily
	}
	if sourceFamily != internalNoticeRestrictedSourceFamily || !hasInternalNoticeAccess(envelope.AccessContext) {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_family_unavailable")
	}
	if r.noticeReadModelStore == nil || r.noticeBodyStore == nil {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_truth_unavailable")
	}
	if err := ctx.Err(); err != nil {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_truth_unavailable")
	}
	row, ok, err := r.noticeReadModelStore.GetNoticeByID(ctx, request.NoticeID, sourceFamily)
	if err != nil {
		return failClosedNoticeGet(request.NoticeID, sourceFamily, "source_truth_unavailable")
	}
	if !ok {
		body := noticeGetResult{
			NoticeID:     request.NoticeID,
			Outcome:      "not_found",
			SourceFamily: sourceFamily,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	objectKey := strings.TrimSpace(row.CanonicalMarkdownObjectKey)
	if objectKey == "" {
		return failClosedNoticeGet(request.NoticeID, row.SourceFamily, "source_truth_unavailable")
	}
	bodyText, err := r.noticeBodyStore.GetNoticeBody(ctx, objectKey)
	if err != nil || strings.TrimSpace(bodyText) == "" {
		return failClosedNoticeGet(request.NoticeID, row.SourceFamily, "source_truth_unavailable")
	}
	body := noticeGetResult{
		NoticeID:       row.SourceNoticeID,
		Outcome:        "resolved_current",
		Title:          row.Title,
		SourceFamily:   row.SourceFamily,
		SourceURL:      row.SourceURL,
		CanonicalURL:   row.CanonicalURL,
		NormalizedBody: bodyText,
		PublishedAt:    row.PublishedAt,
		EffectiveAt:    row.EffectiveAt,
		AttachmentRefs: append([]string(nil), row.AttachmentRefs...),
		ProvenanceRefs: append([]string(nil), row.ProvenanceRefs...),
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
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
}

func internalNoticeSourceFamilies(values []string) []string {
	normalized := make([]string, 0, len(values))
	if len(values) == 0 {
		return []string{internalNoticeRestrictedSourceFamily}
	}
	seen := map[string]bool{}
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item != internalNoticeRestrictedSourceFamily || seen[item] {
			continue
		}
		seen[item] = true
		normalized = append(normalized, item)
	}
	return normalized
}

func hasInternalNoticeAccess(accessContext noticeAccessContext) bool {
	authorization := accessContext.Authorization
	if strings.TrimSpace(authorization.PrincipalID) == "" {
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
		FailCloseReason: reason,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}
