package httpapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/execution"
)

func createHTTPAPIQueuedDurableRunForTest(
	t *testing.T,
	store *execution.InMemoryDurableRuntimeStore,
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
		t.Fatalf("create durable run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusQueued,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("queue durable run: %v", err)
	}
}

func prepareHTTPAPIDurableLeaseDependenciesForTest(
	t *testing.T,
	store *execution.InMemoryDurableRuntimeStore,
	lane execution.DurableLane,
	workerID string,
	now time.Time,
) {
	t.Helper()
	if err := store.UpsertLaneBudget(context.Background(), execution.LaneBudget{
		Lane:                   lane,
		MaxActiveLeases:        4,
		MaxQueuedRuns:          16,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	if err := store.UpsertWorkerHeartbeat(context.Background(), execution.WorkerHeartbeat{
		WorkerID:       workerID,
		WorkerKind:     "supervisor-agent-worker",
		Lanes:          []execution.DurableLane{lane},
		RuntimeVersion: "test",
		Status:         execution.WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now.Add(-time.Second),
	}); err != nil {
		t.Fatalf("upsert worker heartbeat: %v", err)
	}
}

func ragHandoffForDurableWorkerTest(queryText string) map[string]any {
	return map[string]any{
		"target":        "rag-agent",
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

func waitForHTTPAPIDurableEventType(
	t *testing.T,
	store execution.DurableRuntimeStore,
	runID string,
	eventType execution.DurableRunEventType,
	notify chan<- struct{},
) {
	t.Helper()
	deadline := time.Now().Add(300 * time.Millisecond)
	closed := false
	for time.Now().Before(deadline) {
		events, err := store.ListRunEvents(context.Background(), runID)
		if err != nil {
			t.Fatalf("list events: %v", err)
		}
		for _, event := range events {
			if event.EventType != eventType {
				continue
			}
			if !closed {
				close(notify)
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for durable event %s", eventType)
}

func waitForHTTPAPIDurableEventCount(
	t *testing.T,
	store execution.DurableRuntimeStore,
	runID string,
	eventType execution.DurableRunEventType,
	expectedCount int,
	notify chan<- struct{},
) {
	t.Helper()
	deadline := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		events, err := store.ListRunEvents(context.Background(), runID)
		if err != nil {
			t.Fatalf("list events: %v", err)
		}
		count := 0
		for _, event := range events {
			if event.EventType == eventType {
				count++
			}
		}
		if count >= expectedCount {
			close(notify)
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d durable events %s", expectedCount, eventType)
}

type leaseOwnershipDriftStore struct {
	*execution.InMemoryDurableRuntimeStore
	driftLeaseOwner bool
}

func (s *leaseOwnershipDriftStore) GetExecutionLease(
	ctx context.Context,
	leaseID string,
) (execution.ExecutionLease, error) {
	lease, err := s.InMemoryDurableRuntimeStore.GetExecutionLease(ctx, leaseID)
	if err != nil {
		return execution.ExecutionLease{}, err
	}
	if s.driftLeaseOwner {
		lease.WorkerID = lease.WorkerID + "-other"
	}
	return lease, nil
}

func durableAgentResponseBodyForTest(answerText string) json.RawMessage {
	body, err := json.Marshal(map[string]any{
		"target":             "rag-agent",
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
