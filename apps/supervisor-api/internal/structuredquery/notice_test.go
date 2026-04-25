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
				TargetSurface:              "procurement_notice_history",
				PrimaryRole:                "procurement_notice",
				CanonicalMarkdownObjectKey: "campus_notices/documents/internal_notice/355222/canonical.md",
				BodyExcerpt:                "家具采购项目摘要",
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
	if result.NoticeCards[0].BodyExcerpt != "家具采购项目摘要" {
		t.Fatalf("body_excerpt = %q", result.NoticeCards[0].BodyExcerpt)
	}
	if result.NoticeCards[0].TargetSurface != "procurement_notice_history" {
		t.Fatalf("target_surface = %q", result.NoticeCards[0].TargetSurface)
	}
	if result.NoticeCards[0].PrimaryRole != "procurement_notice" {
		t.Fatalf("primary_role = %q", result.NoticeCards[0].PrimaryRole)
	}
	if store.searchQueryText != "家具采购" {
		t.Fatalf("search query = %q, want 家具采购", store.searchQueryText)
	}
	if store.searchMaxResults != 3 {
		t.Fatalf("search max_results = %d, want 3", store.searchMaxResults)
	}
}

func TestLookupCampusNoticeDiscoverFiltersByTargetSurface(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:   "internal_notice_restricted",
				SourceNoticeID: "355222",
				Title:          "中央民族大学丰台校区家具采购项目比选公告",
				SourceURL:      "https://portal.example.edu/notices/355222",
				PublishedAt:    "2026-04-12",
				TargetSurface:  "procurement_notice_history",
				BodyExcerpt:    "家具采购项目摘要",
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
			"target_surfaces":["procurement_notice_history"],
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
	if got, want := store.searchTargetSurfaces, []string{"procurement_notice_history"}; !equalStrings(got, want) {
		t.Fatalf("target_surfaces = %#v, want %#v", got, want)
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
			TargetSurface:              "procurement_notice_history",
			PrimaryRole:                "procurement_notice",
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
	if result.TargetSurface != "procurement_notice_history" {
		t.Fatalf("target_surface = %q", result.TargetSurface)
	}
	if result.PrimaryRole != "procurement_notice" {
		t.Fatalf("primary_role = %q", result.PrimaryRole)
	}
	if bodyStore.readCount != 1 {
		t.Fatalf("body read count = %d, want 1", bodyStore.readCount)
	}
}

func TestLookupCampusNoticeGetFiltersByTargetSurface(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		getRow: &noticeReadModelRecord{
			SourceFamily:               "internal_notice_restricted",
			SourceNoticeID:             "355222",
			Title:                      "中央民族大学丰台校区家具采购项目比选公告",
			TargetSurface:              "procurement_notice_history",
			PrimaryRole:                "procurement_notice",
			CanonicalMarkdownObjectKey: "campus_notices/documents/internal_notice/355222/canonical.md",
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
		NoticeBodyStore: &fakeNoticeBodyStore{
			bodies: map[string]string{
				"campus_notices/documents/internal_notice/355222/canonical.md": "# 采购公告",
			},
		},
	})

	response := runtime.LookupCampusNoticeGet(context.Background(), []byte(`{
		"payload":{
			"notice_id":"355222",
			"source_family":"internal_notice_restricted",
			"target_surfaces":["procurement_notice_history"]
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
	if got, want := store.getTargetSurfaces, []string{"procurement_notice_history"}; !equalStrings(got, want) {
		t.Fatalf("target_surfaces = %#v, want %#v", got, want)
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

func TestNewRuntimeConfiguresNoticeStoresFromOptions(t *testing.T) {
	runtime := NewRuntime(Options{
		NoticeReadModelDatabaseURL:     "postgresql://notice.example/db",
		NoticeReadModelTable:           "ingestion_projection.internal_notice_read_model",
		NoticeObjectStoreEndpoint:      "http://minio:9000",
		NoticeObjectStoreAccessKey:     "access",
		NoticeObjectStoreSecretKey:     "secret",
		NoticeObjectStoreRegion:        "us-east-1",
		NoticeObjectStoreBucketDerived: "campus-rag-derived",
	})

	status := runtime.Status()
	if !status.NoticeReadModelConfigured {
		t.Fatal("notice read model should be configured")
	}
	if !status.NoticeBodyStoreConfigured {
		t.Fatal("notice body store should be configured")
	}
}

func TestNoticePostgresOptionsDefaultsToSmallLocalPool(t *testing.T) {
	config, err := noticePostgresPoolConfig(NoticePostgresOptions{
		DatabaseURL: "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
		TableName:   "ingestion_projection.internal_notice_read_model",
	})
	if err != nil {
		t.Fatalf("pool config error: %v", err)
	}
	if config.MinConns != 0 {
		t.Fatalf("MinConns = %d, want 0", config.MinConns)
	}
	if config.MaxConns != 2 {
		t.Fatalf("MaxConns = %d, want 2", config.MaxConns)
	}
}

type fakeNoticeReadModelStore struct {
	searchRows           []noticeReadModelRecord
	getRow               *noticeReadModelRecord
	searchCount          int
	searchQueryText      string
	searchMaxResults     int
	searchTargetSurfaces []string
	getTargetSurfaces    []string
}

func (s *fakeNoticeReadModelStore) SearchNotices(
	ctx context.Context,
	sourceFamilies []string,
	queryText string,
	targetSurfaces []string,
	maxResults int,
) ([]noticeReadModelRecord, error) {
	s.searchCount++
	s.searchQueryText = queryText
	s.searchTargetSurfaces = append([]string(nil), targetSurfaces...)
	s.searchMaxResults = maxResults
	return append([]noticeReadModelRecord(nil), s.searchRows...), nil
}

func (s *fakeNoticeReadModelStore) GetNoticeByID(
	ctx context.Context,
	noticeID string,
	sourceFamily string,
	targetSurfaces []string,
) (noticeReadModelRecord, bool, error) {
	s.getTargetSurfaces = append([]string(nil), targetSurfaces...)
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

func equalStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
