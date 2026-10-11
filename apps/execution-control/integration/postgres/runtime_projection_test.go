//go:build postgres_integration

package postgres_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/operation"
	projection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeapi"
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
	service := &operation.OperationService{StateWriter: store, Writer: projection.New(projection.Writer{RunProjectionStore: interrupted, WorkerID: "runtime-test"}), InputReader: &executionapplication.InputReader{ExecutionInputLoader: instanceInputs{}}, Options: operation.Options{Configured: true, AnswerTransport: "buffered", DeploymentRelease: "test"}}
	server := httptest.NewServer(&runtimeapi.Server{SharedSecret: "test", Operations: service, Store: store, Receipts: store.Receipts})
	defer server.Close()
	for _, name := range []string{"direct", "plan", "execute", "synthesize", "recovery", "deadline", "replan-invalid", "replan-valid"} {
		createPostgresFinalizationRun(t, store, "runtime-"+name, time.Now().UTC().Add(-time.Second))
	}
	command := exec.CommandContext(t.Context(), "pnpm", "--dir", "apps/agent-runtime", "exec", "tsx", "test/helpers/control-projection.ts", server.URL)
	command.Dir = filepath.Clean(h.repositoryRoot)
	out, err := command.CombinedOutput()
	require.NoError(t, err, string(out))
	require.True(t, interrupted.interrupted)
	conn := connect(t, url)
	defer closeConn(t, conn)
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
