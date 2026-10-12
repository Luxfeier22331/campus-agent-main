package operation

import (
	searchapi "github.com/MUC-WIKI/campus-agent/packages/search-api-go"
	"reflect"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

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
					items := []searchapi.SearchResultItem{}
					if matched {
						items = append(items, searchapi.SearchResultItem{ResultRef: "result://sha256:" + strings.Repeat("a", 64), SourceKind: "notice", NoticeID: "notice-1", CitationHref: "/notices/notice-1", Title: "校园服务", SectionTitle: "办理说明", Text: "唯一检索正文"})
					}
					full := searchapi.EncodeSearchResult(items, 1)
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
