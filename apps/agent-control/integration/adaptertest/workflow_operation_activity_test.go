package adaptertest

import (
	"context"
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

	if err := adapter.ProjectWorkflowToolResults(context.Background(), run, request, output.ToolResults, identity); err != nil {
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
