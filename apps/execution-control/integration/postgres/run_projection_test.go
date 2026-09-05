//go:build postgres_integration

package postgres_test

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/jackc/pgx/v5"
)

func testRunProjectionStore(t *testing.T, harness *postgresHarness) {
	t.Run("schema health CRUD and idempotent install", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		requireSchema(t, databaseURL)
		if err := store.HealthCheck(t.Context()); err != nil {
			t.Fatalf("run projection health check: %v", err)
		}

		now := time.Date(2026, 7, 15, 8, 0, 0, 0, time.UTC)
		created, err := store.CreateRun(t.Context(), durableRun("run-crud", "conversation-crud", now))
		if err != nil {
			t.Fatalf("create run: %v", err)
		}
		if created.Status != execution.DurableRunStatusCreated ||
			created.Metadata["execution_contract_version"] != "tool_execution_v7" {
			t.Fatalf("created run = %#v", created)
		}
		updatedMetadata := map[string]any{
			"execution_contract_version": "tool_execution_v7",
			"execution_input_ref":        "app-api://execution-inputs/" + created.RequestID,
			"execution_input_sha256":     strings.Repeat("b", 64),
		}
		if err := store.ReplaceRunMetadata(t.Context(), created.RequestID, updatedMetadata); err != nil {
			t.Fatalf("replace run metadata: %v", err)
		}
		for index, status := range []execution.DurableRunStatus{
			execution.DurableRunStatusQueued,
			execution.DurableRunStatusAdmitted,
			execution.DurableRunStatusRunning,
		} {
			created, err = store.TransitionRun(
				t.Context(),
				created.RequestID,
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
		loaded, err := store.GetRun(t.Context(), created.RequestID)
		if err != nil {
			t.Fatalf("get run: %v", err)
		}
		if loaded.Metadata["execution_input_sha256"] != strings.Repeat("b", 64) {
			t.Fatalf("run metadata = %#v", loaded.Metadata)
		}
	})

	t.Run("answer stream transaction and LISTEN NOTIFY wakeups", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		if err := store.HealthCheck(t.Context()); err != nil {
			t.Fatalf("run projection health check: %v", err)
		}

		now := time.Date(2026, 7, 25, 8, 0, 0, 0, time.UTC)
		run := createPostgresRunningRun(t, store, "run-answer-stream", now)
		conflict := postgresAnswerStreamStartRequest(run, now.Add(4*time.Second))
		conflict.FirstDeltaEvent.EventID = conflict.AnswerStartedEvent.EventID
		if _, err := store.StartRunAnswerStream(t.Context(), conflict); !errors.Is(
			err,
			execution.ErrInvalidRunEvent,
		) {
			t.Fatalf("conflicting answer stream error = %v, want ErrInvalidRunEvent", err)
		}
		unchanged, err := store.GetRun(t.Context(), run.RequestID)
		if err != nil {
			t.Fatalf("get run after rolled back answer stream: %v", err)
		}
		if unchanged.Status != execution.DurableRunStatusRunning ||
			!unchanged.StreamingStartedAt.IsZero() {
			t.Fatalf("run changed after rolled back answer stream: %#v", unchanged)
		}
		unchangedEvents, err := store.ListRunEvents(t.Context(), run.RequestID)
		if err != nil || len(unchangedEvents) != 0 {
			t.Fatalf("events after rolled back answer stream = %#v, err=%v", unchangedEvents, err)
		}

		type waitResult struct {
			events []execution.DurableRunEvent
			err    error
		}
		waitCtx, cancelWait := context.WithTimeout(t.Context(), 2*time.Second)
		defer cancelWait()
		waitResults := make(chan waitResult, 2)
		for range 2 {
			go func() {
				events, waitErr := store.WaitForRunEventsAfter(waitCtx, run.RequestID, 0)
				waitResults <- waitResult{events: events, err: waitErr}
			}()
		}
		time.Sleep(50 * time.Millisecond)

		request := postgresAnswerStreamStartRequest(run, now.Add(4*time.Second))
		streaming, err := store.StartRunAnswerStream(t.Context(), request)
		if err != nil {
			t.Fatalf("start answer stream: %v", err)
		}
		if streaming.Status != execution.DurableRunStatusStreaming ||
			!streaming.StreamingStartedAt.Equal(request.Now) {
			t.Fatalf("streaming run = %#v", streaming)
		}
		for range 2 {
			select {
			case result := <-waitResults:
				if result.err != nil || len(result.events) != 2 ||
					result.events[0].EventType != execution.DurableRunEventTypeRunAnswerStarted ||
					result.events[1].EventType != execution.DurableRunEventTypeRunAnswerDelta {
					t.Fatalf("LISTEN NOTIFY wait result = %#v, err=%v", result.events, result.err)
				}
			case <-waitCtx.Done():
				t.Fatalf("LISTEN NOTIFY waiter timed out: %v", waitCtx.Err())
			}
		}

		closeRun := createPostgresRunningRun(t, store, "run-listener-close", now.Add(time.Minute))
		closeResult := make(chan error, 1)
		go func() {
			_, waitErr := store.WaitForRunEventsAfter(context.Background(), closeRun.RequestID, 0)
			closeResult <- waitErr
		}()
		time.Sleep(50 * time.Millisecond)
		store.Close()
		select {
		case closeErr := <-closeResult:
			if closeErr == nil {
				t.Fatal("closing the store did not fail the active run event waiter")
			}
		case <-time.After(time.Second):
			t.Fatal("closing the store did not release the active run event waiter")
		}
	})

	t.Run("listener reconnects after backend termination", func(t *testing.T) {
		databaseName, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		if err := store.HealthCheck(t.Context()); err != nil {
			t.Fatalf("run projection health check: %v", err)
		}

		now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
		run := createPostgresRunningRun(t, store, "run-listener-reconnect", now)
		adminURL := harness.databaseURL(t, databaseName, adminUser, adminPassword)
		oldPID := waitForRunEventListenerPID(t, adminURL, true)

		type waitResult struct {
			events []execution.DurableRunEvent
			err    error
		}
		waitCtx, cancelWait := context.WithTimeout(t.Context(), 2*time.Second)
		defer cancelWait()
		waitResults := make(chan waitResult, 1)
		go func() {
			events, waitErr := store.WaitForRunEventsAfter(waitCtx, run.RequestID, 0)
			waitResults <- waitResult{events: events, err: waitErr}
		}()
		time.Sleep(50 * time.Millisecond)

		terminateRunEventListener(t, adminURL, oldPID)
		select {
		case result := <-waitResults:
			if result.err == nil {
				t.Fatalf("listener termination returned events without an error: %#v", result.events)
			}
			if errors.Is(result.err, context.DeadlineExceeded) {
				t.Fatalf("listener termination left waiter blocked: %v", result.err)
			}
		case <-waitCtx.Done():
			t.Fatalf("listener termination did not release waiter: %v", waitCtx.Err())
		}

		waitForRunEventListenerPID(t, adminURL, false)
		waitForRunProjectionHealth(t, store)
		newPID := waitForRunEventListenerPID(t, adminURL, true)
		if newPID == oldPID {
			t.Fatalf("listener backend was not replaced: old pid=%d new pid=%d", oldPID, newPID)
		}

		resumeCtx, cancelResume := context.WithTimeout(t.Context(), 2*time.Second)
		defer cancelResume()
		resumeResults := make(chan waitResult, 1)
		go func() {
			events, waitErr := store.WaitForRunEventsAfter(resumeCtx, run.RequestID, 0)
			resumeResults <- waitResult{events: events, err: waitErr}
		}()
		time.Sleep(50 * time.Millisecond)

		appended, err := store.AppendRunEvent(t.Context(), execution.DurableRunEvent{
			EventID:              run.RequestID + ":listener-reconnect",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunAnswerStarted,
			OccurredAt:           now.Add(time.Second),
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": "streaming"},
		})
		if err != nil {
			t.Fatalf("append event after listener reconnect: %v", err)
		}
		select {
		case result := <-resumeResults:
			if result.err != nil || len(result.events) != 1 || result.events[0].Sequence != appended.Sequence {
				t.Fatalf("reconnected listener result = %#v, err=%v", result.events, result.err)
			}
		case <-resumeCtx.Done():
			t.Fatalf("reconnected listener did not receive notification: %v", resumeCtx.Err())
		}
	})

	t.Run("schema health rejects catalog drift", func(t *testing.T) {
		testCases := []struct {
			name          string
			mutationSQL   string
			wantErrorPart string
		}{
			{
				name:          "missing added column",
				mutationSQL:   "alter table execution_control.agent_runs drop column request_fingerprint_sha256 cascade",
				wantErrorPart: "column execution_control.agent_runs.request_fingerprint_sha256",
			},
			{
				name:          "wrong dispatch fence default",
				mutationSQL:   "alter table execution_control.agent_workflow_starts alter column dispatch_attempted set default true",
				wantErrorPart: "column execution_control.agent_workflow_starts.dispatch_attempted",
			},
			{
				name:          "missing step attempt uniqueness fence",
				mutationSQL:   "alter table execution_control.agent_step_attempts drop constraint agent_step_attempts_request_id_step_id_attempt_key",
				wantErrorPart: "constraint execution_control.agent_step_attempts (u request_id,step_id,attempt)",
			},
			{
				name:          "missing owner deletion state check",
				mutationSQL:   "alter table execution_control.owner_deletion_fences drop constraint owner_deletion_fences_state_check",
				wantErrorPart: "check constraint execution_control.owner_deletion_fences.owner_deletion_fences_state_check",
			},
			{
				name:          "missing lifecycle lease index",
				mutationSQL:   "drop index execution_control.agent_workflow_starts_lease_idx",
				wantErrorPart: "index execution_control.agent_workflow_starts_lease_idx",
			},
			{
				name: "wrong active run predicate",
				mutationSQL: `
					drop index execution_control.agent_runs_active_conversation_idx;
					create unique index agent_runs_active_conversation_idx
						on execution_control.agent_runs (conversation_id)
						where status in ('created', 'queued')`,
				wantErrorPart: "index execution_control.agent_runs_active_conversation_idx",
			},
		}
		for _, testCase := range testCases {
			t.Run(testCase.name, func(t *testing.T) {
				_, databaseURL := harness.ownerDatabase(t)
				store := newRunProjectionStore(t, databaseURL, true)
				conn := connect(t, databaseURL)
				defer closeConn(t, conn)
				if _, err := conn.Exec(t.Context(), testCase.mutationSQL); err != nil {
					t.Fatalf("mutate run projection schema: %v", err)
				}
				err := store.HealthCheck(t.Context())
				if err == nil || !strings.Contains(err.Error(), testCase.wantErrorPart) {
					t.Fatalf("schema health error = %v, want part %q", err, testCase.wantErrorPart)
				}
			})
		}
	})

	t.Run("owner deletion drains and removes the PostgreSQL projection", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 31, 8, 0, 0, 0, time.UTC)
		ownerUserID := "user:postgres-owner-deletion"
		run := durableRun("run-owner-deletion-postgres", "conversation-owner-deletion-postgres", now)
		run.OwnerUserID = ownerUserID
		created, err := store.CreateRun(t.Context(), run)
		if err != nil {
			t.Fatalf("create owner deletion run: %v", err)
		}
		for index, status := range []execution.DurableRunStatus{
			execution.DurableRunStatusQueued,
			execution.DurableRunStatusAdmitted,
			execution.DurableRunStatusRunning,
		} {
			created, err = store.TransitionRun(
				t.Context(), created.RequestID, status, "", now.Add(time.Duration(index+1)*time.Second),
			)
			if err != nil {
				t.Fatalf("transition owner deletion run to %s: %v", status, err)
			}
		}
		step := execution.RunStepProjection{
			StepID: "agent.primary", RequestID: created.RequestID, ConversationID: created.ConversationID,
			StepKind: "agent", Status: "running", UpdatedAt: now.Add(4 * time.Second),
			PayloadSchemaVersion: "run-step-v1", SanitizedPayload: map[string]any{"phase": "running"},
		}
		if _, err := store.UpsertRunStep(t.Context(), step); err != nil {
			t.Fatalf("insert owner deletion step: %v", err)
		}
		attempt := execution.StepAttemptProjection{
			AttemptID: "owner-deletion-attempt", StepID: step.StepID, RequestID: created.RequestID,
			Attempt: 1, Status: "running", UpdatedAt: now.Add(4 * time.Second),
			PayloadSchemaVersion: "step-attempt-v1", SanitizedPayload: map[string]any{"phase": "running"},
		}
		if _, err := store.UpsertStepAttempt(t.Context(), attempt); err != nil {
			t.Fatalf("insert owner deletion attempt: %v", err)
		}
		if _, err := store.UpsertStepResult(t.Context(), execution.StepResultProjection{
			ResultID: "owner-deletion-result", StepID: step.StepID, RequestID: created.RequestID,
			AttemptID: attempt.AttemptID, Status: "completed", ResultKind: "answer",
			ProjectionRef: "projection://owner-deletion", CreatedAt: now.Add(4 * time.Second),
			PayloadSchemaVersion: "step-result-v1", SanitizedPayload: map[string]any{"status": "completed"},
		}); err != nil {
			t.Fatalf("insert owner deletion result: %v", err)
		}

		status, err := store.BeginOwnerDeletion(t.Context(), ownerUserID, now.Add(5*time.Second))
		if err != nil || status.State != execution.OwnerDeletionStateDraining || status.ActiveRuns != 1 {
			t.Fatalf("begin owner deletion status = %#v, err=%v", status, err)
		}
		commands, err := store.LeaseRunCancellationCommands(t.Context(), execution.LifecycleLeaseRequest{
			LeaseToken: "owner-deletion-cancel-lease", Now: now.Add(6 * time.Second),
			LeaseUntil: now.Add(time.Minute), Limit: 1,
		})
		if err != nil || len(commands) != 1 || commands[0].Reason != "account_deletion" {
			t.Fatalf("owner deletion cancellation command = %#v, err=%v", commands, err)
		}
		if err := store.ConfirmRunCancellationCommand(t.Context(), execution.RunCancellationCommandResult{
			RequestID: created.RequestID, LeaseToken: commands[0].LeaseToken, Now: now.Add(7 * time.Second),
		}); err != nil {
			t.Fatalf("confirm owner deletion cancellation: %v", err)
		}
		if _, err := store.FinalizeOwnerDeletion(t.Context(), execution.OwnerDeletionFinalizeRequest{
			OwnerUserID: ownerUserID, Now: now.Add(8 * time.Second),
		}); !errors.Is(err, execution.ErrOwnerDeletionNotDrained) {
			t.Fatalf("finalize before terminal run error = %v, want ErrOwnerDeletionNotDrained", err)
		}
		if _, err := store.CancelRunProjection(t.Context(), execution.DurableRunCancelRequest{
			RequestID: created.RequestID, Reason: "account_deletion", Now: now.Add(9 * time.Second),
		}); err != nil {
			t.Fatalf("cancel owner deletion run: %v", err)
		}
		status, err = store.FinalizeOwnerDeletion(t.Context(), execution.OwnerDeletionFinalizeRequest{
			OwnerUserID: ownerUserID, Now: now.Add(10 * time.Second),
		})
		if err != nil || status.State != execution.OwnerDeletionStateDeleted || status.ActiveRuns != 0 {
			t.Fatalf("finalize owner deletion status = %#v, err=%v", status, err)
		}
		conn := connect(t, databaseURL)
		defer closeConn(t, conn)
		for _, table := range []string{
			"agent_runs", "agent_run_events", "agent_run_steps", "agent_step_attempts",
			"agent_step_results", "agent_workflow_starts", "agent_run_cancellations",
		} {
			var count int
			if err := conn.QueryRow(t.Context(), "select count(*)::int from execution_control."+table+" where request_id = $1", created.RequestID).Scan(&count); err != nil {
				t.Fatalf("count deleted %s rows: %v", table, err)
			}
			if count != 0 {
				t.Fatalf("deleted %s rows = %d, want 0", table, count)
			}
		}
		var fenceState string
		if err := conn.QueryRow(t.Context(), `
			select state from execution_control.owner_deletion_fences where owner_user_id = $1
		`, ownerUserID).Scan(&fenceState); err != nil {
			t.Fatalf("read owner deletion tombstone: %v", err)
		}
		if fenceState != string(execution.OwnerDeletionStateDeleted) {
			t.Fatalf("owner deletion fence state = %q, want deleted", fenceState)
		}
		createdAfterDeletion := durableRun("run-owner-deletion-after", "conversation-owner-deletion-after", now.Add(11*time.Second))
		createdAfterDeletion.OwnerUserID = ownerUserID
		if _, err := store.CreateRun(t.Context(), createdAfterDeletion); !errors.Is(err, execution.ErrOwnerDeleted) {
			t.Fatalf("create run after owner deletion error = %v, want ErrOwnerDeleted", err)
		}
	})

	t.Run("superseded workflow execution binding is immutable for cancellation", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 23, 7, 30, 0, 0, time.UTC)
		run := durableRun("run-superseded-binding", "conversation-superseded-binding", now)
		workflowID := "campus-agent.chat." + run.RequestID
		request := execution.DurableRunCreateIntent{
			Run:                      run,
			RequestFingerprintSHA256: strings.Repeat("a", 64),
			WorkflowID:               workflowID,
			PayloadSHA256:            strings.Repeat("b", 64),
			TaskQueue:                run.TaskQueue,
			WorkflowInputJSON:        []byte(`{"request_id":"run-superseded-binding"}`),
			CreatedEvent: execution.DurableRunEvent{
				EventID: run.RequestID + ":run-created", RequestID: run.RequestID,
				ConversationID: run.ConversationID, EventType: execution.DurableRunEventTypeRunCreated,
				OccurredAt: now, Visibility: execution.DurableRunEventVisibilityInternal,
				PayloadSchemaVersion: "run-event-v1", Payload: map[string]any{"status": "created"},
			},
		}
		if _, err := store.CreateRunWithStartIntent(t.Context(), request); err != nil {
			t.Fatalf("create run with start: %v", err)
		}
		starts, err := store.LeaseWorkflowStartIntents(t.Context(), execution.LifecycleLeaseRequest{
			LeaseToken: "postgres-start-binding", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
		})
		if err != nil || len(starts) != 1 {
			t.Fatalf("lease start = %#v, err=%v", starts, err)
		}
		if err := store.MarkWorkflowStartDispatchAttempt(t.Context(), execution.WorkflowStartIntentResult{
			RequestID: run.RequestID, LeaseToken: starts[0].LeaseToken, Now: now.Add(time.Second),
		}); err != nil {
			t.Fatalf("mark dispatch: %v", err)
		}
		if _, err := store.RequestRunCancellation(t.Context(), execution.DurableRunCancellationRequest{
			RequestID: run.RequestID, Reason: "user_requested", Now: now.Add(2 * time.Second),
		}); err != nil {
			t.Fatalf("request cancellation: %v", err)
		}
		boundAt := now.Add(3 * time.Second)
		binding := execution.WorkflowStartExecutionBinding{
			RequestID: run.RequestID, WorkflowID: workflowID,
			TemporalRunID: "temporal-postgres-bound", Now: boundAt,
		}
		bound, err := store.BindSupersededWorkflowStartExecution(t.Context(), binding)
		if err != nil || bound.State != execution.LifecycleIntentStateSuperseded ||
			bound.TemporalRunID != binding.TemporalRunID {
			t.Fatalf("bound start = %#v, err=%v", bound, err)
		}
		replayed := binding
		replayed.Now = boundAt.Add(time.Minute)
		if got, err := store.BindSupersededWorkflowStartExecution(t.Context(), replayed); err != nil ||
			!got.UpdatedAt.Equal(boundAt) {
			t.Fatalf("idempotent binding = %#v, err=%v", got, err)
		}
		conflict := binding
		conflict.TemporalRunID = "temporal-postgres-conflict"
		if _, err := store.BindSupersededWorkflowStartExecution(t.Context(), conflict); !errors.Is(
			err,
			execution.ErrWorkflowStartExecutionBindingConflict,
		) {
			t.Fatalf("conflicting binding error = %v", err)
		}
		if _, err := store.CancelRunProjection(t.Context(), execution.DurableRunCancelRequest{
			RequestID: run.RequestID, Reason: "user_requested", Now: now.Add(4 * time.Second),
		}); err != nil {
			t.Fatalf("cancel bound run: %v", err)
		}
	})

	t.Run("undispatched superseded workflow rejects execution binding", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 23, 7, 40, 0, 0, time.UTC)
		run := durableRun("run-undispatched-binding", "conversation-undispatched-binding", now)
		workflowID := "campus-agent.chat." + run.RequestID
		request := execution.DurableRunCreateIntent{
			Run:                      run,
			RequestFingerprintSHA256: strings.Repeat("a", 64),
			WorkflowID:               workflowID,
			PayloadSHA256:            strings.Repeat("b", 64),
			TaskQueue:                run.TaskQueue,
			WorkflowInputJSON:        []byte(`{"request_id":"run-undispatched-binding"}`),
			CreatedEvent: execution.DurableRunEvent{
				EventID: run.RequestID + ":run-created", RequestID: run.RequestID,
				ConversationID: run.ConversationID, EventType: execution.DurableRunEventTypeRunCreated,
				OccurredAt: now, Visibility: execution.DurableRunEventVisibilityInternal,
				PayloadSchemaVersion: "run-event-v1", Payload: map[string]any{"status": "created"},
			},
		}
		if _, err := store.CreateRunWithStartIntent(t.Context(), request); err != nil {
			t.Fatalf("create run with start: %v", err)
		}
		if _, err := store.RequestRunCancellation(t.Context(), execution.DurableRunCancellationRequest{
			RequestID: run.RequestID, Reason: "user_requested", Now: now.Add(time.Second),
		}); err != nil {
			t.Fatalf("request cancellation: %v", err)
		}
		if _, err := store.BindSupersededWorkflowStartExecution(
			t.Context(),
			execution.WorkflowStartExecutionBinding{
				RequestID: run.RequestID, WorkflowID: workflowID,
				TemporalRunID: "temporal-without-dispatch", Now: now.Add(2 * time.Second),
			},
		); !errors.Is(err, execution.ErrWorkflowStartExecutionBindingConflict) {
			t.Fatalf("undispatched binding error = %v, want binding conflict", err)
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
		if _, err := store.UpsertStepResult(t.Context(), execution.StepResultProjection{
			ResultID:             run.RequestID + ":finalization.write:result-1",
			StepID:               "finalization.write",
			RequestID:            run.RequestID,
			AttemptID:            run.RequestID + ":finalization.write:attempt-1",
			Status:               "completed",
			ResultKind:           "final_answer_projection",
			ProjectionRef:        "app-api:response:terminal-race",
			CreatedAt:            now,
			PayloadSchemaVersion: "step-result-projection-v1",
			SanitizedPayload:     map[string]any{"activity_attempt": 1},
		}); err != nil {
			t.Fatalf("create finalization proof: %v", err)
		}

		start := make(chan struct{})
		result := make(chan error, 2)
		var waitGroup sync.WaitGroup
		waitGroup.Add(2)
		go func() {
			defer waitGroup.Done()
			<-start
			_, err := store.CompleteRunProjection(t.Context(), execution.DurableRunCompleteRequest{
				RequestID:        run.RequestID,
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
				RequestID:      run.RequestID,
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
			case errors.Is(err, execution.ErrDurableRunTerminalConflict):
				rejected++
			default:
				t.Fatalf("terminal transition error = %v", err)
			}
		}
		if succeeded != 1 || rejected != 1 {
			t.Fatalf("terminal results = %d succeeded/%d rejected, want 1/1", succeeded, rejected)
		}
		stored, err := store.GetRun(t.Context(), run.RequestID)
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
		if _, err := store.CreateRun(t.Context(), run); err != nil {
			t.Fatalf("create running run: %v", err)
		}
		if _, err := conn.Exec(
			t.Context(),
			`insert into execution_control.conversation_run_locks (conversation_id, request_id) values ($1, $2)`,
			run.ConversationID,
			run.RequestID,
		); err != nil {
			t.Fatalf("insert conversation lock: %v", err)
		}
		failedAt := now.Add(time.Second + 789*time.Nanosecond)
		request := execution.DurableRunFailRequest{
			RequestID:      run.RequestID,
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
		if failed.Status != execution.DurableRunStatusFailed {
			t.Fatalf("failed run = %#v", failed)
		}
		var lockCount int
		if err := conn.QueryRow(
			t.Context(),
			`select count(*) from execution_control.conversation_run_locks where conversation_id = $1`,
			run.ConversationID,
		).Scan(&lockCount); err != nil {
			t.Fatalf("count released conversation lock: %v", err)
		}
		if lockCount != 0 {
			t.Fatalf("conversation lock count = %d, want 0", lockCount)
		}
		events, err := store.ListRunEvents(t.Context(), run.RequestID)
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
			map[string]any{"failure_kind": "worker_unavailable", "status": "failed"},
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
			`insert into execution_control.conversation_run_locks (conversation_id, request_id) values ($1, $2)`,
			collisionRun.ConversationID,
			collisionRun.RequestID,
		); err != nil {
			t.Fatalf("insert collision conversation lock: %v", err)
		}
		if _, err := store.AppendRunEvent(t.Context(), execution.DurableRunEvent{
			EventID:              collisionRun.RequestID + ":run-failed",
			RequestID:            collisionRun.RequestID,
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
			RequestID:      collisionRun.RequestID,
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
		stored, err := store.GetRun(t.Context(), collisionRun.RequestID)
		if err != nil || stored.Status != execution.DurableRunStatusRunning {
			t.Fatalf("collision run after rollback = %#v, error = %v", stored, err)
		}
		if err := conn.QueryRow(
			t.Context(),
			`select count(*) from execution_control.conversation_run_locks where conversation_id = $1`,
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
					RequestID:            run.RequestID,
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
		events, err := store.ListRunEvents(t.Context(), run.RequestID)
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

	t.Run("expiry transition and browser event are atomic", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
		run := durableRun("run-expiry-atomic", "conversation-expiry-atomic", now)
		run.Status = execution.DurableRunStatusRunning
		run.StartedAt = now
		if _, err := store.CreateRun(t.Context(), run); err != nil {
			t.Fatal(err)
		}
		expiredAt := now.Add(15 * time.Minute)
		request := execution.DurableRunExpireRequest{RequestID: run.RequestID, Now: expiredAt}
		expired, err := store.ExpireRunProjection(t.Context(), request)
		if err != nil {
			t.Fatal(err)
		}
		if expired.Status != execution.DurableRunStatusExpired || !expired.Retryable ||
			expired.TerminalReason != execution.DurableTerminalReasonRunTimeout {
			t.Fatalf("expired run = %#v", expired)
		}
		events, err := store.ListRunEvents(t.Context(), run.RequestID)
		if err != nil || len(events) != 1 || events[0].EventType != execution.DurableRunEventTypeRunExpired {
			t.Fatalf("expiry events = %#v, err=%v", events, err)
		}
		if _, err := store.ExpireRunProjection(t.Context(), request); err != nil {
			t.Fatalf("replay expiry: %v", err)
		}
		if _, err := store.CreateRun(t.Context(), durableRun(
			"run-after-expiry", run.ConversationID, expiredAt.Add(time.Second),
		)); err != nil {
			t.Fatalf("create next run after expiry: %v", err)
		}

		collision := durableRun("run-expiry-collision", "conversation-expiry-collision", now)
		collision.Status = execution.DurableRunStatusRunning
		collision.StartedAt = now
		if _, err := store.CreateRun(t.Context(), collision); err != nil {
			t.Fatal(err)
		}
		if _, err := store.AppendRunEvent(t.Context(), execution.DurableRunEvent{
			EventID: collision.RequestID + ":run-expired", RequestID: collision.RequestID,
			ConversationID: collision.ConversationID, EventType: execution.DurableRunEventTypeActivityFailed,
			OccurredAt: now, Visibility: execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1", Payload: map[string]any{"failure_kind": "earlier"},
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.ExpireRunProjection(t.Context(), execution.DurableRunExpireRequest{
			RequestID: collision.RequestID, Now: expiredAt,
		}); !errors.Is(err, execution.ErrDurableRunExpiryConflict) {
			t.Fatalf("expiry collision error = %v", err)
		}
		stored, err := store.GetRun(t.Context(), collision.RequestID)
		if err != nil || stored.Status != execution.DurableRunStatusRunning {
			t.Fatalf("collision run after rollback = %#v, err=%v", stored, err)
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
			RequestID:            run.RequestID,
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
			RequestID:            run.RequestID,
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
			RequestID:            run.RequestID,
			AttemptID:            attempt.AttemptID,
			Status:               "completed",
			ResultKind:           "answer",
			ProjectionRef:        "projection:answer:1",
			CreatedAt:            now.Add(3*time.Second + 789*time.Nanosecond),
			PayloadSchemaVersion: "step-result-v1",
			SanitizedPayload: map[string]any{
				"large_counter": int64(9007199254740993),
				"shape":         "answer",
			},
		}
		createdResult, err := store.UpsertStepResult(t.Context(), result)
		if err != nil {
			t.Fatalf("upsert step result: %v", err)
		}
		wantCreatedAt := result.CreatedAt.UTC().Truncate(time.Microsecond)
		if !createdResult.CreatedAt.Equal(wantCreatedAt) {
			t.Fatalf("created result time = %s, want %s", createdResult.CreatedAt, wantCreatedAt)
		}
		replayedResult, err := store.UpsertStepResult(t.Context(), result)
		if err != nil {
			t.Fatalf("replay identical step result: %v", err)
		}
		if !replayedResult.CreatedAt.Equal(wantCreatedAt) || replayedResult.Status != result.Status {
			t.Fatalf("replayed result = %#v, want the original result", replayedResult)
		}
		result.Status = "published"
		if _, err := store.UpsertStepResult(t.Context(), result); !errors.Is(
			err,
			execution.ErrStepResultProjectionConflict,
		) {
			t.Fatalf("changed step result replay error = %v, want ErrStepResultProjectionConflict", err)
		}

		steps, err := store.ListRunSteps(t.Context(), run.RequestID)
		if err != nil || len(steps) != 1 || steps[0].Status != "completed" {
			t.Fatalf("steps = %#v, error = %v", steps, err)
		}
		attempts, err := store.ListStepAttempts(t.Context(), run.RequestID)
		if err != nil || len(attempts) != 1 || attempts[0].DurationMS != 2000 {
			t.Fatalf("attempts = %#v, error = %v", attempts, err)
		}
		results, err := store.ListStepResults(t.Context(), run.RequestID)
		if err != nil || len(results) != 1 || results[0].Status != "completed" ||
			!results[0].CreatedAt.Equal(wantCreatedAt) {
			t.Fatalf("results = %#v, error = %v", results, err)
		}
		if _, err := store.CancelRunProjection(t.Context(), execution.DurableRunCancelRequest{
			RequestID: run.RequestID,
			Reason:    "integration terminal write fence",
			Now:       now.Add(4 * time.Second),
		}); err != nil {
			t.Fatalf("cancel trajectory run: %v", err)
		}
		result.Status = "completed"
		for name, terminalResult := range map[string]execution.StepResultProjection{
			"identical replay": result,
			"new result": {
				ResultID:             "result-primary-after-terminal",
				StepID:               step.StepID,
				RequestID:            run.RequestID,
				AttemptID:            attempt.AttemptID,
				Status:               "completed",
				ResultKind:           "answer",
				ProjectionRef:        "projection:answer:after-terminal",
				CreatedAt:            now.Add(5 * time.Second),
				PayloadSchemaVersion: "step-result-v1",
				SanitizedPayload:     map[string]any{"shape": "late-answer"},
			},
		} {
			if _, err := store.UpsertStepResult(t.Context(), terminalResult); !errors.Is(
				err,
				execution.ErrDurableRunTerminalConflict,
			) {
				t.Fatalf("%s error = %v, want ErrDurableRunTerminalConflict", name, err)
			}
		}

		if err := store.DeleteRun(t.Context(), run.RequestID); err != nil {
			t.Fatalf("delete run: %v", err)
		}
		ownerURL := harness.databaseURL(t, databaseName, ownerRole, ownerPassword)
		conn := connect(t, ownerURL)
		defer closeConn(t, conn)
		for _, table := range []string{
			"execution_control.agent_run_events",
			"execution_control.agent_run_steps",
			"execution_control.agent_step_attempts",
			"execution_control.agent_step_results",
			"execution_control.conversation_run_locks",
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

	t.Run("completed runs accept only post-answer memory results", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		store := newRunProjectionStore(t, databaseURL, true)
		now := time.Date(2026, 7, 23, 15, 0, 0, 0, time.UTC)
		run := durableRun("run-post-answer-memory", "conversation-post-answer-memory", now)
		if _, err := store.CreateRun(t.Context(), run); err != nil {
			t.Fatalf("create post-answer memory run: %v", err)
		}
		for index, status := range []execution.DurableRunStatus{
			execution.DurableRunStatusQueued,
			execution.DurableRunStatusAdmitted,
			execution.DurableRunStatusRunning,
		} {
			if _, err := store.TransitionRun(
				t.Context(),
				run.RequestID,
				status,
				"",
				now.Add(time.Duration(index+1)*time.Second),
			); err != nil {
				t.Fatalf("transition post-answer memory run to %s: %v", status, err)
			}
		}
		finalResponseRef := "projection://runs/run-post-answer-memory/finalization/write"
		if _, err := store.UpsertStepResult(t.Context(), execution.StepResultProjection{
			ResultID:             run.RequestID + ":finalization.write:result:1",
			StepID:               "finalization.write",
			RequestID:            run.RequestID,
			AttemptID:            run.RequestID + ":finalization.write:attempt:1",
			Status:               "completed",
			ResultKind:           "final_answer_projection",
			ProjectionRef:        finalResponseRef,
			CreatedAt:            now.Add(3500 * time.Millisecond),
			PayloadSchemaVersion: "step-result-v1",
			SanitizedPayload:     map[string]any{"status": "completed"},
		}); err != nil {
			t.Fatalf("create finalization result before completion: %v", err)
		}
		if _, err := store.CompleteRunProjection(t.Context(), execution.DurableRunCompleteRequest{
			RequestID:        run.RequestID,
			TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
			FinalResponseRef: finalResponseRef,
			Now:              now.Add(4 * time.Second),
		}); err != nil {
			t.Fatalf("complete post-answer memory run: %v", err)
		}

		memoryResults := []execution.StepResultProjection{{
			ResultID:             run.RequestID + ":memory.append:result:1",
			StepID:               "memory.append",
			RequestID:            run.RequestID,
			AttemptID:            run.RequestID + ":memory.append:attempt:1",
			Status:               "completed",
			ResultKind:           "memory_conversation_append_result",
			ProjectionRef:        "projection://runs/run-post-answer-memory/memory/append",
			CreatedAt:            now.Add(5 * time.Second),
			PayloadSchemaVersion: "step-result-v1",
			SanitizedPayload:     map[string]any{"status": "completed"},
		}}
		for _, result := range memoryResults {
			if _, err := store.UpsertStepResult(t.Context(), result); err != nil {
				t.Fatalf("create %s post-completion result: %v", result.StepID, err)
			}
			if _, err := store.UpsertStepResult(t.Context(), result); err != nil {
				t.Fatalf("replay %s post-completion result: %v", result.StepID, err)
			}
		}
		conflict := memoryResults[0]
		conflict.SanitizedPayload = map[string]any{"status": "changed"}
		if _, err := store.UpsertStepResult(t.Context(), conflict); !errors.Is(
			err,
			execution.ErrStepResultProjectionConflict,
		) {
			t.Fatalf("post-completion memory conflict error = %v", err)
		}
		mismatched := memoryResults[0]
		mismatched.ResultID = run.RequestID + ":memory.append:wrong-kind:result:1"
		mismatched.ResultKind = "agent_final_output"
		if _, err := store.UpsertStepResult(t.Context(), mismatched); !errors.Is(
			err,
			execution.ErrDurableRunTerminalConflict,
		) {
			t.Fatalf("mismatched post-completion memory result error = %v", err)
		}
		results, err := store.ListStepResults(t.Context(), run.RequestID)
		if err != nil || len(results) != len(memoryResults)+1 ||
			results[0].SanitizedPayload["status"] != "completed" {
			t.Fatalf("post-completion memory results = %#v, error = %v", results, err)
		}

		canceled := durableRun("run-canceled-memory", "conversation-canceled-memory", now)
		if _, err := store.CreateRun(t.Context(), canceled); err != nil {
			t.Fatalf("create canceled memory run: %v", err)
		}
		if _, err := store.CancelRunProjection(t.Context(), execution.DurableRunCancelRequest{
			RequestID: canceled.RequestID,
			Reason:    "integration terminal memory fence",
			Now:       now.Add(time.Second),
		}); err != nil {
			t.Fatalf("cancel memory run: %v", err)
		}
		lateMemoryResult := memoryResults[0]
		lateMemoryResult.ResultID = canceled.RequestID + ":memory.append:result:1"
		lateMemoryResult.RequestID = canceled.RequestID
		if _, err := store.UpsertStepResult(t.Context(), lateMemoryResult); !errors.Is(
			err,
			execution.ErrDurableRunTerminalConflict,
		) {
			t.Fatalf("canceled memory result error = %v", err)
		}
	})
}

func newRunProjectionStore(
	t *testing.T,
	databaseURL string,
	prepareSchema bool,
) *executionpersistence.PostgresRunProjectionStore {
	t.Helper()
	if prepareSchema {
		requireSchema(t, databaseURL)
	}
	store, err := executionpersistence.NewPostgresRunProjectionStore(
		t.Context(),
		executionpersistence.PostgresRunProjectionStoreOptions{
			DatabaseURL: databaseURL,
		},
	)
	if err != nil {
		t.Fatalf("create run projection store: %v", err)
	}
	t.Cleanup(store.Close)
	return store
}

func waitForRunEventListenerPID(
	t *testing.T,
	databaseURL string,
	present bool,
) int32 {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		var pid int32
		err := conn.QueryRow(
			t.Context(),
			`select pid
			 from pg_stat_activity
			 where datname = current_database()
			   and usename = $1
			   and lower(query) like 'listen campus_agent_run_events%'
			 order by backend_start desc
			 limit 1`,
			ownerRole,
		).Scan(&pid)
		found := err == nil
		if present && found {
			return pid
		}
		if !present && errors.Is(err, pgx.ErrNoRows) {
			return 0
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("inspect run event listener backend: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if present {
		t.Fatalf("run event listener backend did not become visible")
	} else {
		t.Fatalf("run event listener backend did not terminate")
	}
	return 0
}

func terminateRunEventListener(t *testing.T, databaseURL string, pid int32) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var terminated bool
	if err := conn.QueryRow(t.Context(), `select pg_terminate_backend($1)`, pid).Scan(&terminated); err != nil {
		t.Fatalf("terminate run event listener backend: %v", err)
	}
	if !terminated {
		t.Fatalf("terminate run event listener backend returned false for pid %d", pid)
	}
}

func waitForRunProjectionHealth(
	t *testing.T,
	store *executionpersistence.PostgresRunProjectionStore,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		checkCtx, cancel := context.WithTimeout(t.Context(), 250*time.Millisecond)
		lastErr = store.HealthCheck(checkCtx)
		cancel()
		if lastErr == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("run projection health did not recover: %v", lastErr)
}

func durableRun(runID, conversationID string, now time.Time) execution.DurableRun {
	return execution.DurableRun{
		RequestID:      runID,
		ConversationID: conversationID,
		OwnerUserID:    "user:integration",
		Surface:        "testcontainers",
		TaskQueue:      "campus-agent.integration",
		Status:         execution.DurableRunStatusCreated,
		CreatedAt:      now,
		UpdatedAt:      now,
		RuntimeVersions: map[string]any{
			"execution_control": "integration",
		},
		Metadata: map[string]any{
			"execution_contract_version": "tool_execution_v7",
			"execution_input_ref":        "app-api://execution-inputs/" + runID,
			"execution_input_sha256":     strings.Repeat("a", 64),
		},
	}
}

func createPostgresRunningRun(
	t *testing.T,
	store *executionpersistence.PostgresRunProjectionStore,
	runID string,
	now time.Time,
) execution.DurableRun {
	t.Helper()
	run, err := store.CreateRun(t.Context(), durableRun(runID, "conversation-"+runID, now))
	if err != nil {
		t.Fatalf("create run %s: %v", runID, err)
	}
	for index, status := range []execution.DurableRunStatus{
		execution.DurableRunStatusQueued,
		execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
	} {
		run, err = store.TransitionRun(
			t.Context(),
			run.RequestID,
			status,
			"",
			now.Add(time.Duration(index+1)*time.Second),
		)
		if err != nil {
			t.Fatalf("transition run %s to %s: %v", runID, status, err)
		}
	}
	return run
}

func postgresAnswerStreamStartRequest(
	run execution.DurableRun,
	now time.Time,
) execution.RunAnswerStreamStartRequest {
	return execution.RunAnswerStreamStartRequest{
		RequestID: run.RequestID,
		Now:       now,
		AnswerStartedEvent: execution.DurableRunEvent{
			EventID:              run.RequestID + ":answer-started",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunAnswerStarted,
			OccurredAt:           now,
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-answer-event-v2",
			Payload:              map[string]any{"status": "streaming"},
		},
		FirstDeltaEvent: execution.DurableRunEvent{
			EventID:              run.RequestID + ":answer-delta:1",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunAnswerDelta,
			OccurredAt:           now,
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-answer-event-v2",
			Payload:              map[string]any{"chunk_index": 1, "delta": "first"},
		},
	}
}

func postgresFailedRunTerminalEvent(
	run execution.DurableRun,
	now time.Time,
	payload map[string]any,
) execution.DurableRunEvent {
	return execution.DurableRunEvent{
		EventID:              run.RequestID + ":run-failed",
		RequestID:            run.RequestID,
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
