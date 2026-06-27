package httpapi

import "testing"

func TestPrimaryAgentSelectedToolClassifiesNoticePeriodSummary(t *testing.T) {
	selected := primaryAgentSelectedTool([]string{"campus_notice_period_summary"})

	if selected != "campus_notice_period_summary" {
		t.Fatalf("selected tool = %q, want campus_notice_period_summary", selected)
	}
}
