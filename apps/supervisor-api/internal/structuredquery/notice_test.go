package structuredquery

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestLookupCampusNoticeDiscoverReadsRestrictedNoticeReadModel(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:               "internal_notice_restricted",
				SourceNoticeID:             "355222",
				Title:                      "中央民族大学丰台校区家具采购项目比选公告",
				VisibilityLevel:            "restricted",
				EntitlementGroups:          []string{"students"},
				PolicyProjectionVersion:    "phase1-authorization-projection-v1",
				SourceURL:                  "https://portal.example.edu/notices/355222",
				PublishedAt:                "2026-04-12",
				EffectiveAt:                "2026-04-12",
				TargetSurface:              "notice_level_query",
				PrimaryRole:                "notice_window",
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
	if result.NoticeCards[0].TargetSurface != "notice_level_query" {
		t.Fatalf("target_surface = %q", result.NoticeCards[0].TargetSurface)
	}
	if result.NoticeCards[0].PrimaryRole != "notice_window" {
		t.Fatalf("primary_role = %q", result.NoticeCards[0].PrimaryRole)
	}
	if result.NoticeCards[0].CanonicalURL != result.NoticeCards[0].SourceURL {
		t.Fatalf("canonical_url = %q, want source_url fallback", result.NoticeCards[0].CanonicalURL)
	}
	if store.searchQueryText != "家具采购" {
		t.Fatalf("search query = %q, want 家具采购", store.searchQueryText)
	}
	if store.searchMaxResults != 3 {
		t.Fatalf("search max_results = %d, want 3", store.searchMaxResults)
	}
}

func TestLookupCampusNoticeDiscoverFailsClosedWhenRestrictedRowLacksAuthzProjection(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:   "internal_notice_restricted",
				SourceNoticeID: "355222",
				Title:          "中央民族大学丰台校区家具采购项目比选公告",
				SourceURL:      "https://portal.example.edu/notices/355222",
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

	result, ok := response.Body.(noticeDiscoverResult)
	if !ok {
		t.Fatalf("body = %T, want noticeDiscoverResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupCampusNoticeDiscoverFailsClosedWhenMinimumCardFieldsAreMissing(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:            "internal_notice_restricted",
				SourceNoticeID:          "355222",
				Title:                   "中央民族大学丰台校区家具采购项目比选公告",
				VisibilityLevel:         "restricted",
				EntitlementGroups:       []string{"students"},
				PolicyProjectionVersion: "phase1-authorization-projection-v1",
				SourceURL:               "",
				TargetSurface:           "notice_level_query",
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
			"source_families":["internal_notice_restricted"]
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

	result, ok := response.Body.(noticeDiscoverResult)
	if !ok {
		t.Fatalf("body = %T, want noticeDiscoverResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupCampusNoticeGetFailsClosedForRestrictedRowWithoutEntitlementOverlap(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		getRow: &noticeReadModelRecord{
			SourceFamily:               "internal_notice_restricted",
			SourceNoticeID:             "355222",
			Title:                      "中央民族大学丰台校区家具采购项目比选公告",
			SourceURL:                  "https://portal.example.edu/notices/355222",
			CanonicalMarkdownObjectKey: "campus_notices/documents/internal_notice/355222/canonical.md",
			VisibilityLevel:            "restricted",
			EntitlementGroups:          []string{"staff"},
			PolicyProjectionVersion:    "phase1-authorization-projection-v1",
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

	result, ok := response.Body.(noticeGetResult)
	if !ok {
		t.Fatalf("body = %T, want noticeGetResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
	if bodyStore.readCount != 0 {
		t.Fatalf("body read count = %d, want 0", bodyStore.readCount)
	}
}

func TestLookupCampusNoticeDiscoverFiltersByTargetSurface(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:            "internal_notice_restricted",
				SourceNoticeID:          "355222",
				Title:                   "中央民族大学丰台校区家具采购项目比选公告",
				VisibilityLevel:         "restricted",
				EntitlementGroups:       []string{"students"},
				PolicyProjectionVersion: "phase1-authorization-projection-v1",
				SourceURL:               "https://portal.example.edu/notices/355222",
				PublishedAt:             "2026-04-12",
				TargetSurface:           "notice_level_query",
				BodyExcerpt:             "家具采购项目摘要",
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
			"target_surfaces":["notice_level_query"],
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
	if got, want := store.searchTargetSurfaces, []string{"notice_level_query"}; !equalStrings(got, want) {
		t.Fatalf("target_surfaces = %#v, want %#v", got, want)
	}
}

func TestLookupCampusNoticeDiscoverClampsMaxResults(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:            "internal_notice_restricted",
				SourceNoticeID:          "355222",
				Title:                   "中央民族大学丰台校区家具采购项目比选公告",
				VisibilityLevel:         "restricted",
				EntitlementGroups:       []string{"students"},
				PolicyProjectionVersion: "phase1-authorization-projection-v1",
				SourceURL:               "https://portal.example.edu/notices/355222",
				TargetSurface:           "notice_level_query",
			},
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
		NoticeBodyStore:      &fakeNoticeBodyStore{},
	})

	response := runtime.LookupCampusNoticeDiscover(context.Background(), []byte(`{
		"payload":{
			"query_text":"采购",
			"source_families":["internal_notice_restricted"],
			"max_results":9999
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
	if store.searchMaxResults != 20 {
		t.Fatalf("search max_results = %d, want 20", store.searchMaxResults)
	}
}

func TestLookupCampusNoticeGetReadsCanonicalBody(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		getRow: &noticeReadModelRecord{
			SourceFamily:               "internal_notice_restricted",
			SourceNoticeID:             "355222",
			Title:                      "中央民族大学丰台校区家具采购项目比选公告",
			VisibilityLevel:            "restricted",
			EntitlementGroups:          []string{"students"},
			PolicyProjectionVersion:    "phase1-authorization-projection-v1",
			SourceURL:                  "https://portal.example.edu/notices/355222",
			CanonicalURL:               "https://portal.example.edu/notices/355222",
			PublishedAt:                "2026-04-12",
			EffectiveAt:                "2026-04-12",
			TargetSurface:              "notice_level_query",
			PrimaryRole:                "notice_window",
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
	if result.TargetSurface != "notice_level_query" {
		t.Fatalf("target_surface = %q", result.TargetSurface)
	}
	if result.PrimaryRole != "notice_window" {
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
			TargetSurface:              "notice_level_query",
			PrimaryRole:                "notice_window",
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
			"target_surfaces":["notice_level_query"]
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
	if got, want := store.getTargetSurfaces, []string{"notice_level_query"}; !equalStrings(got, want) {
		t.Fatalf("target_surfaces = %#v, want %#v", got, want)
	}
}

func TestReadNoticeBodyLimitedRejectsOversizedBody(t *testing.T) {
	_, err := readNoticeBodyLimited(strings.NewReader("0123456789abcdef"), 8)
	if !errors.Is(err, errNoticeBodyTooLarge) {
		t.Fatalf("err = %v, want errNoticeBodyTooLarge", err)
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

func TestLookupCampusNoticeDiscoverAdmitsWechatPublicNoticeSourceFamily(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:   "wechat_public_notice",
				SourceNoticeID: "wechat:article:001",
				Title:          "校园活动通知",
				SourceURL:      "https://mp.weixin.qq.com/s/example",
				PublishedAt:    "2026-04-24T08:00:00+08:00",
				TargetSurface:  "notice_level_query",
			},
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
		TrustedTimeRFC3339:   "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupCampusNoticeDiscover(context.Background(), []byte(`{
		"payload":{
			"query_text":"校园活动",
			"source_families":["wechat_public_notice"]
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

	result, ok := response.Body.(noticeDiscoverResult)
	if !ok {
		t.Fatalf("body = %T, want noticeDiscoverResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.NoticeCards) != 1 {
		t.Fatalf("notice_cards = %#v", result.NoticeCards)
	}
	if result.NoticeCards[0].SourceFamily != "wechat_public_notice" {
		t.Fatalf("source_family = %q, want wechat_public_notice", result.NoticeCards[0].SourceFamily)
	}
	if store.searchCount != 1 {
		t.Fatalf("search count = %d, want 1", store.searchCount)
	}
}

func TestLookupCampusNoticeGetReturnsReferenceOnlyWhenPublicBodyUnavailable(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		getRow: &noticeReadModelRecord{
			SourceFamily:   "wechat_public_notice",
			SourceNoticeID: "wechat:article:001",
			Title:          "校园活动通知",
			SourceURL:      "https://mp.weixin.qq.com/s/example",
			CanonicalURL:   "https://mp.weixin.qq.com/s/example",
			PublishedAt:    "2026-04-24T08:00:00+08:00",
			TargetSurface:  "notice_level_query",
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
	})

	response := runtime.LookupCampusNoticeGet(context.Background(), []byte(`{
		"payload":{
			"notice_id":"wechat:article:001",
			"source_family":"wechat_public_notice"
		},
		"access_context":{
			"authorization":{
				"principal_id":"principal-001",
				"entitlement_groups":["students"]
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
	if !result.ReferenceOnly {
		t.Fatal("reference_only = false, want true")
	}
	if result.NormalizedBody != "" {
		t.Fatalf("normalized_body = %q, want empty", result.NormalizedBody)
	}
}

func TestLookupCampusNoticeGetFailsClosedWithoutRestrictedAuthorization(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		getRow: &noticeReadModelRecord{
			SourceFamily:   "internal_notice_restricted",
			SourceNoticeID: "355222",
			Title:          "中央民族大学丰台校区家具采购项目比选公告",
			SourceURL:      "https://portal.example.edu/notices/355222",
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
	})

	response := runtime.LookupCampusNoticeGet(context.Background(), []byte(`{
		"payload":{
			"notice_id":"355222",
			"source_family":"internal_notice_restricted"
		},
		"access_context":{
			"authorization":{
				"principal_id":"principal-001"
			}
		}
	}`))

	result, ok := response.Body.(noticeGetResult)
	if !ok {
		t.Fatalf("body = %T, want noticeGetResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_family_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_family_unavailable", result.FailCloseReason)
	}
	if store.getCount != 0 {
		t.Fatalf("get count = %d, want 0", store.getCount)
	}
}

func TestLookupCampusNoticeGetFailsClosedForUnknownSourceFamily(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		getRow: &noticeReadModelRecord{
			SourceFamily:   "unknown_family",
			SourceNoticeID: "355222",
			Title:          "中央民族大学丰台校区家具采购项目比选公告",
			SourceURL:      "https://portal.example.edu/notices/355222",
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
	})

	response := runtime.LookupCampusNoticeGet(context.Background(), []byte(`{
		"payload":{
			"notice_id":"355222",
			"source_family":"unknown_family"
		},
		"access_context":{
			"authorization":{
				"principal_id":"principal-001",
				"entitlement_groups":["students"]
			}
		}
	}`))

	result, ok := response.Body.(noticeGetResult)
	if !ok {
		t.Fatalf("body = %T, want noticeGetResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_family_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_family_unavailable", result.FailCloseReason)
	}
	if store.getCount != 0 {
		t.Fatalf("get count = %d, want 0", store.getCount)
	}
}

func TestNewRuntimeConfiguresNoticeStoresFromOptions(t *testing.T) {
	runtime := NewRuntime(Options{
		NoticeReadModelDatabaseURL:     "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
		NoticeReadModelTable:           "ingestion_projection.internal_notice_read_model",
		NoticeObjectStoreEndpoint:      "http://minio:9000",
		NoticeObjectStoreAccessKey:     "access",
		NoticeObjectStoreSecretKey:     "secret",
		NoticeObjectStoreRegion:        "us-east-1",
		NoticeObjectStoreBucketDerived: "campus-rag-derived",
	})

	status := runtime.Status(context.Background())
	if !status.NoticeReadModelConfigured {
		t.Fatal("notice read model should be configured")
	}
	if !status.NoticeBodyStoreConfigured {
		t.Fatal("notice body store should be configured")
	}
}

func TestNewRuntimeConfiguresServiceGuideReadModelStoreFromOptions(t *testing.T) {
	runtime := NewRuntime(Options{
		StructuredProjectionDatabaseURL: "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
	})

	status := runtime.Status(context.Background())
	if !status.ServiceGuideReadModelConfigured {
		t.Fatal("service guide read model should be configured")
	}
}

func TestServiceGuidePostgresOptionsDefaultsToSmallLocalPool(t *testing.T) {
	config, err := serviceGuidePostgresPoolConfig(ServiceGuidePostgresOptions{
		DatabaseURL: "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
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
	getCount             int
	searchQueryText      string
	searchMaxResults     int
	searchTargetSurfaces []string
	searchAuthorization  noticeReadModelAuthorizationFilter
	getTargetSurfaces    []string
	getAuthorization     noticeReadModelAuthorizationFilter
}

func (s *fakeNoticeReadModelStore) SearchNotices(
	ctx context.Context,
	criteria noticeSearchCriteria,
) ([]noticeReadModelRecord, error) {
	s.searchCount++
	s.searchQueryText = criteria.QueryText
	s.searchTargetSurfaces = append([]string(nil), criteria.TargetSurfaces...)
	s.searchMaxResults = criteria.MaxResults
	s.searchAuthorization = criteria.Authorization
	return append([]noticeReadModelRecord(nil), s.searchRows...), nil
}

func (s *fakeNoticeReadModelStore) GetNoticeByID(
	ctx context.Context,
	criteria noticeGetCriteria,
) (noticeReadModelRecord, bool, error) {
	s.getCount++
	s.getTargetSurfaces = append([]string(nil), criteria.TargetSurfaces...)
	s.getAuthorization = criteria.Authorization
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
