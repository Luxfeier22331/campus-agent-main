package temporaladapter

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/testsuite"
)

type receiptTestRuntimeClient struct{ calls int }

func (c *receiptTestRuntimeClient) Execute(context.Context, outboundadapter.AgentRuntimeRequest) (outboundadapter.AgentRuntimeResponse, error) {
	c.calls++
	return outboundadapter.AgentRuntimeResponse{}, fmt.Errorf("receipt must prevent provider execution")
}

func TestOperationActivityRestoresReceiptWithoutProviderExecution(t *testing.T) {
	for _, completed := range []bool{false, true} {
		t.Run(fmt.Sprintf("completed=%t", completed), func(t *testing.T) {
			ctx := context.Background()
			now := time.Now().UTC().Add(-time.Minute)
			runID := fmt.Sprintf("run-receipt-restore-%t", completed)
			store := executionpersistence.NewInMemoryRunProjectionStore()
			createQueuedDurableRunForTest(t, store, runID, "conv-"+runID, now, agentRequestForDurableWorkerTest("hello"))
			run, err := store.GetRun(ctx, runID)
			if err != nil {
				t.Fatal(err)
			}
			fenced := &temporalActivityRootFenceIntentStore{InMemoryRunProjectionStore: store, intent: execution.WorkflowStartIntent{
				RequestID: runID, WorkflowID: temporalActivityTestWorkflowID, TemporalRunID: temporalActivityTestRunID,
				State: execution.LifecycleIntentStateConfirmed,
			}}
			adapter := newAdapterForTest(config.Config{AgentRuntimeBaseURL: "http://unused.invalid", AgentRuntimeSharedSecret: "test", TemporalWorkerIdentity: "test-worker"})
			attachRunProjectionStoreForAdapterTest(adapter, fenced)
			client := &receiptTestRuntimeClient{}
			adapter.agentRuntimeClient = client
			snapshot := admissionSnapshotForTest(t, false)
			request := workflowOperationActivityRequest{
				AdmissionSnapshot: snapshot, ConversationID: run.ConversationID, RequestID: runID,
				Operation: temporalruntime.WorkflowOperationSolve, StepID: "solve.initial", StepKind: "solver",
				MaxSteps: 2, Stream: true, Payload: map[string]any{"goal": "hello", "max_steps": 2},
			}
			limits := limitsFromAdmissionSnapshot(snapshot.AgentLimits)
			limits.MaxTurns = snapshot.AgentBudget.MaxModelTurns
			limits.MaxFunctionToolCalls = snapshot.AgentBudget.MaxFunctionToolCalls
			limits.MaxPlanSteps = snapshot.AgentBudget.MaxPlanSteps
			limits.MaxReplans = snapshot.AgentBudget.MaxReplans
			payload, err := adapter.loadExecutionPayload(ctx, run)
			if err != nil {
				t.Fatal(err)
			}
			conversation, err := workflowConversationContextForRun(payload, limits)
			if err != nil {
				t.Fatal(err)
			}
			providerHash, err := workflowOperationProviderRequestSHA256(workflowOperationRuntimeRequestPayload(run, request, conversation, limits, 1))
			if err != nil {
				t.Fatal(err)
			}
			metadata, err := execution.InputMetadata(run)
			if err != nil {
				t.Fatal(err)
			}
			receipt := execution.AgentInvocationReceipt{
				InvocationID: runID + ":solve.initial", RequestID: runID, CreatedAt: now, UpdatedAt: now,
				InputSHA256: sha256AnyValue(workflowOperationInvocationEnvelope{
					AdmissionSnapshotSHA256: execution.HashAdmissionJSON(snapshot), ExecutionInputSHA256: metadata.ExecutionInputSHA256,
					InvocationID: runID + ":solve.initial", Operation: request.Operation, ProviderRequestSHA256: providerHash,
					RequestID: runID, SchemaVersion: workflowOperationInvocationSchemaVersion, StepID: request.StepID,
				}),
			}
			if _, _, err := store.BeginAgentInvocation(ctx, receipt); err != nil {
				t.Fatal(err)
			}
			output := temporalruntime.WorkflowOperationActivityOutput{
				Operation: request.Operation, RequestID: runID, WorkflowResultRef: workflowOperationResultRef(runID, request.StepID),
				Status: "completed", SolveOutcome: "answer", FinalOutput: "保存的回答",
			}
			if completed {
				receipt.OutputJSON, err = json.Marshal(output)
				if err != nil {
					t.Fatal(err)
				}
				receipt.OutputSHA256 = sha256Bytes(receipt.OutputJSON)
				receipt.CompletedAt = now.Add(time.Second)
				receipt.UpdatedAt = receipt.CompletedAt
				if _, err := store.CompleteAgentInvocation(ctx, receipt); err != nil {
					t.Fatal(err)
				}
				if _, err := store.UpsertRunStep(ctx, execution.RunStepProjection{
					RequestID: runID, ConversationID: run.ConversationID, StepID: request.StepID, StepKind: "solver",
					Status: "started", StartedAt: now, UpdatedAt: now, ActivityAttempt: 1,
					TaskQueue: temporalruntime.ActivityTaskQueueAgent, PayloadSchemaVersion: "run-step-projection-v1",
				}); err != nil {
					t.Fatal(err)
				}
			}
			env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
			env.RegisterActivity(adapter.SolveTask)
			value, activityErr := env.ExecuteActivity(adapter.SolveTask, temporalruntime.SolveTaskActivityInput{
				WorkflowOperationActivityInputBase: temporalruntime.WorkflowOperationActivityInputBase{
					AdmissionSnapshot: snapshot, RequestID: runID, ConversationID: run.ConversationID,
				}, MaxSteps: 2,
			})
			if client.calls != 0 {
				t.Fatalf("provider calls = %d", client.calls)
			}
			if !completed {
				assertTemporalActivityRootFenceError(t, activityErr, "workflow_attempt_uncertain", true)
				return
			}
			if activityErr != nil {
				t.Fatal(activityErr)
			}
			var restored temporalruntime.WorkflowOperationActivityOutput
			if err := value.Get(&restored); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(restored, output) {
				t.Fatalf("restored output = %#v", restored)
			}
			steps, err := store.ListRunSteps(ctx, runID)
			if err != nil || len(steps) != 1 || steps[0].Status != "completed" {
				t.Fatalf("steps=%#v err=%v", steps, err)
			}
			results, err := store.ListStepResults(ctx, runID)
			if err != nil || len(results) != 1 {
				t.Fatalf("results=%#v err=%v", results, err)
			}
		})
	}
}
