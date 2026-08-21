package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"strings"
	"sync"
	"testing"
	"time"
)

type reconcilerStarterForTest struct {
	mu             sync.Mutex
	startCalls     int
	recoveryStarts int
	startRunID     string
	startErr       error
	recoveryInput  temporalruntime.ToolExecutionWorkflowInput
	cancelErr      error
	describe       temporalruntime.WorkflowExecutionInfo
	describeSeries []temporalruntime.WorkflowExecutionInfo
	describeErr    error
	describeRunIDs []string
	cancelCalls    int
	cancelInput    temporalruntime.ToolExecutionWorkflowCancelInput
	onStart        func()
}

// reconcilerStarterWithoutControlForTest models a command client that can
// start workflows but cannot bind a successful RPC to a concrete execution.

type reconcilerStarterWithoutControlForTest struct {
	delegate *reconcilerStarterForTest
}

type failingWorkflowStartExecutionBindingStore struct {
	*execution.InMemoryRunProjectionStore
	err error
}

func (s *failingWorkflowStartExecutionBindingStore) BindSupersededWorkflowStartExecution(
	context.Context,
	execution.WorkflowStartExecutionBinding,
) (execution.WorkflowStartIntent, error) {
	return execution.WorkflowStartIntent{}, s.err
}

func (f *reconcilerStarterWithoutControlForTest) StartToolExecutionWorkflow(
	ctx context.Context,
	input temporalruntime.ToolExecutionWorkflowInput,
) (string, error) {
	return f.delegate.StartToolExecutionWorkflow(ctx, input)
}

func (f *reconcilerStarterWithoutControlForTest) StartPersonalMemoryCommandWorkflow(
	ctx context.Context,
	input temporalruntime.PersonalMemoryCommandWorkflowInput,
) error {
	return f.delegate.StartPersonalMemoryCommandWorkflow(ctx, input)
}

func (f *reconcilerStarterWithoutControlForTest) CancelToolExecutionWorkflow(
	ctx context.Context,
	input temporalruntime.ToolExecutionWorkflowCancelInput,
) error {
	return f.delegate.CancelToolExecutionWorkflow(ctx, input)
}

func (f *reconcilerStarterWithoutControlForTest) CheckReadiness(
	ctx context.Context,
) temporalruntime.RuntimeReadiness {
	return f.delegate.CheckReadiness(ctx)
}

func (f *reconcilerStarterForTest) StartToolExecutionWorkflow(
	context.Context,
	temporalruntime.ToolExecutionWorkflowInput,
) (string, error) {
	f.mu.Lock()
	f.startCalls++
	temporalRunID := f.startRunID
	if temporalRunID == "" {
		temporalRunID = f.describe.RunID
	}
	err := f.startErr
	onStart := f.onStart
	f.mu.Unlock()
	if onStart != nil {
		onStart()
	}
	return temporalRunID, err
}

func (f *reconcilerStarterForTest) EnsureToolExecutionWorkflowForCancellation(
	_ context.Context,
	input temporalruntime.ToolExecutionWorkflowInput,
) (string, error) {
	f.mu.Lock()
	f.recoveryStarts++
	f.recoveryInput = input
	temporalRunID := f.startRunID
	if temporalRunID == "" {
		temporalRunID = f.describe.RunID
	}
	err := f.startErr
	onStart := f.onStart
	f.mu.Unlock()
	if onStart != nil {
		onStart()
	}
	return temporalRunID, err
}

func (f *reconcilerStarterForTest) StartPersonalMemoryCommandWorkflow(
	context.Context,
	temporalruntime.PersonalMemoryCommandWorkflowInput,
) error {
	return nil
}

func (f *reconcilerStarterForTest) CancelToolExecutionWorkflow(
	_ context.Context,
	input temporalruntime.ToolExecutionWorkflowCancelInput,
) error {
	f.mu.Lock()
	f.cancelCalls++
	f.cancelInput = input
	f.mu.Unlock()
	return f.cancelErr
}

func (f *reconcilerStarterForTest) CheckReadiness(context.Context) temporalruntime.RuntimeReadiness {
	return temporalruntime.RuntimeReadiness{Healthy: true}
}

func (f *reconcilerStarterForTest) DescribeToolExecutionWorkflow(
	_ context.Context,
	_ string,
	temporalRunID string,
) (temporalruntime.WorkflowExecutionInfo, error) {
	f.mu.Lock()
	describeIndex := len(f.describeRunIDs)
	f.describeRunIDs = append(f.describeRunIDs, temporalRunID)
	info := f.describe
	if describeIndex < len(f.describeSeries) {
		info = f.describeSeries[describeIndex]
	}
	err := f.describeErr
	f.mu.Unlock()
	return info, err
}

func (f *reconcilerStarterForTest) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.startCalls
}

func (f *reconcilerStarterForTest) cancellations() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cancelCalls
}

func (f *reconcilerStarterForTest) recoveryCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.recoveryStarts
}

func (f *reconcilerStarterForTest) cancellationRecoveryInput() temporalruntime.ToolExecutionWorkflowInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.recoveryInput
}

func (f *reconcilerStarterForTest) cancellationInput() temporalruntime.ToolExecutionWorkflowCancelInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cancelInput
}

func (f *reconcilerStarterForTest) describedTemporalRunIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.describeRunIDs...)
}

type failWorkflowStartIntentOnceStore struct {
	*execution.InMemoryRunProjectionStore
	failed bool
}

func (s *failWorkflowStartIntentOnceStore) FailWorkflowStartIntent(
	ctx context.Context,
	result execution.WorkflowStartIntentResult,
) error {
	if !s.failed {
		s.failed = true
		return errors.New("workflow start retirement unavailable")
	}
	return s.InMemoryRunProjectionStore.FailWorkflowStartIntent(ctx, result)
}

type pagedActiveWorkflowStore struct {
	execution.RunProjectionStore
	bindings []execution.ActiveWorkflowRun
	cursors  []string
}

func (s *pagedActiveWorkflowStore) ListActiveWorkflowRuns(
	_ context.Context,
	afterRunID string,
	limit int,
) ([]execution.ActiveWorkflowRun, error) {
	s.cursors = append(s.cursors, afterRunID)
	page := make([]execution.ActiveWorkflowRun, 0, limit)
	for _, binding := range s.bindings {
		if binding.Run.RunID <= afterRunID {
			continue
		}
		page = append(page, binding)
		if len(page) == limit {
			break
		}
	}
	return page, nil
}

type noOpExecutionInputLoader struct{}

func (noOpExecutionInputLoader) Load(context.Context, execution.DurableRun) (contracts.ExecutionPayloadWire, error) {
	return contracts.ExecutionPayloadWire{}, errors.New("not used")
}

type failingGetRunProjectionStore struct {
	execution.RunProjectionStore
	err error
}

func (s failingGetRunProjectionStore) GetRun(context.Context, string) (execution.DurableRun, error) {
	return execution.DurableRun{}, s.err
}

type failingAfterFirstGetRunProjectionStore struct {
	execution.RunProjectionStore
	err   error
	reads int
}

func (s *failingAfterFirstGetRunProjectionStore) GetRun(
	ctx context.Context,
	runID string,
) (execution.DurableRun, error) {
	s.reads++
	if s.reads > 1 {
		return execution.DurableRun{}, s.err
	}
	return s.RunProjectionStore.GetRun(ctx, runID)
}

type terminalOnCancellationRecheckStore struct {
	execution.RunProjectionStore
	reads int
}

func (s *terminalOnCancellationRecheckStore) GetRun(
	ctx context.Context,
	runID string,
) (execution.DurableRun, error) {
	run, err := s.RunProjectionStore.GetRun(ctx, runID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	s.reads++
	if s.reads > 1 {
		run.Status = execution.DurableRunStatusCompleted
		run.TerminalReason = execution.DurableTerminalReasonAnswerCompleted
		run.CompletedAt = lifecycleNow()
	}
	return run, nil
}

func confirmAndStartReconcilerRunForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	intent execution.WorkflowStartIntent,
	temporalRunID string,
) time.Time {
	t.Helper()
	ctx := context.Background()
	leased, err := store.LeaseWorkflowStartIntents(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: "confirm-running-workflow",
		Now:        intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute),
		Limit:      1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease workflow start intent = %#v, err=%v", leased, err)
	}
	markReconcilerStartDispatchForTest(t, store, leased[0], intent.CreatedAt)
	queuedAt := intent.CreatedAt.Add(time.Second)
	if err := store.ConfirmWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: leased[0].LeaseToken, TemporalRunID: temporalRunID, Now: queuedAt,
	}); err != nil {
		t.Fatalf("confirm workflow start intent: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		intent.RunID,
		execution.DurableRunStatusAdmitted,
		"",
		queuedAt.Add(time.Second),
	); err != nil {
		t.Fatalf("admit reconciler run: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		intent.RunID,
		execution.DurableRunStatusRunning,
		"",
		queuedAt.Add(2*time.Second),
	); err != nil {
		t.Fatalf("start reconciler run: %v", err)
	}
	return queuedAt.Add(3 * time.Second)
}

func requestAndLeaseReconcilerCancellationForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	now time.Time,
	leaseToken string,
) execution.RunCancellationCommand {
	t.Helper()
	ctx := context.Background()
	if _, err := store.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RunID: runID, Reason: "user_requested", Now: now,
	}); err != nil {
		t.Fatalf("request run cancellation: %v", err)
	}
	commands, err := store.LeaseRunCancellationCommands(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: leaseToken, Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("lease cancellation command = %#v, err=%v", commands, err)
	}
	return commands[0]
}

func assertReconcilerCancellationConfirmedForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	now time.Time,
) {
	t.Helper()
	commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "assert-cancellation-confirmed-" + runID,
		Now:        now.Add(2 * time.Minute),
		LeaseUntil: now.Add(3 * time.Minute),
		Limit:      1,
	})
	if err != nil || len(commands) != 0 {
		t.Fatalf("confirmed cancellation command re-leased = %#v, err=%v", commands, err)
	}
}

func createReconcilerStartIntentForTest(t *testing.T) (*execution.InMemoryRunProjectionStore, execution.WorkflowStartIntent) {
	t.Helper()
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Now().UTC().Truncate(time.Microsecond).Add(-time.Minute)
	runID := "run-reconciler-test"
	conversationID := "conversation-reconciler-test"
	payloadHash := strings.Repeat("a", 64)
	server := NewServer(config.Config{})
	attachAgentAdmissionProviderConfigsForTest(server)
	snapshot, err := server.buildAgentAdmissionSnapshot(t.Context(), false)
	if err != nil {
		t.Fatalf("build reconciler admission snapshot: %v", err)
	}
	input := temporalruntime.ToolExecutionWorkflowInput{
		AdmissionSnapshot:       snapshot,
		AdmissionSnapshotSHA256: sha256JSONRef(snapshot),
		ConversationID:          conversationID,
		PayloadSHA256:           payloadHash,
		RequestID:               "request-reconciler-test",
		RunID:                   runID,
		TaskQueue:               temporalruntime.WorkflowTaskQueue,
		TraceID:                 "trace-reconciler-test",
		TurnID:                  "turn-reconciler-test",
		WorkflowID:              "campus-agent.chat." + runID,
	}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	request := execution.DurableRunCreateIntent{
		Run: execution.DurableRun{
			RunID: runID, ConversationID: conversationID, TurnID: input.TurnID,
			RequestID: input.RequestID, TraceID: input.TraceID, OwnerUserID: "user-reconciler-test",
			Surface: "campus-web", TaskQueue: temporalruntime.WorkflowTaskQueue,
			Status: execution.DurableRunStatusCreated, CreatedAt: now, UpdatedAt: now,
			Metadata: map[string]any{
				"execution_contract_version": "tool_execution_v5",
				"execution_input_ref":        "app-api://execution-inputs/" + runID,
				"execution_input_sha256":     payloadHash,
			},
		},
		RequestFingerprintSHA256: strings.Repeat("b", 64),
		WorkflowID:               input.WorkflowID,
		PayloadSHA256:            payloadHash,
		TaskQueue:                input.TaskQueue,
		WorkflowInputJSON:        inputJSON,
		CreatedEvent: execution.DurableRunEvent{
			EventID: "run-reconciler-test:run-created", RunID: runID, ConversationID: conversationID,
			EventType: execution.DurableRunEventTypeRunCreated, OccurredAt: now,
			Visibility: execution.DurableRunEventVisibilityInternal, PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{"status": "created"},
		},
	}
	if _, err := store.CreateRunWithStartIntent(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	created, err := store.GetWorkflowStartIntent(context.Background(), runID)
	if err != nil {
		t.Fatal(err)
	}
	return store, created
}

func reconcilerWorkflowInfoForIntent(
	t *testing.T,
	intent execution.WorkflowStartIntent,
	temporalRunID string,
) temporalruntime.WorkflowExecutionInfo {
	t.Helper()
	var input temporalruntime.ToolExecutionWorkflowInput
	if err := json.Unmarshal(intent.WorkflowInputJSON, &input); err != nil {
		t.Fatal(err)
	}
	identity, err := temporalruntime.ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	return temporalruntime.WorkflowExecutionInfo{
		Found: true, WorkflowID: input.WorkflowID, RunID: temporalRunID, FirstRunID: temporalRunID,
		ResetStateKnown: true,
		IdentityState:   temporalruntime.WorkflowIdentityKnown,
		Identity:        identity,
	}
}

func markReconcilerStartDispatchForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	intent execution.WorkflowStartIntent,
	now time.Time,
) {
	t.Helper()
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, Now: now,
	}); err != nil {
		t.Fatal(err)
	}
}

func mustListRunEvents(
	t *testing.T,
	store execution.RunProjectionStore,
	runID string,
) []execution.DurableRunEvent {
	t.Helper()
	events, err := store.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatal(err)
	}
	return events
}

var _ temporalruntime.WorkflowControl = (*reconcilerStarterForTest)(nil)

var _ temporalruntime.ChatWorkflowStarter = (*reconcilerStarterWithoutControlForTest)(nil)
