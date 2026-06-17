package execution

import "testing"

func TestNewNoticePeriodSummaryProjectionBuildsBoundedProjection(t *testing.T) {
	projection, ok := NewNoticePeriodSummaryProjection(
		"step:notice-period-summary",
		"2026-04-01",
		"2026-04-10",
		"4月上旬共有两条奖学金相关通知。",
		[]string{"奖学金：申请安排", "奖学金：答辩安排"},
		[]string{"https://portal.example.edu/notices/notice-001"},
	)

	if !ok {
		t.Fatal("projection not built")
	}
	if projection.ProjectionKind != ProjectionKindNoticePeriodSummary {
		t.Fatalf("projection kind = %q, want notice_period_summary", projection.ProjectionKind)
	}
	if projection.Payload["summary"] != "4月上旬共有两条奖学金相关通知。" {
		t.Fatalf("summary = %#v", projection.Payload["summary"])
	}
	if projection.Payload["start_date"] != "2026-04-01" || projection.Payload["end_date"] != "2026-04-10" {
		t.Fatalf("date range = %#v", projection.Payload)
	}
	if projection.Safety.MaxChars != MaxNoticePeriodSummaryProjectionSummaryChars {
		t.Fatalf("max chars = %d", projection.Safety.MaxChars)
	}
}
