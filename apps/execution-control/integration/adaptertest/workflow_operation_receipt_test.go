package adaptertest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/testsuite"
)

type receiptTestRuntimeClient struct{ calls int }

type diagnosticFailureStore struct {
	*temporalActivityRootFenceIntentStore
	diagnosticCalls int
}

func (s *diagnosticFailureStore) RecordModelOutputDiagnostic(ctx context.Context, requestID, resultID string, diagnostic execution.ModelOutputDiagnostic) error {
	s.diagnosticCalls++
	deadline, ok := ctx.Deadline()
	if !ok || time.Until(deadline) > time.Second {
		panic("diagnostic write must be bounded")
	}
	return fmt.Errorf("diagnostic storage unavailable")
}

type modelOutputFailureClient struct {
	calls    int
	response string
}

func (c *modelOutputFailureClient) Execute(context.Context, executionapplication.AgentRuntimeRequest) (executionapplication.AgentRuntimeResponse, error) {
	c.calls++
	return executionapplication.AgentRuntimeResponse{StatusCode: 200, Body: io.NopCloser(strings.NewReader(c.response))}, nil
}

func TestRejectedReplanDecisionPreservesFailureUsageAndReplay(t *testing.T) {
	for _, decision := range []string{"continue", "synthesize"} {
		t.Run(decision, func(t *testing.T) {
			const runID = "rejected-replan"
			store := executionpersistence.NewInMemoryRunProjectionStore()
			createQueuedDurableRunForTest(t, store, runID, "conv-"+runID, time.Now(), agentRequestForDurableWorkerTest("hello"))
			fenced := &temporalActivityRootFenceIntentStore{InMemoryRunProjectionStore: store, intent: execution.WorkflowStartIntent{RequestID: runID, WorkflowID: temporalActivityTestWorkflowID, TemporalRunID: temporalActivityTestRunID, State: execution.LifecycleIntentStateConfirmed}}
			adapter := newAdapterForTest(config.Config{AgentRuntimeBaseURL: "http://unused.invalid", AgentRuntimeSharedSecret: "test", TemporalWorkerIdentity: "test-worker"})
			attachRunProjectionStoreForAdapterTest(adapter, fenced)
			adapter.Receipts = executionapplication.NewReceiptService(store.Receipts)
			snapshot := admissionSnapshotForTest(t, false)
			step := temporalruntime.WorkflowTaskPlanStep{ID: "step.notice", Objective: "查通知", CandidateSources: []temporalruntime.WorkflowSource{temporalruntime.WorkflowSourceCampusSearch}, DependsOn: []string{}}
			plan := temporalruntime.WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: "hello", Steps: []temporalruntime.WorkflowTaskPlanStep{step}}
			remaining := []temporalruntime.WorkflowTaskPlanStep{}
			if decision == "synthesize" {
				remaining = []temporalruntime.WorkflowTaskPlanStep{step}
			}
			body, err := json.Marshal(map[string]any{
				"request_id": runID, "operation": "replan", "status": "completed", "runtime_release": "test",
				"tool_contract_fingerprint": snapshot.ToolContractFingerprint,
				"usage":                     map[string]any{"input_tokens": 10, "output_tokens": 2, "model_request_count": 1, "usage_observed": true},
				"replan":                    temporalruntime.WorkflowTaskReplan{SchemaVersion: "task_replan.v3", Decision: decision, Reason: "检查", RemainingSteps: remaining},
			})
			if err != nil {
				t.Fatal(err)
			}
			client := &modelOutputFailureClient{response: string(body)}
			adapter.AgentRuntimeClient = client
			env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
			env.RegisterActivity(adapter.ReplanTask)
			input := temporalruntime.ReplanTaskActivityInput{
				WorkflowOperationActivityInputBase: temporalruntime.WorkflowOperationActivityInputBase{AdmissionSnapshot: workflowcontract.AdmissionToWorkflow(snapshot), RequestID: runID, ConversationID: "conv-" + runID},
				Plan:                               plan, ReplanIndex: 1, RemainingSteps: plan.Steps, MaxRemainingSteps: snapshot.AgentBudget.MaxPlanSteps,
			}
			for attempt := 0; attempt < 2; attempt++ {
				value, err := env.ExecuteActivity(adapter.ReplanTask, input)
				if err != nil {
					t.Fatal(err)
				}
				var output temporalruntime.WorkflowOperationActivityOutput
				if err := value.Get(&output); err != nil {
					t.Fatal(err)
				}
				if output.Status != "failed" || output.Failure.Code != "model_output_invalid" || output.Failure.Detail == "" || output.Usage.OutputTokens != 2 || output.Replan != nil {
					t.Fatalf("lost failed decision: %#v", output)
				}
			}
			if client.calls != 1 {
				t.Fatalf("provider calls=%d", client.calls)
			}
		})
	}
}

func TestModelOutputDiagnosticFailureDoesNotChangeResultOrReplay(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	const runID = "run-model-output-diagnostic-failure"
	store := executionpersistence.NewInMemoryRunProjectionStore()
	createQueuedDurableRunForTest(t, store, runID, "conv-"+runID, now, agentRequestForDurableWorkerTest("hello"))
	fenced := &diagnosticFailureStore{temporalActivityRootFenceIntentStore: &temporalActivityRootFenceIntentStore{InMemoryRunProjectionStore: store, intent: execution.WorkflowStartIntent{
		RequestID: runID, WorkflowID: temporalActivityTestWorkflowID, TemporalRunID: temporalActivityTestRunID, State: execution.LifecycleIntentStateConfirmed,
	}}}
	adapter := newAdapterForTest(config.Config{AgentRuntimeBaseURL: "http://unused.invalid", AgentRuntimeSharedSecret: "test", TemporalWorkerIdentity: "test-worker"})
	attachRunProjectionStoreForAdapterTest(adapter, fenced)
	adapter.Receipts = executionapplication.NewReceiptService(store.Receipts)
	snapshot := admissionSnapshotForTest(t, false)
	body, err := json.Marshal(map[string]any{
		"request_id": runID, "operation": "solve", "status": "failed", "runtime_release": "test",
		"failure":                   map[string]any{"code": "model_output_invalid", "operation": "workflow.solve"},
		"tool_contract_fingerprint": snapshot.ToolContractFingerprint,
		"usage":                     map[string]any{"input_tokens": 10, "output_tokens": 2, "model_request_count": 1, "usage_observed": true},
		"model_output_diagnostic":   execution.ModelOutputDiagnostic{SchemaVersion: 1, Text: "raw-visible-bad-output", OriginalUTF8Bytes: len("raw-visible-bad-output"), ValidationStage: "json_parse", OutputSchema: "solve_output"},
	})
	if err != nil {
		t.Fatal(err)
	}
	client := &modelOutputFailureClient{response: "event: failed\ndata: " + string(body) + "\n\n"}
	adapter.AgentRuntimeClient = client
	env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
	runOperation := func(ctx context.Context) (temporalruntime.WorkflowOperationActivityOutput, error) {
		return adapter.RunWorkflowOperationActivity(ctx, executionactivities.WorkflowOperationActivityRequest{
			AdmissionSnapshot: snapshot, RequestID: runID, ConversationID: "conv-" + runID,
			Operation: temporalruntime.WorkflowOperationSolve, StepID: "solve.initial", StepKind: "solver", MaxSteps: 2, Stream: true,
			Payload: map[string]any{"max_steps": 2},
		})
	}
	env.RegisterActivity(runOperation)
	for attempt := 0; attempt < 2; attempt++ {
		value, err := env.ExecuteActivity(runOperation)
		if err != nil {
			t.Fatal(err)
		}
		var output temporalruntime.WorkflowOperationActivityOutput
		if err := value.Get(&output); err != nil {
			t.Fatal(err)
		}
		if output.Status != "failed" || output.Failure.Code != "model_output_invalid" || output.Usage.OutputTokens != 2 {
			t.Fatalf("lost failure result: %#v", output)
		}
		encoded, _ := json.Marshal(output)
		if strings.Contains(string(encoded), "raw-visible-bad-output") || strings.Contains(string(encoded), "model_output_diagnostic") {
			t.Fatal("diagnostic entered Temporal output")
		}
	}
	if client.calls != 1 || fenced.diagnosticCalls != 1 {
		t.Fatalf("provider calls=%d diagnostic calls=%d", client.calls, fenced.diagnosticCalls)
	}
	results, err := store.ListStepResults(ctx, runID)
	if err != nil || len(results) != 1 {
		t.Fatalf("results=%v err=%v", results, err)
	}
	encoded, _ := json.Marshal(results)
	if strings.Contains(string(encoded), "raw-visible-bad-output") {
		t.Fatal("diagnostic entered immutable result")
	}
}

func (c *receiptTestRuntimeClient) Execute(context.Context, executionapplication.AgentRuntimeRequest) (executionapplication.AgentRuntimeResponse, error) {
	c.calls++
	return executionapplication.AgentRuntimeResponse{}, fmt.Errorf("receipt must prevent provider execution")
}

func TestOperationActivityRestoresReceiptWithoutProviderExecution(t *testing.T) {
	for _, status := range []string{"started", "completed", "failed", "model_output_invalid", "execute-legacy", "execute-summary", "execute-corrupt"} {
		t.Run(status, func(t *testing.T) {
			shape := status
			execute := strings.HasPrefix(shape, "execute-")
			if execute {
				status = "completed"
			}
			failureCode := "retrieval_budget_exhausted"
			if status == "model_output_invalid" {
				failureCode = status
				status = "failed"
			}
			completed := status != "started"
			ctx := context.Background()
			now := time.Now().UTC().Add(-time.Minute)
			runID := "run-receipt-restore-" + shape
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
			adapter.Receipts = executionapplication.NewReceiptService(store.Receipts)
			client := &receiptTestRuntimeClient{}
			adapter.AgentRuntimeClient = client
			snapshot := admissionSnapshotForTest(t, false)
			request := executionactivities.WorkflowOperationActivityRequest{
				AdmissionSnapshot: snapshot, ConversationID: run.ConversationID, RequestID: runID,
				Operation: temporalruntime.WorkflowOperationSolve, StepID: "solve.initial", StepKind: "solver",
				MaxSteps: 2, Stream: false, Payload: map[string]any{"goal": "hello", "max_steps": 2},
			}
			step := temporalruntime.WorkflowTaskPlanStep{ID: "step.notice", Objective: "hello", CandidateSources: []temporalruntime.WorkflowSource{temporalruntime.WorkflowSourceCampusSearch}, DependsOn: []string{}}
			plan := temporalruntime.WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: "hello", Steps: []temporalruntime.WorkflowTaskPlanStep{step}}
			if execute {
				request.Operation = temporalruntime.WorkflowOperationExecuteStep
				request.StepID = executionactivities.WorkflowTaskStepID(step.ID)
				request.StepKind = "executor"
				request.Stream = false
				request.Plan = &plan
				request.Step = &step
				request.CitationStart = 1
				request.Payload = map[string]any{"goal": "hello", "completed_steps": request.CompletedSteps, "citation_start": 1, "plan": plan, "step": step}
			}
			limits := executionactivities.LimitsFromAdmissionSnapshot(snapshot.AgentLimits)
			limits.MaxTurns = snapshot.AgentBudget.MaxModelTurns
			limits.MaxFunctionToolCalls = snapshot.AgentBudget.MaxFunctionToolCalls
			limits.MaxPlanSteps = snapshot.AgentBudget.MaxPlanSteps
			limits.MaxReplans = snapshot.AgentBudget.MaxReplans
			payload, err := adapter.LoadExecutionPayload(ctx, run)
			if err != nil {
				t.Fatal(err)
			}
			conversation, err := executionactivities.WorkflowConversationContextForRun(payload, limits)
			if err != nil {
				t.Fatal(err)
			}
			providerHash, err := executionactivities.WorkflowOperationProviderRequestSHA256(executionactivities.WorkflowOperationRuntimeRequestPayload(run, request, conversation, limits, 1))
			if err != nil {
				t.Fatal(err)
			}
			metadata, err := execution.InputMetadata(run)
			if err != nil {
				t.Fatal(err)
			}
			receipt := execution.AgentInvocationReceipt{
				InvocationID: runID + ":" + request.StepID, RequestID: runID, CreatedAt: now, UpdatedAt: now,
				InputSHA256: activityprojection.Sha256AnyValue(executionactivities.WorkflowOperationInvocationEnvelope{
					AdmissionSnapshotSHA256: execution.HashAdmissionJSON(snapshot), ExecutionInputSHA256: metadata.ExecutionInputSHA256,
					InvocationID: runID + ":" + request.StepID, Operation: request.Operation, ProviderRequestSHA256: providerHash,
					RequestID: runID, SchemaVersion: executionactivities.WorkflowOperationInvocationSchemaVersion, StepID: request.StepID,
				}),
			}
			if _, _, err := store.Receipts.BeginAgentInvocation(ctx, receipt); err != nil {
				t.Fatal(err)
			}
			output := temporalruntime.WorkflowOperationActivityOutput{
				Operation: request.Operation, RequestID: runID, WorkflowResultRef: activityprojection.WorkflowOperationResultRef(runID, request.StepID),
				Status: "completed", SolveOutcome: "answer", FinalOutput: "保存的回答",
			}
			if execute {
				output.SolveOutcome = ""
				result := map[string]any{"outcome": "matched"}
				if shape == "execute-legacy" {
					result["results"] = []any{map[string]any{"citation_index": float64(1), "citation_href": "/notices/notice-1", "notice_id": "notice-1", "result_ref": "result://sha256:" + strings.Repeat("a", 64), "section_title": "办理说明", "source_kind": "notice", "text": "唯一检索正文", "title": "校园服务"}}
				}
				output.ToolResults = []temporalruntime.AgentToolResult{{ToolName: "campus_search", Status: "completed", InvocationID: "search-1", Result: result}}
				output.Evidence = []temporalruntime.WorkflowEvidence{{ID: "notice", Title: "校园服务", Excerpt: "唯一检索正文", Source: temporalruntime.WorkflowSourceCampusSearch, CitationIndex: 1}}
				output.SourceAttempts = []temporalruntime.WorkflowSourceAttempt{{Source: temporalruntime.WorkflowSourceCampusSearch, Status: "matched"}}
			}
			if status == "failed" {
				output.Status = "failed"
				output.FinalOutput = ""
				output.Failure = &temporalruntime.ExecutionFailure{Code: failureCode, Operation: "solve"}
				output.Evidence = []temporalruntime.WorkflowEvidence{{ID: "notice", Title: "通知", Excerpt: "已取得的正文", Source: temporalruntime.WorkflowSourceCampusSearch, CitationIndex: 1}}
				output.SourceAttempts = []temporalruntime.WorkflowSourceAttempt{{Source: temporalruntime.WorkflowSourceCampusSearch, Status: "matched"}}
				output.Usage = temporalruntime.AgentUsageSummary{InputTokens: 100, OutputTokens: 20, ModelRequestCount: 2, UsageObserved: true}
			}
			if completed {
				receipt.OutputJSON, err = json.Marshal(output)
				if err != nil {
					t.Fatal(err)
				}
				receipt.OutputSHA256 = executionactivities.Sha256Bytes(receipt.OutputJSON)
				if execute {
					// PostgreSQL JSONB changes object key order and whitespace.
					var object map[string]any
					if err := json.Unmarshal(receipt.OutputJSON, &object); err != nil {
						t.Fatal(err)
					}
					receipt.OutputJSON, err = json.MarshalIndent(object, "", "  ")
					if err != nil {
						t.Fatal(err)
					}
					if shape == "execute-corrupt" {
						receipt.OutputSHA256 = strings.Repeat("0", 64)
					}
				}
				receipt.CompletedAt = now.Add(time.Second)
				receipt.UpdatedAt = receipt.CompletedAt
				if _, err := store.Receipts.CompleteAgentInvocation(ctx, receipt); err != nil {
					t.Fatal(err)
				}
				if _, err := store.UpsertRunStep(ctx, execution.RunStepProjection{
					RequestID: runID, ConversationID: run.ConversationID, StepID: request.StepID, StepKind: request.StepKind,
					Status: "started", StartedAt: now, UpdatedAt: now, ActivityAttempt: 1,
					TaskQueue: temporalruntime.ActivityTaskQueueAgent, PayloadSchemaVersion: "run-step-projection-v1",
				}); err != nil {
					t.Fatal(err)
				}
			}
			env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
			restore := func(ctx context.Context) (temporalruntime.WorkflowOperationActivityOutput, error) {
				base := temporalruntime.WorkflowOperationActivityInputBase{AdmissionSnapshot: workflowcontract.AdmissionToWorkflow(snapshot), RequestID: runID, ConversationID: run.ConversationID}
				if execute {
					return adapter.ExecuteTaskStep(ctx, temporalruntime.ExecuteTaskStepActivityInput{WorkflowOperationActivityInputBase: base, Plan: plan, Step: step, CitationStart: 1})
				}
				return adapter.SolveTask(ctx, temporalruntime.SolveTaskActivityInput{WorkflowOperationActivityInputBase: base, MaxSteps: 2})
			}
			env.RegisterActivity(restore)
			value, activityErr := env.ExecuteActivity(restore)
			if client.calls != 0 {
				t.Fatalf("provider calls = %d", client.calls)
			}
			if !completed || shape == "execute-corrupt" {
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
			if err != nil || len(steps) != 1 || steps[0].Status != status {
				t.Fatalf("steps=%#v err=%v", steps, err)
			}
			results, err := store.ListStepResults(ctx, runID)
			if err != nil || len(results) != 1 {
				t.Fatalf("results=%#v err=%v", results, err)
			}
			// A second replay must accept an already repaired failed attempt too.
			value, activityErr = env.ExecuteActivity(restore)
			if activityErr != nil {
				t.Fatal(activityErr)
			}
			if err := value.Get(&restored); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(restored, output) || client.calls != 0 {
				t.Fatalf("second replay changed result or called provider: %#v", restored)
			}
			if execute {
				saved, _, err := store.Receipts.BeginAgentInvocation(ctx, receipt)
				if err != nil || !bytes.Equal(saved.OutputJSON, receipt.OutputJSON) || saved.OutputSHA256 != receipt.OutputSHA256 {
					t.Fatalf("replay rewrote receipt: %v", err)
				}
			}
		})
	}
}
