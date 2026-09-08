package temporaladapter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const (
	campusSearchToolName         = string(contracts.ToolIDCampusSearch)
	personalMemoryRecallToolName = string(contracts.ToolIDPersonalMemoryRecall)
	modelTargetSHA256ForTest     = "4b20ab70a9ac22073110f59ea007f27de19d731319b62ed4bd60b11d057c6635"
)

var temporalTestExecutionInputs = struct {
	sync.RWMutex
	values map[string]contracts.ExecutionPayloadWire
}{values: map[string]contracts.ExecutionPayloadWire{}}

func newAdapterForTest(cfg config.Config) *Adapter {
	return New(Options{
		Config:                cfg,
		AgentRuntimeClient:    outboundadapter.NewAgentRuntimeClient(cfg),
		ProductCallbackClient: outboundadapter.NewProductCallbackClient(cfg),
	})
}

func newWorkerAuthAdapterForTest() *Adapter {
	return newAdapterForTest(config.Config{AppAPIExecutionSharedSecret: "secret"})
}

type staticModelTargetResolver struct {
	targetSHA256 string
	err          error
}

func (resolver staticModelTargetResolver) ResolveModelTarget(
	_ context.Context,
) (execution.ModelTarget, error) {
	if resolver.err != nil {
		return execution.ModelTarget{}, resolver.err
	}
	if resolver.targetSHA256 == "" {
		return execution.ModelTarget{}, fmt.Errorf("workflow model target is missing")
	}
	return execution.ModelTarget{TargetSHA256: resolver.targetSHA256, HostedWebSearch: true}, nil
}

func attachAgentAdmissionProviderConfigsForTest(adapter *Adapter) {
	adapter.admissionService = executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		AgentDeadlineMS:       adapter.config.AgentRuntimeDeadlineMS,
		ContextCharLimit:      adapter.config.AgentRuntimeContextCharLimit,
		CurrentInputCharLimit: adapter.config.AgentRuntimeInputCharLimit,
		MaxOutputTokens:       adapter.config.AgentRuntimeMaxOutputTokens,
		ModelTargetResolver: staticModelTargetResolver{
			targetSHA256: modelTargetSHA256ForTest,
		},
	})
}

func admissionSnapshotForTest(
	t *testing.T,
	personalMemoryRecallAvailable bool,
) execution.AgentAdmissionSnapshot {
	t.Helper()
	service := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ModelTargetResolver: staticModelTargetResolver{
			targetSHA256: modelTargetSHA256ForTest,
		},
	})
	snapshot, err := service.BuildAgentAdmissionSnapshot(t.Context(), personalMemoryRecallAvailable)
	if err != nil {
		t.Fatalf("build agent admission snapshot: %v", err)
	}
	return snapshot
}

func writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}

func v3ExecutionMetadataForTemporalTest(requestID string) map[string]any {
	return map[string]any{
		"execution_contract_version": contracts.ExecutionContractVersion,
		"execution_input_ref":        "app-api://execution-inputs/" + requestID,
		"execution_input_sha256":     strings.Repeat("a", 64),
	}
}

type temporalTestExecutionInputLoader struct{}

func (temporalTestExecutionInputLoader) Load(
	_ context.Context,
	run execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	temporalTestExecutionInputs.RLock()
	wire, ok := temporalTestExecutionInputs.values[run.RequestID]
	temporalTestExecutionInputs.RUnlock()
	if !ok {
		return contracts.ExecutionPayloadWire{}, fmt.Errorf("test execution input %s not found", run.RequestID)
	}
	return wire, nil
}

func executionPayloadWireForTemporalTest(
	requestID string,
	conversationID string,
	userGoal string,
	contextProjection map[string]any,
) contracts.ExecutionPayloadWire {
	return contracts.ExecutionPayloadWire{
		ExecutionContractVersion: contracts.ExecutionContractVersion,
		ResponseContract:         contracts.ResponseContract,
		UserGoal:                 userGoal,
		ConversationID:           conversationID,
		RequestID:                requestID,
		Context:                  execution.CloneAnyMap(contextProjection),
	}
}

func attachRunProjectionStoreForAdapterTest(
	adapter *Adapter,
	store execution.RunProjectionStore,
) {
	adapter.runProjectionStore = store
	adapter.executionInputLoader = temporalTestExecutionInputLoader{}
	adapter.productFinalizationWriter = func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
		return nil
	}
}

func createQueuedDurableRunForTest(
	t *testing.T,
	store *executionpersistence.InMemoryRunProjectionStore,
	runID string,
	conversationID string,
	now time.Time,
	agentRequest map[string]any,
) {
	t.Helper()
	userGoal := "hello"
	if agentRequest != nil {
		if payload, ok := agentRequest["payload"].(map[string]any); ok {
			userGoal = execution.FirstNonEmptyText(payload["query_text"], userGoal)
		}
	}
	metadata := v3ExecutionMetadataForTemporalTest(runID)
	contextProjection := map[string]any{
		"actor":         map[string]any{"user_id": "user-executor"},
		"authorization": map[string]any{"entitlement_groups": []string{"students"}},
		"conversation": map[string]any{
			"current_user_message": map[string]any{
				"created_at": now.UTC().Format(time.RFC3339),
			},
		},
	}
	wire := executionPayloadWireForTemporalTest(runID, conversationID, userGoal, contextProjection)
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
		TaskQueue:      temporalruntime.WorkflowTaskQueue,
		Status:         execution.DurableRunStatusCreated,
		CreatedAt:      now,
		Metadata:       metadata,
	}); err != nil {
		t.Fatalf("create run projection: %v", err)
	}
	registerTestExecutionInputForTemporalAdapter(t, store, execution.DurableRun{RequestID: runID}, wire)
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

func registerTestExecutionInputForTemporalAdapter(
	t *testing.T,
	store *executionpersistence.InMemoryRunProjectionStore,
	run execution.DurableRun,
	wire contracts.ExecutionPayloadWire,
) {
	t.Helper()
	encoded, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("encode test execution input: %v", err)
	}
	digest := sha256.Sum256(encoded)
	temporalTestExecutionInputs.Lock()
	temporalTestExecutionInputs.values[run.RequestID] = wire
	temporalTestExecutionInputs.Unlock()
	latest, err := store.GetRun(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("get run for execution input registration: %v", err)
	}
	metadata := execution.CloneAnyMap(latest.Metadata)
	metadata["execution_input_sha256"] = hex.EncodeToString(digest[:])
	if err := store.ReplaceRunMetadata(context.Background(), run.RequestID, metadata); err != nil {
		t.Fatalf("update execution input digest: %v", err)
	}
}

func setExecutionPayloadConversationContextForRunTest(
	t *testing.T,
	store *executionpersistence.InMemoryRunProjectionStore,
	runID string,
	conversationContext map[string]any,
) {
	t.Helper()
	temporalTestExecutionInputs.RLock()
	wire, ok := temporalTestExecutionInputs.values[runID]
	temporalTestExecutionInputs.RUnlock()
	if !ok {
		t.Fatalf("test execution input %s not found", runID)
	}
	contextProjection := execution.CloneAnyMap(wire.Context)
	contextProjection["conversation"] = execution.CloneAnyMap(conversationContext)
	wire.Context = contextProjection
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	registerTestExecutionInputForTemporalAdapter(t, store, run, wire)
}

func agentRequestForDurableWorkerTest(queryText string) map[string]any {
	return map[string]any{
		"payload": map[string]any{"query_text": queryText},
	}
}

func assertDurableEventTypes(
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
			t.Fatalf("new finalization path emitted legacy browser event: %#v", event)
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

type fakePersonalMemoryExecutor struct {
	appendErr     error
	appendDelay   time.Duration
	appendCount   int
	commandCount  int
	commandErr    error
	commandResult memoryruntime.PersonalMemoryCommandResult
	recallCount   int
	seenAppend    memoryruntime.AppendConversationTurnRequest
	seenRequest   memoryruntime.RecallRequest
}

func (executor *fakePersonalMemoryExecutor) ExecuteCommand(
	_ context.Context,
	request memoryruntime.PersonalMemoryCommandRequest,
) (memoryruntime.PersonalMemoryCommandResult, error) {
	executor.commandCount++
	if executor.commandErr != nil {
		return memoryruntime.PersonalMemoryCommandResult{}, executor.commandErr
	}
	if executor.commandResult.Status != "" {
		result := executor.commandResult
		if result.CommandID == "" {
			result.CommandID = request.CommandID
		}
		return result, nil
	}
	return memoryruntime.PersonalMemoryCommandResult{CommandID: request.CommandID, Status: "succeeded"}, nil
}

func (executor *fakePersonalMemoryExecutor) Recall(
	_ context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	executor.recallCount++
	executor.seenRequest = request
	return memoryruntime.RecallResult{
		ContextBlock: "用户记忆:\n相关事实:\n- 用户关注保研和培养方案。",
	}, nil
}

func (executor *fakePersonalMemoryExecutor) AppendConversationTurn(
	_ context.Context,
	request memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	executor.appendCount++
	executor.seenAppend = request
	if executor.appendDelay > 0 {
		time.Sleep(executor.appendDelay)
	}
	if executor.appendErr != nil {
		return memoryruntime.AppendConversationTurnResult{}, executor.appendErr
	}
	return memoryruntime.AppendConversationTurnResult{AppendedMessageCount: 1}, nil
}
