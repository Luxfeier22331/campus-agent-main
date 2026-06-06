package temporalruntime

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
)

func TestChatAnswerWorkflowExecutesTypedStepGraph(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterActivity(&Activities{})
	completedAt := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	env.OnActivity(
		PlanChatAnswerActivityName,
		mock.Anything,
		mock.MatchedBy(planInputMatcher("run-workflow-001")),
	).Return(
		PlanChatAnswerActivityOutput{
			PlanRef: "projection://runs/run-workflow-001/plan",
			RunID:   "run-workflow-001",
			Status:  "planned",
		},
		nil,
	)
	env.OnActivity(
		InvokeSemanticWorkerActivityName,
		mock.Anything,
		mock.MatchedBy(semanticInputMatcher("run-workflow-001")),
	).Return(
		InvokeSemanticWorkerActivityOutput{
			BridgeRef: "projection://runs/run-workflow-001/semantic/rag",
			RunID:     "run-workflow-001",
			Status:    "completed",
		},
		nil,
	)
	env.OnActivity(
		FinalizeChatAnswerActivityName,
		mock.Anything,
		mock.MatchedBy(finalizeInputMatcher("run-workflow-001")),
	).Return(
		FinalizeChatAnswerActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/run-workflow-001/finalization",
			RunID:         "run-workflow-001",
			Status:        "completed",
		},
		nil,
	)

	env.ExecuteWorkflow(ChatAnswerWorkflow, ChatAnswerWorkflowInput{
		ConversationID: "conv-workflow-001",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "d8a73157ce10cd94a91c2079fc9a92c8f9f42f71360e4de7b80bf2e7d5e75c5c",
		RequestID:      "req-workflow-001",
		RunID:          "run-workflow-001",
		TaskQueue:      WorkflowTaskQueue,
		TraceID:        "trace-workflow-001",
		TurnID:         "turn-workflow-001",
		WorkflowID:     "campus-agent.chat.run-workflow-001",
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result ChatAnswerWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if result.RunID != "run-workflow-001" || result.Status != "completed" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.ProjectionRef != "projection://runs/run-workflow-001/finalization" {
		t.Fatalf("projection ref = %q", result.ProjectionRef)
	}
}

func TestWorkerRuntimeRequiresFinalizationActivities(t *testing.T) {
	_, err := NewWorkerRuntime(context.Background(), WorkerOptions{
		Address:                "127.0.0.1:1",
		Namespace:              "campus-agent-test",
		WorkflowQueue:          WorkflowTaskQueue,
		RAGQueue:               ActivityTaskQueueRAG,
		FinalizationQueue:      ActivityTaskQueueFinalization,
		RAGActivities:          &Activities{},
		FinalizationActivities: nil,
	})
	if err == nil {
		t.Fatal("expected missing finalization activities to fail")
	}
	if !strings.Contains(err.Error(), "temporal finalization activities are required") {
		t.Fatalf("error = %q", err.Error())
	}
}

type Activities struct{}

func (Activities) PlanChatAnswerActivity(
	_ context.Context,
	input PlanChatAnswerActivityInput,
) (PlanChatAnswerActivityOutput, error) {
	return PlanChatAnswerActivityOutput{
		PlanRef: "projection://runs/" + input.RunID + "/plan",
		RunID:   input.RunID,
		Status:  "planned",
	}, nil
}

func (Activities) InvokeSemanticWorkerActivity(
	_ context.Context,
	input InvokeSemanticWorkerActivityInput,
) (InvokeSemanticWorkerActivityOutput, error) {
	return InvokeSemanticWorkerActivityOutput{
		BridgeRef: "projection://runs/" + input.RunID + "/semantic/rag",
		RunID:     input.RunID,
		Status:    "completed",
	}, nil
}

func (Activities) FinalizeChatAnswerActivity(
	_ context.Context,
	input FinalizeChatAnswerActivityInput,
) (FinalizeChatAnswerActivityOutput, error) {
	return FinalizeChatAnswerActivityOutput{
		CompletedAt:   time.Now().UTC(),
		ProjectionRef: "projection://runs/" + input.RunID + "/finalization",
		RunID:         input.RunID,
		Status:        "completed",
	}, nil
}

func planInputMatcher(runID string) func(PlanChatAnswerActivityInput) bool {
	return func(input PlanChatAnswerActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.PayloadSHA256 != ""
	}
}

func semanticInputMatcher(runID string) func(InvokeSemanticWorkerActivityInput) bool {
	return func(input InvokeSemanticWorkerActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.PlanRef == "projection://runs/run-workflow-001/plan"
	}
}

func finalizeInputMatcher(runID string) func(FinalizeChatAnswerActivityInput) bool {
	return func(input FinalizeChatAnswerActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.PlanRef == "projection://runs/run-workflow-001/plan" &&
			input.BridgeRef == "projection://runs/run-workflow-001/semantic/rag"
	}
}
