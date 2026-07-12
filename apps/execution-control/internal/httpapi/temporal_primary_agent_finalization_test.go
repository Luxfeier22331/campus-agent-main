package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestWriteFinalizationActivityCompletesPrimaryAgentResult(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 30, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-finalization",
		"conv-primary-agent-finalization",
		now,
		ragHandoffForDurableWorkerTest("hi 你是谁"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:001"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef("run-primary-agent-finalization", "agent/primary/result")
	run, err := store.GetRun(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalAgentMetadata(context.Background(), run, func(metadata map[string]any) {
		for key, value := range map[string]any{
			"agent_result_ref":      agentResultRef,
			"final_output":          "你好，我是校园问答助手。",
			"terminal_envelope":     map[string]any{"kind": "answer", "answer_text": "你好，我是校园问答助手。"},
			"provider_response_id":  "resp-primary-agent-finalization",
			"llm_io_fingerprint":    primaryAgentFingerprintForFinalizationTest("run-primary-agent-finalization"),
			"raw_prompt":            "system prompt should never be projected",
			"provider_request_body": map[string]any{"authorization": "Bearer forbidden"},
			"selected_tools":        []string{"transport_schedule_lookup"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "transport_schedule_lookup",
				"tool":         "transport_schedule_lookup",
				"payload_kind": "transport_schedule_lookup",
				"result_ref":   "agent-runtime://run-primary-agent-finalization/tools/transport_schedule_lookup",
				"result":       map[string]any{"outcome": "resolved_current"},
			}},
			"terminal_reason": "answer_completed",
			"stage_timing": map[string]any{
				"agent.runtime_ms": float64(42),
			},
			"usage": map[string]any{
				"input_tokens":             12,
				"output_tokens":            8,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 42,
			},
		} {
			metadata[key] = value
		}
	}); err != nil {
		t.Fatalf("replace temporal agent metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-finalization",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-finalization",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("run run: %v", err)
	}

	output, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			RunID:          "run-primary-agent-finalization",
			TraceID:        "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("finalization status = %q", output.Status)
	}
	completedRun, err := store.GetRun(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if completedRun.FinalResponseRef != output.ProjectionRef {
		t.Fatalf("final response ref = %q, want %q", completedRun.FinalResponseRef, output.ProjectionRef)
	}
	if completedRun.SelectedTool != "transport_schedule_lookup" {
		t.Fatalf("run selected tool = %q, want transport_schedule_lookup", completedRun.SelectedTool)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizationResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizationResponse["answer_text"])
	}
	if finalizationResponse["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("selected_tool = %#v", finalizationResponse["selected_tool"])
	}
	observability, ok := finalizationResponse["observability"].(map[string]any)
	if !ok {
		t.Fatalf("observability = %#v", finalizationResponse["observability"])
	}
	fingerprint, ok := observability["llm_io_fingerprint"].(map[string]any)
	if !ok {
		t.Fatalf("observability.llm_io_fingerprint = %#v", observability["llm_io_fingerprint"])
	}
	if fingerprint["schema_version"] != "llm_io_fingerprint.v1" ||
		fingerprint["run_id"] != "run-primary-agent-finalization" ||
		fingerprint["trace_id"] != "trace-executor-001" {
		t.Fatalf("llm_io_fingerprint = %#v", fingerprint)
	}
	answerFingerprint, ok := observability["answer_eval_fingerprint"].(map[string]any)
	if !ok {
		t.Fatalf("observability.answer_eval_fingerprint = %#v", observability["answer_eval_fingerprint"])
	}
	if answerFingerprint["schema_version"] != "answer_eval_fingerprint.v1" ||
		answerFingerprint["llm_call_site"] != "agent.primary" ||
		answerFingerprint["selected_tool"] != "transport_schedule_lookup" ||
		answerFingerprint["terminal_outcome"] != "grounded_answer" {
		t.Fatalf("answer_eval_fingerprint = %#v", answerFingerprint)
	}
	branchIdentity, ok := answerFingerprint["branch_identity"].(map[string]any)
	if !ok {
		t.Fatalf("answer_eval_fingerprint.branch_identity = %#v", answerFingerprint["branch_identity"])
	}
	if branchIdentity["prompt_id"] != "primary_agent" ||
		branchIdentity["branch_kind"] != "tool_routed" {
		t.Fatalf("branch identity = %#v, want primary agent prompt plus tool_routed branch", branchIdentity)
	}
	encodedResponse, err := json.Marshal(finalizationResponse)
	if err != nil {
		t.Fatalf("encode finalization response: %v", err)
	}
	for _, forbidden := range []string{
		"raw_prompt",
		"provider_request_body",
		"system prompt should never be projected",
		"Bearer forbidden",
	} {
		if strings.Contains(string(encodedResponse), forbidden) {
			t.Fatalf("finalization response leaked %q: %s", forbidden, string(encodedResponse))
		}
	}
	stageTiming, ok := finalizationResponse["stage_timing"].(map[string]any)
	if !ok {
		t.Fatalf("stage_timing = %#v", finalizationResponse["stage_timing"])
	}
	if stageTiming["agent.runtime_ms"] != float64(42) {
		t.Fatalf("agent.runtime_ms = %#v, want 42", stageTiming["agent.runtime_ms"])
	}
	if _, ok := stageTiming["finalization.write_ms"]; !ok {
		t.Fatalf("stage_timing missing finalization.write_ms: %#v", stageTiming)
	}
	workflowTrace, ok := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if !ok {
		t.Fatalf("workflow_trace_summary = %#v", finalizationResponse["workflow_trace_summary"])
	}
	if workflowTrace["workflow_mode"] != "single_step" ||
		workflowTrace["first_decision_actor"] != "primary_agent" ||
		workflowTrace["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
	}
	toolCalls := expectRecordList(t, workflowTrace["tool_call_summaries"], "tool_call_summaries")
	if len(toolCalls) != 1 || toolCalls[0]["result_projection"] != "bounded_summary" {
		t.Fatalf("tool_call_summaries = %#v, want bounded primary-agent tool summary", workflowTrace["tool_call_summaries"])
	}
	results, err := store.ListStepResults(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	var finalizationResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "finalization.write" {
			finalizationResult = &results[index]
		}
	}
	if finalizationResult == nil {
		t.Fatal("finalization.write result missing")
		return
	}
	projectedResponse, ok := finalizationResult.SanitizedPayload["finalized_response"].(map[string]any)
	if !ok {
		t.Fatalf("finalization result payload = %#v", finalizationResult.SanitizedPayload)
	}
	if projectedResponse["answer_text"] != finalizationResponse["answer_text"] ||
		projectedResponse["trace_id"] != finalizationResponse["trace_id"] {
		t.Fatalf("projected response drifted from event: %#v", projectedResponse)
	}
}

func TestWriteFinalizationActivityCompletesPrimaryAgentClarification(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-clarification",
		"conv-primary-agent-clarification",
		now,
		ragHandoffForDurableWorkerTest("校车怎么走"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:001"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef("run-primary-agent-clarification", "agent/primary/result")
	run, err := store.GetRun(context.Background(), "run-primary-agent-clarification")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalAgentMetadata(context.Background(), run, func(metadata map[string]any) {
		for key, value := range map[string]any{
			"agent_result_ref":     agentResultRef,
			"final_output":         "请问你要查询哪条校车线路或哪个校区？",
			"terminal_envelope":    map[string]any{"kind": "clarification_required", "follow_up_question": "请问你要查询哪条校车线路或哪个校区？"},
			"provider_response_id": "resp-primary-agent-clarification",
			"llm_io_fingerprint":   primaryAgentFingerprintForFinalizationTest("run-primary-agent-clarification"),
			"selected_tools":       []string{},
			"tool_results":         []map[string]any{},
			"terminal_reason":      "clarification_required",
			"usage": map[string]any{
				"input_tokens":             10,
				"output_tokens":            9,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 18,
			},
		} {
			metadata[key] = value
		}
	}); err != nil {
		t.Fatalf("replace temporal agent metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-clarification",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-clarification",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("run run: %v", err)
	}

	output, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			RunID:          "run-primary-agent-clarification",
			TraceID:        "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("finalization status = %q", output.Status)
	}
	completedRun, err := store.GetRun(context.Background(), "run-primary-agent-clarification")
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if completedRun.TerminalReason != execution.DurableTerminalReasonClarificationRequired {
		t.Fatalf("terminal reason = %q", completedRun.TerminalReason)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-clarification")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizationResponse["status"] != "needs_clarification" {
		t.Fatalf("status = %#v", finalizationResponse["status"])
	}
	if finalizationResponse["follow_up_question"] != "请问你要查询哪条校车线路或哪个校区？" {
		t.Fatalf("follow_up_question = %#v", finalizationResponse["follow_up_question"])
	}
	traceSummary, ok := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if !ok || traceSummary["direct_vs_delegate_branch"] != "clarification" {
		t.Fatalf("workflow trace summary = %#v", finalizationResponse["workflow_trace_summary"])
	}
}

func primaryAgentFingerprintForFinalizationTest(runID string) map[string]any {
	toolRuntime := testToolRuntimeFingerprintMap()
	modelParams := modelParamsProjection(map[string]any{
		"model":       "gpt-4.1",
		"provider":    "openai",
		"tool_config": map[string]any{"tool_choice": "auto"},
		"transport":   "responses",
	})
	promptID := "primary_agent"
	promptTemplateSHA256 := "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	renderedPromptSHA256 := "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	return map[string]any{
		"schema_version":                  "llm_io_fingerprint.v1",
		"run_id":                          runID,
		"request_id":                      "req-primary-agent-finalization",
		"trace_id":                        "trace-executor-001",
		"runtime_release":                 "execution-control@test",
		"llm_call_site":                   "agent.primary",
		"provider_profile_revision":       "primary_agent:provider_profile_primary:3",
		"provider":                        "openai",
		"model":                           "gpt-4.1",
		"model_params_hash":               modelParams["params_sha256"],
		"model_params_projection":         modelParams,
		"prompt_id":                       promptID,
		"prompt_registry_attestation":     promptRegistryAttestation(promptID, promptTemplateSHA256, primaryAgentPromptVariablesSchemaVersion, primaryAgentOutputSchemaID),
		"prompt_template_sha256":          promptTemplateSHA256,
		"prompt_variables_schema_version": "final_model_context.v1",
		"rendered_prompt_sha256":          renderedPromptSHA256,
		"provider_request_safe_hash":      providerRequestSafeHash(map[string]any{"model": "gpt-4.1", "prompt_id": promptID, "rendered_prompt_sha256": renderedPromptSHA256}),
		"tool_catalog_sha256":             "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		"tool_schema_sha256":              "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		"tool_runtime_fingerprint":        toolRuntime,
		"tool_runtime_attestation":        toolRuntimeAttestation("apps/agent-runtime", toolRuntime),
		"workflow_artifact_sha256":        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		"context_envelope_sha256":         "sha256:1111111111111111111111111111111111111111111111111111111111111111",
		"memory_selection_sha256":         "sha256:2222222222222222222222222222222222222222222222222222222222222222",
		"evidence_packet_sha256":          "sha256:3333333333333333333333333333333333333333333333333333333333333333",
		"output_schema_id":                primaryAgentOutputSchemaID,
		"primary_attestation":             primaryAttestation("primary_agent_call", "apps/agent-runtime", map[string]any{"prompt_id": promptID, "tool_runtime_fingerprint": toolRuntime}),
	}
}

func writeAgentRuntimeSSEEvent(
	t *testing.T,
	response http.ResponseWriter,
	event string,
	payload map[string]any,
) {
	t.Helper()
	if event == "completed" {
		addDefaultAgentRuntimeAttestationForTest(payload)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode agent runtime SSE payload: %v", err)
	}
	response.Header().Set("content-type", "text/event-stream; charset=utf-8")
	if _, err := fmt.Fprintf(response, "event: %s\ndata: %s\n\n", event, encoded); err != nil {
		t.Fatalf("write agent runtime SSE event: %v", err)
	}
	if flusher, ok := response.(http.Flusher); ok {
		flusher.Flush()
	}
}

func addDefaultAgentRuntimeAttestationForTest(payload map[string]any) {
	if _, exists := payload["prompt_trace"]; !exists {
		payload["prompt_trace"] = map[string]any{
			"schema_version":         "agent_runtime_prompt_trace.v1",
			"prompt_id":              "primary_agent",
			"prompt_template_sha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			"rendered_prompt_sha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		}
	}
	if _, exists := payload["tool_runtime_fingerprint"]; !exists {
		payload["tool_runtime_fingerprint"] = testToolRuntimeFingerprintMap()
	}
}

func testToolRuntimeFingerprintMap() map[string]any {
	return map[string]any{
		"schema_version":                     "tool_runtime_fingerprint.v1",
		"tools_schema_version":               "tool-registry-v4",
		"tools_registry_version":             "2026-06-26",
		"tools_sha256":                       "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		"function_schema_version":            "tool-function-schemas-v1",
		"function_schema_sha256":             "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		"workflow_artifact_schema_version":   "workflow-artifact-registry-v2",
		"workflow_artifact_registry_version": "2026-05-07",
		"workflow_artifact_sha256":           "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		"combined_sha256":                    "sha256:9999999999999999999999999999999999999999999999999999999999999999",
	}
}
