package runtimeapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/integration/agenttest"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"github.com/jackc/pgx/v5"
)

type testPayloadStore map[string]json.RawMessage

func (s testPayloadStore) PutRuntimePayload(_ context.Context, requestID, ref string, payload json.RawMessage) error {
	key := requestID + ":" + ref
	if previous, ok := s[key]; ok && string(previous) != string(payload) {
		return execution.ErrAgentInvocationConflict
	}
	s[key] = append(json.RawMessage{}, payload...)
	return nil
}
func (s testPayloadStore) GetRuntimePayload(_ context.Context, requestID, ref string) (json.RawMessage, error) {
	payload, ok := s[requestID+":"+ref]
	if !ok {
		return nil, pgx.ErrNoRows
	}
	return payload, nil
}

type failingProjection struct {
	executionapplication.RunStore
	fail bool
}

func (s *failingProjection) UpsertStepResult(ctx context.Context, result execution.StepResultProjection) (execution.StepResultProjection, error) {
	if s.fail {
		s.fail = false
		return execution.StepResultProjection{}, errors.New("injected projection failure")
	}
	return s.RunStore.UpsertStepResult(ctx, result)
}

type unavailableAnswerPublisher struct{}

func (unavailableAnswerPublisher) PublishAnswerDelta(context.Context, answerstream.Delta) error {
	return answerstream.ErrUnavailable
}

func TestProjectRetryPreservesReceiptAndRepairsBufferedAnswer(t *testing.T) {
	for _, offline := range []bool{false, true} {
		t.Run(fmt.Sprint("offline=", offline), func(t *testing.T) { testBufferedProject(t, offline) })
	}
}
func testBufferedProject(t *testing.T, offline bool) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	frozen := agenttest.CreateQueuedRun(t, store, "runtime-project")
	snapshot := agenttest.AdmissionSnapshot(t)
	broken := &failingProjection{RunStore: store}

	projectionOwner := &operation.RunProjectionService{Answers: store, StateWriter: store, Writer: &projection.Writer{RunProjectionStore: broken}}
	if offline {
		projectionOwner.Answers = unavailableAnswerPublisher{}
	}
	api := &Server{Store: testPayloadStore{}, Projection: projectionOwner, Input: &operation.RuntimeInputService{Projection: projectionOwner, InputReader: &executionapplication.InputReader{ExecutionInputLoader: frozen}}, Invocation: &executionapplication.RuntimeInvocationService{Receipts: store.Receipts, Runs: projectionOwner}}
	now := time.Now().UTC().Truncate(time.Microsecond)
	stageStarted := now.Add(-4 * time.Second)
	prepareCtx := projection.WithEvidence(t.Context(), projection.InvocationEvidence{Present: true, WorkflowID: "workflow", RunID: "root", ActivityID: "prepare", ActivityType: "prepareStage", Attempt: 2, TaskQueue: "model-queue", ScheduledTime: now.Add(-5 * time.Second), StartedTime: stageStarted})

	req := operation.OperationRequest{RequestID: frozen.Wire.RequestID, ConversationID: frozen.Wire.ConversationID, AdmissionSnapshot: snapshot, Operation: executioncontract.WorkflowOperationSolve, StepID: "solve.initial", StepKind: "solver", MaxSteps: 2}
	if _, err := api.handlePrepare(prepareCtx, PrepareRequest{RequestID: req.RequestID, Ref: "prepared", Operation: req}); err != nil {
		t.Fatal(err)
	}
	invocation := InvocationBeginRequest{RequestID: req.RequestID, InvocationID: "turn-0", InputSHA256: execution.HashAdmissionJSON(req)}
	if _, err := api.handleInvocationBegin(t.Context(), invocation); err != nil {
		t.Fatal(err)
	}
	completionReceipt := InvocationCompleteRequest{RequestID: invocation.RequestID, InvocationID: invocation.InvocationID, Payload: json.RawMessage(`{"answer":"hello"}`)}
	if _, err := api.handleInvocationComplete(t.Context(), completionReceipt); err != nil {
		t.Fatal(err)
	}
	toolStarted := now.Add(-2 * time.Second)
	toolCompleted := toolStarted.Add(time.Second)
	var tools []map[string]any
	for i, delay := range []time.Duration{0, 500 * time.Millisecond} {
		tools = append(tools, map[string]any{
			"tool_name": "personal_memory_recall", "invocation_id": fmt.Sprintf("recall-%d", i), "status": "completed",
			"started_at": toolStarted.Add(200 * time.Millisecond), "completed_at": toolCompleted, "duration_ms": 800,
			"result":   map[string]any{"outcome": "no_match", "memory_text": ""},
			"activity": executioncontract.ActivityMetadata{WorkflowID: "workflow", TemporalRunID: "root", ActivityID: fmt.Sprintf("tool-%d", i), ActivityType: "executeTool", ActivityAttempt: 3, TaskQueue: "tool-queue", ScheduledAt: toolStarted.Add(-delay), StartedAt: toolStarted},
		})
	}
	payload, err := json.Marshal(map[string]any{
		"request_id": req.RequestID, "operation": "solve", "status": "completed", "solve_outcome": "answer", "final_output": "hello", "terminal_reason": "operation_completed",
		"tool_contract_fingerprint": execution.ToolContractFingerprintSnapshotMap(snapshot.ToolContractFingerprint),
		"usage":                     map[string]any{"model_request_count": 1, "input_tokens": 2, "output_tokens": 3, "cached_input_tokens": 0, "usage_observed": true},
		"tool_results":              tools,
	})
	if err != nil {
		t.Fatal(err)
	}
	completion := ProjectRequest{RequestID: req.RequestID, Ref: "prepared", Payload: payload, CompletedAt: time.Now().UTC()}
	broken.fail = true
	if _, err := api.handleProject(t.Context(), completion); err == nil {
		t.Fatal("expected interrupted projection")
	}
	for range 2 {
		if _, err := api.handleProject(t.Context(), completion); err != nil {
			t.Fatal(err)
		}
	}
	receipt, err := api.handleInvocationGet(t.Context(), InvocationGetRequest(invocation))
	if err != nil || receipt.Disposition != "replay" {
		t.Fatalf("receipt = %#v, %v", receipt, err)
	}
	events, err := store.ListRunEvents(t.Context(), req.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[execution.DurableRunEventType]int{}
	for _, event := range events {
		counts[event.EventType]++
	}
	if counts["run.answer_delta"] != 0 || counts[execution.DurableRunEventTypeRunAnswerCompleted] != 1 {
		t.Fatalf("unexpected durable answer events: %v", counts)
	}
	deltas, err := store.ReadAnswerDeltas(t.Context(), req.RequestID, 0)
	wantDeltas := 1
	if offline {
		wantDeltas = 0
	}
	if err != nil || len(deltas) != wantDeltas {
		t.Fatalf("buffered answer repair duplicated/lost temporary text: %v %v", deltas, err)
	}
	attempts, err := store.ListStepAttempts(t.Context(), req.RequestID)
	if err != nil || len(attempts) != 3 {
		t.Fatalf("attempts=%#v err=%v", attempts, err)
	}
	for _, attempt := range attempts {
		if attempt.WorkflowID != "workflow" || attempt.TemporalRunID != "root" {
			t.Fatalf("lost workflow identity: %#v", attempt)
		}
		if attempt.StepID == "solve.initial" {
			if attempt.Attempt != 2 || attempt.ActivityID != "prepare" || attempt.TaskQueue != "model-queue" || !attempt.StartedAt.Equal(stageStarted) || attempt.ScheduleToStartMS != 1000 {
				t.Fatalf("lost prepare activity metadata: %#v", attempt)
			}
			continue
		}
		wantDelay := int64(0)
		if attempt.ActivityID == "tool-1" {
			wantDelay = 500
		}
		if attempt.Attempt != 3 || attempt.ActivityType != "executeTool" || attempt.TaskQueue != "tool-queue" || !attempt.StartedAt.Equal(toolStarted) || attempt.ScheduleToStartMS != wantDelay {
			t.Fatalf("lost tool activity metadata: %#v", attempt)
		}
	}
}

func TestAnswerDeltaCannotStartLifecycleOrPublishInvalidContract(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	const id = "delta-contract"
	agenttest.CreateQueuedRun(t, store, id)
	if _, err := store.TransitionRun(t.Context(), id, execution.DurableRunStatusAdmitted, "", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	run, err := store.TransitionRun(t.Context(), id, execution.DurableRunStatusRunning, "", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	service := &operation.RunProjectionService{StateWriter: store, Answers: store}
	if err := service.ProjectWorkflowAnswerDelta(t.Context(), run, id+":answer", 1, "draft"); err == nil {
		t.Fatal("delta before started must fail")
	}
	unchanged, err := store.GetRun(t.Context(), id)
	if err != nil || unchanged.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run changed: %v %v", unchanged.Status, err)
	}
	events, err := store.ListRunEvents(t.Context(), id)
	if err != nil || len(events) != 0 {
		t.Fatalf("delta changed lifecycle: %v %v", events, err)
	}
	if err := service.ProjectWorkflowAnswerStarted(t.Context(), run, id+":answer"); err != nil {
		t.Fatal(err)
	}
	run, err = store.GetRun(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		message string
		index   int
		text    string
	}{
		{id + ":answer", 0, "draft"}, {"wrong", 1, "draft"}, {id + ":answer", 1, ""},
	} {
		if err := service.ProjectWorkflowAnswerDelta(t.Context(), run, test.message, test.index, test.text); err == nil {
			t.Fatal("invalid delta accepted")
		}
	}
	deltas, err := store.ReadAnswerDeltas(t.Context(), id, 0)
	if err != nil || len(deltas) != 0 {
		t.Fatalf("invalid delta was published: %v %v", deltas, err)
	}
}
