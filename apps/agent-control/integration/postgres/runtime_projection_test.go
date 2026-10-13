//go:build postgres_integration

package postgres_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	projection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/runtimeapi"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

type interruptedProjectionStore struct {
	*executionpersistence.PostgresRunProjectionStore
	interrupted bool
}

func (s *interruptedProjectionStore) UpsertStepResult(ctx context.Context, result execution.StepResultProjection) (execution.StepResultProjection, error) {
	if !s.interrupted && result.StepID == "solve.initial" && result.Status == "completed" {
		s.interrupted = true
		return execution.StepResultProjection{}, errors.New("projection interrupted after step write")
	}
	return s.PostgresRunProjectionStore.UpsertStepResult(ctx, result)
}
func testRuntimeActivityProjection(t *testing.T, h *postgresHarness) {
	_, url := h.ownerDatabase(t)
	store := newRunProjectionStore(t, url, true)
	interrupted := &interruptedProjectionStore{PostgresRunProjectionStore: store}

	service := &operation.RunProjectionService{Answers: store, StateWriter: store, Writer: projection.New(projection.Writer{RunProjectionStore: interrupted, WorkerID: "runtime-test"}), DeploymentRelease: "test"}
	server := httptest.NewServer(&runtimeapi.Server{SharedSecret: "test", ActivityStore: store, Projection: service, Input: &operation.RuntimeInputService{Projection: service, InputReader: &executionapplication.InputReader{ExecutionInputLoader: instanceInputs{}}, AnswerTransport: "buffered"}, Store: store, Invocation: &executionapplication.RuntimeInvocationService{Receipts: store.Receipts, Runs: service}})

	defer server.Close()
	conn := connect(t, url)
	defer closeConn(t, conn)
	for _, name := range []string{"direct", "plan", "execute", "synthesize", "recovery", "deadline", "replan-invalid", "replan-valid"} {
		run := createPostgresFinalizationRun(t, store, "runtime-"+name, time.Now().UTC().Add(-time.Second))
		_, err := conn.Exec(t.Context(), `insert into execution_control.agent_workflow_starts(request_id,workflow_id,payload_sha256,task_queue,workflow_input_json,state,temporal_run_id,next_attempt_at,created_at,updated_at) values($1,$2,$3,'test','{}','confirmed',$4,now(),now(),now())`, run.RequestID, "workflow-"+run.RequestID, strings.Repeat("a", 64), "temporal-"+run.RequestID)
		require.NoError(t, err)
	}
	command := exec.CommandContext(t.Context(), "pnpm", "--dir", "apps/agent-runtime", "exec", "tsx", "test/helpers/control-projection.ts", server.URL)
	command.Dir = filepath.Clean(h.repositoryRoot)
	out, err := command.CombinedOutput()
	require.NoError(t, err, string(out))
	require.True(t, interrupted.interrupted)
	var receipts int
	require.NoError(t, conn.QueryRow(t.Context(), `select count(*) from execution_control.agent_invocation_receipts where invocation_id not like '%:model:%'`).Scan(&receipts))
	require.Zero(t, receipts, "projection must not claim model invocations")
	for _, name := range []string{"direct", "plan", "execute", "synthesize", "recovery", "deadline", "replan-invalid", "replan-valid"} {
		steps, err := store.ListRunSteps(t.Context(), "runtime-"+name)
		require.NoError(t, err)
		require.NotEmpty(t, steps)
		require.Len(t, steps, 1)
		step := steps[0]
		expectedStatus := "completed"
		if name == "deadline" || name == "replan-invalid" {
			expectedStatus = "failed"
		}
		require.Equal(t, expectedStatus, step.Status)
		completion, err := store.GetRuntimePayload(t.Context(), step.RequestID, "stage:"+step.StepID+":prepared:completion")
		require.NoError(t, err)
		var saved struct {
			CompletedAt time.Time `json:"completed_at"`
		}
		require.NoError(t, json.Unmarshal(completion, &saved))
		require.True(t, step.CompletedAt.Equal(saved.CompletedAt), "completion timestamp changed on replay")
		attempts, err := store.ListStepAttempts(t.Context(), step.RequestID)
		require.NoError(t, err)
		require.Len(t, attempts, 1)
		require.Equal(t, expectedStatus, attempts[0].Status)
		results, err := store.ListStepResults(t.Context(), step.RequestID)
		require.NoError(t, err)
		require.Len(t, results, 1)
		require.True(t, results[0].CreatedAt.Equal(saved.CompletedAt))
		events, err := store.ListRunEvents(t.Context(), step.RequestID)
		require.NoError(t, err)
		completed, answerStarted, answerCompleted := 0, 0, 0
		for _, event := range events {
			switch event.EventType {
			case execution.DurableRunEventTypeWorkflowOperationCompleted:
				completed++
			case execution.DurableRunEventTypeRunAnswerStarted:
				answerStarted++
			case execution.DurableRunEventTypeRunAnswerCompleted:
				answerCompleted++
			}
		}
		require.Equal(t, 1, completed)
		if name == "direct" || name == "synthesize" {
			require.Equal(t, 1, answerStarted)
			require.Equal(t, 1, answerCompleted)
		}

	}
}

func testRuntimePayloadLifecycle(t *testing.T, h *postgresHarness) {
	_, url := h.ownerDatabase(t)
	store := newRunProjectionStore(t, url, true)
	conn := connect(t, url)
	defer closeConn(t, conn)
	run := createPostgresFinalizationRun(t, store, "payload-lifecycle", time.Now().UTC())
	require.NoError(t, store.PutRuntimePayload(t.Context(), run.RequestID, "input", json.RawMessage(`{"answer":"saved"}`)))
	require.NoError(t, store.DeleteRuntimePayloads(t.Context(), run.RequestID))
	_, err := store.GetRuntimePayload(t.Context(), run.RequestID, "input")
	require.NoError(t, err, "active run must retain its input")
	// Product terminal state alone is insufficient while finalization projection repair remains.
	_, err = conn.Exec(t.Context(), `update execution_control.agent_runs set status='completed',terminal_reason='answer_completed',completed_at=now() where request_id=$1`, run.RequestID)
	require.NoError(t, err)
	candidates, err := store.ListTerminalRuntimePayloads(t.Context(), "", 32)
	require.NoError(t, err)
	require.Empty(t, candidates)
	require.NoError(t, store.DeleteRuntimePayloads(t.Context(), run.RequestID))
	_, err = store.GetRuntimePayload(t.Context(), run.RequestID, "input")
	require.NoError(t, err)
	_, err = store.AppendRunEvent(t.Context(), execution.DurableRunEvent{EventID: run.RequestID + ":run-completed", RequestID: run.RequestID, ConversationID: run.ConversationID, EventType: execution.DurableRunEventTypeRunCompleted, OccurredAt: time.Now().UTC(), Visibility: execution.DurableRunEventVisibilityBrowser, PayloadSchemaVersion: "run-event-v1", Payload: map[string]any{"status": "completed"}})
	require.NoError(t, err)
	candidates, err = store.ListTerminalRuntimePayloads(t.Context(), "", 32)
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	for range 2 {
		require.NoError(t, store.DeleteRuntimePayloads(t.Context(), run.RequestID))
	}
	_, err = store.GetRuntimePayload(t.Context(), run.RequestID, "input")
	require.ErrorIs(t, err, pgx.ErrNoRows)
}
