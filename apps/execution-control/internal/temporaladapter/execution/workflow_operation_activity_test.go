package execution

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestReceiptBudgetSurvivesJSONBWhitespace(t *testing.T) {
	output := temporalruntime.WorkflowOperationActivityOutput{Operation: temporalruntime.WorkflowOperationSolve}
	encoded, err := json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	output.FinalOutput = strings.Repeat("x", (1<<20)-len(encoded))
	encoded, err = json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	var spaced bytes.Buffer
	if err := json.Indent(&spaced, encoded, "", "  "); err != nil {
		t.Fatal(err)
	}
	if spaced.Len() <= 1<<20 {
		t.Fatal("fixture must exceed raw budget")
	}
	var restored temporalruntime.WorkflowOperationActivityOutput
	if err := decodeReceiptOutput(spaced.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.FinalOutput != output.FinalOutput {
		t.Fatal("receipt changed")
	}
}

func TestSourceFailureDoesNotInvalidateCompletedAnswer(t *testing.T) {
	request := WorkflowOperationActivityRequest{Operation: temporalruntime.WorkflowOperationSolve}
	request.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames = []string{"personal_memory_recall", "campus_search"}
	for _, code := range []string{"personal_memory_recall_failed", "campus_search_timeout", "tool_contract_mismatch", "run_context_conflict"} {
		output := temporalruntime.WorkflowOperationActivityOutput{Status: "completed", ToolResults: []temporalruntime.AgentToolResult{{ToolName: "personal_memory_recall", Status: "failed", Failure: &temporalruntime.ExecutionFailure{Code: code, Operation: "tool.personal_memory_recall"}}}}
		err := ValidateWorkflowOperationOutputSources(request, output)
		if (err == nil) != temporalruntime.WorkflowSourceUnavailable(code) {
			t.Fatalf("code %s: %v", code, err)
		}
	}
}

func TestTemporalMemoryToolResultIsAllowlistedAndBounded(t *testing.T) {
	result, err := temporalToolResult(AgentToolResult{
		ToolName: "personal_memory_recall", Status: "completed",
		Result: map[string]any{"outcome": "matched", "memory_text": strings.Repeat("😀", 4000), "query": "private-query", "raw": map[string]any{"secret": "private-debug"}},
	})
	if err != nil || len(result) != 1 || result["outcome"] != "matched" {
		t.Fatalf("result = %#v, err = %v", result, err)
	}
	_, err = temporalToolResult(AgentToolResult{ToolName: "personal_memory_recall", Status: "completed", Result: map[string]any{"outcome": "matched", "memory_text": strings.Repeat("😀", 4001)}})
	if err == nil {
		t.Fatal("oversized memory accepted")
	}
}

func TestTemporalMemoryToolResultKeepsNoMatchWithoutPayload(t *testing.T) {
	result, err := temporalToolResult(AgentToolResult{ToolName: "personal_memory_recall", Status: "completed", Result: map[string]any{"outcome": "no_match", "memory_text": ""}})
	if err != nil || len(result) != 1 || result["outcome"] != "no_match" {
		t.Fatalf("result = %#v, err = %v", result, err)
	}
}

func TestOperationOutputRejectsUnknownFieldsAndOversizedEvidence(t *testing.T) {
	var output temporalruntime.WorkflowOperationActivityOutput
	if err := decodeOperationJSON([]byte("{\"unknown_debug\":\"secret\"}"), &output); err == nil {
		t.Fatal("unknown receipt field accepted")
	}
	output.Operation = temporalruntime.WorkflowOperationSolve
	output.StageTiming = map[string]any{"debug": 1.0}
	if err := ValidateOperationOutputFields(output); err == nil {
		t.Fatal("unknown timing accepted")
	}
	output.StageTiming = nil
	output.Evidence = []temporalruntime.WorkflowEvidence{{Excerpt: strings.Repeat("😀", 4000)}}
	if err := ValidateOperationOutputFields(output); err != nil {
		t.Fatal(err)
	}
	output.Evidence[0].Excerpt += "😀"
	if err := ValidateOperationOutputFields(output); err == nil {
		t.Fatal("oversized evidence accepted")
	}
}
