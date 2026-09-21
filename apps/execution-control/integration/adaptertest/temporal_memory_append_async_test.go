package adaptertest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
)

type asyncMemoryFake struct {
	submits     int
	polls       int
	status      string
	errorDetail string
	httpStatus  int
	submitErr   error
	queryErr    error
}

type appendResultFailureStore struct {
	*executionpersistence.InMemoryRunProjectionStore
	failResult bool
}

func (s *appendResultFailureStore) UpsertStepResult(ctx context.Context, result execution.StepResultProjection) (execution.StepResultProjection, error) {
	if result.StepID == "memory.append" && s.failResult {
		s.failResult = false
		return execution.StepResultProjection{}, errors.New("result storage unavailable")
	}
	return s.InMemoryRunProjectionStore.UpsertStepResult(ctx, result)
}

func TestAsyncMemoryAppendActivityUsesBackgroundWorkflowIdentity(t *testing.T) {
	for _, validIdentity := range []bool{true, false} {
		t.Run(map[bool]string{true: "background", false: "unrelated"}[validIdentity], func(t *testing.T) {
			store := executionpersistence.NewInMemoryRunProjectionStore()
			now := time.Now().UTC()
			requestID := "activity-identity"
			createMemoryAppendRunForTest(t, store, requestID, "我希望回答简短", ptrBool(true), now)
			adapter := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "salt"})
			attachRunProjectionStoreForAdapterTest(adapter, store)
			remote := &asyncMemoryFake{status: "completed"}
			adapter.AsyncMemoryExecutor = remote
			adapter.PersonalMemoryStateStore = memorypersistence.NewInMemoryStateStore()
			env := (&testsuite.WorkflowTestSuite{}).NewTestWorkflowEnvironment()
			workflowID := "unrelated"
			if validIdentity {
				workflowID = "memory.append/" + requestID
			}
			env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: workflowID})
			env.RegisterActivityWithOptions(adapter.AdvanceMemoryAppendActivity, activity.RegisterOptions{Name: temporalruntime.AdvanceMemoryAppendActivityName})
			env.ExecuteWorkflow(temporalruntime.MemoryAppendWorkflow, temporalruntime.MemoryAppendWorkflowInput{RequestID: requestID})
			if validIdentity {
				require.NoError(t, env.GetWorkflowError())
				require.Equal(t, 1, remote.submits)
				require.Equal(t, 1, remote.polls)
			} else {
				require.ErrorContains(t, env.GetWorkflowError(), "memory append workflow identity mismatch")
				require.Zero(t, remote.submits)
			}
		})
	}
}

func (f *asyncMemoryFake) SubmitConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	f.submits++
	return memoryruntime.AppendOperation{Status: "pending"}, f.submitErr
}
func (f *asyncMemoryFake) GetConversationTurnOperation(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	f.polls++
	return memoryruntime.AppendOperation{Status: f.status, ErrorCode: "hindsight_append_failed", ErrorDetail: f.errorDetail, HTTPStatus: f.httpStatus}, f.queryErr
}

func TestAsyncMemoryAppendRetainsFenceUntilConfirmedTerminal(t *testing.T) {
	for _, terminal := range []string{"completed", "failed"} {
		t.Run(terminal, func(t *testing.T) {
			ctx := t.Context()
			store := executionpersistence.NewInMemoryRunProjectionStore()
			now := time.Now().UTC().Add(-10 * time.Minute)
			requestID := "async-" + terminal
			createMemoryAppendRunForTest(t, store, requestID, "我希望回答简短", ptrBool(true), now)
			state := memorypersistence.NewInMemoryStateStore()
			remote := &asyncMemoryFake{status: "processing", submitErr: errors.New("acknowledgement lost"), errorDetail: "Hindsight reported an upstream HTTP failure during retain processing.", httpStatus: 503}
			adapter := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "salt"})
			attachRunProjectionStoreForAdapterTest(adapter, store)
			adapter.AsyncMemoryExecutor = remote
			failingStore := &appendResultFailureStore{InMemoryRunProjectionStore: store}
			adapter.RunProjectionStore = failingStore
			adapter.PersonalMemoryStateStore = state
			input := temporalruntime.MemoryAppendWorkflowInput{RequestID: requestID, StartedAt: now}
			owner := memoryruntime.OwnerScopeHash("salt", "tenant-main", "user-executor")
			out, err := adapter.AdvanceMemoryAppendActivity(ctx, input)
			require.NoError(t, err)
			require.Equal(t, "running", out.Status)
			drained, err := state.GenerationDrained(ctx, owner, 1)
			require.NoError(t, err)
			require.False(t, drained)
			require.ErrorIs(t, state.MarkOwnerDeleted(ctx, owner), memoryruntime.ErrMemoryOwnerNotDrained)
			remote.submitErr = nil
			input.Submitted = true
			remote.queryErr = errors.New("connection interrupted")
			_, err = adapter.AdvanceMemoryAppendActivity(ctx, input)
			require.Error(t, err)
			remote.queryErr = nil
			remote.status = "not_found"
			out, err = adapter.AdvanceMemoryAppendActivity(ctx, input)
			require.NoError(t, err)
			require.Equal(t, "running", out.Status)
			drained, err = state.GenerationDrained(ctx, owner, 1)
			require.NoError(t, err)
			require.False(t, drained)
			remote.status = terminal
			failingStore.failResult = true
			_, err = adapter.AdvanceMemoryAppendActivity(ctx, input)
			require.ErrorContains(t, err, "result storage unavailable")
			drained, err = state.GenerationDrained(ctx, owner, 1)
			require.NoError(t, err)
			require.False(t, drained)
			pollsBeforeRepair := remote.polls
			out, err = adapter.AdvanceMemoryAppendActivity(ctx, input)
			require.NoError(t, err)
			require.Equal(t, pollsBeforeRepair, remote.polls)
			require.Equal(t, terminal, out.Status)
			drained, err = state.GenerationDrained(ctx, owner, 1)
			require.NoError(t, err)
			require.True(t, drained)
			// Response-loss replay must not poll or submit after terminal projection.
			polls := remote.polls
			out, err = adapter.AdvanceMemoryAppendActivity(ctx, input)
			require.NoError(t, err)
			require.Equal(t, terminal, out.Status)
			require.Equal(t, polls, remote.polls)
			require.Equal(t, 1, remote.submits)
			steps, err := store.ListRunSteps(ctx, requestID)
			require.NoError(t, err)
			for _, step := range steps {
				if step.StepID == "memory.append" {
					require.Equal(t, terminal, step.Status)
					if terminal == "completed" {
						require.NotContains(t, step.SanitizedPayload, "failure")
					} else {
						require.Equal(t, map[string]any{
							"code": "hindsight_append_failed", "operation": "memory.append",
							"detail": remote.errorDetail, "http_status": 503,
						}, step.SanitizedPayload["failure"])
					}
				}
			}
			results, err := store.ListStepResults(ctx, requestID)
			require.NoError(t, err)
			count := 0
			for _, result := range results {
				if result.StepID == "memory.append" {
					count++
				}
			}
			require.Equal(t, 1, count)
		})
	}
}
