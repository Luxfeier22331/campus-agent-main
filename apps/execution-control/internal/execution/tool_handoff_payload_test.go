package execution

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestToolHandoffPayloadUsesNoticeSummaryNotBodyLabel(t *testing.T) {
	base := json.RawMessage(`{
		"user_goal":"这条通知依据学生手册哪条规定？",
		"request_id":"req-001",
		"runtime_decisions":{"runtime_decision_summary":{}}
	}`)
	projection, ok := NewNoticeContextProjection(
		"tool:notice:campus_notice_get",
		"烟雾测试通知",
		"通知短摘要要求结合学生手册相关规定理解。",
		"https://example.invalid/notices/smoke",
	)
	if !ok {
		t.Fatal("expected notice context projection")
	}
	payload, err := ToolHandoffPayload(
		base,
		RuntimeHandoff{
			ToolTarget:   "knowledge_query",
			TaskQueue:    "campus-agent.activity.knowledge",
			PayloadKind:  "rag_request",
			AllowedTools: []string{"knowledge_query"},
		},
		projection,
	)
	if err != nil {
		t.Fatalf("tool handoff payload: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode tool handoff payload: %v", err)
	}
	userGoal, _ := decoded["user_goal"].(string)
	if !strings.Contains(userGoal, "摘要：通知短摘要要求结合学生手册相关规定理解。") {
		t.Fatalf("user_goal = %q, want notice summary label", userGoal)
	}
	if strings.Contains(userGoal, "正文：") {
		t.Fatalf("user_goal leaked body label: %q", userGoal)
	}
}

func TestToolHandoffPayloadProjectsWorkflowContextWithoutRawContextLeak(t *testing.T) {
	base := json.RawMessage(`{
		"user_goal":"这条通知依据学生手册哪条规定？",
		"request_id":"req-001",
		"conversation_id":"conv-001",
		"trace":{"trace_id":"trace-001"},
		"actor":{"user_id":"student-001"},
		"context":{
			"actor":{"user_id":"student-001"},
			"authorization":{"retrieval_filter":{"visibility_level":"public"}},
			"conversation":{
				"schema_version":"conversation_context.v1",
				"conversation_id":"conv-001",
				"user_message_id":"msg-user-002",
				"current_user_message":{"role":"user","content":"这个依据哪条？","created_at":"2026-06-16T10:00:00Z"},
				"recent_turns":[],
				"previous_evidence_refs":[],
				"previous_tool_results":[],
				"session_state":{"confirmed_slots":[],"turn_count":2},
				"visibility":{"model_visible":["current_user_message"],"runtime_only":["budget"]},
				"memory_recall":{"gate_field":"context.memory.enabled","owner":"execution-control","runtime":"hindsight"},
				"source_attribution":[],
				"context_summary":null,
				"budget":{"token_estimate":12,"recent_turn_limit":6},
				"truncation":null
			},
			"raw_transcript":"上一轮完整对话不应进入跨 agent context"
		},
		"runtime_decisions":{"runtime_decision_summary":{}}
	}`)
	projection, ok := NewNoticeContextProjection(
		"tool:notice:campus_notice_get",
		"通勤班车班次调整通知",
		"两校区通勤班车临时增加班次。",
		"https://example.invalid/notices/355122",
	)
	if !ok {
		t.Fatal("expected notice context projection")
	}

	payload, err := ToolHandoffPayload(
		base,
		RuntimeHandoff{
			ToolTarget:             "knowledge_query",
			TaskQueue:              "campus-agent.activity.knowledge",
			PayloadKind:            "rag_request",
			AllowedTools:           []string{"knowledge_query"},
			RequiredProjectionKind: string(ProjectionKindNoticeContext),
			ExpectedArtifacts:      []string{"evidence_bundle", "grounding_verdict"},
		},
		projection,
	)
	if err != nil {
		t.Fatalf("tool handoff payload: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode tool handoff payload: %v", err)
	}
	decisions := expectToolHandoffPayloadRecord(t, decoded["runtime_decisions"], "runtime_decisions")
	handoff := expectToolHandoffPayloadRecord(t, decisions["handoff"], "runtime_decisions.handoff")
	agentRequest := expectToolHandoffPayloadRecord(
		t,
		handoff["tool_request"],
		"runtime_decisions.handoff.tool_request",
	)
	context := expectToolHandoffPayloadRecord(
		t,
		agentRequest["context"],
		"runtime_decisions.handoff.tool_request.context",
	)
	if context["raw_transcript"] != nil {
		t.Fatalf("tool_request.context leaked raw transcript: %#v", context)
	}
	conversation := expectToolHandoffPayloadRecord(
		t,
		context["conversation"],
		"runtime_decisions.handoff.tool_request.context.conversation",
	)
	if conversation["schema_version"] != "conversation_context.v1" {
		t.Fatalf("conversation context = %#v", conversation)
	}
	workflowContext := expectToolHandoffPayloadRecord(
		t,
		agentRequest["workflow_context"],
		"runtime_decisions.handoff.tool_request.workflow_context",
	)
	projectionRefs, ok := workflowContext["projection_refs"].([]any)
	if !ok || len(projectionRefs) != 1 {
		t.Fatalf("workflow_context.projection_refs = %#v, want one projection", workflowContext["projection_refs"])
	}
	projected := expectToolHandoffPayloadRecord(t, projectionRefs[0], "projection_refs[0]")
	if projected["projection_kind"] != "notice_context" ||
		projected["projection_id"] != projection.ProjectionID ||
		projected["content_hash"] != projection.ContentHash {
		t.Fatalf("projection ref = %#v, want notice context summary", projected)
	}
	if _, hasPayload := projected["payload"]; hasPayload {
		t.Fatalf("projection ref leaked payload: %#v", projected)
	}
	if workflowContext["required_projection_kind"] != "notice_context" ||
		workflowContext["visibility"] != "tool_private" {
		t.Fatalf("workflow_context = %#v, want required kind and private visibility", workflowContext)
	}
}

func TestToolHandoffPayloadIncludesWorkflowStepExecutionMetadata(t *testing.T) {
	base := json.RawMessage(`{
		"user_goal":"这条通知依据学生手册哪条规定？",
		"request_id":"req-001",
		"conversation_id":"conv-001",
		"trace":{"trace_id":"trace-001"},
		"actor":{"user_id":"student-001"},
		"context":{"actor":{"user_id":"student-001"}},
		"runtime_decisions":{"runtime_decision_summary":{}}
	}`)
	projection, ok := NewNoticeContextProjection(
		"tool:notice:campus_notice_get",
		"通勤班车班次调整通知",
		"两校区通勤班车临时增加班次。",
		"https://example.invalid/notices/355122",
	)
	if !ok {
		t.Fatal("expected notice context projection")
	}

	payload, err := ToolHandoffPayload(
		base,
		RuntimeHandoff{
			ToolTarget:             "knowledge_query",
			TaskQueue:              "campus-agent.activity.knowledge",
			PayloadKind:            "rag_request",
			AllowedTools:           []string{"knowledge_query"},
			RequiredProjectionKind: string(ProjectionKindNoticeContext),
			ExpectedArtifacts:      []string{"evidence_bundle", "grounding_verdict"},
		},
		projection,
	)
	if err != nil {
		t.Fatalf("tool handoff payload: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode tool handoff payload: %v", err)
	}
	decisions := expectToolHandoffPayloadRecord(t, decoded["runtime_decisions"], "runtime_decisions")
	handoff := expectToolHandoffPayloadRecord(t, decisions["handoff"], "runtime_decisions.handoff")
	agentRequest := expectToolHandoffPayloadRecord(
		t,
		handoff["tool_request"],
		"runtime_decisions.handoff.tool_request",
	)
	workflowContext := expectToolHandoffPayloadRecord(
		t,
		agentRequest["workflow_context"],
		"runtime_decisions.handoff.tool_request.workflow_context",
	)
	if workflowContext["workflow_run_ref"] != "workflow:req-001" {
		t.Fatalf("workflow_context.workflow_run_ref = %#v, want workflow:req-001", workflowContext["workflow_run_ref"])
	}
	if workflowContext["step_id"] != "tool:knowledge_query:rag_request" {
		t.Fatalf("workflow_context.step_id = %#v, want tool:knowledge_query:rag_request", workflowContext["step_id"])
	}
	if workflowContext["tool_id"] != "knowledge_query" {
		t.Fatalf("workflow_context.tool_id = %#v, want knowledge_query", workflowContext["tool_id"])
	}
	expectedArtifacts, ok := workflowContext["expected_output_artifacts"].([]any)
	if !ok ||
		len(expectedArtifacts) != 2 ||
		expectedArtifacts[0] != "evidence_bundle" ||
		expectedArtifacts[1] != "grounding_verdict" {
		t.Fatalf(
			"workflow_context.expected_output_artifacts = %#v, want evidence_bundle + grounding_verdict",
			workflowContext["expected_output_artifacts"],
		)
	}
}

func TestToolHandoffPayloadFailsClosedWhenRequiredProjectionMissing(t *testing.T) {
	base := json.RawMessage(`{
		"user_goal":"这条通知依据学生手册哪条规定？",
		"request_id":"req-001",
		"runtime_decisions":{"runtime_decision_summary":{}}
	}`)

	_, err := ToolHandoffPayload(
		base,
		RuntimeHandoff{
			ToolTarget:             "knowledge_query",
			TaskQueue:              "campus-agent.activity.knowledge",
			PayloadKind:            "rag_request",
			AllowedTools:           []string{"knowledge_query"},
			RequiredProjectionKind: string(ProjectionKindNoticeContext),
		},
	)

	if err == nil || !strings.Contains(err.Error(), "required projection") {
		t.Fatalf("ToolHandoffPayload error = %v, want required projection fail-close", err)
	}
}

func TestToolHandoffPayloadForRagHandoffIncludesScheduleAndNoticeProjectionRefs(t *testing.T) {
	base := json.RawMessage(`{
		"user_goal":"这条班车通知依据学生手册哪条规定？",
		"request_id":"req-001",
		"conversation_id":"conv-001",
		"trace":{"trace_id":"trace-001"},
		"runtime_decisions":{"runtime_decision_summary":{}}
	}`)
	scheduleProjection, ok := NewScheduleBaselineProjection(
		"tool:transport_schedule_lookup:transport_schedule_lookup",
		"route:intercampus:student",
		"两校区学生通勤班车",
		"intercampus_commute",
		"当前班车基线显示两校区学生通勤班车正常运行，最近班次 06:50 发车。",
		[]string{"transport-snapshot:2026-03-18"},
	)
	if !ok {
		t.Fatal("expected schedule baseline projection")
	}
	noticeProjection, ok := NewNoticeContextProjection(
		"tool:notice:campus_notice_get",
		"关于两校区学生通勤班车增加班次的通知",
		"自 3 月 18 日起增加若干学生通勤班车班次。",
		"https://example.invalid/notices/355122",
	)
	if !ok {
		t.Fatal("expected notice context projection")
	}

	payload, err := ToolHandoffPayload(
		base,
		RuntimeHandoff{
			ToolTarget:             "knowledge_query",
			TaskQueue:              "campus-agent.activity.knowledge",
			PayloadKind:            "rag_request",
			AllowedTools:           []string{"knowledge_query"},
			RequiredProjectionKind: string(ProjectionKindNoticeContext),
		},
		scheduleProjection,
		noticeProjection,
	)
	if err != nil {
		t.Fatalf("tool handoff payload: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode tool handoff payload: %v", err)
	}
	userGoal, _ := decoded["user_goal"].(string)
	if !strings.Contains(userGoal, "已读取的班车基线") ||
		!strings.Contains(userGoal, "两校区学生通勤班车") ||
		!strings.Contains(userGoal, "最近班次 06:50 发车") ||
		!strings.Contains(userGoal, "已读取的通知上下文") {
		t.Fatalf("user_goal = %q, want schedule + notice context", userGoal)
	}
	decisions := expectToolHandoffPayloadRecord(t, decoded["runtime_decisions"], "runtime_decisions")
	handoff := expectToolHandoffPayloadRecord(t, decisions["handoff"], "runtime_decisions.handoff")
	agentRequest := expectToolHandoffPayloadRecord(
		t,
		handoff["tool_request"],
		"runtime_decisions.handoff.tool_request",
	)
	workflowContext := expectToolHandoffPayloadRecord(
		t,
		agentRequest["workflow_context"],
		"runtime_decisions.handoff.tool_request.workflow_context",
	)
	projectionRefs, ok := workflowContext["projection_refs"].([]any)
	if !ok || len(projectionRefs) != 2 {
		t.Fatalf("workflow_context.projection_refs = %#v, want two projections", workflowContext["projection_refs"])
	}
}

func expectToolHandoffPayloadRecord(t *testing.T, value any, name string) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s = %#v, want object", name, value)
	}
	return record
}
