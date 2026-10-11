package executionreconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	temporaladapter "github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/adaptertest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolcontract"
)

const (
	campusSearchToolName         = string(contracts.ToolIDCampusSearch)
	personalMemoryRecallToolName = string(contracts.ToolIDPersonalMemoryRecall)

	workflowStartNotDispatchedFailure       = WorkflowStartNotDispatchedFailure
	workflowStartPostDispatchFailure        = WorkflowStartPostDispatchFailure
	workflowStartRemoteConflictFailure      = WorkflowStartRemoteConflictFailure
	workflowExecutionTerminatedFailure      = WorkflowExecutionTerminatedFailure
	workflowCompletedUnprojectedFailure     = WorkflowCompletedUnprojectedFailure
	workflowFailedUnprojectedFailure        = WorkflowFailedUnprojectedFailure
	workflowCanceledUnprojectedFailure      = WorkflowCanceledUnprojectedFailure
	workflowExecutionClosedInvariantFailure = WorkflowExecutionClosedInvariantFailure
)

const primaryAgentModelTargetSHA256ForTest = "4b20ab70a9ac22073110f59ea007f27de19d731319b62ed4bd60b11d057c6635"

type staticModelTargetResolver struct {
	targetSHA256 string
	err          error
}

func (resolver staticModelTargetResolver) ResolveModelTarget(
	context.Context,
) (execution.ModelTarget, error) {
	if resolver.err != nil {
		return execution.ModelTarget{}, resolver.err
	}
	return execution.ModelTarget{TargetSHA256: resolver.targetSHA256, HostedWebSearch: true}, nil
}

type reconcilerTestHarness struct {
	adapter                   *temporaladapter.Adapter
	reconciler                *Reconciler
	productFinalizationWriter temporaladapter.ProductFinalizationWriter
}

func newReconcilerTestHarness(
	cfg config.Config,
	store executionapplication.RunStore,
	starter executionapplication.WorkflowStarter,
) *reconcilerTestHarness {
	harness := &reconcilerTestHarness{}
	admissionService := newAdmissionServiceForReconcilerTest()
	harness.adapter = temporaladapter.New(temporaladapter.Options{
		Config:               cfg,
		AdmissionService:     admissionService,
		ExecutionInputLoader: noOpExecutionInputLoader{},
		ProductFinalizationWriter: func(
			ctx context.Context,
			run execution.DurableRun,
			completedAt time.Time,
			response map[string]any,
		) error {
			if harness.productFinalizationWriter == nil {
				return nil
			}
			return harness.productFinalizationWriter(ctx, run, completedAt, response)
		},
		RunProjectionStore: store,
	})
	harness.reconciler = New(Options{
		Finalizer:        harness.adapter.FinalizationAdapter,
		OperationTimeout: time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		Starter:          starter,
		Store:            store,
	})
	return harness
}

func newReconcilerForTest(
	cfg config.Config,
	store executionapplication.RunStore,
	starter executionapplication.WorkflowStarter,
	writer temporaladapter.ProductFinalizationWriter,
) *Reconciler {
	harness := newReconcilerTestHarness(cfg, store, starter)
	harness.productFinalizationWriter = writer
	return harness.reconciler
}

func newAdmissionServiceForReconcilerTest() *executionapplication.AdmissionService {
	return executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ToolContract: toolcontract.Files{},
		ModelTargetResolver: staticModelTargetResolver{
			targetSHA256: primaryAgentModelTargetSHA256ForTest,
		},
	})
}

func temporalProjectionRef(runID string, suffix string) string {
	return "projection://runs/" + strings.TrimSpace(runID) + "/" + strings.TrimSpace(suffix)
}

func temporalStepAttemptID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":attempt-" + fmt.Sprint(attempt)
}

func temporalStepResultID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":result-" + fmt.Sprint(attempt)
}

func storeFinalizationCompletionProofForTest(
	t *testing.T,
	store executionapplication.RunStore,
	runID string,
	projectionRef string,
	createdAt time.Time,
) {
	t.Helper()
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             temporalStepResultID(runID, "finalization.write", 1),
		StepID:               "finalization.write",
		RequestID:            runID,
		AttemptID:            temporalStepAttemptID(runID, "finalization.write", 1),
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        projectionRef,
		CreatedAt:            createdAt,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"activity_attempt": 1},
	}); err != nil {
		t.Fatalf("store finalization completion proof: %v", err)
	}
}

type reconcilerStarterForTest struct {
	mu             sync.Mutex
	startCalls     int
	recoveryStarts int
	startRunID     string
	startErr       error
	recoveryInput  execution.WorkflowStartInput
	cancelErr      error
	describe       execution.WorkflowExecutionInfo
	describeSeries []execution.WorkflowExecutionInfo
	describeErr    error
	describeRunIDs []string
	cancelCalls    int
	cancelInput    execution.WorkflowCancelInput
	onStart        func()
	onDescribe     func(string)
}

// reconcilerStarterWithoutControlForTest models a command client that can
// start workflows but cannot bind a successful RPC to a concrete execution.

type reconcilerStarterWithoutControlForTest struct {
	delegate *reconcilerStarterForTest
}

type failingWorkflowStartExecutionBindingStore struct {
	*executionpersistence.InMemoryRunProjectionStore
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
	input execution.WorkflowStartInput,
) (string, error) {
	return f.delegate.StartToolExecutionWorkflow(ctx, input)
}

func (f *reconcilerStarterWithoutControlForTest) CancelToolExecutionWorkflow(
	ctx context.Context,
	input execution.WorkflowCancelInput,
) error {
	return f.delegate.CancelToolExecutionWorkflow(ctx, input)
}

func (f *reconcilerStarterForTest) StartToolExecutionWorkflow(
	context.Context,
	execution.WorkflowStartInput,
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
	input execution.WorkflowStartInput,
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

func (f *reconcilerStarterForTest) CancelToolExecutionWorkflow(
	_ context.Context,
	input execution.WorkflowCancelInput,
) error {
	f.mu.Lock()
	f.cancelCalls++
	f.cancelInput = input
	f.mu.Unlock()
	return f.cancelErr
}

func (f *reconcilerStarterForTest) DescribeToolExecutionWorkflow(
	_ context.Context,
	_ string,
	temporalRunID string,
) (execution.WorkflowExecutionInfo, error) {
	f.mu.Lock()
	describeIndex := len(f.describeRunIDs)
	f.describeRunIDs = append(f.describeRunIDs, temporalRunID)
	info := f.describe
	if describeIndex < len(f.describeSeries) {
		info = f.describeSeries[describeIndex]
	}
	err := f.describeErr
	onDescribe := f.onDescribe
	f.mu.Unlock()
	if onDescribe != nil {
		onDescribe(temporalRunID)
	}
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

func (f *reconcilerStarterForTest) cancellationRecoveryInput() execution.WorkflowStartInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.recoveryInput
}

func (f *reconcilerStarterForTest) cancellationInput() execution.WorkflowCancelInput {
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
	*executionpersistence.InMemoryRunProjectionStore
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
	executionapplication.RunStore
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
		if binding.Run.RequestID <= afterRunID {
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

type failingGetRunStore struct {
	executionapplication.RunStore
	err error
}

func (s failingGetRunStore) GetRun(context.Context, string) (execution.DurableRun, error) {
	return execution.DurableRun{}, s.err
}

type failingAfterFirstGetRunStore struct {
	executionapplication.RunStore
	err   error
	reads int
}

func (s *failingAfterFirstGetRunStore) GetRun(
	ctx context.Context,
	runID string,
) (execution.DurableRun, error) {
	s.reads++
	if s.reads > 1 {
		return execution.DurableRun{}, s.err
	}
	return s.RunStore.GetRun(ctx, runID)
}

type terminalOnCancellationRecheckStore struct {
	executionapplication.RunStore
	reads int
}

func (s *terminalOnCancellationRecheckStore) GetRun(
	ctx context.Context,
	runID string,
) (execution.DurableRun, error) {
	run, err := s.RunStore.GetRun(ctx, runID)
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
	store *executionpersistence.InMemoryRunProjectionStore,
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
		RequestID: intent.RequestID, LeaseToken: leased[0].LeaseToken, TemporalRunID: temporalRunID, Now: queuedAt,
	}); err != nil {
		t.Fatalf("confirm workflow start intent: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		intent.RequestID,
		execution.DurableRunStatusAdmitted,
		"",
		queuedAt.Add(time.Second),
	); err != nil {
		t.Fatalf("admit reconciler run: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		intent.RequestID,
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
	store *executionpersistence.InMemoryRunProjectionStore,
	runID string,
	now time.Time,
	leaseToken string,
) execution.RunCancellationCommand {
	t.Helper()
	ctx := context.Background()
	if _, err := store.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RequestID: runID, Reason: "user_requested", Now: now,
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
	store *executionpersistence.InMemoryRunProjectionStore,
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

func createReconcilerStartIntentForTest(t *testing.T) (*executionpersistence.InMemoryRunProjectionStore, execution.WorkflowStartIntent) {
	t.Helper()
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Now().UTC().Truncate(time.Microsecond).Add(-time.Minute)
	runID := "run-reconciler-test"
	conversationID := "conversation-reconciler-test"
	payloadHash := strings.Repeat("a", 64)
	snapshot, err := newAdmissionServiceForReconcilerTest().BuildAgentAdmissionSnapshot(t.Context(), false)
	if err != nil {
		t.Fatalf("build reconciler admission snapshot: %v", err)
	}
	input := execution.WorkflowStartInput{
		AdmissionSnapshot:       snapshot,
		AdmissionSnapshotSHA256: execution.SHA256JSONRef(snapshot),
		ConversationID:          conversationID,
		PayloadSHA256:           payloadHash,
		RequestID:               runID,
		TaskQueue:               execution.WorkflowTaskQueue,
		WorkflowID:              "campus-agent.chat." + runID,
	}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	request := execution.DurableRunCreateIntent{
		Run: execution.DurableRun{
			RequestID: runID, ConversationID: conversationID, OwnerUserID: "user-reconciler-test",
			Surface: "campus-web", TaskQueue: execution.WorkflowTaskQueue,
			Status: execution.DurableRunStatusCreated, CreatedAt: now, UpdatedAt: now,
			Metadata: map[string]any{
				"execution_contract_version": "tool_execution_v7",
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
			EventID: "run-reconciler-test:run-created", RequestID: runID, ConversationID: conversationID,
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

func lifecycleNow() time.Time {
	return LifecycleNow()
}

func reconcilerWorkflowInfoForIntent(
	t *testing.T,
	intent execution.WorkflowStartIntent,
	temporalRunID string,
) execution.WorkflowExecutionInfo {
	t.Helper()
	var input execution.WorkflowStartInput
	if err := json.Unmarshal(intent.WorkflowInputJSON, &input); err != nil {
		t.Fatal(err)
	}
	identity, err := execution.WorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	return execution.WorkflowExecutionInfo{
		Found: true, WorkflowID: input.WorkflowID, RunID: temporalRunID, FirstRunID: temporalRunID,
		ResetStateKnown: true,
		IdentityState:   execution.WorkflowIdentityKnown,
		Identity:        identity,
	}
}

func markReconcilerStartDispatchForTest(
	t *testing.T,
	store *executionpersistence.InMemoryRunProjectionStore,
	intent execution.WorkflowStartIntent,
	now time.Time,
) {
	t.Helper()
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: intent.RequestID, LeaseToken: intent.LeaseToken, Now: now,
	}); err != nil {
		t.Fatal(err)
	}
}

func mustListRunEvents(
	t *testing.T,
	store executionapplication.RunStore,
	runID string,
) []execution.DurableRunEvent {
	t.Helper()
	events, err := store.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatal(err)
	}
	return events
}

var _ executionapplication.WorkflowControl = (*reconcilerStarterForTest)(nil)

var _ executionapplication.WorkflowStarter = (*reconcilerStarterWithoutControlForTest)(nil)
