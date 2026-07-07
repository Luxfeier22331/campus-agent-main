package httpapi

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

func TestStructuredAnswerTextUsesNoticeSourceCardNotBody(t *testing.T) {
	answerText := structuredAnswerText(
		toolreadmodel.ToolCampusNoticeGet,
		map[string]any{
			"outcome":         "resolved_current",
			"title":           "2026年春假安排通知",
			"source_url":      "https://www.example.edu/info/2026-spring-break.htm",
			"normalized_body": "一、放假时间为 4 月 30 日至 5 月 5 日。",
			"body_excerpt":    "春假安排短摘要。",
		},
		"completed",
	)

	for _, snippet := range []string{"2026年春假安排通知", "https://www.example.edu/info/2026-spring-break.htm"} {
		if !strings.Contains(answerText, snippet) {
			t.Fatalf("answer_text = %q, want snippet %q", answerText, snippet)
		}
	}
	for _, forbidden := range []string{"一、放假时间", "春假安排短摘要"} {
		if strings.Contains(answerText, forbidden) {
			t.Fatalf("answer_text = %q, must not contain notice body/excerpt %q", answerText, forbidden)
		}
	}
}
