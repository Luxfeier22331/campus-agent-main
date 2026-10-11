package operation

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
)

func TestReceiptBudgetSurvivesJSONBWhitespace(t *testing.T) {
	output := executioncontract.OperationOutput{Operation: executioncontract.WorkflowOperationSolve}
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
	var restored executioncontract.OperationOutput
	if err := decodeReceiptOutput(spaced.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.FinalOutput != output.FinalOutput {
		t.Fatal("receipt changed")
	}
}

func TestSourceFailureDoesNotInvalidateCompletedAnswer(t *testing.T) {
	request := OperationRequest{Operation: executioncontract.WorkflowOperationSolve}
	request.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames = []string{"personal_memory_recall", "campus_search"}
	for _, code := range []string{"personal_memory_recall_failed", "campus_search_timeout", "tool_contract_mismatch", "run_context_conflict"} {
		output := executioncontract.OperationOutput{Status: "completed", ToolResults: []executioncontract.AgentToolResult{{ToolName: "personal_memory_recall", Status: "failed", Failure: &executioncontract.ExecutionFailure{Code: code, Operation: "tool.personal_memory_recall"}}}}
		err := ValidateWorkflowOperationOutputSources(request, output)
		if (err == nil) != executioncontract.WorkflowSourceUnavailable(code) {
			t.Fatalf("code %s: %v", code, err)
		}
	}
}

func TestSynthesisOutputMustNotReturnAdmittedMaterials(t *testing.T) {
	request := OperationRequest{
		Operation: executioncontract.WorkflowOperationSynthesize,
		Evidence: []executioncontract.WorkflowEvidence{{
			ID: "notice-1", Source: executioncontract.WorkflowSourceCampusSearch,
			Title: "通知", Excerpt: "正文", CitationIndex: 1,
		}},
		SourceAttempts: []executioncontract.WorkflowSourceAttempt{{
			Source: executioncontract.WorkflowSourceCampusSearch, Status: "matched",
		}},
	}
	if err := ValidateWorkflowOperationOutputSources(request, executioncontract.OperationOutput{
		Operation: executioncontract.WorkflowOperationSynthesize,
		Status:    "completed",
	}); err != nil {
		t.Fatalf("empty synthesis response rejected: %v", err)
	}
	if err := ValidateWorkflowOperationOutputSources(request, executioncontract.OperationOutput{
		Operation:      executioncontract.WorkflowOperationSynthesize,
		Status:         "completed",
		Evidence:       request.Evidence,
		SourceAttempts: request.SourceAttempts,
	}); err == nil {
		t.Fatal("synthesis response echoed admitted materials")
	}
}

func TestSynthesisRuntimeResponseRejectsReturnedMaterials(t *testing.T) {
	_, err := WorkflowOperationOutputFromRuntimeResponse(
		executionapplication.AgentRuntimeResult{
			Operation:   string(executioncontract.WorkflowOperationSynthesize),
			Status:      "completed",
			FinalOutput: "答案",
			Evidence:    []map[string]any{{"id": "notice-1"}},
		},
		executioncontract.WorkflowOperationSynthesize,
		"operation-result",
	)
	if err == nil || !strings.Contains(err.Error(), "must not return evidence") {
		t.Fatalf("err = %v, want synthesis material rejection", err)
	}
}

func TestTemporalMemoryToolResultIsAllowlistedAndBounded(t *testing.T) {
	result, err := temporalToolResult(executionapplication.AgentToolResult{
		ToolName: "personal_memory_recall", Status: "completed",
		Result: map[string]any{"outcome": "matched", "memory_text": strings.Repeat("😀", 4000), "query": "private-query", "raw": map[string]any{"secret": "private-debug"}},
	}, executioncontract.WorkflowOperationExecuteStep)
	if err != nil || len(result) != 1 || result["outcome"] != "matched" {
		t.Fatalf("result = %#v, err = %v", result, err)
	}
	_, err = temporalToolResult(executionapplication.AgentToolResult{ToolName: "personal_memory_recall", Status: "completed", Result: map[string]any{"outcome": "matched", "memory_text": strings.Repeat("😀", 4001)}}, executioncontract.WorkflowOperationExecuteStep)
	if err == nil {
		t.Fatal("oversized memory accepted")
	}
}

func TestTemporalMemoryToolResultKeepsNoMatchWithoutPayload(t *testing.T) {
	result, err := temporalToolResult(executionapplication.AgentToolResult{ToolName: "personal_memory_recall", Status: "completed", Result: map[string]any{"outcome": "no_match", "memory_text": ""}}, executioncontract.WorkflowOperationExecuteStep)
	if err != nil || len(result) != 1 || result["outcome"] != "no_match" {
		t.Fatalf("result = %#v, err = %v", result, err)
	}
}

func TestOperationOutputRejectsUnknownFieldsAndOversizedEvidence(t *testing.T) {
	var output executioncontract.OperationOutput
	if err := decodeOperationJSON([]byte("{\"unknown_debug\":\"secret\"}"), &output); err == nil {
		t.Fatal("unknown receipt field accepted")
	}
	output.Operation = executioncontract.WorkflowOperationSolve
	output.StageTiming = map[string]any{"debug": 1.0}
	if err := ValidateOperationOutputFields(output); err == nil {
		t.Fatal("unknown timing accepted")
	}
	output.StageTiming = nil
	output.Evidence = []executioncontract.WorkflowEvidence{{Excerpt: strings.Repeat("😀", 4000)}}
	if err := ValidateOperationOutputFields(output); err != nil {
		t.Fatal(err)
	}
	output.Evidence[0].Excerpt += "😀"
	if err := ValidateOperationOutputFields(output); err == nil {
		t.Fatal("oversized evidence accepted")
	}
}

func TestCampusSearchOutputCompactsOnlyExecuteResults(t *testing.T) {
	for _, operation := range []executioncontract.WorkflowOperation{executioncontract.WorkflowOperationExecuteStep, executioncontract.WorkflowOperationSolve} {
		for _, status := range []string{"completed", "failed"} {
			for _, matched := range []bool{false, true} {
				t.Run(string(operation)+"/"+status+"/"+map[bool]string{true: "matched", false: "no_match"}[matched], func(t *testing.T) {
					items := []campussearch.SearchResultItem{}
					if matched {
						items = append(items, campussearch.SearchResultItem{ResultRef: "result://sha256:" + strings.Repeat("a", 64), SourceKind: "notice", NoticeID: "notice-1", CitationHref: "/notices/notice-1", Title: "校园服务", SectionTitle: "办理说明", Text: "唯一检索正文"})
					}
					full := campussearch.EncodeSearchResult(items, 1)
					response := executionapplication.AgentRuntimeResult{Status: status, SolveOutcome: "answer", FinalOutput: "办理说明[1]", ToolResults: []executionapplication.AgentToolResult{{ToolName: "campus_search", Status: "completed", InvocationID: "search-1", DurationMS: 12, Result: full}}}
					if status == "failed" {
						response.Failure = &executioncontract.ExecutionFailure{Code: "model_output_invalid", Operation: string(operation)}
					}
					output, err := WorkflowOperationOutputFromRuntimeResponse(response, operation, "operation-result")
					if err != nil {
						t.Fatal(err)
					}
					want := full
					if operation == executioncontract.WorkflowOperationExecuteStep {
						want = map[string]any{"outcome": full["outcome"]}
					}
					tool := output.ToolResults[0]
					if !reflect.DeepEqual(tool.Result, want) || tool.InvocationID != "search-1" || tool.DurationMS != 12 || output.Status != status {
						t.Fatalf("output=%#v", output)
					}
					if _, exists := response.ToolResults[0].Result["results"]; !exists {
						t.Fatal("conversion changed raw projection input")
					}
					if err := ValidateOperationOutputFields(output); err != nil {
						t.Fatal(err)
					}
				})
			}
		}
	}
}

func TestExecuteToolSummaryStillValidatesRuntimeResult(t *testing.T) {
	for name, result := range map[string]map[string]any{
		"summary is not a runtime result": {"outcome": "matched"},
		"matched without results":         {"outcome": "matched", "results": []any{}},
		"extra field":                     {"outcome": "no_match", "results": []any{}, "debug": "unexpected"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := temporalToolResult(executionapplication.AgentToolResult{ToolName: "campus_search", Status: "completed", Result: result}, executioncontract.WorkflowOperationExecuteStep); err == nil {
				t.Fatal("invalid runtime result accepted")
			}
		})
	}
	result, err := temporalToolResult(executionapplication.AgentToolResult{ToolName: "campus_search", Status: "failed", Result: map[string]any{"text": "discarded"}}, executioncontract.WorkflowOperationExecuteStep)
	if err != nil || len(result) != 0 {
		t.Fatalf("failed tool result=%v err=%v", result, err)
	}
}

func TestExecuteReceiptAcceptsOnlyFullResultOrOutcome(t *testing.T) {
	for _, tc := range []struct {
		name   string
		result map[string]any
		valid  bool
	}{
		{"matched", map[string]any{"outcome": "matched"}, true},
		{"no_match", map[string]any{"outcome": "no_match"}, true},
		{"legacy", campussearch.EncodeSearchResult(nil, 1), true},
		{"invalid outcome", map[string]any{"outcome": "unknown"}, false},
		{"extra field", map[string]any{"outcome": "matched", "text": "unexpected"}, false},
		{"invalid full result", map[string]any{"outcome": "matched", "results": []any{}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			output := executioncontract.OperationOutput{Operation: executioncontract.WorkflowOperationExecuteStep, ToolResults: []executioncontract.AgentToolResult{{ToolName: "campus_search", Status: "completed", Result: tc.result}}}
			encoded, err := json.MarshalIndent(output, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			var restored executioncontract.OperationOutput
			err = decodeReceiptOutput(encoded, &restored)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v err=%v", tc.valid, err)
			}
			if tc.valid {
				wantJSON, _ := json.Marshal(tc.result)
				gotJSON, _ := json.Marshal(restored.ToolResults[0].Result)
				if string(wantJSON) != string(gotJSON) {
					t.Fatalf("receipt changed: want %s got %s", wantJSON, gotJSON)
				}
			}
			if tc.name == "matched" || tc.name == "no_match" {
				output.Operation = executioncontract.WorkflowOperationSolve
				if err := ValidateOperationOutputFields(output); err == nil {
					t.Fatal("Solve accepted a summary without its citation results")
				}
			}
		})
	}
}
