package httpapi

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
)

func TestStructuredAnswerTextUsesServiceGuideRequiredMaterials(t *testing.T) {
	answerText := structuredAnswerText(
		structuredquery.ToolServiceGuideLookup,
		map[string]any{
			"outcome": "resolved_current",
			"resolved_service": map[string]any{
				"display_name": "公费医疗报销办理指南",
			},
			"required_materials": []any{
				map[string]any{"name": "急诊证明", "required": true},
				map[string]any{"name": "住院收据", "required": true},
			},
		},
		"completed",
	)

	for _, snippet := range []string{"公费医疗报销办理指南", "急诊证明", "住院收据"} {
		if !strings.Contains(answerText, snippet) {
			t.Fatalf("answer_text = %q, want snippet %q", answerText, snippet)
		}
	}
}

func TestStructuredAnswerTextUsesServiceGuideContactRefs(t *testing.T) {
	answerText := structuredAnswerText(
		structuredquery.ToolServiceGuideLookup,
		map[string]any{
			"outcome": "resolved_current",
			"resolved_service": map[string]any{
				"display_name": "公费医疗报销办理指南",
			},
			"contact_refs": []any{
				map[string]any{
					"label":      "校医院",
					"department": "校医院",
					"phone":      "68930000",
				},
			},
		},
		"completed",
	)

	for _, snippet := range []string{"公费医疗报销办理指南", "校医院", "68930000"} {
		if !strings.Contains(answerText, snippet) {
			t.Fatalf("answer_text = %q, want snippet %q", answerText, snippet)
		}
	}
}

func TestStructuredAnswerTextUsesContactDirectoryPoints(t *testing.T) {
	answerText := structuredAnswerText(
		structuredquery.ToolContactDirectoryLookup,
		map[string]any{
			"outcome": "resolved_current",
			"resolved_contact": map[string]any{
				"display_name": "研究生院招生办公室",
			},
			"contact_points": []any{
				map[string]any{
					"channel_type": "phone",
					"label":        "招生咨询",
					"value":        "010-68930001",
				},
			},
		},
		"completed",
	)

	for _, snippet := range []string{"研究生院招生办公室", "010-68930001"} {
		if !strings.Contains(answerText, snippet) {
			t.Fatalf("answer_text = %q, want snippet %q", answerText, snippet)
		}
	}
}

func TestStructuredAnswerTextUsesNoticeSourceCardNotBody(t *testing.T) {
	answerText := structuredAnswerText(
		structuredquery.ToolCampusNoticeGet,
		map[string]any{
			"outcome":         "resolved_current",
			"title":           "2026年春假安排通知",
			"source_url":      "https://www.muc.edu.cn/info/2026-spring-break.htm",
			"normalized_body": "一、放假时间为 4 月 30 日至 5 月 5 日。",
			"body_excerpt":    "春假安排短摘要。",
		},
		"completed",
	)

	for _, snippet := range []string{"2026年春假安排通知", "https://www.muc.edu.cn/info/2026-spring-break.htm"} {
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
