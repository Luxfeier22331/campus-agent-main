package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"sync"
	"testing"
	"time"
)

func TestInMemoryRunStepProjectionTerminalAttemptIsImmutable(t *testing.T) {
	terminalStatuses := []string{"completed", "failed", "blocked", "canceled", "expired", "skipped"}
	for index, status := range terminalStatuses {
		t.Run(status, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 23, 1, index, 0, 0, time.UTC)
			requestID := "run-step-terminal-" + status
			createRunProjectionForTest(t, store, requestID, "conv-step-terminal-"+status, now)

			started := monotonicRunStepForTest(requestID, "started", 1, now.Add(time.Second), "started")
			if _, err := store.UpsertRunStep(context.Background(), started); err != nil {
				t.Fatalf("seed started step: %v", err)
			}
			terminal := started
			terminal.Status = status
			terminal.CompletedAt = now.Add(2 * time.Second)
			terminal.UpdatedAt = terminal.CompletedAt
			terminal.SanitizedPayload = map[string]any{"marker": "terminal-" + status}
			if _, err := store.UpsertRunStep(context.Background(), terminal); err != nil {
				t.Fatalf("write first terminal step: %v", err)
			}

			late := terminal
			late.Status = "completed"
			late.UpdatedAt = now.Add(3 * time.Second)
			late.SanitizedPayload = map[string]any{"marker": "late"}
			if _, err := store.UpsertRunStep(context.Background(), late); !errors.Is(err, execution.ErrStaleRunStepProjection) {
				t.Fatalf("late terminal overwrite error = %v, want execution.ErrStaleRunStepProjection", err)
			}
			steps, err := store.ListRunSteps(context.Background(), requestID)
			if err != nil || len(steps) != 1 {
				t.Fatalf("stored steps = %#v, error = %v", steps, err)
			}
			if steps[0].Status != status || steps[0].SanitizedPayload["marker"] != "terminal-"+status {
				t.Fatalf("stored terminal step = %#v, want first terminal projection", steps[0])
			}
		})
	}
}

func TestInMemoryRunStepProjectionAllowsHigherAttemptAndRejectsLowerAttempt(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 2, 0, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-step-attempt-order", "conv-step-attempt-order", now)

	first := monotonicRunStepForTest("run-step-attempt-order", "failed", 1, now.Add(time.Second), "attempt-1")
	first.CompletedAt = first.UpdatedAt
	if _, err := store.UpsertRunStep(context.Background(), first); err != nil {
		t.Fatalf("write first attempt: %v", err)
	}
	second := monotonicRunStepForTest("run-step-attempt-order", "started", 2, now.Add(2*time.Second), "attempt-2-started")
	if _, err := store.UpsertRunStep(context.Background(), second); err != nil {
		t.Fatalf("start higher attempt: %v", err)
	}
	second.Status = "completed"
	second.CompletedAt = now.Add(3 * time.Second)
	second.UpdatedAt = second.CompletedAt
	second.SanitizedPayload = map[string]any{"marker": "attempt-2-completed"}
	if _, err := store.UpsertRunStep(context.Background(), second); err != nil {
		t.Fatalf("complete higher attempt: %v", err)
	}

	lateFirst := first
	lateFirst.Status = "completed"
	lateFirst.UpdatedAt = now.Add(4 * time.Second)
	lateFirst.SanitizedPayload = map[string]any{"marker": "late-attempt-1"}
	if _, err := store.UpsertRunStep(context.Background(), lateFirst); !errors.Is(err, execution.ErrStaleRunStepProjection) {
		t.Fatalf("lower attempt overwrite error = %v, want execution.ErrStaleRunStepProjection", err)
	}
	steps, err := store.ListRunSteps(context.Background(), first.RequestID)
	if err != nil || len(steps) != 1 {
		t.Fatalf("stored steps = %#v, error = %v", steps, err)
	}
	if steps[0].ActivityAttempt != 2 || steps[0].Status != "completed" ||
		steps[0].SanitizedPayload["marker"] != "attempt-2-completed" {
		t.Fatalf("aggregate step = %#v, want completed attempt 2", steps[0])
	}
}

func TestInMemoryStepAttemptProjectionTerminalRecordIsImmutable(t *testing.T) {
	terminalStatuses := []string{"completed", "failed", "blocked", "canceled", "expired", "skipped"}
	for index, status := range terminalStatuses {
		t.Run(status, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 23, 3, index, 0, 0, time.UTC)
			requestID := "run-attempt-terminal-" + status
			createRunProjectionForTest(t, store, requestID, "conv-attempt-terminal-"+status, now)

			started := monotonicStepAttemptForTest(requestID, 1, "started", now.Add(time.Second), "started")
			if _, err := store.UpsertStepAttempt(context.Background(), started); err != nil {
				t.Fatalf("seed started attempt: %v", err)
			}
			terminal := started
			terminal.Status = status
			terminal.CompletedAt = now.Add(2 * time.Second)
			terminal.UpdatedAt = terminal.CompletedAt
			terminal.SanitizedPayload = map[string]any{"marker": "terminal-" + status}
			if _, err := store.UpsertStepAttempt(context.Background(), terminal); err != nil {
				t.Fatalf("write first terminal attempt: %v", err)
			}

			late := terminal
			late.Status = "completed"
			late.UpdatedAt = now.Add(3 * time.Second)
			late.SanitizedPayload = map[string]any{"marker": "late"}
			if _, err := store.UpsertStepAttempt(context.Background(), late); !errors.Is(err, execution.ErrStaleStepAttemptProjection) {
				t.Fatalf("late attempt overwrite error = %v, want execution.ErrStaleStepAttemptProjection", err)
			}
			attempts, err := store.ListStepAttempts(context.Background(), requestID)
			if err != nil || len(attempts) != 1 {
				t.Fatalf("stored attempts = %#v, error = %v", attempts, err)
			}
			if attempts[0].Status != status || attempts[0].SanitizedPayload["marker"] != "terminal-"+status {
				t.Fatalf("stored terminal attempt = %#v, want first terminal projection", attempts[0])
			}
		})
	}
}

func TestInMemoryStepAttemptProjectionAllowsStartedToTerminalAndNewRetryRecord(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 4, 0, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-attempt-retry", "conv-attempt-retry", now)

	first := monotonicStepAttemptForTest("run-attempt-retry", 1, "started", now.Add(time.Second), "attempt-1-started")
	if _, err := store.UpsertStepAttempt(context.Background(), first); err != nil {
		t.Fatalf("start first attempt: %v", err)
	}
	first.Status = "failed"
	first.CompletedAt = now.Add(2 * time.Second)
	first.UpdatedAt = first.CompletedAt
	first.SanitizedPayload = map[string]any{"marker": "attempt-1-failed"}
	if _, err := store.UpsertStepAttempt(context.Background(), first); err != nil {
		t.Fatalf("fail first attempt: %v", err)
	}
	second := monotonicStepAttemptForTest("run-attempt-retry", 2, "completed", now.Add(3*time.Second), "attempt-2-completed")
	second.CompletedAt = second.UpdatedAt
	if _, err := store.UpsertStepAttempt(context.Background(), second); err != nil {
		t.Fatalf("write second attempt: %v", err)
	}

	attempts, err := store.ListStepAttempts(context.Background(), first.RequestID)
	if err != nil || len(attempts) != 2 {
		t.Fatalf("stored attempts = %#v, error = %v", attempts, err)
	}
	if attempts[0].Status != "failed" || attempts[1].Status != "completed" || attempts[1].ActivityAttempt != 2 {
		t.Fatalf("retry attempts = %#v, want immutable failure followed by completed retry", attempts)
	}
}

func TestInMemoryStepAttemptProjectionRejectsActivityAttemptRegression(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 4, 30, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-attempt-regression", "conv-attempt-regression", now)

	current := monotonicStepAttemptForTest("run-attempt-regression", 2, "started", now.Add(time.Second), "activity-attempt-2")
	if _, err := store.UpsertStepAttempt(context.Background(), current); err != nil {
		t.Fatalf("seed activity attempt 2: %v", err)
	}
	regressed := current
	regressed.ActivityAttempt = 1
	regressed.UpdatedAt = now.Add(2 * time.Second)
	regressed.SanitizedPayload = map[string]any{"marker": "late-activity-attempt-1"}
	if _, err := store.UpsertStepAttempt(context.Background(), regressed); !errors.Is(err, execution.ErrStaleStepAttemptProjection) {
		t.Fatalf("activity attempt regression error = %v, want execution.ErrStaleStepAttemptProjection", err)
	}
	attempts, err := store.ListStepAttempts(context.Background(), current.RequestID)
	if err != nil || len(attempts) != 1 {
		t.Fatalf("stored attempts = %#v, error = %v", attempts, err)
	}
	if attempts[0].ActivityAttempt != 2 || attempts[0].SanitizedPayload["marker"] != "activity-attempt-2" {
		t.Fatalf("stored attempt = %#v, want activity attempt 2", attempts[0])
	}
}

func TestInMemoryStepProjectionConcurrentTerminalWritersHaveSingleWinner(t *testing.T) {
	t.Run("run step", func(t *testing.T) {
		store := NewInMemoryRunProjectionStore()
		now := time.Date(2026, 7, 23, 5, 0, 0, 0, time.UTC)
		createRunProjectionForTest(t, store, "run-step-terminal-race", "conv-step-terminal-race", now)
		started := monotonicRunStepForTest("run-step-terminal-race", "started", 1, now, "started")
		if _, err := store.UpsertRunStep(context.Background(), started); err != nil {
			t.Fatalf("seed started step: %v", err)
		}

		results := make(chan error, 2)
		start := make(chan struct{})
		var waitGroup sync.WaitGroup
		for index, status := range []string{"completed", "canceled"} {
			waitGroup.Add(1)
			go func(index int, status string) {
				defer waitGroup.Done()
				<-start
				candidate := started
				candidate.Status = status
				candidate.CompletedAt = now.Add(time.Duration(index+1) * time.Second)
				candidate.UpdatedAt = candidate.CompletedAt
				candidate.SanitizedPayload = map[string]any{"marker": status}
				_, err := store.UpsertRunStep(context.Background(), candidate)
				results <- err
			}(index, status)
		}
		close(start)
		waitGroup.Wait()
		close(results)
		assertSingleStepProjectionWinner(t, results, execution.ErrStaleRunStepProjection)
	})

	t.Run("step attempt", func(t *testing.T) {
		store := NewInMemoryRunProjectionStore()
		now := time.Date(2026, 7, 23, 5, 10, 0, 0, time.UTC)
		createRunProjectionForTest(t, store, "run-attempt-terminal-race", "conv-attempt-terminal-race", now)
		started := monotonicStepAttemptForTest("run-attempt-terminal-race", 1, "started", now, "started")
		if _, err := store.UpsertStepAttempt(context.Background(), started); err != nil {
			t.Fatalf("seed started attempt: %v", err)
		}

		results := make(chan error, 2)
		start := make(chan struct{})
		var waitGroup sync.WaitGroup
		for index, status := range []string{"completed", "canceled"} {
			waitGroup.Add(1)
			go func(index int, status string) {
				defer waitGroup.Done()
				<-start
				candidate := started
				candidate.Status = status
				candidate.CompletedAt = now.Add(time.Duration(index+1) * time.Second)
				candidate.UpdatedAt = candidate.CompletedAt
				candidate.SanitizedPayload = map[string]any{"marker": status}
				_, err := store.UpsertStepAttempt(context.Background(), candidate)
				results <- err
			}(index, status)
		}
		close(start)
		waitGroup.Wait()
		close(results)
		assertSingleStepProjectionWinner(t, results, execution.ErrStaleStepAttemptProjection)
	})
}

func assertSingleStepProjectionWinner(t *testing.T, results <-chan error, staleError error) {
	t.Helper()
	succeeded := 0
	stale := 0
	for err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, staleError):
			stale++
		default:
			t.Fatalf("terminal race error = %v", err)
		}
	}
	if succeeded != 1 || stale != 1 {
		t.Fatalf("terminal race results = %d succeeded/%d stale, want 1/1", succeeded, stale)
	}
}

func monotonicRunStepForTest(
	requestID string,
	status string,
	activityAttempt int,
	updatedAt time.Time,
	marker string,
) execution.RunStepProjection {
	return execution.RunStepProjection{
		StepID:               "agent.primary",
		RequestID:            requestID,
		ConversationID:       "conv-" + requestID,
		StepKind:             "agent",
		Status:               status,
		ActivityAttempt:      activityAttempt,
		StartedAt:            updatedAt,
		UpdatedAt:            updatedAt,
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload:     map[string]any{"marker": marker},
	}
}

func monotonicStepAttemptForTest(
	requestID string,
	activityAttempt int,
	status string,
	updatedAt time.Time,
	marker string,
) execution.StepAttemptProjection {
	return execution.StepAttemptProjection{
		AttemptID:            fmt.Sprintf("%s:agent.primary:attempt-%d", requestID, activityAttempt),
		StepID:               "agent.primary",
		RequestID:            requestID,
		Attempt:              activityAttempt,
		Status:               status,
		ActivityAttempt:      activityAttempt,
		StartedAt:            updatedAt,
		UpdatedAt:            updatedAt,
		PayloadSchemaVersion: "step-attempt-projection-v1",
		SanitizedPayload:     map[string]any{"marker": marker},
	}
}
