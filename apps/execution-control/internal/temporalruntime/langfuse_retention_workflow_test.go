package temporalruntime

import (
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
)

func TestLangfuseTraceRetentionWorkflowUsesReplaySafeCutoffAndVerifiesDeletion(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	startedAt := time.Date(2026, 7, 17, 3, 0, 0, 0, time.UTC)
	env.SetStartTime(startedAt)
	input := LangfuseTraceRetentionActivityInput{Cutoff: startedAt.Add(-7 * 24 * time.Hour)}

	env.OnActivity(PurgeLangfuseTraceRetentionActivityName, mock.Anything, input).
		Return(LangfuseTraceRetentionActivityOutput{
			HindsightTraceCount: 3,
			RuntimeTraceCount:   5,
		}, nil).Once()
	env.OnActivity(VerifyLangfuseTraceRetentionActivityName, mock.Anything, input).
		Return(LangfuseTraceRetentionActivityOutput{RuntimeTraceCount: 1}, nil).Once()
	env.OnActivity(PurgeLangfuseTraceRetentionActivityName, mock.Anything, input).
		Return(LangfuseTraceRetentionActivityOutput{RuntimeTraceCount: 1}, nil).Once()
	env.OnActivity(VerifyLangfuseTraceRetentionActivityName, mock.Anything, input).
		Return(LangfuseTraceRetentionActivityOutput{}, nil).Once()

	env.ExecuteWorkflow(LangfuseTraceRetentionWorkflow)
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result LangfuseTraceRetentionWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if !result.Cutoff.Equal(input.Cutoff) ||
		result.DeletedRuntimeTraceCount != 6 ||
		result.DeletedHindsightTraceCount != 3 ||
		result.VerificationRounds != 2 {
		t.Fatalf("workflow result = %#v", result)
	}
}

func TestLangfuseTraceRetentionWorkflowFailsAfterBoundedVerificationRounds(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	startedAt := time.Date(2026, 7, 17, 3, 0, 0, 0, time.UTC)
	env.SetStartTime(startedAt)
	input := LangfuseTraceRetentionActivityInput{Cutoff: startedAt.Add(-7 * 24 * time.Hour)}

	env.OnActivity(PurgeLangfuseTraceRetentionActivityName, mock.Anything, input).
		Return(LangfuseTraceRetentionActivityOutput{}, nil).Times(langfuseTraceRetentionMaxRounds)
	env.OnActivity(VerifyLangfuseTraceRetentionActivityName, mock.Anything, input).
		Return(LangfuseTraceRetentionActivityOutput{HindsightTraceCount: 1}, nil).
		Times(langfuseTraceRetentionMaxRounds)

	env.ExecuteWorkflow(LangfuseTraceRetentionWorkflow)
	if err := env.GetWorkflowError(); err == nil {
		t.Fatal("workflow succeeded despite retained old traces")
	}
	env.AssertActivityNumberOfCalls(t, PurgeLangfuseTraceRetentionActivityName, langfuseTraceRetentionMaxRounds)
	env.AssertActivityNumberOfCalls(t, VerifyLangfuseTraceRetentionActivityName, langfuseTraceRetentionMaxRounds)
}

func TestLangfuseTraceRetentionActivityPolicyIsBounded(t *testing.T) {
	options := langfuseTraceRetentionActivityOptions()
	if options.TaskQueue != ActivityTaskQueueCore || options.StartToCloseTimeout != 30*time.Minute {
		t.Fatalf("activity options = %#v", options)
	}
	if options.RetryPolicy == nil || options.RetryPolicy.MaximumAttempts != 3 {
		t.Fatalf("retry policy = %#v", options.RetryPolicy)
	}
}
