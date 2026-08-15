//go:build postgres_integration

package postgres_test

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func testRunProjectionFinalizationStore(t *testing.T, harness *postgresHarness) {
	t.Run("concurrent candidates select one canonical winner", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 24, 9, 0, 0, 123456000, time.UTC)
		run := createPostgresFinalizationRun(t, store, "run-finalization-race", now)
		fingerprint := strings.Repeat("a", 64)
		requests := []execution.RunProjectionFinalizeRequest{
			postgresFinalizationRequest(run, fingerprint, "candidate-a", now.Add(5*time.Second)),
			postgresFinalizationRequest(run, fingerprint, "candidate-b", now.Add(5*time.Second)),
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
				result, err := store.FinalizeRunProjection(t.Context(), request)
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
		if len(results) != 2 || results[0].Result.ResultID != results[1].Result.ResultID ||
			results[0].Attempt.AttemptID != results[1].Attempt.AttemptID {
			t.Fatalf("concurrent finalization results = %#v", results)
		}
		if results[0].Result.ResultID != requests[0].Result.ResultID &&
			results[0].Result.ResultID != requests[1].Result.ResultID {
			t.Fatalf("canonical result_id = %q, want one candidate", results[0].Result.ResultID)
		}
		assertPostgresFinalizationCardinality(t, store, run.RunID, 1, 1, 1)
		storedRun, err := store.GetRun(t.Context(), run.RunID)
		if err != nil || storedRun.Status != execution.DurableRunStatusCompleted {
			t.Fatalf("completed run = %#v, err=%v", storedRun, err)
		}
	})

	t.Run("legacy canonical records repair the active run", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 24, 9, 10, 0, 0, time.UTC)
		run := createPostgresFinalizationRun(t, store, "run-finalization-legacy", now)
		fingerprint := strings.Repeat("b", 64)
		legacy := postgresFinalizationRequest(run, fingerprint, "legacy", now.Add(5*time.Second))
		seedPostgresFinalizationRecords(t, store, legacy)

		candidate := postgresFinalizationRequest(run, fingerprint, "retry", now.Add(5*time.Second))
		repaired, err := store.FinalizeRunProjection(t.Context(), candidate)
		if err != nil {
			t.Fatalf("repair legacy finalization: %v", err)
		}
		if repaired.Run.Status != execution.DurableRunStatusCompleted ||
			repaired.Attempt.AttemptID != legacy.Attempt.AttemptID ||
			repaired.Result.ResultID != legacy.Result.ResultID {
			t.Fatalf("repaired canonical records = %#v", repaired)
		}
		assertPostgresFinalizationCardinality(t, store, run.RunID, 1, 1, 1)
	})

	t.Run("global attempt and result identities fail closed", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 24, 9, 20, 0, 0, time.UTC)

		t.Run("attempt id", func(t *testing.T) {
			owner := createPostgresFinalizationRun(t, store, "run-attempt-id-owner", now)
			candidateRun := createPostgresFinalizationRun(t, store, "run-attempt-id-candidate", now)
			candidate := postgresFinalizationRequest(
				candidateRun,
				strings.Repeat("c", 64),
				"global-attempt-conflict",
				now.Add(5*time.Second),
			)
			foreignAttempt := candidate.Attempt
			foreignAttempt.RunID = owner.RunID
			foreignAttempt.StepID = "foreign.step"
			if _, err := store.UpsertStepAttempt(t.Context(), foreignAttempt); err != nil {
				t.Fatalf("seed foreign attempt identity: %v", err)
			}

			_, err := store.FinalizeRunProjection(t.Context(), candidate)
			if !errors.Is(err, execution.ErrRunFinalizationConflict) {
				t.Fatalf("attempt identity conflict error = %v", err)
			}
			assertPostgresFinalizationRollback(t, store, candidateRun.RunID)
		})

		t.Run("result id", func(t *testing.T) {
			owner := createPostgresFinalizationRun(t, store, "run-result-id-owner", now)
			candidateRun := createPostgresFinalizationRun(t, store, "run-result-id-candidate", now)
			candidate := postgresFinalizationRequest(
				candidateRun,
				strings.Repeat("d", 64),
				"global-result-conflict",
				now.Add(5*time.Second),
			)
			foreignResult := candidate.Result
			foreignResult.RunID = owner.RunID
			foreignResult.StepID = "foreign.step"
			foreignResult.AttemptID = "foreign-attempt"
			foreignResult.ResultKind = "foreign_result"
			foreignResult.ProjectionRef = "projection://foreign/result"
			if _, err := store.UpsertStepResult(t.Context(), foreignResult); err != nil {
				t.Fatalf("seed foreign result identity: %v", err)
			}

			_, err := store.FinalizeRunProjection(t.Context(), candidate)
			if !errors.Is(err, execution.ErrRunFinalizationConflict) {
				t.Fatalf("result identity conflict error = %v", err)
			}
			assertPostgresFinalizationRollback(t, store, candidateRun.RunID)
		})
	})

	t.Run("completion wins every non-superseded cancellation state", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		conn := connect(t, databaseURL)
		defer closeConn(t, conn)
		now := time.Date(2026, 7, 24, 9, 30, 0, 0, time.UTC)
		states := []execution.LifecycleIntentState{
			execution.LifecycleIntentStatePending,
			execution.LifecycleIntentStateLeased,
			execution.LifecycleIntentStateConfirmed,
			execution.LifecycleIntentStatePermanentFailed,
		}
		for index, state := range states {
			state := state
			t.Run(string(state), func(t *testing.T) {
				runID := "run-finalization-cancellation-" + string(state)
				run := createPostgresFinalizationRun(t, store, runID, now.Add(time.Duration(index)*time.Minute))
				if _, err := store.RequestRunCancellation(t.Context(), execution.DurableRunCancellationRequest{
					RunID: run.RunID, Reason: "user_requested", Now: run.StartedAt.Add(time.Second),
				}); err != nil {
					t.Fatalf("request cancellation: %v", err)
				}
				leaseToken := "lease-" + string(state)
				if state == execution.LifecycleIntentStateLeased || state == execution.LifecycleIntentStateConfirmed {
					leased, err := store.LeaseRunCancellationCommands(t.Context(), execution.LifecycleLeaseRequest{
						LeaseToken: leaseToken,
						Now:        run.StartedAt.Add(2 * time.Second),
						LeaseUntil: run.StartedAt.Add(time.Minute),
						Limit:      1,
					})
					if err != nil || len(leased) != 1 || leased[0].RunID != run.RunID {
						t.Fatalf("lease cancellation = %#v, err=%v", leased, err)
					}
				}
				if state == execution.LifecycleIntentStateConfirmed {
					if err := store.ConfirmRunCancellationCommand(t.Context(), execution.RunCancellationCommandResult{
						RunID: run.RunID, LeaseToken: leaseToken, Now: run.StartedAt.Add(3 * time.Second),
					}); err != nil {
						t.Fatalf("confirm cancellation: %v", err)
					}
				}
				if state == execution.LifecycleIntentStatePermanentFailed {
					if _, err := conn.Exec(t.Context(), `update execution_control.agent_run_cancellations
						set state = 'permanent_failed', lease_token = 'stale-lease',
							lease_until = $2, last_error_code = 'dispatch_exhausted', updated_at = $2
						where run_id = $1`, run.RunID, run.StartedAt.Add(3*time.Second)); err != nil {
						t.Fatalf("set permanent failed cancellation: %v", err)
					}
				}

				completedAt := run.StartedAt.Add(5 * time.Second)
				request := postgresFinalizationRequest(
					run,
					strings.Repeat("e", 64),
					"completion-winner",
					completedAt,
				)
				finalized, err := store.FinalizeRunProjection(t.Context(), request)
				if err != nil || finalized.Run.Status != execution.DurableRunStatusCompleted {
					t.Fatalf("finalize cancellation winner = %#v, err=%v", finalized, err)
				}

				var storedState string
				var nextAttemptAt time.Time
				var storedLeaseToken string
				var leaseUntil *time.Time
				var lastErrorCode string
				var updatedAt time.Time
				if err := conn.QueryRow(t.Context(), `select state, next_attempt_at, lease_token,
					lease_until, last_error_code, updated_at
					from execution_control.agent_run_cancellations where run_id = $1`, run.RunID).Scan(
					&storedState,
					&nextAttemptAt,
					&storedLeaseToken,
					&leaseUntil,
					&lastErrorCode,
					&updatedAt,
				); err != nil {
					t.Fatalf("read settled cancellation: %v", err)
				}
				if storedState != string(execution.LifecycleIntentStateConfirmed) ||
					storedLeaseToken != "" || leaseUntil != nil || lastErrorCode != "completion_won" ||
					!nextAttemptAt.Equal(completedAt) || !updatedAt.Equal(completedAt) {
					t.Fatalf(
						"settled cancellation state=%q next=%s token=%q lease_until=%v error=%q updated=%s",
						storedState,
						nextAttemptAt,
						storedLeaseToken,
						leaseUntil,
						lastErrorCode,
						updatedAt,
					)
				}
			})
		}
	})

	t.Run("late cancellation conflict rolls back the complete bundle", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		conn := connect(t, databaseURL)
		defer closeConn(t, conn)
		now := time.Date(2026, 7, 24, 9, 40, 0, 0, time.UTC)
		run := createPostgresFinalizationRun(t, store, "run-finalization-rollback", now)
		if _, err := store.RequestRunCancellation(t.Context(), execution.DurableRunCancellationRequest{
			RunID: run.RunID, Reason: "user_requested", Now: now.Add(time.Second),
		}); err != nil {
			t.Fatalf("request cancellation: %v", err)
		}
		if _, err := conn.Exec(t.Context(), `update execution_control.agent_run_cancellations
			set state = 'superseded', updated_at = $2 where run_id = $1`, run.RunID, now.Add(2*time.Second)); err != nil {
			t.Fatalf("set incompatible cancellation state: %v", err)
		}

		request := postgresFinalizationRequest(
			run,
			strings.Repeat("f", 64),
			"rollback",
			now.Add(5*time.Second),
		)
		_, err := store.FinalizeRunProjection(t.Context(), request)
		if !errors.Is(err, execution.ErrRunFinalizationConflict) {
			t.Fatalf("late cancellation conflict error = %v", err)
		}
		assertPostgresFinalizationRollback(t, store, run.RunID)
		var cancellationState string
		if err := conn.QueryRow(t.Context(),
			`select state from execution_control.agent_run_cancellations where run_id = $1`,
			run.RunID,
		).Scan(&cancellationState); err != nil {
			t.Fatalf("read rolled back cancellation: %v", err)
		}
		if cancellationState != string(execution.LifecycleIntentStateSuperseded) {
			t.Fatalf("cancellation state after rollback = %q", cancellationState)
		}
	})
}

func createPostgresFinalizationRun(
	t *testing.T,
	store *execution.PostgresRunProjectionStore,
	runID string,
	now time.Time,
) execution.DurableRun {
	t.Helper()
	run := durableRun(runID, "conversation-"+runID, now)
	run.Status = execution.DurableRunStatusRunning
	run.StartedAt = now
	created, err := store.CreateRun(t.Context(), run)
	if err != nil {
		t.Fatalf("create finalization run: %v", err)
	}
	return created
}

func postgresFinalizationRequest(
	run execution.DurableRun,
	fingerprint string,
	candidateID string,
	completedAt time.Time,
) execution.RunProjectionFinalizeRequest {
	projectionRef := "projection://runs/" + run.RunID + "/finalization/write"
	payload := func() map[string]any {
		return map[string]any{
			"finalization_fingerprint_sha256": fingerprint,
			"answer":                          "canonical final answer",
		}
	}
	attemptID := run.RunID + ":finalization.write:attempt:" + candidateID
	return execution.RunProjectionFinalizeRequest{
		Completion: execution.DurableRunCompleteRequest{
			RunID:            run.RunID,
			TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
			FinalResponseRef: projectionRef,
			Now:              completedAt,
		},
		Step: execution.RunStepProjection{
			StepID:               "finalization.write",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			StepKind:             "finalization",
			Status:               "completed",
			ActivityAttempt:      1,
			TaskQueue:            "campus-agent.activities.core",
			WorkerID:             "worker-finalization-integration",
			StartedAt:            completedAt.Add(-time.Second),
			CompletedAt:          completedAt,
			UpdatedAt:            completedAt,
			PayloadSchemaVersion: "run-step-projection-v1",
			SanitizedPayload:     payload(),
		},
		Attempt: execution.StepAttemptProjection{
			AttemptID:            attemptID,
			StepID:               "finalization.write",
			RunID:                run.RunID,
			Attempt:              1,
			Status:               "completed",
			TaskQueue:            "campus-agent.activities.core",
			WorkerID:             "worker-finalization-integration",
			ActivityAttempt:      1,
			StartedAt:            completedAt.Add(-time.Second),
			CompletedAt:          completedAt,
			UpdatedAt:            completedAt,
			PayloadSchemaVersion: "step-attempt-projection-v1",
			SanitizedPayload:     payload(),
		},
		Result: execution.StepResultProjection{
			ResultID:             run.RunID + ":finalization.write:result:" + candidateID,
			StepID:               "finalization.write",
			RunID:                run.RunID,
			AttemptID:            attemptID,
			Status:               "completed",
			ResultKind:           "final_answer_projection",
			ProjectionRef:        projectionRef,
			CreatedAt:            completedAt,
			PayloadSchemaVersion: "step-result-projection-v1",
			SanitizedPayload:     payload(),
		},
		FinalizationFingerprintSHA256: fingerprint,
	}
}

func seedPostgresFinalizationRecords(
	t *testing.T,
	store *execution.PostgresRunProjectionStore,
	request execution.RunProjectionFinalizeRequest,
) {
	t.Helper()
	if _, err := store.UpsertRunStep(t.Context(), request.Step); err != nil {
		t.Fatalf("seed finalization step: %v", err)
	}
	if _, err := store.UpsertStepAttempt(t.Context(), request.Attempt); err != nil {
		t.Fatalf("seed finalization attempt: %v", err)
	}
	if _, err := store.UpsertStepResult(t.Context(), request.Result); err != nil {
		t.Fatalf("seed finalization result: %v", err)
	}
}

func assertPostgresFinalizationRollback(
	t *testing.T,
	store *execution.PostgresRunProjectionStore,
	runID string,
) {
	t.Helper()
	storedRun, err := store.GetRun(t.Context(), runID)
	if err != nil || storedRun.Status != execution.DurableRunStatusRunning || !storedRun.CompletedAt.IsZero() {
		t.Fatalf("run after rollback = %#v, err=%v", storedRun, err)
	}
	assertPostgresFinalizationCardinality(t, store, runID, 0, 0, 0)
}

func assertPostgresFinalizationCardinality(
	t *testing.T,
	store *execution.PostgresRunProjectionStore,
	runID string,
	wantSteps int,
	wantAttempts int,
	wantResults int,
) {
	t.Helper()
	steps, err := store.ListRunSteps(t.Context(), runID)
	if err != nil {
		t.Fatalf("list finalization steps: %v", err)
	}
	attempts, err := store.ListStepAttempts(t.Context(), runID)
	if err != nil {
		t.Fatalf("list finalization attempts: %v", err)
	}
	results, err := store.ListStepResults(t.Context(), runID)
	if err != nil {
		t.Fatalf("list finalization results: %v", err)
	}
	if len(steps) != wantSteps || len(attempts) != wantAttempts || len(results) != wantResults {
		t.Fatalf(
			"finalization cardinality steps=%d attempts=%d results=%d, want %d/%d/%d",
			len(steps),
			len(attempts),
			len(results),
			wantSteps,
			wantAttempts,
			wantResults,
		)
	}
}
