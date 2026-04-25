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
