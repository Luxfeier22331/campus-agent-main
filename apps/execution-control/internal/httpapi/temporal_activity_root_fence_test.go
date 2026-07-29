package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

const (
	temporalActivityTestWorkflowID = "default-test-workflow-id"
	temporalActivityTestRunID      = "default-test-run-id"
)

type temporalActivityRootFenceProbe struct {
	server          *Server
	allowSuperseded bool
}

func (p *temporalActivityRootFenceProbe) Execute(ctx context.Context, runID string) error {
	return p.server.ensureTemporalActivityOwnsRootExecution(ctx, runID, p.allowSuperseded)
}

type temporalActivityRootFenceIntentStore struct {
	*execution.InMemoryRunProjectionStore
	intent execution.WorkflowStartIntent
}

func (s *temporalActivityRootFenceIntentStore) GetWorkflowStartIntent(
	_ context.Context,
	_ string,
) (execution.WorkflowStartIntent, error) {
	return s.intent, nil
}

func TestTemporalActivityRootFenceAcceptsConfirmedRootExecution(t *testing.T) {
	store, intent := createTemporalActivityRootFenceIntentForTest(t, "run-root-match")
	confirmTemporalActivityRootFenceIntentForTest(t, store, intent, temporalActivityTestRunID)
	server := &Server{runProjectionStore: store}

	if err := executeTemporalActivityRootFenceProbe(t, server, intent.RunID, false); err != nil {
		t.Fatalf("root execution fence error: %v", err)
	}
}

func TestTemporalActivityRootFenceRetriesUntilRootBindingIsConfirmed(t *testing.T) {
	store, intent := createTemporalActivityRootFenceIntentForTest(t, "run-root-pending")
	server := &Server{runProjectionStore: store}

	err := executeTemporalActivityRootFenceProbe(t, server, intent.RunID, false)
	assertTemporalActivityRootFenceError(
		t,
		err,
		"temporal_execution_binding_pending",
		false,
	)
}

func TestTemporalActivityRootFenceRejectsResetSuccessorRunID(t *testing.T) {
	store, intent := createTemporalActivityRootFenceIntentForTest(t, "run-root-reset")
	confirmTemporalActivityRootFenceIntentForTest(t, store, intent, "original-root-run-id")
	server := &Server{runProjectionStore: store}

	err := executeTemporalActivityRootFenceProbe(t, server, intent.RunID, false)
	assertTemporalActivityRootFenceError(
		t,
		err,
		"temporal_execution_binding_mismatch",
		true,
	)
}

func TestTemporalActivityRootFenceAllowsOnlyCancellationForSupersededStart(t *testing.T) {
	store, intent := createTemporalActivityRootFenceIntentForTest(t, "run-root-superseded")
	leased := leaseTemporalActivityRootFenceIntentForTest(t, store, intent)
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), execution.WorkflowStartIntentResult{
		RunID:      intent.RunID,
		LeaseToken: leased.LeaseToken,
		Now:        intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatalf("mark workflow start dispatch: %v", err)
	}
	if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RunID:  intent.RunID,
		Reason: "user_requested",
		Now:    intent.CreatedAt.Add(2 * time.Second),
	}); err != nil {
		t.Fatalf("request run cancellation: %v", err)
	}
	superseded, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil {
		t.Fatalf("get superseded workflow start intent: %v", err)
	}
	if superseded.State != execution.LifecycleIntentStateSuperseded {
		t.Fatalf("workflow start state = %q, want superseded", superseded.State)
	}
	superseded.TemporalRunID = temporalActivityTestRunID
	server := &Server{runProjectionStore: &temporalActivityRootFenceIntentStore{
		InMemoryRunProjectionStore: store,
		intent:                     superseded,
	}}

	err = executeTemporalActivityRootFenceProbe(t, server, intent.RunID, false)
	assertTemporalActivityRootFenceError(
		t,
		err,
		"temporal_execution_cancellation_pending",
		false,
	)
	if err := executeTemporalActivityRootFenceProbe(t, server, intent.RunID, true); err != nil {
		t.Fatalf("cancellation finalizer root fence error: %v", err)
	}
}

func executeTemporalActivityRootFenceProbe(
	t *testing.T,
	server *Server,
	runID string,
	allowSuperseded bool,
) error {
	t.Helper()
	probe := &temporalActivityRootFenceProbe{server: server, allowSuperseded: allowSuperseded}
	env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
	env.RegisterActivity(probe.Execute)
	_, err := env.ExecuteActivity(probe.Execute, runID)
	return err
}

func assertTemporalActivityRootFenceError(
	t *testing.T,
	err error,
	wantType string,
	wantNonRetryable bool,
) {
	t.Helper()
	var applicationError *temporal.ApplicationError
	if !errors.As(err, &applicationError) {
		t.Fatalf("root fence error = %v, want Temporal application error", err)
	}
	if applicationError.Type() != wantType || applicationError.NonRetryable() != wantNonRetryable {
		t.Fatalf(
			"root fence error type=%q non_retryable=%t, want type=%q non_retryable=%t",
			applicationError.Type(),
			applicationError.NonRetryable(),
			wantType,
			wantNonRetryable,
		)
	}
}

func createTemporalActivityRootFenceIntentForTest(
	t *testing.T,
	runID string,
) (*execution.InMemoryRunProjectionStore, execution.WorkflowStartIntent) {
	t.Helper()
	now := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	conversationID := "conversation-" + runID
	payloadSHA256 := strings.Repeat("b", 64)
	store := execution.NewInMemoryRunProjectionStore()
	request := execution.DurableRunCreateIntent{
		Run: execution.DurableRun{
			RunID: runID, ConversationID: conversationID, TurnID: "turn-" + runID,
			RequestID: "request-" + runID, TraceID: "trace-" + runID,
			OwnerUserID: "user-root-fence", Surface: "campus-web",
			TaskQueue: temporalruntime.WorkflowTaskQueue,
			Status:    execution.DurableRunStatusCreated,
			CreatedAt: now, UpdatedAt: now,
			Metadata: map[string]any{
				"execution_contract_version": "tool_execution_v5",
				"execution_input_ref":        "app-api://execution-inputs/" + runID,
				"execution_input_sha256":     payloadSHA256,
			},
		},
		RequestFingerprintSHA256: strings.Repeat("a", 64),
		WorkflowID:               temporalActivityTestWorkflowID,
		PayloadSHA256:            payloadSHA256,
		TaskQueue:                temporalruntime.WorkflowTaskQueue,
		WorkflowInputJSON:        json.RawMessage(`{"run_id":"` + runID + `"}`),
		CreatedEvent: execution.DurableRunEvent{
			EventID: runID + ":run-created", RunID: runID, ConversationID: conversationID,
			EventType: execution.DurableRunEventTypeRunCreated, OccurredAt: now,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": "created"},
		},
	}
	if _, err := store.CreateRunWithStartIntent(context.Background(), request); err != nil {
		t.Fatalf("create run with workflow start intent: %v", err)
	}
	intent, err := store.GetWorkflowStartIntent(context.Background(), runID)
	if err != nil {
		t.Fatalf("get workflow start intent: %v", err)
	}
	return store, intent
}

func leaseTemporalActivityRootFenceIntentForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	intent execution.WorkflowStartIntent,
) execution.WorkflowStartIntent {
	t.Helper()
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "root-fence-lease",
		Now:        intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute),
		Limit:      1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease workflow start intent = %#v, err=%v", leased, err)
	}
	return leased[0]
}

func confirmTemporalActivityRootFenceIntentForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	intent execution.WorkflowStartIntent,
	temporalRunID string,
) {
	t.Helper()
	leased := leaseTemporalActivityRootFenceIntentForTest(t, store, intent)
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), execution.WorkflowStartIntentResult{
		RunID:      intent.RunID,
		LeaseToken: leased.LeaseToken,
		Now:        intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatalf("mark workflow start dispatch: %v", err)
	}
	if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RunID:         intent.RunID,
		LeaseToken:    leased.LeaseToken,
		TemporalRunID: temporalRunID,
		Now:           intent.CreatedAt.Add(2 * time.Second),
	}); err != nil {
		t.Fatalf("confirm workflow start intent: %v", err)
	}
}
