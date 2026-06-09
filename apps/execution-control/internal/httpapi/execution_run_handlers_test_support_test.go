package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func attachRunProjectionStoreForHandlerTest(
	server *Server,
	store execution.RunProjectionStore,
) {
	server.runProjectionStore = store
	server.runProjectionStoreErr = nil
}

func durableRunCreateBodyForTest(runID string, conversationID string) string {
	return fmt.Sprintf(`{
		"run_id":%q,
		"conversation_id":%q,
		"turn_id":"turn-%s",
		"request_id":"req-%s",
		"trace_id":"trace-%s",
		"owner_user_id":"user-executor",
		"surface":"public-chat-web",
		"requested_capability":"knowledge",
		"selected_capability":"knowledge",
		"lane":"rag",
		"runtime_versions":{"contract":"durable-agent-runtime-contract-v1"},
		"metadata":{
			"execution_payload":{
				"user_goal":"hello",
				"request_id":"req-%s",
				"conversation_id":%q,
				"trace":{"trace_id":"trace-%s"},
				"actor":{"user_id":"user-executor"},
				"context":{"actor":{"user_id":"user-executor"}},
				"runtime_decisions":{"runtime_decision_summary":{}}
			},
			"handoff":{
				"capability":"rag-tool",
				"payload_kind":"rag_request",
				"allowed_tools":["retrieval.query"],
				"payload":{"query_text":"hello"}
			}
		}
	}`, runID, conversationID, runID, runID, runID, runID, conversationID, runID)
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
	metadata := map[string]any{
		"execution_payload": map[string]any{
			"user_goal":       "hello",
			"request_id":      "req-executor-001",
			"conversation_id": conversationID,
			"trace":           map[string]any{"trace_id": "trace-executor-001"},
			"actor":           map[string]any{"user_id": "user-executor"},
			"context":         map[string]any{"actor": map[string]any{"user_id": "user-executor"}},
			"runtime_decisions": map[string]any{
				"runtime_decision_summary": map[string]any{},
			},
		},
	}
	if handoff != nil {
		metadata["handoff"] = handoff
	}
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          runID,
		ConversationID: conversationID,
		TurnID:         "turn-" + runID,
		RequestID:      "req-executor-001",
		TraceID:        "trace-executor-001",
		OwnerUserID:    "user-executor",
		Surface:        "public-chat-web",
		Lane:           execution.DurableLaneRAG,
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
		"capability":        "knowledge",
		"payload_kind":  "rag_request",
		"allowed_tools": []any{"retrieval.query"},
		"payload":       map[string]any{"query_text": queryText},
	}
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

func durableCapabilityResponseBodyForTest(answerText string) json.RawMessage {
	body, err := json.Marshal(map[string]any{
		"capability":             "knowledge",
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
