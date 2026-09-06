package temporaladapter

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestWriteWorkflowFinalizationCompletesSynthesizedResult(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 9, 4, 11, 30, 0, 0, time.UTC)
	const runID = "run-workflow-finalization"
	createQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-workflow-finalization",
		now,
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("start run: %v", err)
	}

	adapter := newAdapterForTest(config.Config{TemporalWorkerIdentity: "test:finalization:001"})
	attachAgentAdmissionProviderConfigsForTest(adapter)
	attachRunProjectionStoreForAdapterTest(adapter, store)
	snapshot, err := adapter.admissionService.BuildAgentAdmissionSnapshot(t.Context(), false)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	input := temporalruntime.WriteWorkflowFinalizationActivityInput{
		RequestID:         runID,
		FinalizedAt:       now.Add(5 * time.Second),
		AdmissionSnapshot: snapshot,
		WorkflowResult: temporalruntime.WorkflowOperationActivityOutput{
			Operation:               temporalruntime.WorkflowOperationSynthesize,
			WorkflowResultRef:       workflowOperationResultRef(runID, "answer.synthesize"),
			FinalOutput:             "你好，我是校园问答助手。",
			ModelName:               "gpt-5.6-terra",
			ModelProvider:           "openai",
			ProviderResponseID:      "resp-workflow-finalization",
			RequestID:               runID,
			RuntimeRelease:          "agent-runtime@test",
			Status:                  "completed",
			TerminalReason:          "answer_completed",
			ToolContractFingerprint: execution.ToolContractFingerprintSnapshotMap(snapshot.ToolContractFingerprint),
			Usage: temporalruntime.AgentUsageSummary{
				InputTokens:       12,
				OutputTokens:      8,
				UsageObserved:     true,
				ModelRequestCount: 1,
			},
		},
	}

	output, err := adapter.WriteWorkflowFinalization(context.Background(), input)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("finalization status = %q", output.Status)
	}
	completedRun, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if completedRun.FinalResponseRef != output.ProjectionRef ||
		completedRun.TerminalReason != execution.DurableTerminalReasonAnswerCompleted {
		t.Fatalf("completed run = %#v, output = %#v", completedRun, output)
	}
	events, err := store.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizedResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizedResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizedResponse["answer_text"])
	}
	results, err := store.ListStepResults(context.Background(), runID)
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	found := false
	for _, result := range results {
		if result.StepID == "finalization.write" && result.Status == "completed" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("finalization.write result missing: %#v", results)
	}
}
