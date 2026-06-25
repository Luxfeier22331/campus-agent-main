package structuredquery

import (
	"context"
	"errors"
	"strings"
	"testing"
)

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
	if result.DisplayPolicy.PublicSurface != "card_only" ||
		!result.DisplayPolicy.FullBodyForbidden ||
		result.DisplayPolicy.BodyAccess != "none" {
		t.Fatalf("display_policy = %#v, want default public card-only policy", result.DisplayPolicy)
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
	if result.DisplayPolicy.PublicSurface != "card_only" ||
		!result.DisplayPolicy.FullBodyForbidden ||
		result.DisplayPolicy.BodyAccess != "none" {
		t.Fatalf("display_policy = %#v, want default public card-only policy", result.DisplayPolicy)
	}
	if store.getCount != 0 {
		t.Fatalf("get count = %d, want 0", store.getCount)
	}
}

func TestLookupCampusNoticeGetNotFoundKeepsDefaultDisplayPolicy(t *testing.T) {
	store := &fakeNoticeReadModelStore{}
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
	if result.Outcome != "not_found" {
		t.Fatalf("outcome = %q, want not_found", result.Outcome)
	}
	if result.DisplayPolicy.PublicSurface != "card_only" ||
		!result.DisplayPolicy.FullBodyForbidden ||
		result.DisplayPolicy.BodyAccess != "none" {
		t.Fatalf("display_policy = %#v, want default public card-only policy", result.DisplayPolicy)
	}
}

func TestNewRuntimeConfiguresNoticeStoresFromOptions(t *testing.T) {
	runtime := NewRuntime(Options{
		NoticeReadModelDatabaseURL:     "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
		NoticeReadModelTable:           "ingestion_projection.internal_notice_read_model",
		NoticeBodyObjectStoreEndpoint:  "http://minio:9000",
		NoticeBodyObjectStoreAccessKey: "access",
		NoticeBodyObjectStoreSecretKey: "secret",
		NoticeBodyObjectStoreRegion:    "us-east-1",
		NoticeBodyObjectStoreBucket:    "notice-body",
	})

	status := runtime.Status(context.Background())
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
