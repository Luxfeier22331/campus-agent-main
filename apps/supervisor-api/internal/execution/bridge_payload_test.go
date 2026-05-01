package execution

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBridgePayloadForHandoffUsesNoticeSummaryNotBodyLabel(t *testing.T) {
	base := json.RawMessage(`{
		"user_goal":"这条通知依据学生手册哪条规定？",
		"request_id":"req-001",
		"runtime_decisions":{"runtime_decision_summary":{}}
	}`)
	projection, ok := NewNoticeContextProjection(
		"handoff:notice-agent:campus_notice_get",
		"烟雾测试通知",
		"通知短摘要要求结合学生手册相关规定理解。",
		"https://example.invalid/notices/smoke",
	)
	if !ok {
		t.Fatal("expected notice context projection")
	}
	payload, err := BridgePayloadForHandoff(
		base,
		RuntimeHandoff{
			Target:       "rag-agent",
			PayloadKind:  "rag_request",
			AllowedTools: []string{"retrieval.query"},
		},
		projection,
	)
	if err != nil {
		t.Fatalf("bridge payload: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode bridge payload: %v", err)
	}
	userGoal, _ := decoded["user_goal"].(string)
	if !strings.Contains(userGoal, "摘要：通知短摘要要求结合学生手册相关规定理解。") {
		t.Fatalf("user_goal = %q, want notice summary label", userGoal)
	}
	if strings.Contains(userGoal, "正文：") {
		t.Fatalf("user_goal leaked body label: %q", userGoal)
	}
}
