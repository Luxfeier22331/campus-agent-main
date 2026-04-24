package structuredquery

import (
	"context"
	"testing"
)

func TestLookupCampusNoticeDiscoverReadsRestrictedNoticeReadModel(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:               "internal_notice_restricted",
				SourceNoticeID:             "355222",
				Title:                      "中央民族大学丰台校区家具采购项目比选公告",
				SourceURL:                  "https://portal.example.edu/notices/355222",
				CanonicalURL:               "https://portal.example.edu/notices/355222",
				PublishedAt:                "2026-04-12",
				EffectiveAt:                "2026-04-12",
				CanonicalMarkdownObjectKey: "campus_notices/documents/internal_notice/355222/canonical.md",
				AttachmentRefs:             []string{"attachment:355222:1"},
				ProvenanceRefs:             []string{"notice:muc_internal_portal:355222"},
			},
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
		NoticeBodyStore:      &fakeNoticeBodyStore{},
		TrustedTimeRFC3339:   "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupCampusNoticeDiscover(context.Background(), []byte(`{
		"payload":{
			"query_text":"家具采购",
			"source_families":["internal_notice_restricted"],
			"max_results":3
		},
		"access_context":{
			"authorization":{
				"principal_id":"principal-001",
				"entitlement_groups":["students"],
				"retrieval_filter":{
					"entitlement_groups":["students"],
					"visibility_level":"restricted"
				}
			}
		}
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(noticeDiscoverResult)
	if !ok {
		t.Fatalf("body = %T, want noticeDiscoverResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.QueriedTimeAnchor != "2026-04-24T10:30:00+08:00" {
		t.Fatalf("queried_time_anchor = %q", result.QueriedTimeAnchor)
	}
	if len(result.NoticeCards) != 1 || result.NoticeCards[0].NoticeID != "355222" {
		t.Fatalf("notice_cards = %#v", result.NoticeCards)
	}
	if store.searchQueryText != "家具采购" {
		t.Fatalf("search query = %q, want 家具采购", store.searchQueryText)
	}
	if store.searchMaxResults != 3 {
		t.Fatalf("search max_results = %d, want 3", store.searchMaxResults)
	}
}

func TestLookupCampusNoticeGetReadsCanonicalBody(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		getRow: &noticeReadModelRecord{
			SourceFamily:               "internal_notice_restricted",
			SourceNoticeID:             "355222",
			Title:                      "中央民族大学丰台校区家具采购项目比选公告",
			SourceURL:                  "https://portal.example.edu/notices/355222",
			CanonicalURL:               "https://portal.example.edu/notices/355222",
			PublishedAt:                "2026-04-12",
			EffectiveAt:                "2026-04-12",
			CanonicalMarkdownObjectKey: "campus_notices/documents/internal_notice/355222/canonical.md",
			AttachmentRefs:             []string{"attachment:355222:1"},
			ProvenanceRefs:             []string{"notice:muc_internal_portal:355222"},
		},
	}
	bodyStore := &fakeNoticeBodyStore{
		bodies: map[string]string{
			"campus_notices/documents/internal_notice/355222/canonical.md": "# 采购公告\n\n供应商应按要求投标。",
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
		NoticeBodyStore:      bodyStore,
	})

	response := runtime.LookupCampusNoticeGet(context.Background(), []byte(`{
		"payload":{
			"notice_id":"355222",
			"source_family":"internal_notice_restricted"
		},
		"access_context":{
			"authorization":{
				"principal_id":"principal-001",
				"entitlement_groups":["students"],
				"retrieval_filter":{
					"entitlement_groups":["students"],
					"visibility_level":"restricted"
				}
			}
		}
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(noticeGetResult)
	if !ok {
		t.Fatalf("body = %T, want noticeGetResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.NormalizedBody != "# 采购公告\n\n供应商应按要求投标。" {
		t.Fatalf("normalized_body = %q", result.NormalizedBody)
	}
	if len(result.AttachmentRefs) != 1 || result.AttachmentRefs[0] != "attachment:355222:1" {
		t.Fatalf("attachment_refs = %#v", result.AttachmentRefs)
	}
	if bodyStore.readCount != 1 {
		t.Fatalf("body read count = %d, want 1", bodyStore.readCount)
	}
}

func TestLookupCampusNoticeDiscoverFailsClosedWithoutRestrictedAuthorization(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{{SourceNoticeID: "355222"}},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
		NoticeBodyStore:      &fakeNoticeBodyStore{},
		TrustedTimeRFC3339:   "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupCampusNoticeDiscover(context.Background(), []byte(`{
		"payload":{
			"query_text":"家具采购",
			"source_families":["internal_notice_restricted"]
		},
		"access_context":{
			"authorization":{"principal_id":"principal-001"}
		}
	}`))

	result, ok := response.Body.(noticeDiscoverResult)
	if !ok {
		t.Fatalf("body = %T, want noticeDiscoverResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_family_unavailable" {
		t.Fatalf("fail_close_reason = %q", result.FailCloseReason)
	}
	if store.searchCount != 0 {
		t.Fatalf("search count = %d, want 0", store.searchCount)
	}
}

type fakeNoticeReadModelStore struct {
	searchRows       []noticeReadModelRecord
	getRow           *noticeReadModelRecord
	searchCount      int
	searchQueryText  string
	searchMaxResults int
}

func (s *fakeNoticeReadModelStore) SearchNotices(
	ctx context.Context,
	sourceFamilies []string,
	queryText string,
	maxResults int,
) ([]noticeReadModelRecord, error) {
	s.searchCount++
	s.searchQueryText = queryText
	s.searchMaxResults = maxResults
	return append([]noticeReadModelRecord(nil), s.searchRows...), nil
}

func (s *fakeNoticeReadModelStore) GetNoticeByID(
	ctx context.Context,
	noticeID string,
	sourceFamily string,
) (noticeReadModelRecord, bool, error) {
	if s.getRow == nil {
		return noticeReadModelRecord{}, false, nil
	}
	return *s.getRow, true, nil
}

type fakeNoticeBodyStore struct {
	bodies    map[string]string
	readCount int
}

func (s *fakeNoticeBodyStore) GetNoticeBody(ctx context.Context, objectKey string) (string, error) {
	s.readCount++
	body, ok := s.bodies[objectKey]
	if !ok {
		return "", errNoticeBodyUnavailable
	}
	return body, nil
}
