package adaptertest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/finalization"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	applicationcontract "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/outboundadapter"
)

func TestWorkflowOperationReplanDecisionContract(t *testing.T) {
	for _, decision := range []string{"continue", "synthesize", "revise", "unknown", ""} {
		t.Run(decision, func(t *testing.T) {
			output, err := executionactivities.WorkflowOperationOutputFromRuntimeResponse(executionapplication.AgentRuntimeResult{
				Replan: &applicationcontract.WorkflowTaskReplan{
					SchemaVersion: "task_replan.v3", Decision: decision,
					Reason: "检查剩余路径", RemainingSteps: []applicationcontract.WorkflowTaskPlanStep{},
				},
			}, applicationcontract.WorkflowOperationReplan, "result-replan")
			if decision == "continue" || decision == "synthesize" {
				if err != nil || output.Replan == nil || output.Replan.Decision != decision {
					t.Fatalf("valid decision output=%#v, err=%v", output, err)
				}
			} else if err == nil {
				t.Fatalf("accepted invalid decision %q", decision)
			}
		})
	}
}

func TestValidateWorkflowOperationOutputSourcesRequiresCurrentStepCandidates(t *testing.T) {
	step := applicationcontract.WorkflowTaskPlanStep{
		ID:               "step.campus",
		Objective:        "查询校内资料",
		CandidateSources: []applicationcontract.WorkflowSource{applicationcontract.WorkflowSourceCampusSearch},
	}
	request := executionactivities.OperationRequest{
		Operation: applicationcontract.WorkflowOperationExecuteStep,
		Step:      &step,
	}
	output := applicationcontract.OperationOutput{
		ToolResults: []applicationcontract.AgentToolResult{{
			ToolName:     personalMemoryRecallToolName,
			InvocationID: "memory-call",
			Status:       "completed",
		}},
	}

	err := executionactivities.ValidateWorkflowOperationOutputSources(request, output)
	if err == nil || !strings.Contains(err.Error(), "not a candidate source") {
		t.Fatalf("source validation error = %v", err)
	}
}

func TestFailedOperationPreservesToolFailuresButStillChecksSources(t *testing.T) {
	step := applicationcontract.WorkflowTaskPlanStep{ID: "step.campus", Objective: "查询", CandidateSources: []applicationcontract.WorkflowSource{applicationcontract.WorkflowSourceCampusSearch}}
	request := executionactivities.OperationRequest{Operation: applicationcontract.WorkflowOperationExecuteStep, Step: &step}
	output := applicationcontract.OperationOutput{
		Status: "failed", Failure: &applicationcontract.ExecutionFailure{Code: "model_output_invalid"},
		ToolResults: []applicationcontract.AgentToolResult{{ToolName: campusSearchToolName, Status: "failed", Failure: &applicationcontract.ExecutionFailure{Code: "retrieval_budget_exhausted"}}},
	}
	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err != nil {
		t.Fatal(err)
	}
	output.ToolResults[0].ToolName = personalMemoryRecallToolName
	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err == nil {
		t.Fatal("accepted foreign source")
	}
}

func TestValidateWorkflowOperationOutputSourcesAllowsAdmittedRetrievalOnSolver(t *testing.T) {
	request := executionactivities.OperationRequest{
		Operation: applicationcontract.WorkflowOperationSolve,
		AdmissionSnapshot: execution.AgentAdmissionSnapshot{AgentCapabilities: execution.AgentCapabilitiesSnapshot{
			VisibleFunctionToolNames: []string{campusSearchToolName},
		}},
	}
	output := applicationcontract.OperationOutput{
		ToolResults: []applicationcontract.AgentToolResult{{
			ToolName:     campusSearchToolName,
			InvocationID: "campus-call",
			Status:       "completed",
		}},
	}

	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err != nil {
		t.Fatalf("admitted solver retrieval rejected: %v", err)
	}
	request.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames = nil
	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err == nil {
		t.Fatal("solver accepted an unadmitted tool")
	}
}

func TestSolverWebEvidenceUsesAdmission(t *testing.T) {
	request := executionactivities.OperationRequest{Operation: applicationcontract.WorkflowOperationSolve}
	output := applicationcontract.OperationOutput{Evidence: []applicationcontract.WorkflowEvidence{{Source: applicationcontract.WorkflowSourceWebSearch, CitationIndex: 1, Title: "官网", Excerpt: "地址", URL: "https://example.edu"}}}
	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err == nil {
		t.Fatal("accepted unadmitted web evidence")
	}
	request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch = true
	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err != nil {
		t.Fatal(err)
	}
}

func TestRecoverySynthesisContract(t *testing.T) {
	evidence := []applicationcontract.WorkflowEvidence{{ID: "notice", Source: applicationcontract.WorkflowSourceCampusSearch, CitationIndex: 1, Title: "通知", Excerpt: "2册增加至4册"}}
	attempts := []applicationcontract.WorkflowSourceAttempt{{Source: applicationcontract.WorkflowSourceCampusSearch, Status: "matched"}}
	request := executionactivities.OperationRequest{
		Operation: applicationcontract.WorkflowOperationSynthesize, StepID: "answer.synthesize", Goal: "借购数量", Mode: "recovery", RecoveryReason: "provider_timeout",
		Evidence: evidence, SourceAttempts: attempts,
		AdmissionSnapshot: execution.AgentAdmissionSnapshot{AgentCapabilities: execution.AgentCapabilitiesSnapshot{VisibleFunctionToolNames: []string{campusSearchToolName}}},
	}
	for _, stream := range []bool{false, true} {
		request.Stream = stream
		if err := executionactivities.ValidateWorkflowOperationRequest(request); err != nil {
			t.Fatal(err)
		}
	}
	output := applicationcontract.OperationOutput{}
	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err != nil {
		t.Fatal(err)
	}
	output = applicationcontract.OperationOutput{Evidence: evidence, SourceAttempts: attempts}
	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err == nil {
		t.Fatal("synthesis response echoed admitted materials")
	}
	request.Evidence = nil
	if err := executionactivities.ValidateWorkflowOperationRequest(request); err == nil {
		t.Fatal("recovery without materials accepted")
	}
}

func TestRuntimeRequestRetainsSolverMaterialsForLaterOperations(t *testing.T) {
	evidence := []applicationcontract.WorkflowEvidence{{ID: "notice", Source: applicationcontract.WorkflowSourceCampusSearch, CitationIndex: 1, Title: "通知", Excerpt: "2册增加至4册"}}
	attempts := []applicationcontract.WorkflowSourceAttempt{{Source: applicationcontract.WorkflowSourceCampusSearch, Status: "matched"}}
	for _, operation := range []applicationcontract.WorkflowOperation{applicationcontract.WorkflowOperationExecuteStep, applicationcontract.WorkflowOperationReplan} {
		payload := executionactivities.WorkflowOperationRuntimeRequest(execution.DurableRun{RequestID: "materials"}, executionactivities.OperationRequest{Operation: operation, PriorEvidence: evidence, PriorSourceAttempts: attempts}, nil, executionactivities.WorkflowRuntimeLimits{}, 1)
		if len(payload.PriorEvidence) != 1 || len(payload.PriorSourceAttempts) != 1 {
			t.Fatalf("lost solver context: %#v", payload)
		}
	}
}

func TestFailedSolveStreamPreservesDraftWithoutCompletingAnswer(t *testing.T) {
	ctx := context.Background()
	store := executionpersistence.NewInMemoryRunProjectionStore()
	createQueuedDurableRunForTest(t, store, "failed-stream", "conv-stream", time.Now(), agentRequestForDurableWorkerTest("test"))
	if _, err := store.TransitionRun(ctx, "failed-stream", execution.DurableRunStatusAdmitted, "", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.TransitionRun(ctx, "failed-stream", execution.DurableRunStatusRunning, "", time.Now()); err != nil {
		t.Fatal(err)
	}
	run, err := store.GetRun(ctx, "failed-stream")
	if err != nil {
		t.Fatal(err)
	}
	adapter := &executionactivities.OperationService{StateWriter: store, Writer: &activityprojection.Writer{RunProjectionStore: store}}
	body := "event: solve_decision\ndata: {\"schema_version\":\"workflow_runtime_solve_decision.v1\",\"outcome\":\"answer\"}\n\nevent: answer_delta\ndata: {\"schema_version\":\"workflow_runtime_answer_delta.v1\",\"delta\":\"草稿\"}\n\nevent: failed\ndata: {\"request_id\":\"failed-stream\",\"status\":\"failed\",\"operation\":\"solve\",\"failure\":{\"code\":\"provider_timeout\",\"operation\":\"solve\"}}\n\n"
	output, err := adapter.ConsumeWorkflowRuntimeStream(ctx, run, applicationcontract.WorkflowOperationSolve, runtimeEvents(strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if !output.AnswerStarted || output.Status != "failed" {
		t.Fatalf("output=%#v", output)
	}
	events, err := store.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunAnswerCompleted {
			t.Fatal("failed stream completed answer")
		}
	}
}

func TestValidateWorkflowOperationOutputSourcesRequiresExplicitWebCandidate(t *testing.T) {
	step := applicationcontract.WorkflowTaskPlanStep{
		ID:               "step.campus",
		Objective:        "查询校内资料",
		CandidateSources: []applicationcontract.WorkflowSource{applicationcontract.WorkflowSourceCampusSearch},
	}
	request := executionactivities.OperationRequest{
		Operation: applicationcontract.WorkflowOperationExecuteStep,
		Step:      &step,
	}
	output := applicationcontract.OperationOutput{
		Evidence: []applicationcontract.WorkflowEvidence{{
			Source:        applicationcontract.WorkflowSourceWebSearch,
			CitationIndex: 1,
			Excerpt:       "学校地址",
			Title:         "学校官网",
			URL:           "https://example.edu/page",
		}},
	}

	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err == nil ||
		!strings.Contains(err.Error(), "not a candidate") {
		t.Fatalf("web source validation error = %v", err)
	}
}

func TestValidateWorkflowOperationOutputSourcesAllowsWebNoMatchWithoutCitations(t *testing.T) {
	step := applicationcontract.WorkflowTaskPlanStep{
		ID:               "step.web",
		Objective:        "查询公开校园网页",
		CandidateSources: []applicationcontract.WorkflowSource{applicationcontract.WorkflowSourceWebSearch},
	}
	request := executionactivities.OperationRequest{
		Operation: applicationcontract.WorkflowOperationExecuteStep,
		Step:      &step,
	}
	output := applicationcontract.OperationOutput{
		SourceAttempts: []applicationcontract.WorkflowSourceAttempt{{
			Source: applicationcontract.WorkflowSourceWebSearch,
			Status: "no_match",
		}},
	}

	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err != nil {
		t.Fatalf("web no-match source validation error = %v", err)
	}
}

func TestValidateWorkflowOperationOutputSourcesRejectsRetrievalOnReplanner(t *testing.T) {
	request := executionactivities.OperationRequest{Operation: applicationcontract.WorkflowOperationReplan}
	output := applicationcontract.OperationOutput{
		ToolResults: []applicationcontract.AgentToolResult{{
			ToolName:     campusSearchToolName,
			InvocationID: "campus-call",
			Status:       "completed",
		}},
	}

	if err := executionactivities.ValidateWorkflowOperationOutputSources(request, output); err == nil ||
		!strings.Contains(err.Error(), "returned source output") {
		t.Fatalf("replanner source validation error = %v", err)
	}
}

func TestProjectWorkflowToolResultsUsesRuntimeTimingForStepAndAttempt(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
	runID := "run-tool-runtime-timing"
	createQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conversation-"+runID,
		now,
		agentRequestForDurableWorkerTest("查询规定"),
	)
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	adapter := newAdapterForTest(config.Config{TemporalWorkerIdentity: "test:tool-timing"})
	attachRunProjectionStoreForAdapterTest(adapter, store)
	startedAt := now.Add(2 * time.Second)
	completedAt := startedAt.Add(275 * time.Millisecond)
	request := executionactivities.OperationRequest{
		Operation: applicationcontract.WorkflowOperationExecuteStep,
		RequestID: runID,
		StepID:    "step.campus",
	}
	output := executionapplication.AgentRuntimeResult{
		ToolResults: []executionapplication.AgentToolResult{{
			ArgumentsJSON: map[string]any{"search_query": "规定"},
			StartedAt:     &startedAt,
			CompletedAt:   &completedAt,
			DurationMS:    275.25,
			InvocationID:  "call-runtime-timing",
			Result:        map[string]any{"outcome": "matched"},
			Status:        "completed",
			ToolName:      campusSearchToolName,
		}},
	}
	identity := activityprojection.StepProjection{
		ActivityAttempt: 2,
		Attempt:         3,
		Run:             run,
		StartedAt:       now,
		WorkerID:        "test:tool-timing",
	}

	if err := NewExecutionAdapter(adapter).Service.ProjectWorkflowToolResults(context.Background(), run, request, output.ToolResults, identity); err != nil {
		t.Fatalf("project workflow tool result: %v", err)
	}
	steps, err := store.ListRunSteps(context.Background(), runID)
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 {
		t.Fatalf("run steps = %#v, want one tool step", steps)
	}
	if !steps[0].StartedAt.Equal(startedAt) || !steps[0].CompletedAt.Equal(completedAt) {
		t.Fatalf("tool step timing = %s..%s, want %s..%s", steps[0].StartedAt, steps[0].CompletedAt, startedAt, completedAt)
	}
	attempts, err := store.ListStepAttempts(context.Background(), runID)
	if err != nil {
		t.Fatalf("list step attempts: %v", err)
	}
	if len(attempts) != 1 {
		t.Fatalf("step attempts = %#v, want one tool attempt", attempts)
	}
	if !attempts[0].StartedAt.Equal(startedAt) || !attempts[0].CompletedAt.Equal(completedAt) || attempts[0].DurationMS != 276 {
		t.Fatalf("tool attempt timing = %#v, want runtime boundaries and ceiled duration", attempts[0])
	}
}

func TestWorkflowToolProjectionTimingFallsBackWithoutRuntimeBoundaries(t *testing.T) {
	fallbackStartedAt := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
	fallbackCompletedAt := fallbackStartedAt.Add(time.Second)
	startedAt, completedAt, err := executionactivities.WorkflowToolProjectionTimes(
		applicationcontract.AgentToolResult{},
		fallbackStartedAt,
		fallbackCompletedAt,
	)
	if err != nil {
		t.Fatalf("fallback tool timing: %v", err)
	}
	if !startedAt.Equal(fallbackStartedAt) || !completedAt.Equal(fallbackCompletedAt) {
		t.Fatalf("fallback timing = %s..%s, want %s..%s", startedAt, completedAt, fallbackStartedAt, fallbackCompletedAt)
	}
}

func TestWorkflowToolProjectionRejectsReversedRuntimeBoundaries(t *testing.T) {
	startedAt := time.Date(2026, 9, 5, 10, 0, 1, 0, time.UTC)
	completedAt := startedAt.Add(-time.Millisecond)
	_, _, err := executionactivities.WorkflowToolProjectionTimes(
		applicationcontract.AgentToolResult{StartedAt: &startedAt, CompletedAt: &completedAt},
		startedAt,
		startedAt,
	)
	if err == nil || !strings.Contains(err.Error(), "completed_at precedes started_at") {
		t.Fatalf("reversed timing error = %v", err)
	}
}

func TestWorkflowFinalizationResultMapPreservesToolRuntimeTiming(t *testing.T) {
	startedAt := time.Date(2026, 9, 5, 10, 0, 0, 123456000, time.FixedZone("CST", 8*60*60))
	completedAt := startedAt.Add(275 * time.Millisecond)
	payload := finalizationactivities.WorkflowFinalizationResultMap(applicationcontract.FinalizationInput{
		RequestID: "run-tool-result-timing",
		WorkflowResult: applicationcontract.OperationOutput{
			RequestID: "run-tool-result-timing",
			ToolResults: []applicationcontract.AgentToolResult{{
				StartedAt:    &startedAt,
				CompletedAt:  &completedAt,
				DurationMS:   275,
				InvocationID: "call-result-timing",
				Result:       map[string]any{},
				Status:       "completed",
				ToolName:     campusSearchToolName,
			}},
		},
	})
	results := finalizationactivities.WorkflowToolResultMaps(payload["tool_results"])
	if len(results) != 1 {
		t.Fatalf("mapped tool results = %#v, want one result", results)
	}
	if results[0]["started_at"] != "2026-09-05T02:00:00.123456Z" ||
		results[0]["completed_at"] != "2026-09-05T02:00:00.398456Z" {
		t.Fatalf("mapped tool timing = %#v", results[0])
	}
}

func TestWorkflowOperationReceiptReplaysWhenOnlyActivityAttemptChanges(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	runID := "run-operation-retry-fingerprint"
	createQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conversation-"+runID,
		now,
		agentRequestForDurableWorkerTest("查询规定"),
	)

	invocationID := runID + ":solve.initial"
	invocationFingerprint := func(activityAttempt int) string {
		providerRequest, err := outboundadapter.NewAgentRuntimeClient(config.Config{}).Prepare(executionapplication.AgentRuntimeRequest{
			ActivityAttempt: activityAttempt, Operation: applicationcontract.WorkflowOperationSolve,
			Input: map[string]any{"goal": "查询规定"},
		})
		if err != nil {
			t.Fatalf("fingerprint provider request: %v", err)
		}
		return activityprojection.Sha256AnyValue(executionactivities.WorkflowOperationInvocationEnvelope{
			AdmissionSnapshotSHA256: strings.Repeat("a", 64),
			ExecutionInputSHA256:    strings.Repeat("b", 64),
			InvocationID:            invocationID,
			Operation:               applicationcontract.WorkflowOperationSolve,
			ProviderRequestSHA256:   providerRequest,
			RequestID:               runID,
			SchemaVersion:           executionactivities.WorkflowOperationInvocationSchemaVersion,
			StepID:                  "solve.initial",
		})
	}
	firstFingerprint := invocationFingerprint(1)
	retryFingerprint := invocationFingerprint(2)
	if firstFingerprint != retryFingerprint {
		t.Fatalf("retry invocation fingerprint = %q, want %q", retryFingerprint, firstFingerprint)
	}

	receipt := execution.AgentInvocationReceipt{
		InvocationID: invocationID,
		RequestID:    runID,
		InputSHA256:  firstFingerprint,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if _, disposition, err := store.Receipts.BeginAgentInvocation(context.Background(), receipt); err != nil ||
		disposition != execution.AgentInvocationDispositionClaimed {
		t.Fatalf("claim operation receipt disposition=%q err=%v", disposition, err)
	}
	output := json.RawMessage(`{"operation":"solve","status":"completed"}`)
	receipt.OutputJSON = output
	receipt.OutputSHA256 = executionactivities.Sha256Bytes(output)
	receipt.CompletedAt = now.Add(time.Second)
	receipt.UpdatedAt = receipt.CompletedAt
	if _, err := store.Receipts.CompleteAgentInvocation(context.Background(), receipt); err != nil {
		t.Fatalf("complete operation receipt: %v", err)
	}

	retryReceipt := receipt
	retryReceipt.InputSHA256 = retryFingerprint
	stored, disposition, err := store.Receipts.BeginAgentInvocation(context.Background(), retryReceipt)
	if err != nil || disposition != execution.AgentInvocationDispositionReplay ||
		string(stored.OutputJSON) != string(output) {
		t.Fatalf("retry receipt=%#v disposition=%q err=%v", stored, disposition, err)
	}
	retryReceipt.InputSHA256 = strings.Repeat("f", 64)
	if _, _, err := store.Receipts.BeginAgentInvocation(context.Background(), retryReceipt); err == nil {
		t.Fatal("changed input reused completed receipt")
	}
}
