package execution

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestInMemoryOwnerDeletionReusesCancellationAndCascadesProjection(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	store := NewInMemoryRunProjectionStore()
	request := atomicRunCreateRequestForTest(now)
	if _, err := store.CreateRunWithStartIntent(ctx, request); err != nil {
		t.Fatal(err)
	}
	requestID := request.Run.RequestID

	if _, err := store.RequestRunCancellation(ctx, DurableRunCancellationRequest{
		RequestID: requestID, Reason: "user_requested", Now: now.Add(time.Second),
	}); err != nil {
		t.Fatalf("request existing cancellation: %v", err)
	}

	store.mu.Lock()
	intent := store.workflowStartIntents[requestID]
	intent.State = LifecycleIntentStateLeased
	intent.LeaseToken = "stale-start-lease"
	intent.LeaseUntil = now.Add(time.Hour)
	store.workflowStartIntents[requestID] = intent
	store.runSteps["step-1"] = RunStepProjection{RequestID: requestID}
	store.stepAttempts["attempt-1"] = StepAttemptProjection{RequestID: requestID}
	store.stepResults["result-1"] = StepResultProjection{RequestID: requestID}
	store.agentInvocationReceipts["invocation-1"] = AgentInvocationReceipt{RequestID: requestID}
	store.mu.Unlock()

	status, err := store.BeginOwnerDeletion(ctx, request.Run.OwnerUserID, now.Add(2*time.Second))
	if err != nil {
		t.Fatalf("begin owner deletion: %v", err)
	}
	if status.State != OwnerDeletionStateDraining || status.ActiveRuns != 1 {
		t.Fatalf("begin owner deletion status = %#v", status)
	}
	if got := store.cancellationCommands[requestID].Reason; got != "user_requested" {
		t.Fatalf("existing cancellation reason = %q, want it to be reused", got)
	}
	intent = store.workflowStartIntents[requestID]
	if intent.State != LifecycleIntentStateSuperseded || intent.LeaseToken != "" || !intent.LeaseUntil.IsZero() {
		t.Fatalf("owner deletion did not re-fence existing start intent = %#v", intent)
	}
	events, err := store.ListRunEvents(ctx, requestID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("reused cancellation appended duplicate event: %#v", events)
	}

	if _, err := store.FinalizeOwnerDeletion(ctx, OwnerDeletionFinalizeRequest{
		OwnerUserID: request.Run.OwnerUserID,
		Now:         now.Add(3 * time.Second),
	}); !errors.Is(err, ErrOwnerDeletionNotDrained) {
		t.Fatalf("finalize before run drains error = %v, want ErrOwnerDeletionNotDrained", err)
	}
	if _, err := store.CancelRunProjection(ctx, DurableRunCancelRequest{
		RequestID: requestID, Reason: "user_requested", Now: now.Add(4 * time.Second),
	}); err != nil {
		t.Fatalf("observe canceled run projection: %v", err)
	}

	status, err = store.FinalizeOwnerDeletion(ctx, OwnerDeletionFinalizeRequest{
		OwnerUserID: request.Run.OwnerUserID,
		Now:         now.Add(5 * time.Second),
	})
	if err != nil {
		t.Fatalf("finalize owner deletion: %v", err)
	}
	if status.State != OwnerDeletionStateDeleted || status.ActiveRuns != 0 {
		t.Fatalf("finalize owner deletion status = %#v", status)
	}
	if _, err := store.GetRun(ctx, requestID); !errors.Is(err, ErrDurableRunNotFound) {
		t.Fatalf("deleted run lookup error = %v, want ErrDurableRunNotFound", err)
	}
	if len(store.runEvents) != 0 || len(store.runSteps) != 0 || len(store.stepAttempts) != 0 ||
		len(store.stepResults) != 0 || len(store.agentInvocationReceipts) != 0 ||
		len(store.workflowStartIntents) != 0 || len(store.cancellationCommands) != 0 {
		t.Fatalf("owner projection cascade left data: events=%d steps=%d attempts=%d results=%d invocations=%d starts=%d cancellations=%d",
			len(store.runEvents), len(store.runSteps), len(store.stepAttempts), len(store.stepResults),
			len(store.agentInvocationReceipts), len(store.workflowStartIntents), len(store.cancellationCommands))
	}
	if _, err := store.CreateRun(ctx, DurableRun{
		RequestID:      "run-after-deletion",
		ConversationID: "conv-after-deletion",
		OwnerUserID:    request.Run.OwnerUserID,
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      now.Add(6 * time.Second),
		Metadata:       executionMetadataForTest("run-after-deletion", ""),
	}); !errors.Is(err, ErrOwnerDeleted) {
		t.Fatalf("new run after owner deletion error = %v, want ErrOwnerDeleted", err)
	}
}
