package toolreadmodel

import "testing"

func TestNoticeReadModelOrderSQLUsesTimestampColumn(t *testing.T) {
	withNoticeID := noticeReadModelOrderSQL(true)
	if withNoticeID != "published_at_ts desc nulls last, source_notice_id desc, unit_id asc" {
		t.Fatalf("order sql = %q, want timestamp order with notice id tie-breaker", withNoticeID)
	}

	withoutNoticeID := noticeReadModelOrderSQL(false)
	if withoutNoticeID != "published_at_ts desc nulls last, unit_id asc" {
		t.Fatalf("order sql = %q, want timestamp order without notice id tie-breaker", withoutNoticeID)
	}
}
