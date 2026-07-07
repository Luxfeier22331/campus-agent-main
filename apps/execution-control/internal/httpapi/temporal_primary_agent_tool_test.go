package httpapi

import "testing"

func TestPrimaryAgentSelectedToolClassifiesNoticeDiscover(t *testing.T) {
	selected := primaryAgentSelectedTool([]string{"campus_notice_discover"})

	if selected != "campus_notice_discover" {
		t.Fatalf("selected tool = %q, want campus_notice_discover", selected)
	}
}
