//go:build postgres_integration

package postgres_test

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func testRunProjectionStore(t *testing.T, harness *postgresHarness) {
	t.Run("schema health CRUD and idempotent install", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		if err := store.EnsureSchema(t.Context()); err != nil {
			t.Fatalf("reinstall run projection schema: %v", err)
		}
		if err := store.HealthCheck(t.Context()); err != nil {
			t.Fatalf("run projection health check: %v", err)
		}

		now := time.Date(2026, 7, 15, 8, 0, 0, 0, time.UTC)
		created, err := store.CreateRun(t.Context(), durableRun("run-crud", "conversation-crud", now))
		if err != nil {
			t.Fatalf("create run: %v", err)
		}
		if created.Status != execution.DurableRunStatusCreated || created.Metadata["source"] != "integration" {
			t.Fatalf("created run = %#v", created)
		}
		if err := store.ReplaceRunMetadata(t.Context(), created.RunID, map[string]any{"phase": "updated"}); err != nil {
			t.Fatalf("replace run metadata: %v", err)
		}
		for index, status := range []execution.DurableRunStatus{
			execution.DurableRunStatusQueued,
			execution.DurableRunStatusAdmitted,
			execution.DurableRunStatusRunning,
		} {
			created, err = store.TransitionRun(
				t.Context(),
				created.RunID,
				status,
				"",
				now.Add(time.Duration(index+1)*time.Second),
			)
			if err != nil {
				t.Fatalf("transition run to %s: %v", status, err)
			}
		}
		if created.Status != execution.DurableRunStatusRunning || created.StartedAt.IsZero() {
			t.Fatalf("running run = %#v", created)
		}
		loaded, err := store.GetRun(t.Context(), created.RunID)
		if err != nil {
			t.Fatalf("get run: %v", err)
		}
		if loaded.Metadata["phase"] != "updated" {
			t.Fatalf("run metadata = %#v", loaded.Metadata)
		}
	})

	t.Run("active conversation creation is serialized", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 15, 8, 10, 0, 0, time.UTC)
		start := make(chan struct{})
		errorsByRun := make(chan error, 2)
		var waitGroup sync.WaitGroup
		for index := range 2 {
			waitGroup.Add(1)
			go func(index int) {
				defer waitGroup.Done()
				<-start
				_, err := store.CreateRun(
					t.Context(),
					durableRun(fmt.Sprintf("run-active-%d", index), "conversation-active", now),
				)
				errorsByRun <- err
			}(index)
		}
		close(start)
		waitGroup.Wait()
		close(errorsByRun)

		succeeded := 0
		conflicted := 0
		for err := range errorsByRun {
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, execution.ErrConversationActiveRun):
				conflicted++
			default:
				t.Fatalf("concurrent active run error = %v", err)
			}
		}
		if succeeded != 1 || conflicted != 1 {
			t.Fatalf("active run results = %d succeeded/%d conflicted, want 1/1", succeeded, conflicted)
		}
	})

	t.Run("terminal transition is serialized", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 15, 8, 20, 0, 0, time.UTC)
		run := durableRun("run-terminal-race", "conversation-terminal-race", now)
		run.Status = execution.DurableRunStatusRunning
		run.StartedAt = now
		if _, err := store.CreateRun(t.Context(), run); err != nil {
			t.Fatalf("create running run: %v", err)
		}

		start := make(chan struct{})
		result := make(chan error, 2)
		var waitGroup sync.WaitGroup
		waitGroup.Add(2)
		go func() {
			defer waitGroup.Done()
			<-start
			_, err := store.CompleteRunProjection(t.Context(), execution.DurableRunCompleteRequest{
				RunID:            run.RunID,
				TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
				FinalResponseRef: "app-api:response:terminal-race",
				Now:              now.Add(time.Second),
			})
			result <- err
		}()
		go func() {
			defer waitGroup.Done()
			<-start
			failedAt := now.Add(time.Second)
			_, err := store.FailRunProjection(t.Context(), execution.DurableRunFailRequest{
				RunID:          run.RunID,
				TerminalReason: execution.DurableTerminalReasonProviderUnavailable,
				Now:            failedAt,
				TerminalEvent: postgresFailedRunTerminalEvent(
					run,
					failedAt,
					map[string]any{"failure_kind": "provider_unavailable", "status": "failed"},
				),
			})
			result <- err
		}()
		close(start)
		waitGroup.Wait()
		close(result)

		succeeded := 0
		rejected := 0
		for err := range result {
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, execution.ErrInvalidRunTransition):
				rejected++
			default:
				t.Fatalf("terminal transition error = %v", err)
			}
		}
		if succeeded != 1 || rejected != 1 {
			t.Fatalf("terminal results = %d succeeded/%d rejected, want 1/1", succeeded, rejected)
		}
		stored, err := store.GetRun(t.Context(), run.RunID)
		if err != nil {
			t.Fatalf("get terminal run: %v", err)
		}
		if stored.Status != execution.DurableRunStatusCompleted && stored.Status != execution.DurableRunStatusFailed {
			t.Fatalf("terminal run status = %s", stored.Status)
		}
		nextRun := durableRun("run-after-terminal", run.ConversationID, now.Add(2*time.Second))
		if _, err := store.CreateRun(t.Context(), nextRun); err != nil {
			t.Fatalf("create next run after terminal transition: %v", err)
		}
	})

	t.Run("failure transition event and conversation lock are atomic", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		conn := connect(t, databaseURL)
		defer closeConn(t, conn)
		now := time.Date(2026, 7, 15, 8, 25, 0, 0, time.UTC)
		run := durableRun("run-atomic-failure", "conversation-atomic-failure", now)
		run.Status = execution.DurableRunStatusRunning
		run.StartedAt = now
		run.SelectedTool = "knowledge_query"
		if _, err := store.CreateRun(t.Context(), run); err != nil {
			t.Fatalf("create running run: %v", err)
		}
		if _, err := conn.Exec(
			t.Context(),
			`insert into runtime.conversation_run_locks (conversation_id, run_id) values ($1, $2)`,
			run.ConversationID,
			run.RunID,
		); err != nil {
			t.Fatalf("insert conversation lock: %v", err)
		}
		failedAt := now.Add(time.Second + 789*time.Nanosecond)
		request := execution.DurableRunFailRequest{
			RunID:          run.RunID,
			TerminalReason: execution.DurableTerminalReasonProviderUnavailable,
			Now:            failedAt,
			TerminalEvent: postgresFailedRunTerminalEvent(
				run,
				failedAt,
				map[string]any{"failure_kind": "provider_unavailable", "status": "failed"},
			),
		}
		failed, err := store.FailRunProjection(t.Context(), request)
		if err != nil {
			t.Fatalf("fail run projection: %v", err)
		}
		if failed.Status != execution.DurableRunStatusFailed || failed.SelectedTool != "knowledge_query" {
			t.Fatalf("failed run = %#v", failed)
		}
		var lockCount int
		if err := conn.QueryRow(
			t.Context(),
			`select count(*) from runtime.conversation_run_locks where conversation_id = $1`,
			run.ConversationID,
		).Scan(&lockCount); err != nil {
			t.Fatalf("count released conversation lock: %v", err)
		}
		if lockCount != 0 {
			t.Fatalf("conversation lock count = %d, want 0", lockCount)
		}
		events, err := store.ListRunEvents(t.Context(), run.RunID)
		if err != nil || len(events) != 1 || events[0].EventType != execution.DurableRunEventTypeRunFailed {
			t.Fatalf("terminal events = %#v, error = %v", events, err)
		}
		replayed, err := store.FailRunProjection(t.Context(), request)
		if err != nil || !replayed.CompletedAt.Equal(failed.CompletedAt) {
			t.Fatalf("replayed failure = %#v, error = %v", replayed, err)
		}
		conflictingRequest := request
		conflictingRequest.TerminalEvent = postgresFailedRunTerminalEvent(
			run,
			failedAt,
			map[string]any{"failure_kind": "retrieval_unavailable", "status": "failed"},
		)
		if _, err := store.FailRunProjection(t.Context(), conflictingRequest); !errors.Is(err, execution.ErrDurableRunFailureConflict) {
			t.Fatalf("conflicting replay error = %v, want ErrDurableRunFailureConflict", err)
		}
		if _, err := store.CreateRun(
			t.Context(),
			durableRun("run-after-atomic-failure", run.ConversationID, now.Add(2*time.Second)),
		); err != nil {
			t.Fatalf("create next run after atomic failure: %v", err)
		}

		collisionRun := durableRun("run-failure-event-collision", "conversation-failure-event-collision", now)
		collisionRun.Status = execution.DurableRunStatusRunning
		collisionRun.StartedAt = now
		if _, err := store.CreateRun(t.Context(), collisionRun); err != nil {
			t.Fatalf("create collision run: %v", err)
		}
		if _, err := conn.Exec(
			t.Context(),
			`insert into runtime.conversation_run_locks (conversation_id, run_id) values ($1, $2)`,
			collisionRun.ConversationID,
			collisionRun.RunID,
		); err != nil {
			t.Fatalf("insert collision conversation lock: %v", err)
		}
		if _, err := store.AppendRunEvent(t.Context(), execution.DurableRunEvent{
			EventID:              collisionRun.RunID + ":run-failed",
			RunID:                collisionRun.RunID,
			ConversationID:       collisionRun.ConversationID,
			EventType:            execution.DurableRunEventTypeActivityFailed,
			OccurredAt:           now,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"failure_kind": "earlier_failure"},
		}); err != nil {
			t.Fatalf("append colliding terminal event: %v", err)
		}
		collisionFailedAt := now.Add(3 * time.Second)
		_, err = store.FailRunProjection(t.Context(), execution.DurableRunFailRequest{
			RunID:          collisionRun.RunID,
			TerminalReason: execution.DurableTerminalReasonProviderUnavailable,
			Now:            collisionFailedAt,
			TerminalEvent: postgresFailedRunTerminalEvent(
				collisionRun,
				collisionFailedAt,
				map[string]any{"failure_kind": "provider_unavailable"},
			),
		})
		if !errors.Is(err, execution.ErrDurableRunFailureConflict) {
			t.Fatalf("event collision error = %v, want ErrDurableRunFailureConflict", err)
		}
		stored, err := store.GetRun(t.Context(), collisionRun.RunID)
		if err != nil || stored.Status != execution.DurableRunStatusRunning {
			t.Fatalf("collision run after rollback = %#v, error = %v", stored, err)
		}
		if err := conn.QueryRow(
			t.Context(),
			`select count(*) from runtime.conversation_run_locks where conversation_id = $1`,
			collisionRun.ConversationID,
		).Scan(&lockCount); err != nil {
			t.Fatalf("count preserved conversation lock: %v", err)
		}
		if lockCount != 1 {
			t.Fatalf("conversation lock count after rollback = %d, want 1", lockCount)
		}
	})

	t.Run("event sequences are serialized", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 15, 8, 30, 0, 0, time.UTC)
		run := durableRun("run-event-sequence", "conversation-event-sequence", now)
		if _, err := store.CreateRun(t.Context(), run); err != nil {
			t.Fatalf("create event run: %v", err)
		}

		const eventCount = 12
		start := make(chan struct{})
		result := make(chan error, eventCount)
		var waitGroup sync.WaitGroup
		for index := range eventCount {
			waitGroup.Add(1)
			go func(index int) {
				defer waitGroup.Done()
				<-start
				_, err := store.AppendRunEvent(t.Context(), execution.DurableRunEvent{
					EventID:              fmt.Sprintf("event-%02d", index),
					RunID:                run.RunID,
					ConversationID:       run.ConversationID,
					EventType:            execution.DurableRunEventTypeRunCreated,
					OccurredAt:           now.Add(time.Duration(index) * time.Millisecond),
					Visibility:           execution.DurableRunEventVisibilityInternal,
					PayloadSchemaVersion: "run-event-v1",
					Payload:              map[string]any{"index": index},
				})
				result <- err
			}(index)
		}
		close(start)
		waitGroup.Wait()
		close(result)
		for err := range result {
			if err != nil {
				t.Fatalf("append concurrent event: %v", err)
			}
		}
		events, err := store.ListRunEvents(t.Context(), run.RunID)
		if err != nil {
			t.Fatalf("list run events: %v", err)
		}
		if len(events) != eventCount {
			t.Fatalf("event count = %d, want %d", len(events), eventCount)
		}
		for index, event := range events {
			if event.Sequence != int64(index+1) {
				t.Fatalf("event[%d] sequence = %d, want %d", index, event.Sequence, index+1)
			}
		}
	})

	t.Run("step trajectory upserts and cascades", func(t *testing.T) {
		databaseName, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 15, 8, 40, 0, 0, time.UTC)
		run := durableRun("run-trajectory", "conversation-trajectory", now)
		if _, err := store.CreateRun(t.Context(), run); err != nil {
			t.Fatalf("create trajectory run: %v", err)
		}

		step := execution.RunStepProjection{
			StepID:               "agent.primary",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			StepKind:             "agent",
			Status:               "running",
			StartedAt:            now.Add(time.Second),
			UpdatedAt:            now.Add(time.Second),
			PayloadSchemaVersion: "run-step-v1",
			SanitizedPayload:     map[string]any{"phase": "running"},
		}
		if _, err := store.UpsertRunStep(t.Context(), step); err != nil {
			t.Fatalf("upsert run step: %v", err)
		}
		step.Status = "completed"
		step.CompletedAt = now.Add(3 * time.Second)
		step.UpdatedAt = step.CompletedAt
		step.SanitizedPayload = map[string]any{"phase": "completed"}
		if _, err := store.UpsertRunStep(t.Context(), step); err != nil {
			t.Fatalf("update run step: %v", err)
		}

		attempt := execution.StepAttemptProjection{
			AttemptID:            "attempt-primary-1",
			StepID:               step.StepID,
			RunID:                run.RunID,
			Attempt:              1,
			Status:               "running",
			StartedAt:            now.Add(time.Second),
			UpdatedAt:            now.Add(time.Second),
			PayloadSchemaVersion: "step-attempt-v1",
			SanitizedPayload:     map[string]any{"phase": "running"},
		}
		if _, err := store.UpsertStepAttempt(t.Context(), attempt); err != nil {
			t.Fatalf("upsert step attempt: %v", err)
		}
		attempt.Status = "completed"
		attempt.CompletedAt = now.Add(3 * time.Second)
		attempt.UpdatedAt = attempt.CompletedAt
		attempt.DurationMS = 2000
		if _, err := store.UpsertStepAttempt(t.Context(), attempt); err != nil {
			t.Fatalf("update step attempt: %v", err)
		}

		result := execution.StepResultProjection{
			ResultID:             "result-primary-1",
			StepID:               step.StepID,
			RunID:                run.RunID,
			AttemptID:            attempt.AttemptID,
			Status:               "completed",
			ResultKind:           "answer",
			ProjectionRef:        "projection:answer:1",
			CreatedAt:            now.Add(3 * time.Second),
			PayloadSchemaVersion: "step-result-v1",
			SanitizedPayload:     map[string]any{"shape": "answer"},
		}
		if _, err := store.UpsertStepResult(t.Context(), result); err != nil {
			t.Fatalf("upsert step result: %v", err)
		}
		result.Status = "published"
		if _, err := store.UpsertStepResult(t.Context(), result); err != nil {
			t.Fatalf("update step result: %v", err)
		}

		steps, err := store.ListRunSteps(t.Context(), run.RunID)
		if err != nil || len(steps) != 1 || steps[0].Status != "completed" {
			t.Fatalf("steps = %#v, error = %v", steps, err)
		}
		attempts, err := store.ListStepAttempts(t.Context(), run.RunID)
		if err != nil || len(attempts) != 1 || attempts[0].DurationMS != 2000 {
			t.Fatalf("attempts = %#v, error = %v", attempts, err)
		}
		results, err := store.ListStepResults(t.Context(), run.RunID)
		if err != nil || len(results) != 1 || results[0].Status != "published" {
			t.Fatalf("results = %#v, error = %v", results, err)
		}

		if err := store.DeleteRun(t.Context(), run.RunID); err != nil {
			t.Fatalf("delete run: %v", err)
		}
		ownerURL := harness.databaseURL(t, databaseName, ownerRole, ownerPassword)
		conn := connect(t, ownerURL)
		defer closeConn(t, conn)
		for _, table := range []string{
			"runtime.agent_run_events",
			"runtime.agent_run_steps",
			"runtime.agent_step_attempts",
			"runtime.agent_step_results",
			"runtime.conversation_run_locks",
		} {
			var count int
			if err := conn.QueryRow(t.Context(), "select count(*) from "+table).Scan(&count); err != nil {
				t.Fatalf("count %s: %v", table, err)
			}
			if count != 0 {
				t.Fatalf("%s rows after run delete = %d, want 0", table, count)
			}
		}
	})
}

func newRunProjectionStore(
	t *testing.T,
	databaseURL string,
	autoMigrate bool,
) *execution.PostgresRunProjectionStore {
	t.Helper()
	store, err := execution.NewPostgresRunProjectionStore(
		t.Context(),
		execution.PostgresRunProjectionStoreOptions{
			DatabaseURL: databaseURL,
			AutoMigrate: autoMigrate,
		},
	)
	if err != nil {
		t.Fatalf("create run projection store: %v", err)
	}
	t.Cleanup(store.Close)
	return store
}

func durableRun(runID, conversationID string, now time.Time) execution.DurableRun {
	return execution.DurableRun{
		RunID:          runID,
		ConversationID: conversationID,
		TurnID:         "turn:" + runID,
		RequestID:      "request:" + runID,
		TraceID:        "trace:" + runID,
		OwnerUserID:    "user:integration",
		Surface:        "testcontainers",
		TaskQueue:      "campus-agent.integration",
		Status:         execution.DurableRunStatusCreated,
		CreatedAt:      now,
		UpdatedAt:      now,
		RuntimeVersions: map[string]any{
			"execution_control": "integration",
		},
		Metadata: map[string]any{"source": "integration"},
	}
}

func postgresFailedRunTerminalEvent(
	run execution.DurableRun,
	now time.Time,
	payload map[string]any,
) execution.DurableRunEvent {
	return execution.DurableRunEvent{
		EventID:              run.RunID + ":run-failed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunFailed,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              payload,
	}
}

func sortedInts(values []int64) []int64 {
	result := append([]int64(nil), values...)
	sort.Slice(result, func(left, right int) bool { return result[left] < result[right] })
	return result
}
