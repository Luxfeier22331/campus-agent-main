package executionpersistence

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestInMemoryFinalizeRunProjectionConcurrentCandidatesSelectOneCanonicalResult(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 24, 8, 0, 0, 123456789, time.UTC)
	run := createFinalizationCASRun(t, store, "run-finalization-race", now)
	fingerprint := strings.Repeat("a", 64)
	requests := []execution.RunProjectionFinalizeRequest{
		finalizationCASRequest(run, fingerprint, "candidate-a", now.Add(5*time.Second)),
		finalizationCASRequest(run, fingerprint, "candidate-b", now.Add(5*time.Second)),
	}

	type outcome struct {
		result execution.RunProjectionFinalizeResult
		err    error
	}
	start := make(chan struct{})
	outcomes := make(chan outcome, len(requests))
	var waitGroup sync.WaitGroup
	for _, request := range requests {
		request := request
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			result, err := store.FinalizeRunProjection(context.Background(), request)
			outcomes <- outcome{result: result, err: err}
		}()
	}
	close(start)
	waitGroup.Wait()
	close(outcomes)

	results := make([]execution.RunProjectionFinalizeResult, 0, len(requests))
	for outcome := range outcomes {
		if outcome.err != nil {
			t.Fatalf("finalize concurrent candidate: %v", outcome.err)
		}
		results = append(results, outcome.result)
	}
	if len(results) != 2 {
		t.Fatalf("finalization outcomes = %d, want 2", len(results))
	}
	if results[0].Result.ResultID != results[1].Result.ResultID ||
		results[0].Attempt.AttemptID != results[1].Attempt.AttemptID {
		t.Fatalf("concurrent callers returned different canonical records: %#v", results)
	}
	if results[0].Result.ResultID != requests[0].Result.ResultID &&
		results[0].Result.ResultID != requests[1].Result.ResultID {
		t.Fatalf("canonical result_id = %q, want one candidate", results[0].Result.ResultID)
	}

	steps, attempts, storedResults := listFinalizationCASRecords(t, store, run.RequestID)
	if len(steps) != 1 || len(attempts) != 1 || len(storedResults) != 1 {
		t.Fatalf(
			"stored finalization cardinality = steps:%d attempts:%d results:%d, want 1/1/1",
			len(steps),
			len(attempts),
			len(storedResults),
		)
	}
	if attempts[0].AttemptID != results[0].Attempt.AttemptID ||
		storedResults[0].ResultID != results[0].Result.ResultID {
		t.Fatalf("stored records differ from returned canonical records")
	}
	storedRun, err := store.GetRun(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if storedRun.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("run status = %s, want completed", storedRun.Status)
	}
}

func TestInMemoryFinalizeRunProjectionLateCandidateDoesNotMutateCanonicalState(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 24, 8, 10, 0, 234567891, time.UTC)
	run := createFinalizationCASRun(t, store, "run-finalization-late", now)
	fingerprint := strings.Repeat("b", 64)
	winner := finalizationCASRequest(run, fingerprint, "winner", now.Add(5*time.Second))
	written, err := store.FinalizeRunProjection(context.Background(), winner)
	if err != nil {
		t.Fatalf("finalize winner: %v", err)
	}
	store.cancellationCommands[run.RequestID] = execution.RunCancellationCommand{
		RequestID:     run.RequestID,
		WorkflowID:    "campus-agent.chat." + run.RequestID,
		Reason:        "stale_after_completion",
		State:         execution.LifecycleIntentStateSuperseded,
		AttemptCount:  7,
		NextAttemptAt: now.Add(time.Hour),
		LeaseToken:    "stale-completed-replay-lease",
		LeaseUntil:    now.Add(2 * time.Hour),
		LastErrorCode: "stale_completed_replay",
		CreatedAt:     now,
		UpdatedAt:     now.Add(time.Minute),
	}
	beforeCancellation := store.cancellationCommands[run.RequestID]
	beforeRun, err := store.GetRun(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("get winner run: %v", err)
	}
	beforeSteps, beforeAttempts, beforeResults := listFinalizationCASRecords(t, store, run.RequestID)
	successor := run
	successor.RequestID += "-successor"
	successor.Metadata = executionMetadataForTest(successor.RequestID, "")
	if _, err := store.CreateRun(context.Background(), successor); err != nil {
		t.Fatalf("create successor run after winner: %v", err)
	}

	late := finalizationCASRequest(run, fingerprint, "late", now.Add(5*time.Second))
	late.Step.CompletedAt = late.Step.CompletedAt.Add(2 * time.Second)
	late.Step.UpdatedAt = late.Step.CompletedAt
	late.Attempt.CompletedAt = late.Step.CompletedAt
	late.Attempt.UpdatedAt = late.Step.CompletedAt
	late.Result.CreatedAt = late.Step.CompletedAt
	replayed, err := store.FinalizeRunProjection(context.Background(), late)
	if err != nil {
		t.Fatalf("replay late candidate: %v", err)
	}
	if replayed.Result.ResultID != written.Result.ResultID ||
		replayed.Attempt.AttemptID != written.Attempt.AttemptID {
		t.Fatalf("late candidate did not receive winner records: %#v", replayed)
	}
	afterRun, err := store.GetRun(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("get replayed run: %v", err)
	}
	if !reflect.DeepEqual(afterRun, beforeRun) {
		t.Fatalf("completed run mutated on late replay\nbefore=%#v\nafter=%#v", beforeRun, afterRun)
	}
	afterSteps, afterAttempts, afterResults := listFinalizationCASRecords(t, store, run.RequestID)
	if !reflect.DeepEqual(afterSteps, beforeSteps) ||
		!reflect.DeepEqual(afterAttempts, beforeAttempts) ||
		!reflect.DeepEqual(afterResults, beforeResults) {
		t.Fatalf("canonical records mutated on late replay")
	}
	if afterCancellation := store.cancellationCommands[run.RequestID]; !reflect.DeepEqual(afterCancellation, beforeCancellation) {
		t.Fatalf(
			"completed replay inspected or mutated a stale cancellation command\nbefore=%#v\nafter=%#v",
			beforeCancellation,
			afterCancellation,
		)
	}
	if activeRunID := store.activeRunByConversation[run.ConversationID]; activeRunID != successor.RequestID {
		t.Fatalf(
			"late replay changed successor active lock = %q, want %q",
			activeRunID,
			successor.RequestID,
		)
	}
}

func TestInMemoryFinalizeRunProjectionRejectsCompletedIdentityDrift(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*execution.RunProjectionFinalizeRequest)
	}{
		{
			name: "completed at",
			mutate: func(request *execution.RunProjectionFinalizeRequest) {
				request.Completion.Now = request.Completion.Now.Add(time.Microsecond)
			},
		},
		{
			name: "terminal reason",
			mutate: func(request *execution.RunProjectionFinalizeRequest) {
				request.Completion.TerminalReason = execution.DurableTerminalReasonToolClosed
			},
		},
		{
			name: "final response ref",
			mutate: func(request *execution.RunProjectionFinalizeRequest) {
				request.Completion.FinalResponseRef += "-drift"
				request.Result.ProjectionRef = request.Completion.FinalResponseRef
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 24, 8, 15, 0, 0, time.UTC)
			run := createFinalizationCASRun(
				t,
				store,
				"run-finalization-drift-"+strings.ReplaceAll(test.name, " ", "-"),
				now,
			)
			fingerprint := strings.Repeat("2", 64)
			winner := finalizationCASRequest(run, fingerprint, "winner", now.Add(5*time.Second))
			if _, err := store.FinalizeRunProjection(context.Background(), winner); err != nil {
				t.Fatalf("finalize winner: %v", err)
			}
			beforeRun, err := store.GetRun(context.Background(), run.RequestID)
			if err != nil {
				t.Fatalf("get completed run: %v", err)
			}

			replay := finalizationCASRequest(run, fingerprint, "late", now.Add(5*time.Second))
			test.mutate(&replay)
			_, err = store.FinalizeRunProjection(context.Background(), replay)
			if !errors.Is(err, execution.ErrRunFinalizationConflict) {
				t.Fatalf("identity drift error = %v, want execution.ErrRunFinalizationConflict", err)
			}
			afterRun, getErr := store.GetRun(context.Background(), run.RequestID)
			if getErr != nil {
				t.Fatalf("get run after drift: %v", getErr)
			}
			if !reflect.DeepEqual(afterRun, beforeRun) {
				t.Fatalf("identity drift mutated completed run")
			}
		})
	}
}

func TestInMemoryFinalizeRunProjectionRepairsActiveRunFromCanonicalLegacyRecords(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 24, 8, 20, 0, 0, time.UTC)
	run := createFinalizationCASRun(t, store, "run-finalization-repair", now)
	fingerprint := strings.Repeat("c", 64)
	legacy := finalizationCASRequest(run, fingerprint, "legacy", now.Add(5*time.Second))
	seedFinalizationCASRecords(t, store, legacy)

	candidate := finalizationCASRequest(run, fingerprint, "retry", now.Add(5*time.Second))
	repaired, err := store.FinalizeRunProjection(context.Background(), candidate)
	if err != nil {
		t.Fatalf("repair active run: %v", err)
	}
	if repaired.Result.ResultID != legacy.Result.ResultID ||
		repaired.Attempt.AttemptID != legacy.Attempt.AttemptID {
		t.Fatalf("repair returned non-canonical records: %#v", repaired)
	}
	if repaired.Run.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("repaired run status = %s, want completed", repaired.Run.Status)
	}
	_, attempts, results := listFinalizationCASRecords(t, store, run.RequestID)
	if len(attempts) != 1 || len(results) != 1 {
		t.Fatalf("repair wrote retry records: attempts=%#v results=%#v", attempts, results)
	}
}

func TestInMemoryFinalizeRunProjectionFailsClosedOnAmbiguousOrIncompleteLegacyRecords(t *testing.T) {
	tests := []struct {
		name string
		seed func(*testing.T, *InMemoryRunProjectionStore, execution.RunProjectionFinalizeRequest)
	}{
		{
			name: "multiple results",
			seed: func(t *testing.T, store *InMemoryRunProjectionStore, request execution.RunProjectionFinalizeRequest) {
				seedFinalizationCASRecords(t, store, request)
				second := request
				second.Attempt.AttemptID += "-second"
				second.Attempt.Attempt = 2
				second.Result.ResultID += "-second"
				second.Result.AttemptID = second.Attempt.AttemptID
				if _, err := store.UpsertStepAttempt(context.Background(), second.Attempt); err != nil {
					t.Fatalf("seed second attempt: %v", err)
				}
				if _, err := store.UpsertStepResult(context.Background(), second.Result); err != nil {
					t.Fatalf("seed second result: %v", err)
				}
			},
		},
		{
			name: "missing step and attempt",
			seed: func(t *testing.T, store *InMemoryRunProjectionStore, request execution.RunProjectionFinalizeRequest) {
				if _, err := store.UpsertStepResult(context.Background(), request.Result); err != nil {
					t.Fatalf("seed incomplete result: %v", err)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 24, 8, 30, 0, 0, time.UTC)
			run := createFinalizationCASRun(t, store, "run-finalization-"+strings.ReplaceAll(test.name, " ", "-"), now)
			fingerprint := strings.Repeat("d", 64)
			request := finalizationCASRequest(run, fingerprint, "legacy", now.Add(5*time.Second))
			test.seed(t, store, request)

			_, err := store.FinalizeRunProjection(context.Background(), request)
			if !errors.Is(err, execution.ErrRunFinalizationConflict) {
				t.Fatalf("finalization error = %v, want execution.ErrRunFinalizationConflict", err)
			}
			storedRun, getErr := store.GetRun(context.Background(), run.RequestID)
			if getErr != nil {
				t.Fatalf("get failed-closed run: %v", getErr)
			}
			if storedRun.Status != execution.DurableRunStatusRunning {
				t.Fatalf("failed-closed run status = %s, want running", storedRun.Status)
			}
		})
	}
}

func TestInMemoryFinalizeRunProjectionRejectsFingerprintMismatchWithoutWrites(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 24, 8, 40, 0, 0, time.UTC)
	run := createFinalizationCASRun(t, store, "run-finalization-fingerprint", now)
	request := finalizationCASRequest(run, strings.Repeat("e", 64), "candidate", now.Add(5*time.Second))
	request.FinalizationFingerprintSHA256 = strings.Repeat("f", 64)

	_, err := store.FinalizeRunProjection(context.Background(), request)
	if !errors.Is(err, execution.ErrRunFinalizationConflict) {
		t.Fatalf("fingerprint mismatch error = %v, want execution.ErrRunFinalizationConflict", err)
	}
	steps, attempts, results := listFinalizationCASRecords(t, store, run.RequestID)
	if len(steps) != 0 || len(attempts) != 0 || len(results) != 0 {
		t.Fatalf("fingerprint mismatch wrote records: %#v %#v %#v", steps, attempts, results)
	}
}

func TestInMemoryProjectionIdentifiersAreGloballyUnique(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 24, 8, 45, 0, 0, time.UTC)
	firstRun := createFinalizationCASRun(t, store, "run-global-identity-first", now)
	secondRun := createFinalizationCASRun(t, store, "run-global-identity-second", now)
	first := finalizationCASRequest(firstRun, strings.Repeat("0", 64), "shared", now.Add(time.Second))

	if _, err := store.UpsertStepAttempt(context.Background(), first.Attempt); err != nil {
		t.Fatalf("seed globally unique attempt: %v", err)
	}
	duplicateAttemptID := first.Attempt
	duplicateAttemptID.RequestID = secondRun.RequestID
	if _, err := store.UpsertStepAttempt(context.Background(), duplicateAttemptID); !errors.Is(
		err,
		execution.ErrStaleStepAttemptProjection,
	) {
		t.Fatalf("cross-run duplicate attempt_id error = %v, want execution.ErrStaleStepAttemptProjection", err)
	}
	duplicateAttemptNumber := first.Attempt
	duplicateAttemptNumber.AttemptID += "-different-id"
	if _, err := store.UpsertStepAttempt(context.Background(), duplicateAttemptNumber); !errors.Is(
		err,
		execution.ErrStaleStepAttemptProjection,
	) {
		t.Fatalf("duplicate attempt tuple error = %v, want execution.ErrStaleStepAttemptProjection", err)
	}

	if _, err := store.UpsertStepResult(context.Background(), first.Result); err != nil {
		t.Fatalf("seed globally unique result: %v", err)
	}
	duplicateResultID := first.Result
	duplicateResultID.RequestID = secondRun.RequestID
	if _, err := store.UpsertStepResult(context.Background(), duplicateResultID); !errors.Is(
		err,
		execution.ErrStepResultProjectionConflict,
	) {
		t.Fatalf("cross-run duplicate result_id error = %v, want execution.ErrStepResultProjectionConflict", err)
	}
}

func TestInMemoryFinalizeRunProjectionRejectsCrossRunAttemptIdentity(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 24, 8, 47, 0, 0, time.UTC)
	run := createFinalizationCASRun(t, store, "run-finalization-cross-run-attempt", now)
	foreignRun := createFinalizationCASRun(t, store, "run-finalization-cross-run-owner", now)
	request := finalizationCASRequest(run, strings.Repeat("9", 64), "candidate", now.Add(5*time.Second))
	foreignAttempt := request.Attempt
	foreignAttempt.RequestID = foreignRun.RequestID
	if _, err := store.UpsertStepAttempt(context.Background(), foreignAttempt); err != nil {
		t.Fatalf("seed foreign attempt identity: %v", err)
	}

	_, err := store.FinalizeRunProjection(context.Background(), request)
	if !errors.Is(err, execution.ErrRunFinalizationConflict) {
		t.Fatalf("cross-run attempt finalization error = %v, want execution.ErrRunFinalizationConflict", err)
	}
	steps, attempts, results := listFinalizationCASRecords(t, store, run.RequestID)
	if len(steps) != 0 || len(attempts) != 0 || len(results) != 0 {
		t.Fatalf("cross-run attempt conflict wrote records: %#v %#v %#v", steps, attempts, results)
	}
}

func TestInMemoryFinalizeRunProjectionCompletionWinsCancellation(t *testing.T) {
	for _, state := range []execution.LifecycleIntentState{
		execution.LifecycleIntentStatePending,
		execution.LifecycleIntentStateLeased,
		execution.LifecycleIntentStateConfirmed,
		execution.LifecycleIntentStatePermanentFailed,
	} {
		t.Run(string(state), func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 24, 8, 50, 0, 0, time.UTC)
			run := createFinalizationCASRun(t, store, "run-finalization-cancel-"+string(state), now)
			if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
				RequestID: run.RequestID,
				Reason:    "user_requested",
				Now:       now.Add(2 * time.Second),
			}); err != nil {
				t.Fatalf("request cancellation: %v", err)
			}
			if state == execution.LifecycleIntentStateLeased || state == execution.LifecycleIntentStateConfirmed {
				leased, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
					LeaseToken: "lease-finalization-cancel",
					Now:        now.Add(3 * time.Second),
					LeaseUntil: now.Add(30 * time.Second),
					Limit:      1,
				})
				if err != nil || len(leased) != 1 {
					t.Fatalf("lease cancellation command: leased=%#v err=%v", leased, err)
				}
				if state == execution.LifecycleIntentStateConfirmed {
					if err := store.ConfirmRunCancellationCommand(
						context.Background(),
						execution.RunCancellationCommandResult{
							RequestID:  run.RequestID,
							LeaseToken: leased[0].LeaseToken,
							Now:        now.Add(4 * time.Second),
						},
					); err != nil {
						t.Fatalf("confirm cancellation command: %v", err)
					}
				}
			}
			if state == execution.LifecycleIntentStatePermanentFailed {
				command := store.cancellationCommands[run.RequestID]
				command.State = execution.LifecycleIntentStatePermanentFailed
				command.LastErrorCode = "cancellation_delivery_rejected"
				command.UpdatedAt = now.Add(4 * time.Second)
				store.cancellationCommands[run.RequestID] = command
			}

			request := finalizationCASRequest(
				run,
				strings.Repeat("1", 64),
				"completion-winner",
				now.Add(5*time.Second),
			)
			finalized, err := store.FinalizeRunProjection(context.Background(), request)
			if err != nil {
				t.Fatalf("finalize after cancellation request: %v", err)
			}
			if finalized.Run.Status != execution.DurableRunStatusCompleted {
				t.Fatalf("finalized run status = %s, want completed", finalized.Run.Status)
			}
			command := store.cancellationCommands[run.RequestID]
			if command.State != execution.LifecycleIntentStateConfirmed || command.LeaseToken != "" ||
				!command.LeaseUntil.IsZero() || command.LastErrorCode != execution.FinalizationCompletionWonErrorCode ||
				!command.UpdatedAt.Equal(execution.CanonicalProjectionTime(request.Completion.Now)) {
				t.Fatalf("completion did not atomically settle cancellation command: %#v", command)
			}
			if _, active := store.activeRunByConversation[run.ConversationID]; active {
				t.Fatal("completed run retained its conversation active lock")
			}
		})
	}
}

func createFinalizationCASRun(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	requestID string,
	now time.Time,
) execution.DurableRun {
	t.Helper()
	run := execution.DurableRun{
		RequestID:      requestID,
		ConversationID: "conversation-" + requestID,
		OwnerUserID:    "user-finalization-cas",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		Status:         execution.DurableRunStatusRunning,
		CreatedAt:      now.Add(-time.Minute),
		StartedAt:      now,
		UpdatedAt:      now,
		Metadata:       executionMetadataForTest(requestID, ""),
	}
	created, err := store.CreateRun(context.Background(), run)
	if err != nil {
		t.Fatalf("create finalization CAS run: %v", err)
	}
	return created
}

func finalizationCASRequest(
	run execution.DurableRun,
	fingerprint string,
	candidateID string,
	completedAt time.Time,
) execution.RunProjectionFinalizeRequest {
	projectionRef := "projection://runs/" + run.RequestID + "/finalization/write"
	payload := func() map[string]any {
		return map[string]any{
			execution.FinalizationFingerprintPayloadKey: fingerprint,
			"answer": "canonical final answer",
		}
	}
	return execution.RunProjectionFinalizeRequest{
		Completion: execution.DurableRunCompleteRequest{
			RequestID:        run.RequestID,
			TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
			FinalResponseRef: projectionRef,
			Now:              completedAt,
		},
		Step: execution.RunStepProjection{
			StepID:               execution.FinalizationStepID,
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			StepKind:             execution.FinalizationStepKind,
			Status:               "completed",
			ActivityAttempt:      1,
			TaskQueue:            "campus-agent.activities.core",
			WorkerID:             "worker-finalization-cas",
			StartedAt:            completedAt.Add(-time.Second),
			CompletedAt:          completedAt,
			UpdatedAt:            completedAt,
			PayloadSchemaVersion: "run-step-projection-v1",
			SanitizedPayload:     payload(),
		},
		Attempt: execution.StepAttemptProjection{
			AttemptID:            run.RequestID + ":finalization.write:attempt:" + candidateID,
			StepID:               execution.FinalizationStepID,
			RequestID:            run.RequestID,
			Attempt:              1,
			Status:               "completed",
			TaskQueue:            "campus-agent.activities.core",
			WorkerID:             "worker-finalization-cas",
			ActivityAttempt:      1,
			StartedAt:            completedAt.Add(-time.Second),
			CompletedAt:          completedAt,
			UpdatedAt:            completedAt,
			PayloadSchemaVersion: "step-attempt-projection-v1",
			SanitizedPayload:     payload(),
		},
		Result: execution.StepResultProjection{
			ResultID:             run.RequestID + ":finalization.write:result:" + candidateID,
			StepID:               execution.FinalizationStepID,
			RequestID:            run.RequestID,
			AttemptID:            run.RequestID + ":finalization.write:attempt:" + candidateID,
			Status:               "completed",
			ResultKind:           execution.FinalizationResultKind,
			ProjectionRef:        projectionRef,
			CreatedAt:            completedAt,
			PayloadSchemaVersion: "step-result-projection-v1",
			SanitizedPayload:     payload(),
		},
		FinalizationFingerprintSHA256: fingerprint,
	}
}

func seedFinalizationCASRecords(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	request execution.RunProjectionFinalizeRequest,
) {
	t.Helper()
	if _, err := store.UpsertRunStep(context.Background(), request.Step); err != nil {
		t.Fatalf("seed finalization step: %v", err)
	}
	if _, err := store.UpsertStepAttempt(context.Background(), request.Attempt); err != nil {
		t.Fatalf("seed finalization attempt: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), request.Result); err != nil {
		t.Fatalf("seed finalization result: %v", err)
	}
}

func listFinalizationCASRecords(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	requestID string,
) ([]execution.RunStepProjection, []execution.StepAttemptProjection, []execution.StepResultProjection) {
	t.Helper()
	steps, err := store.ListRunSteps(context.Background(), requestID)
	if err != nil {
		t.Fatalf("list finalization steps: %v", err)
	}
	attempts, err := store.ListStepAttempts(context.Background(), requestID)
	if err != nil {
		t.Fatalf("list finalization attempts: %v", err)
	}
	results, err := store.ListStepResults(context.Background(), requestID)
	if err != nil {
		t.Fatalf("list finalization results: %v", err)
	}
	return steps, attempts, results
}
