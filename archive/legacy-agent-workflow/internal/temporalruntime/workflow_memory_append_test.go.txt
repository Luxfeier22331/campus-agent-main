package temporalruntime

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

func TestAsyncMemoryAppendTransportRecoveryDoesNotResubmitAcceptedTask(t *testing.T) {
	for _, terminalStatus := range []string{"completed", "failed"} {
		t.Run(terminalStatus, func(t *testing.T) {
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestWorkflowEnvironment()
			submits, polls := 0, 0
			env.RegisterActivityWithOptions(func(ctx context.Context, in MemoryAppendWorkflowInput) (AdvanceMemoryAppendActivityOutput, error) {
				require.Equal(t, "req-async", in.RequestID)
				require.False(t, in.StartedAt.IsZero())
				if !in.Submitted {
					submits++
					if submits == 1 {
						return AdvanceMemoryAppendActivityOutput{}, temporal.NewApplicationError("lost acknowledgement", "network")
					}
				} else {
					polls++
					if polls == 1 {
						return AdvanceMemoryAppendActivityOutput{}, temporal.NewApplicationError("status unavailable", "network")
					}
					// Simulate a provider retry and a write taking over 300s.
					if polls >= 40 {
						return AdvanceMemoryAppendActivityOutput{Status: terminalStatus}, nil
					}
				}
				return AdvanceMemoryAppendActivityOutput{Status: "running"}, nil
			}, activity.RegisterOptions{Name: AdvanceMemoryAppendActivityName})
			start := env.Now()
			env.ExecuteWorkflow(MemoryAppendWorkflow, MemoryAppendWorkflowInput{RequestID: "req-async"})
			require.NoError(t, env.GetWorkflowError())
			require.Equal(t, 2, submits)
			require.Equal(t, 40, polls)
			require.Greater(t, env.Now().Sub(start), 300*time.Second)
		})
	}
}

func TestAsyncMemoryAppendResumeOnlyQueriesExistingOperation(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	started := time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC)
	env.RegisterActivityWithOptions(func(_ context.Context, in MemoryAppendWorkflowInput) (AdvanceMemoryAppendActivityOutput, error) {
		require.True(t, in.Submitted)
		require.Equal(t, started, in.StartedAt)
		return AdvanceMemoryAppendActivityOutput{Status: "completed"}, nil
	}, activity.RegisterOptions{Name: AdvanceMemoryAppendActivityName})
	env.ExecuteWorkflow(MemoryAppendWorkflow, MemoryAppendWorkflowInput{RequestID: "req-resumed", Submitted: true, StartedAt: started})
	require.NoError(t, env.GetWorkflowError())
}

func TestAsyncMemoryAppendContinueAsNewPreservesSubmittedIdentity(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.SetContinueAsNewSuggested(true)
	env.RegisterActivityWithOptions(func(_ context.Context, in MemoryAppendWorkflowInput) (AdvanceMemoryAppendActivityOutput, error) {
		require.False(t, in.Submitted)
		return AdvanceMemoryAppendActivityOutput{Status: "running"}, nil
	}, activity.RegisterOptions{Name: AdvanceMemoryAppendActivityName})
	started := env.Now()
	env.ExecuteWorkflow(MemoryAppendWorkflow, MemoryAppendWorkflowInput{RequestID: "continue"})
	var continued *workflow.ContinueAsNewError
	require.True(t, errors.As(env.GetWorkflowError(), &continued))
	var resumed MemoryAppendWorkflowInput
	require.NoError(t, converter.GetDefaultDataConverter().FromPayloads(continued.Input, &resumed))
	require.Equal(t, "continue", resumed.RequestID)
	require.True(t, resumed.Submitted)
	require.True(t, started.Equal(resumed.StartedAt))
}

func TestAnswerDoesNotWaitForBackgroundMemory(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{}, true)
	env.RegisterWorkflowWithOptions(func(ctx workflow.Context, _ MemoryAppendWorkflowInput) error {
		return workflow.Sleep(ctx, 20*time.Minute)
	}, workflow.RegisterOptions{Name: MemoryAppendWorkflowType})
	input := validToolExecutionWorkflowInput("async-parent")
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(
		WorkflowOperationActivityOutput{Operation: WorkflowOperationSolve, SolveOutcome: "answer", FinalOutput: "答案", RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(
		WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	start := env.Now()
	env.ExecuteWorkflow(ToolExecutionWorkflow, input)
	require.NoError(t, env.GetWorkflowError())
	require.Less(t, env.Now().Sub(start), time.Minute)
	env.AssertActivityNumberOfCalls(t, AdvanceMemoryAppendActivityName, 0)
	env.AssertExpectations(t)
}
