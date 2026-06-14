package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityProjectsSdkTypedToolResult(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 10, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-sdk-tool",
		"conv-primary-agent-sdk-tool",
		now,
		ragHandoffForDurableWorkerTest("今晚六点还有丰台去海淀的班车吗"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-sdk-tool",
			"final_output":         "今晚六点的丰台到海淀班车暂时无法用结构化来源确认，请人工校对。",
			"provider_response_id": "resp-primary-agent-sdk-tool",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-sdk-tool",
			"selected_tools":       []string{"transport_schedule_lookup", "transport_schedule_lookup"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "transport_schedule_lookup",
				"capability":   "campus_services",
				"payload_kind": "transport_schedule_lookup",
				"arguments_json": validTransportScheduleLookupArguments(
					"今晚六点还有丰台去海淀的班车吗",
				),
				"result_ref": "agent-runtime://run-primary-agent-sdk-tool/tools/transport_schedule_lookup",
				"result":     map[string]any{"outcome": "temporarily_unverifiable"},
			}, {
				"status":       "completed",
				"tool_name":    "transport_schedule_lookup",
				"capability":   "campus_services",
				"payload_kind": "transport_schedule_lookup",
				"arguments_json": validTransportScheduleLookupArguments(
					"今晚六点还有丰台去海淀的班车吗",
				),
				"result_ref": "agent-runtime://run-primary-agent-sdk-tool/tools/transport_schedule_lookup/2",
				"result":     map[string]any{"outcome": "resolved_current"},
			}},
			"terminal_reason": "answer_completed",
			"usage": map[string]any{
				"input_tokens":             28,
				"output_tokens":            16,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 55,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:sdk-tool",
	})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:      "conv-primary-agent-sdk-tool",
		RequestID:           "req-primary-agent-sdk-tool",
		RunID:               "run-primary-agent-sdk-tool",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-sdk-tool",
		VisibleCapabilities: []string{"campus_services", "notice", "knowledge"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	steps, err := store.ListRunSteps(context.Background(), "run-primary-agent-sdk-tool")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	var firstToolStep *execution.RunStepProjection
	var secondToolStep *execution.RunStepProjection
	for index := range steps {
		if steps[index].StepID == "sdk_tool.execute.transport_schedule_lookup.1" {
			firstToolStep = &steps[index]
		}
		if steps[index].StepID == "sdk_tool.execute.transport_schedule_lookup.2" {
			secondToolStep = &steps[index]
		}
	}
	if firstToolStep == nil {
		t.Fatalf("first sdk typed tool step missing: %#v", steps)
		return
	}
	if secondToolStep == nil {
		t.Fatalf("second sdk typed tool step missing: %#v", steps)
		return
	}
	if firstToolStep.Capability != "campus_services" ||
		firstToolStep.StepKind != "tool" ||
		firstToolStep.Status != "completed" ||
		secondToolStep.Status != "completed" {
		t.Fatalf("sdk typed tool steps = %#v / %#v", firstToolStep, secondToolStep)
	}
	results, err := store.ListStepResults(context.Background(), "run-primary-agent-sdk-tool")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	var firstToolResult *execution.StepResultProjection
	var secondToolResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "sdk_tool.execute.transport_schedule_lookup.1" {
			firstToolResult = &results[index]
		}
		if results[index].StepID == "sdk_tool.execute.transport_schedule_lookup.2" {
			secondToolResult = &results[index]
		}
	}
	if firstToolResult == nil {
		t.Fatalf("first sdk typed tool result missing: %#v", results)
		return
	}
	if secondToolResult == nil {
		t.Fatalf("second sdk typed tool result missing: %#v", results)
		return
	}
	if firstToolResult.ResultKind != "typed_tool_result" ||
		firstToolResult.ProjectionRef != "projection://runs/run-primary-agent-sdk-tool/sdk-tools/transport_schedule_lookup/1" ||
		secondToolResult.ProjectionRef != "projection://runs/run-primary-agent-sdk-tool/sdk-tools/transport_schedule_lookup/2" {
		t.Fatalf("sdk typed tool results = %#v / %#v", firstToolResult, secondToolResult)
	}
	if firstToolResult.SanitizedPayload["selected_tool"] != "transport_schedule_lookup" ||
		firstToolResult.SanitizedPayload["outcome"] != "temporarily_unverifiable" ||
		secondToolResult.SanitizedPayload["outcome"] != "resolved_current" {
		t.Fatalf("sdk typed tool result payloads = %#v / %#v", firstToolResult.SanitizedPayload, secondToolResult.SanitizedPayload)
	}
}

func TestExecutePrimaryAgentActivityProjectsBoundedReplanAttempt(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 35, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-sdk-tool-replan",
		"conv-primary-agent-sdk-tool-replan",
		now,
		ragHandoffForDurableWorkerTest("今晚六点还有丰台去海淀的班车吗"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-sdk-tool-replan",
			"final_output":         "重试后确认当前投影可用。",
			"provider_response_id": "resp-primary-agent-sdk-tool-replan",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-sdk-tool-replan",
			"selected_tools":       []string{"transport_schedule_lookup"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "transport_schedule_lookup",
				"capability":   "campus_services",
				"payload_kind": "transport_schedule_lookup",
				"arguments_json": validTransportScheduleLookupArguments(
					"今晚六点还有丰台去海淀的班车吗",
				),
				"result_ref": "agent-runtime://run-primary-agent-sdk-tool-replan/tools/transport_schedule_lookup/2",
				"result":     map[string]any{"outcome": "resolved_current"},
			}},
			"terminal_reason": "answer_completed",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:sdk-tool-replan",
	})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		Attempt:             2,
		ConversationID:      "conv-primary-agent-sdk-tool-replan",
		ReplanReason:        "bounded_replan_after_tool_handler_failed",
		RequestID:           "req-primary-agent-sdk-tool-replan",
		RunID:               "run-primary-agent-sdk-tool-replan",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-sdk-tool-replan",
		VisibleCapabilities: []string{"campus_services"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	attempts, err := store.ListStepAttempts(context.Background(), "run-primary-agent-sdk-tool-replan")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	var agentAttempt *execution.StepAttemptProjection
	var toolAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "agent.primary" {
			agentAttempt = &attempts[index]
		}
		if attempts[index].StepID == "sdk_tool.execute.transport_schedule_lookup.1" {
			toolAttempt = &attempts[index]
		}
	}
	if agentAttempt == nil {
		t.Fatalf("agent attempt missing: %#v", attempts)
		return
	}
	if toolAttempt == nil {
		t.Fatalf("tool attempt missing: %#v", attempts)
		return
	}
	if agentAttempt.Attempt != 2 ||
		agentAttempt.ReplanReason != "bounded_replan_after_tool_handler_failed" {
		t.Fatalf("agent attempt = %#v", agentAttempt)
	}
	if toolAttempt.Attempt != 2 ||
		toolAttempt.ReplanReason != "bounded_replan_after_tool_handler_failed" {
		t.Fatalf("tool attempt = %#v", toolAttempt)
	}
}

func TestExecutePrimaryAgentActivityProjectsFailedSdkTypedToolResult(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 20, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-sdk-tool-failed",
		"conv-primary-agent-sdk-tool-failed",
		now,
		ragHandoffForDurableWorkerTest("最近有什么通知"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "failed",
			"run_id":               "run-primary-agent-sdk-tool-failed",
			"final_output":         "",
			"provider_response_id": "resp-primary-agent-sdk-tool-failed",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-sdk-tool-failed",
			"selected_tools":       []string{"campus_notice_discover"},
			"tool_results": []map[string]any{{
				"status":            "failed",
				"tool_name":         "campus_notice_discover",
				"capability":        "notice",
				"payload_kind":      "campus_notice_discover",
				"arguments_json":    validCampusNoticeDiscoverArguments("最近有什么通知"),
				"result_ref":        "agent-runtime://run-primary-agent-sdk-tool-failed/tools/campus_notice_discover/failed",
				"fail_close_reason": "tool_handler_failed",
				"result":            map[string]any{"error": map[string]any{"code": "source_truth_unavailable"}},
			}},
			"terminal_reason": "agent_runtime_failed",
			"usage": map[string]any{
				"input_tokens":             20,
				"output_tokens":            3,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 17,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:sdk-tool-failed",
	})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:      "conv-primary-agent-sdk-tool-failed",
		RequestID:           "req-primary-agent-sdk-tool-failed",
		RunID:               "run-primary-agent-sdk-tool-failed",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-sdk-tool-failed",
		VisibleCapabilities: []string{"notice", "knowledge"},
	})
	if err == nil {
		t.Fatal("expected failed SDK tool to fail primary agent activity")
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-sdk-tool-failed")
	if listErr != nil {
		t.Fatalf("list run steps: %v", listErr)
	}
	var toolStep *execution.RunStepProjection
	for index := range steps {
		if steps[index].StepID == "sdk_tool.execute.campus_notice_discover.1" {
			toolStep = &steps[index]
		}
	}
	if toolStep == nil {
		t.Fatalf("failed sdk typed tool step missing: %#v", steps)
		return
	}
	if toolStep.Status != "failed" ||
		toolStep.Capability != "notice" ||
		toolStep.SanitizedPayload["fail_close_reason"] != "tool_handler_failed" {
		t.Fatalf("failed sdk typed tool step = %#v", toolStep)
	}
	results, listResultsErr := store.ListStepResults(context.Background(), "run-primary-agent-sdk-tool-failed")
	if listResultsErr != nil {
		t.Fatalf("list step results: %v", listResultsErr)
	}
	var toolResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "sdk_tool.execute.campus_notice_discover.1" {
			toolResult = &results[index]
		}
	}
	if toolResult == nil {
		t.Fatalf("failed sdk typed tool result missing: %#v", results)
		return
	}
	if toolResult.ResultKind != "activity_failure" ||
		toolResult.SanitizedPayload["selected_tool"] != "campus_notice_discover" {
		t.Fatalf("failed sdk typed tool result = %#v", toolResult)
	}
}

func TestExecutePrimaryAgentActivityFailsClosedOnInvalidSdkToolArguments(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 12, 5, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-sdk-tool-bad-args",
		"conv-primary-agent-sdk-tool-bad-args",
		now,
		ragHandoffForDurableWorkerTest("今晚六点还有丰台去海淀的班车吗"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-sdk-tool-bad-args",
			"final_output":         "不应在非法参数后完成。",
			"provider_response_id": "resp-primary-agent-sdk-tool-bad-args",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-sdk-tool-bad-args",
			"selected_tools":       []string{"transport_schedule_lookup"},
			"tool_results": []map[string]any{{
				"status":         "completed",
				"tool_name":      "transport_schedule_lookup",
				"capability":     "campus_services",
				"payload_kind":   "transport_schedule_lookup",
				"arguments_json": map[string]any{"query_text": "校车", "unexpected": "field"},
				"result_ref":     "agent-runtime://run-primary-agent-sdk-tool-bad-args/tools/transport_schedule_lookup",
				"result":         map[string]any{"outcome": "resolved_current"},
			}},
			"terminal_reason": "answer_completed",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:sdk-tool-bad-args",
	})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:      "conv-primary-agent-sdk-tool-bad-args",
		RequestID:           "req-primary-agent-sdk-tool-bad-args",
		RunID:               "run-primary-agent-sdk-tool-bad-args",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-sdk-tool-bad-args",
		VisibleCapabilities: []string{"campus_services"},
	})
	if err == nil {
		t.Fatal("execute primary agent accepted invalid SDK tool arguments")
	}
	if !strings.Contains(err.Error(), "fail_close_reason=schema_contract_drift") {
		t.Fatalf("error = %q, want schema_contract_drift fail close", err.Error())
	}
	attempts, listErr := store.ListStepAttempts(context.Background(), "run-primary-agent-sdk-tool-bad-args")
	if listErr != nil {
		t.Fatalf("list attempts: %v", listErr)
	}
	var toolAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "sdk_tool.execute.transport_schedule_lookup.1" {
			toolAttempt = &attempts[index]
			break
		}
	}
	if toolAttempt == nil {
		t.Fatalf("sdk tool failure attempt missing: %#v", attempts)
		return
	}
	if toolAttempt.Status != "failed" ||
		toolAttempt.FailCloseReason != "schema_contract_drift" {
		t.Fatalf("tool attempt = %#v, want failed schema_contract_drift", toolAttempt)
	}
	if toolAttempt.SanitizedPayload["argument_validation"] == "" {
		t.Fatalf("tool attempt payload = %#v, want argument_validation", toolAttempt.SanitizedPayload)
	}
}

func TestExecutePrimaryAgentActivityRejectsUnadmittedSdkToolResult(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 25, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-sdk-tool-unadmitted",
		"conv-primary-agent-sdk-tool-unadmitted",
		now,
		ragHandoffForDurableWorkerTest("查看通知正文"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-sdk-tool-unadmitted",
			"final_output":         "不应使用 internal-only 工具回答。",
			"provider_response_id": "resp-primary-agent-sdk-tool-unadmitted",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-sdk-tool-unadmitted",
			"selected_tools":       []string{"campus_notice_get"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "campus_notice_get",
				"capability":   "notice",
				"payload_kind": "campus_notice_get",
				"result_ref":   "agent-runtime://run-primary-agent-sdk-tool-unadmitted/tools/campus_notice_get",
				"result":       map[string]any{"outcome": "resolved_current"},
			}},
			"terminal_reason": "answer_completed",
			"usage": map[string]any{
				"input_tokens":             18,
				"output_tokens":            9,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 24,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:sdk-tool-unadmitted",
	})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:      "conv-primary-agent-sdk-tool-unadmitted",
		RequestID:           "req-primary-agent-sdk-tool-unadmitted",
		RunID:               "run-primary-agent-sdk-tool-unadmitted",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-sdk-tool-unadmitted",
		VisibleCapabilities: []string{"notice", "knowledge"},
	})
	if err == nil {
		t.Fatal("expected unadmitted SDK tool result to fail closed")
	}
	if !strings.Contains(err.Error(), "agent runtime tool campus_notice_get is not admitted") {
		t.Fatalf("error = %q, want unadmitted tool failure", err.Error())
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-sdk-tool-unadmitted")
	if listErr != nil {
		t.Fatalf("list run steps: %v", listErr)
	}
	for _, step := range steps {
		if strings.HasPrefix(step.StepID, "sdk_tool.execute.campus_notice_get") {
			t.Fatalf("unadmitted SDK tool was projected as typed step: %#v", step)
		}
	}
}

func TestExecutePrimaryAgentActivityRejectsSdkToolOutsideVisibleCapabilities(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 45, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-sdk-tool-hidden-capability",
		"conv-primary-agent-sdk-tool-hidden-capability",
		now,
		ragHandoffForDurableWorkerTest("最近有什么通知"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-sdk-tool-hidden-capability",
			"final_output":         "不应使用本轮不可见能力回答。",
			"provider_response_id": "resp-primary-agent-sdk-tool-hidden-capability",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-sdk-tool-hidden-capability",
			"selected_tools":       []string{"campus_notice_discover"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "campus_notice_discover",
				"capability":   "notice",
				"payload_kind": "campus_notice_discover",
				"result_ref":   "agent-runtime://run-primary-agent-sdk-tool-hidden-capability/tools/campus_notice_discover",
				"result":       map[string]any{"outcome": "resolved_current"},
			}},
			"terminal_reason": "answer_completed",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:sdk-tool-hidden-capability",
	})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:      "conv-primary-agent-sdk-tool-hidden-capability",
		RequestID:           "req-primary-agent-sdk-tool-hidden-capability",
		RunID:               "run-primary-agent-sdk-tool-hidden-capability",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-sdk-tool-hidden-capability",
		VisibleCapabilities: []string{"campus_services"},
	})
	if err == nil {
		t.Fatal("expected hidden capability SDK tool result to fail closed")
	}
	if !strings.Contains(err.Error(), "agent runtime tool campus_notice_discover capability notice was not visible") {
		t.Fatalf("error = %q, want hidden capability failure", err.Error())
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-sdk-tool-hidden-capability")
	if listErr != nil {
		t.Fatalf("list run steps: %v", listErr)
	}
	for _, step := range steps {
		if strings.HasPrefix(step.StepID, "sdk_tool.execute.campus_notice_discover") {
			t.Fatalf("hidden capability SDK tool was projected as typed step: %#v", step)
		}
	}
}

func validTransportScheduleLookupArguments(queryText string) map[string]any {
	return map[string]any{
		"query_text": queryText,
		"intent":     "next_departure",
		"route_selector": map[string]any{
			"route_id":               nil,
			"service_family":         "intercampus",
			"route_variant_query":    nil,
			"origin_campus":          "fengtai",
			"destination_campus":     "haidian",
			"origin_stop_query":      nil,
			"destination_stop_query": nil,
		},
		"snapshot_query": map[string]any{
			"mode":      "current",
			"as_of":     nil,
			"year_hint": nil,
		},
		"service_time_query": map[string]any{
			"date_mode":            "today",
			"service_date":         nil,
			"daypart":              "evening",
			"departure_not_before": "18:00",
			"departure_not_after":  nil,
		},
		"result_limit": 3,
	}
}

func validCampusNoticeDiscoverArguments(queryText string) map[string]any {
	return map[string]any{
		"query_text": queryText,
		"temporal_query": map[string]any{
			"mode":      "latest",
			"as_of":     nil,
			"year_hint": nil,
		},
		"source_families": []any{"official_web_public_notice"},
		"target_surfaces": []any{"notice_level_query"},
		"max_results":     5,
	}
}
