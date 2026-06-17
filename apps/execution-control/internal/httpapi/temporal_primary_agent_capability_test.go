package httpapi

import "testing"

func TestPrimaryAgentSelectedCapabilityClassifiesNoticePeriodSummary(t *testing.T) {
	selected := primaryAgentSelectedCapability([]string{"campus_notice_period_summary"})

	if selected != "notice" {
		t.Fatalf("selected capability = %q, want notice", selected)
	}
}
