package httpapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type fakeTemporalStarter struct {
	cancelRunID  string
	cancelReason string
	cancelErr    error
	ctx          context.Context
	input        temporalruntime.ToolExecutionWorkflowInput
	err          error
}

func (f *fakeTemporalStarter) StartToolExecutionWorkflow(
	ctx context.Context,
	input temporalruntime.ToolExecutionWorkflowInput,
) error {
	f.ctx = ctx
	f.input = input
	return f.err
}

func (f *fakeTemporalStarter) StartPersonalMemoryCommandWorkflow(
	context.Context,
	temporalruntime.PersonalMemoryCommandWorkflowInput,
) error {
	return f.err
}

func (f *fakeTemporalStarter) CancelToolExecutionWorkflow(
	_ context.Context,
	input temporalruntime.ToolExecutionWorkflowCancelInput,
) error {
	f.cancelRunID = input.RunID
	f.cancelReason = input.Reason
	return f.cancelErr
}

func (f *fakeTemporalStarter) CheckReadiness(context.Context) temporalruntime.RuntimeReadiness {
	return temporalruntime.RuntimeReadiness{
		Healthy: true,
		TaskQueues: []temporalruntime.TaskQueueReadiness{
			{
				Name:    temporalruntime.WorkflowTaskQueue,
				Type:    temporalruntime.TaskQueueTypeWorkflow,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueCore,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueAgent,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
		},
	}
}

func publicRetrievalFilterForTest() map[string]any {
	return map[string]any{
		"policy_projection_version": "phase1-authorization-projection-v1",
		"visibility_level":          "public",
	}
}

func setExecutionPayloadConversationContextForRunTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	conversationContext map[string]any,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	metadata := cloneAnyMapFromMetadata(run.Metadata)
	executionPayload := cloneAnyMapFromMetadata(metadata["execution_payload"])
	contextEnvelope := cloneAnyMapFromMetadata(executionPayload["context"])
	contextEnvelope["conversation"] = conversationContext
	executionPayload["context"] = contextEnvelope
	metadata["execution_payload"] = executionPayload
	if err := store.ReplaceRunMetadata(context.Background(), runID, metadata); err != nil {
		t.Fatalf("replace run metadata: %v", err)
	}
}

func attachRunProjectionStoreForHandlerTest(
	server *Server,
	store execution.RunProjectionStore,
) {
	server.runProjectionStore = store
	server.runProjectionStoreErr = nil
	server.productFinalizationWriter = func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
		return nil
	}
}

func durableRunCreateBodyForTest(runID string, conversationID string) string {
	return durableRunCreateBodyWithToolForTest(
		runID,
		conversationID,
		"knowledge_query",
	)
}

func durableRunCreateBodyWithToolForTest(
	runID string,
	conversationID string,
	requestedTool string,
) string {
	executionPayload := map[string]any{
		"execution_contract_version": "tool_execution_v2",
		"response_contract":          "execution_finalization_response_v3",
		"user_goal":                  "hello",
		"request_id":                 "req-" + runID,
		"conversation_id":            conversationID,
		"trace":                      map[string]any{"trace_id": "trace-" + runID},
		"context": map[string]any{
			"actor": map[string]any{"user_id": "user-executor"},
			"authorization": map[string]any{
				"retrieval_filter": map[string]any{
					"policy_projection_version": "phase1-authorization-projection-v1",
					"visibility_level":          "public",
				},
			},
		},
	}
	body := map[string]any{
		"run_id":          runID,
		"conversation_id": conversationID,
		"turn_id":         "turn-" + runID,
		"request_id":      "req-" + runID,
		"trace_id":        "trace-" + runID,
		"owner_user_id":   "user-executor",
		"surface":         "campus-web",
		"runtime_versions": map[string]any{
			"contract": "durable-agent-runtime-contract-v1",
		},
		"metadata": map[string]any{"execution_payload": executionPayload},
	}
	if requestedTool != "" {
		executionPayload["requested_tool"] = requestedTool
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func createHTTPAPIQueuedDurableRunForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	conversationID string,
	now time.Time,
	handoff map[string]any,
) {
	t.Helper()
	userGoal := "hello"
	if handoff != nil {
		if payload, ok := handoff["payload"].(map[string]any); ok {
			userGoal = firstNonEmptyText(payload["query_text"], userGoal)
		}
	}
	metadata := map[string]any{
		"execution_payload": map[string]any{
			"execution_contract_version": "tool_execution_v2",
			"response_contract":          "execution_finalization_response_v3",
			"user_goal":                  userGoal,
			"request_id":                 "req-executor-001",
			"conversation_id":            conversationID,
			"trace":                      map[string]any{"trace_id": "trace-executor-001"},
			"context": map[string]any{
				"actor": map[string]any{"user_id": "user-executor"},
				"authorization": map[string]any{
					"retrieval_filter": publicRetrievalFilterForTest(),
				},
				"conversation": map[string]any{
					"current_user_message": map[string]any{
						"created_at": now.UTC().Format(time.RFC3339),
					},
				},
			},
		},
	}
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          runID,
		ConversationID: conversationID,
		TurnID:         "turn-" + runID,
		RequestID:      "req-executor-001",
		TraceID:        "trace-executor-001",
		OwnerUserID:    "user-executor",
		Surface:        "campus-web",
		RequestedTool:  handoffToolForDurableWorkerTest(handoff),
		SelectedTool:   handoffSelectedToolForDurableWorkerTest(handoff),
		TaskQueue:      "campus-agent.workflow",
		Status:         execution.DurableRunStatusCreated,
		CreatedAt:      now,
		Metadata:       metadata,
	}); err != nil {
		t.Fatalf("create run projection: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusQueued,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
}

func ragHandoffForDurableWorkerTest(queryText string) map[string]any {
	return map[string]any{
		"tool":          "knowledge_query",
		"payload_kind":  "rag_request",
		"allowed_tools": []any{"knowledge_query"},
		"payload":       map[string]any{"query_text": queryText},
	}
}

func handoffToolForDurableWorkerTest(handoff map[string]any) string {
	if handoff == nil {
		return ""
	}
	return firstNonEmptyText(handoff["tool"], "")
}

func handoffSelectedToolForDurableWorkerTest(handoff map[string]any) string {
	if handoff == nil {
		return ""
	}
	allowed, _ := handoff["allowed_tools"].([]any)
	if len(allowed) == 1 {
		return firstNonEmptyText(allowed[0], "")
	}
	return firstNonEmptyText(handoff["tool"], "")
}

func assertHTTPAPIDurableEventTypes(
	t *testing.T,
	events []execution.DurableRunEvent,
	expected []execution.DurableRunEventType,
) {
	t.Helper()
	if len(events) != len(expected) {
		t.Fatalf("event count = %d, want %d: %#v", len(events), len(expected), events)
	}
	for index, expectedType := range expected {
		if events[index].EventType != expectedType {
			t.Fatalf("event[%d] type = %q, want %q", index, events[index].EventType, expectedType)
		}
		if events[index].Sequence != int64(index+1) {
			t.Fatalf("event[%d] sequence = %d, want %d", index, events[index].Sequence, index+1)
		}
	}
}

func expectInternalFinalizationResponseForTest(
	t *testing.T,
	events []execution.DurableRunEvent,
) map[string]any {
	t.Helper()
	var finalizationResponse map[string]any
	for _, event := range events {
		if event.EventType != execution.DurableRunEventTypeFinalizationCompleted {
			continue
		}
		if event.Visibility == execution.DurableRunEventVisibilityBrowser {
			if _, exists := event.Payload["response"]; exists {
				t.Fatalf("browser finalization.completed event leaked response: %#v", event.Payload)
			}
			continue
		}
		if event.Visibility != execution.DurableRunEventVisibilityInternal {
			continue
		}
		response, ok := event.Payload["response"].(map[string]any)
		if !ok {
			t.Fatalf("internal finalization response payload = %#v", event.Payload["response"])
		}
		finalizationResponse = response
	}
	if finalizationResponse == nil {
		t.Fatal("internal finalization.completed event missing")
	}
	return finalizationResponse
}

func durableToolResponseBodyForTest(answerText string) json.RawMessage {
	body, err := json.Marshal(map[string]any{
		"tool":               "knowledge_query",
		"status":             "completed",
		"answer_text":        answerText,
		"follow_up_question": "",
		"confidence":         "high",
		"result": map[string]any{
			"evidence": map[string]any{
				"sources": []map[string]any{{"doc_id": "student_rules:test"}},
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return body
}
