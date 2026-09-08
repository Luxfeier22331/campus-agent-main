package temporaladapter

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestWorkflowOperationProviderRequestFingerprintIgnoresActivityAttempt(t *testing.T) {
	first := map[string]any{
		"activity_attempt": 1,
		"operation":        "solve",
		"operation_input":  map[string]any{"goal": "查询规定"},
	}
	second := execution.CloneAnyMap(first)
	second["activity_attempt"] = 2

	firstHash, err := workflowOperationProviderRequestSHA256(first)
	if err != nil {
		t.Fatalf("fingerprint first request: %v", err)
	}
	secondHash, err := workflowOperationProviderRequestSHA256(second)
	if err != nil {
		t.Fatalf("fingerprint retry request: %v", err)
	}
	if firstHash != secondHash {
		t.Fatalf("retry fingerprint = %q, want stable fingerprint %q", secondHash, firstHash)
	}
	if firstHash != "c928ca9bebee3087d2140bcfe0546750d4d5320195b05e0001233624177049ee" {
		t.Fatalf("logical request fingerprint changed: %s", firstHash)
	}

	second["operation_input"].(map[string]any)["goal"] = "查询奖学金"
	changedHash, err := workflowOperationProviderRequestSHA256(second)
	if err != nil {
		t.Fatalf("fingerprint changed request: %v", err)
	}
	if changedHash == firstHash {
		t.Fatal("semantic operation input change reused the receipt fingerprint")
	}
}

func TestWorkflowOperationReplanDecisionContract(t *testing.T) {
	for _, decision := range []string{"continue", "synthesize", "revise", "unknown", ""} {
		t.Run(decision, func(t *testing.T) {
			output, err := workflowOperationOutputFromRuntimeResponse(agentRuntimeResponse{
				StructuredOutput: map[string]any{
					"schema_version": "task_replan.v1", "decision": decision,
					"reason": "检查剩余路径", "remaining_steps": []any{},
				},
			}, temporalruntime.WorkflowOperationReplan, "result-replan")
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
		providerRequest, err := workflowOperationProviderRequestSHA256(map[string]any{
			"activity_attempt": activityAttempt,
			"operation":        "solve",
			"operation_input":  map[string]any{"goal": "查询规定"},
		})
		if err != nil {
			t.Fatalf("fingerprint provider request: %v", err)
		}
		return sha256AnyValue(workflowOperationInvocationEnvelope{
			AdmissionSnapshotSHA256: strings.Repeat("a", 64),
			ExecutionInputSHA256:    strings.Repeat("b", 64),
			InvocationID:            invocationID,
			Operation:               temporalruntime.WorkflowOperationSolve,
			ProviderRequestSHA256:   providerRequest,
			RequestID:               runID,
			SchemaVersion:           workflowOperationInvocationSchemaVersion,
			StepID:                  "solve.initial",
		})
	}
	firstFingerprint := invocationFingerprint(1)
	if firstFingerprint != "83fd8fcf89e85fd386ab3e40546feefeceb84237725ac88e75d15df4ab2b68f3" {
		t.Fatalf("invocation fingerprint changed: %s", firstFingerprint)
	}
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
	if _, disposition, err := store.BeginAgentInvocation(context.Background(), receipt); err != nil ||
		disposition != execution.AgentInvocationDispositionClaimed {
		t.Fatalf("claim operation receipt disposition=%q err=%v", disposition, err)
	}
	output := json.RawMessage(`{"operation":"solve","status":"completed"}`)
	receipt.OutputJSON = output
	receipt.OutputSHA256 = sha256Bytes(output)
	receipt.CompletedAt = now.Add(time.Second)
	receipt.UpdatedAt = receipt.CompletedAt
	if _, err := store.CompleteAgentInvocation(context.Background(), receipt); err != nil {
		t.Fatalf("complete operation receipt: %v", err)
	}

	retryReceipt := receipt
	retryReceipt.InputSHA256 = retryFingerprint
	stored, disposition, err := store.BeginAgentInvocation(context.Background(), retryReceipt)
	if err != nil || disposition != execution.AgentInvocationDispositionReplay ||
		string(stored.OutputJSON) != string(output) {
		t.Fatalf("retry receipt=%#v disposition=%q err=%v", stored, disposition, err)
	}
	retryReceipt.InputSHA256 = strings.Repeat("f", 64)
	if _, _, err := store.BeginAgentInvocation(context.Background(), retryReceipt); err == nil {
		t.Fatal("changed input reused completed receipt")
	}
}

func TestValidateWorkflowOperationOutputSourcesRequiresCurrentStepCandidates(t *testing.T) {
	step := temporalruntime.WorkflowTaskPlanStep{
		ID:               "step.campus",
		Objective:        "查询校内资料",
		CandidateSources: []temporalruntime.WorkflowSource{temporalruntime.WorkflowSourceCampusSearch},
	}
	request := workflowOperationActivityRequest{
		Operation: temporalruntime.WorkflowOperationExecuteStep,
		Step:      &step,
	}
	output := temporalruntime.WorkflowOperationActivityOutput{
		ToolResults: []temporalruntime.AgentToolResult{{
			ToolName:     personalMemoryRecallToolName,
			InvocationID: "memory-call",
			Status:       "completed",
		}},
	}

	err := validateWorkflowOperationOutputSources(request, output)
	if err == nil || !strings.Contains(err.Error(), "not a candidate source") {
		t.Fatalf("source validation error = %v", err)
	}
}

func TestValidateWorkflowOperationOutputSourcesRejectsRetrievalOnSolver(t *testing.T) {
	request := workflowOperationActivityRequest{Operation: temporalruntime.WorkflowOperationSolve}
	output := temporalruntime.WorkflowOperationActivityOutput{
		ToolResults: []temporalruntime.AgentToolResult{{
			ToolName:     campusSearchToolName,
			InvocationID: "campus-call",
			Status:       "completed",
		}},
	}

	if err := validateWorkflowOperationOutputSources(request, output); err == nil ||
		!strings.Contains(err.Error(), "solver returned retrieval output") {
		t.Fatalf("solver source validation error = %v", err)
	}
}

func TestValidateWorkflowOperationOutputSourcesRequiresExplicitWebCandidate(t *testing.T) {
	step := temporalruntime.WorkflowTaskPlanStep{
		ID:               "step.campus",
		Objective:        "查询校内资料",
		CandidateSources: []temporalruntime.WorkflowSource{temporalruntime.WorkflowSourceCampusSearch},
	}
	request := workflowOperationActivityRequest{
		Operation: temporalruntime.WorkflowOperationExecuteStep,
		Step:      &step,
	}
	output := temporalruntime.WorkflowOperationActivityOutput{
		WebSearchUsed: true,
		WebCitations: []temporalruntime.AgentWebCitation{{
			StartIndex: 0,
			EndIndex:   1,
			Title:      "学校官网",
			URL:        "https://example.edu/page",
		}},
	}

	if err := validateWorkflowOperationOutputSources(request, output); err == nil ||
		!strings.Contains(err.Error(), "not a candidate source") {
		t.Fatalf("web source validation error = %v", err)
	}
}

func TestValidateWorkflowOperationOutputSourcesAllowsWebNoMatchWithoutCitations(t *testing.T) {
	step := temporalruntime.WorkflowTaskPlanStep{
		ID:               "step.web",
		Objective:        "查询公开校园网页",
		CandidateSources: []temporalruntime.WorkflowSource{temporalruntime.WorkflowSourceWebSearch},
	}
	request := workflowOperationActivityRequest{
		Operation: temporalruntime.WorkflowOperationExecuteStep,
		Step:      &step,
	}
	output := temporalruntime.WorkflowOperationActivityOutput{
		SourceAttempts: []temporalruntime.WorkflowSourceAttempt{{
			Source: temporalruntime.WorkflowSourceWebSearch,
			Status: "no_match",
		}},
		WebSearchUsed: true,
	}

	if err := validateWorkflowOperationOutputSources(request, output); err != nil {
		t.Fatalf("web no-match source validation error = %v", err)
	}
}

func TestValidateWorkflowOperationOutputSourcesRejectsRetrievalOnReplanner(t *testing.T) {
	request := workflowOperationActivityRequest{Operation: temporalruntime.WorkflowOperationReplan}
	output := temporalruntime.WorkflowOperationActivityOutput{
		ToolResults: []temporalruntime.AgentToolResult{{
			ToolName:     campusSearchToolName,
			InvocationID: "campus-call",
			Status:       "completed",
		}},
	}

	if err := validateWorkflowOperationOutputSources(request, output); err == nil ||
		!strings.Contains(err.Error(), "returned source output") {
		t.Fatalf("replanner source validation error = %v", err)
	}
}
