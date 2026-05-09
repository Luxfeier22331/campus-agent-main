package structuredquery

import (
	"context"
	"testing"
)

func TestLookupCampusNoticeChangeSetReturnsTransportOperationalOverride(t *testing.T) {
	store := &fakeNoticeReadModelStore{
		searchRows: []noticeReadModelRecord{
			{
				SourceFamily:            "internal_notice_restricted",
				SourceNoticeID:          "353903",
				Title:                   "关于通勤班车丰台校区乘车点调整的通知",
				VisibilityLevel:         "restricted",
				EntitlementGroups:       []string{"students"},
				PolicyProjectionVersion: "phase1-authorization-projection-v1",
				SourceURL:               "https://portal.example.edu/notices/353903",
				PublishedAt:             "2026-01-01T08:00:00+08:00",
				TargetSurface:           "campus_services/service_status_candidate",
				BodyExcerpt:             "通勤班车丰台校区乘车点调整至南门外停车区。",
			},
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
		TransportScheduleReadModelStore: &fakeTransportScheduleReadModelStore{
			bundle: mustProjectionBundle(t, transportProjectionFixtureWithOperationalNotice()),
		},
		TrustedTimeRFC3339: "2026-01-02T09:00:00+08:00",
	})

	response := runtime.LookupCampusNoticeChangeSet(context.Background(), []byte(`{
		"payload":{
			"query_text":"丰台到海淀通勤车今天乘车点有没有变",
			"route_labels":["丰台到海淀通勤车"],
			"service_date":"2026-01-02"
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

	result, ok := response.Body.(noticeChangeSetLookupResult)
	if !ok {
		t.Fatalf("body = %T, want noticeChangeSetLookupResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ChangeSet == nil {
		t.Fatal("change_set = nil, want bounded change set")
	}
	if result.ChangeSet.ChangeKind != "stop_or_boarding_point_change" {
		t.Fatalf("change_kind = %q", result.ChangeSet.ChangeKind)
	}
	if len(result.ChangeSet.Facts) != 1 {
		t.Fatalf("facts = %#v, want one fact", result.ChangeSet.Facts)
	}
	if result.ChangeSet.Facts[0].SourceNoticeID != "353903" {
		t.Fatalf("source_notice_id = %q", result.ChangeSet.Facts[0].SourceNoticeID)
	}
	if result.ChangeSet.SourceRefs[0].SourceURL != "https://portal.example.edu/notices/353903" {
		t.Fatalf("source_url = %q", result.ChangeSet.SourceRefs[0].SourceURL)
	}
	if store.searchCount != 0 {
		t.Fatalf("searchCount = %d, want no full-text notice search after operational notice IDs resolve", store.searchCount)
	}
	if store.idLookupCount != 1 {
		t.Fatalf("idLookupCount = %d, want one selected notice ID lookup", store.idLookupCount)
	}
	if !equalStrings(store.idLookupNoticeIDs, []string{"353903"}) {
		t.Fatalf("idLookupNoticeIDs = %#v, want 353903", store.idLookupNoticeIDs)
	}
}

func TestLookupCampusNoticeChangeSetFailsClosedWhenBaselineMissing(t *testing.T) {
	runtime := NewRuntime(Options{
		NoticeReadModelStore: &fakeNoticeReadModelStore{},
		TransportScheduleReadModelStore: &fakeTransportScheduleReadModelStore{
			bundle: projectionBundle{},
		},
		TrustedTimeRFC3339: "2026-01-02T09:00:00+08:00",
	})

	response := runtime.LookupCampusNoticeChangeSet(context.Background(), []byte(`{
		"payload":{
			"query_text":"今天班车是否有临时通知",
			"route_labels":["丰台到海淀通勤车"],
			"service_date":"2026-01-02"
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

	result := response.Body.(noticeChangeSetLookupResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

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

func TestLookupCampusNoticeGetReturnsSourceCardWithoutCanonicalBody(t *testing.T) {
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
			BodyExcerpt:                "家具采购项目摘要。",
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
	if result.NormalizedBody != "" {
		t.Fatalf("normalized_body = %q, want empty", result.NormalizedBody)
	}
	if result.BodyExcerpt != "家具采购项目摘要。" {
		t.Fatalf("body_excerpt = %q", result.BodyExcerpt)
	}
	if result.DisplayPolicy.PublicSurface != "card_only" ||
		!result.DisplayPolicy.FullBodyForbidden ||
		result.DisplayPolicy.BodyAccess != "none" {
		t.Fatalf("display_policy = %#v, want public card-only policy", result.DisplayPolicy)
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
	if bodyStore.readCount != 0 {
		t.Fatalf("body read count = %d, want 0 for card-first notice get", bodyStore.readCount)
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
