package toolreadmodel

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
				ProvenanceRefs:             []string{"notice:example_internal_portal:355222"},
			},
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
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
	if result.NoticeCards[0].CanonicalURL != "" {
		t.Fatalf("canonical_url = %q, want empty when read model has no canonical_url", result.NoticeCards[0].CanonicalURL)
	}
	if store.searchQueryText != "家具采购" {
		t.Fatalf("search query = %q, want 家具采购", store.searchQueryText)
	}
	if store.searchMaxResults != 3 {
		t.Fatalf("search max_results = %d, want 3", store.searchMaxResults)
	}
}

func TestLookupCampusNoticeDiscoverPassesTemporalQueryToReadModel(t *testing.T) {
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
			},
		},
	}
	runtime := NewRuntime(Options{
		NoticeReadModelStore: store,
		TrustedTimeRFC3339:   "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupCampusNoticeDiscover(context.Background(), []byte(`{
		"payload":{
			"query_text":"家具采购",
			"temporal_query":{"mode":"current_year","year_hint":"2026"},
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

	if response.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", response.Outcome)
	}
	if store.searchTemporalQuery.Mode != "current_year" {
		t.Fatalf("temporal mode = %q, want current_year", store.searchTemporalQuery.Mode)
	}
	if store.searchTemporalQuery.YearHint != "2026" {
		t.Fatalf("temporal year_hint = %q, want 2026", store.searchTemporalQuery.YearHint)
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
			ProvenanceRefs:             []string{"notice:example_internal_portal:355222"},
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
