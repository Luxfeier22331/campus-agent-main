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

func TestBridgePayloadForHandoffProjectsWorkflowContextWithoutRawContextLeak(t *testing.T) {
	base := json.RawMessage(`{
		"user_goal":"这条通知依据学生手册哪条规定？",
		"request_id":"req-001",
		"conversation_id":"conv-001",
		"trace":{"trace_id":"trace-001"},
		"actor":{"user_id":"student-001"},
		"context":{
			"actor":{"user_id":"student-001"},
			"authorization":{"retrieval_filter":{"visibility_level":"public"}},
			"raw_transcript":"上一轮完整对话不应进入跨 agent context"
		},
		"runtime_decisions":{"runtime_decision_summary":{}}
	}`)
	projection, ok := NewNoticeContextProjection(
		"handoff:notice-agent:campus_notice_get",
		"通勤班车班次调整通知",
		"两校区通勤班车临时增加班次。",
		"https://example.invalid/notices/355122",
	)
	if !ok {
		t.Fatal("expected notice context projection")
	}

	payload, err := BridgePayloadForHandoff(
		base,
		RuntimeHandoff{
			Target:                 "rag-agent",
			PayloadKind:            "rag_request",
			AllowedTools:           []string{"retrieval.query"},
			RequiredProjectionKind: string(ProjectionKindNoticeContext),
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
	decisions := expectBridgePayloadRecord(t, decoded["runtime_decisions"], "runtime_decisions")
	handoff := expectBridgePayloadRecord(t, decisions["handoff"], "runtime_decisions.handoff")
	agentRequest := expectBridgePayloadRecord(
		t,
		handoff["agent_request"],
		"runtime_decisions.handoff.agent_request",
	)
	context := expectBridgePayloadRecord(
		t,
		agentRequest["context"],
		"runtime_decisions.handoff.agent_request.context",
	)
	if context["raw_transcript"] != nil {
		t.Fatalf("agent_request.context leaked raw transcript: %#v", context)
	}
	workflowContext := expectBridgePayloadRecord(
		t,
		agentRequest["workflow_context"],
		"runtime_decisions.handoff.agent_request.workflow_context",
	)
	projectionRefs, ok := workflowContext["projection_refs"].([]any)
	if !ok || len(projectionRefs) != 1 {
		t.Fatalf("workflow_context.projection_refs = %#v, want one projection", workflowContext["projection_refs"])
	}
	projected := expectBridgePayloadRecord(t, projectionRefs[0], "projection_refs[0]")
	if projected["projection_kind"] != "notice_context" ||
		projected["projection_id"] != projection.ProjectionID ||
		projected["content_hash"] != projection.ContentHash {
		t.Fatalf("projection ref = %#v, want notice context summary", projected)
	}
	if _, hasPayload := projected["payload"]; hasPayload {
		t.Fatalf("projection ref leaked payload: %#v", projected)
	}
	if workflowContext["required_projection_kind"] != "notice_context" ||
		workflowContext["visibility"] != "agent_private" {
		t.Fatalf("workflow_context = %#v, want required kind and private visibility", workflowContext)
	}
}

func TestBridgePayloadForHandoffFailsClosedWhenRequiredProjectionMissing(t *testing.T) {
	base := json.RawMessage(`{
		"user_goal":"这条通知依据学生手册哪条规定？",
		"request_id":"req-001",
		"runtime_decisions":{"runtime_decision_summary":{}}
	}`)

	_, err := BridgePayloadForHandoff(
		base,
		RuntimeHandoff{
			Target:                 "rag-agent",
			PayloadKind:            "rag_request",
			AllowedTools:           []string{"retrieval.query"},
			RequiredProjectionKind: string(ProjectionKindNoticeContext),
		},
	)

	if err == nil || !strings.Contains(err.Error(), "required projection") {
		t.Fatalf("BridgePayloadForHandoff error = %v, want required projection fail-close", err)
	}
}

func expectBridgePayloadRecord(t *testing.T, value any, name string) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s = %#v, want object", name, value)
	}
	return record
}
