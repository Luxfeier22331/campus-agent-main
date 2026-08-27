package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

var testExecutionInputs = struct {
	sync.RWMutex
	values map[string]contracts.ExecutionPayloadWire
}{values: map[string]contracts.ExecutionPayloadWire{}}

type mapExecutionInputLoader struct{}

func (mapExecutionInputLoader) Load(_ context.Context, run execution.DurableRun) (contracts.ExecutionPayloadWire, error) {
	testExecutionInputs.RLock()
	wire, ok := testExecutionInputs.values[run.RequestID]
	testExecutionInputs.RUnlock()
	if !ok {
		return contracts.ExecutionPayloadWire{}, fmt.Errorf("test execution input %s not found", run.RequestID)
	}
	return wire, nil
}

type failingExecutionInputLoader struct {
	err error
}

func (loader failingExecutionInputLoader) Load(
	context.Context,
	execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	return contracts.ExecutionPayloadWire{}, loader.err
}

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
) (string, error) {
	f.ctx = ctx
	f.input = input
	return "temporal-fake-run", f.err
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
	f.cancelRunID = input.RequestID
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

func v3ExecutionMetadataForHTTPTest(requestID string) map[string]any {
	return map[string]any{
		"execution_contract_version": contracts.ExecutionContractVersion,
		"execution_input_ref":        "app-api://execution-inputs/" + requestID,
		"execution_input_sha256":     strings.Repeat("a", 64),
	}
}

func executionPayloadWireForHTTPTest(
	requestID string,
	conversationID string,
	userGoal string,
	contextProjection map[string]any,
) contracts.ExecutionPayloadWire {
	if contextProjection == nil {
		contextProjection = map[string]any{}
	}
	return contracts.ExecutionPayloadWire{
		ExecutionContractVersion: contracts.ExecutionContractVersion,
		ResponseContract:         contracts.ResponseContract,
		UserGoal:                 userGoal,
		ConversationID:           conversationID,
		RequestID:                requestID,
		Context:                  cloneAnyMapFromMetadata(contextProjection),
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
	wire := testExecutionInputForRun(t, runID)
	contextEnvelope := cloneAnyMapFromMetadata(wire.Context)
	contextEnvelope["conversation"] = conversationContext
	wire.Context = contextEnvelope
	registerTestExecutionInput(t, store, run, wire)
}

func attachRunProjectionStoreForHandlerTest(
	server *Server,
	store execution.RunProjectionStore,
) {
	server.runProjectionStore = store
	server.runProjectionStoreErr = nil
	server.executionInputLoader = mapExecutionInputLoader{}
	server.executionInputErr = nil
	server.productFinalizationWriter = func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
		return nil
	}
}

func durableRunCreateBodyForTest(runID string, conversationID string) string {
	return durableRunCreateBodyWithToolForTest(runID, conversationID, "")
}

func durableRunCreateBodyWithToolForTest(
	runID string,
	conversationID string,
	requestedTool string,
) string {
	wire := executionPayloadWireForHTTPTest(
		runID,
		conversationID,
		"学生请假手续是什么？",
		map[string]any{
			"actor":         map[string]any{"user_id": "user-executor"},
			"authorization": map[string]any{"entitlement_groups": []string{"students"}},
		},
	)
	encodedWire, err := json.Marshal(wire)
	if err != nil {
		panic(err)
	}
	digest := sha256.Sum256(encodedWire)
	testExecutionInputs.Lock()
	testExecutionInputs.values[runID] = wire
	testExecutionInputs.Unlock()
	body := map[string]any{
		"conversation_id":                conversationID,
		"request_id":                     runID,
		"owner_user_id":                  "user-executor",
		"personal_memory_recall_allowed": false,
		"surface":                        "campus-web",
		"runtime_versions": map[string]any{
			"contract": "durable-agent-runtime-contract-v1",
		},
		"metadata": map[string]any{
			"execution_contract_version": "tool_execution_v6",
			"execution_input_ref":        "app-api://execution-inputs/" + runID,
			"execution_input_sha256":     hex.EncodeToString(digest[:]),
		},
	}
	if requestedTool != "" {
		body["metadata"].(map[string]any)["requested_tool"] = requestedTool
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
	agentRequest map[string]any,
) {
	t.Helper()
	userGoal := "hello"
	if agentRequest != nil {
		if payload, ok := agentRequest["payload"].(map[string]any); ok {
			userGoal = firstNonEmptyText(payload["query_text"], userGoal)
		}
	}
	metadata := v3ExecutionMetadataForHTTPTest(runID)
	contextProjection := map[string]any{
		"actor":         map[string]any{"user_id": "user-executor"},
		"authorization": map[string]any{"entitlement_groups": []string{"students"}},
		"conversation": map[string]any{
			"current_user_message": map[string]any{
				"created_at": now.UTC().Format(time.RFC3339),
			},
		},
	}
	wire := executionPayloadWireForHTTPTest(
		runID,
		conversationID,
		userGoal,
		contextProjection,
	)
	encodedWire, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("encode test execution input: %v", err)
	}
	digest := sha256.Sum256(encodedWire)
	metadata["execution_input_sha256"] = hex.EncodeToString(digest[:])
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RequestID:      runID,
		ConversationID: conversationID,
		OwnerUserID:    "user-executor",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow.v3",
		Status:         execution.DurableRunStatusCreated,
		CreatedAt:      now,
		Metadata:       metadata,
	}); err != nil {
		t.Fatalf("create run projection: %v", err)
	}
	registerTestExecutionInput(t, store, execution.DurableRun{RequestID: runID}, wire)
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

func testExecutionInputForRun(t *testing.T, runID string) contracts.ExecutionPayloadWire {
	t.Helper()
	testExecutionInputs.RLock()
	wire, ok := testExecutionInputs.values[runID]
	testExecutionInputs.RUnlock()
	if !ok {
		t.Fatalf("test execution input %s not found", runID)
	}
	return wire
}

func registerTestExecutionInput(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	run execution.DurableRun,
	wire contracts.ExecutionPayloadWire,
) {
	t.Helper()
	encoded, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("encode test execution input: %v", err)
	}
	digest := sha256.Sum256(encoded)
	testExecutionInputs.Lock()
	testExecutionInputs.values[run.RequestID] = wire
	testExecutionInputs.Unlock()
	latest, err := store.GetRun(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("get run for execution input registration: %v", err)
	}
	metadata := cloneAnyMapFromMetadata(latest.Metadata)
	metadata["execution_input_sha256"] = hex.EncodeToString(digest[:])
	if err := store.ReplaceRunMetadata(context.Background(), run.RequestID, metadata); err != nil {
		t.Fatalf("update execution input digest: %v", err)
	}
}

func agentRequestForDurableWorkerTest(queryText string) map[string]any {
	return map[string]any{
		"payload": map[string]any{"query_text": queryText},
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
