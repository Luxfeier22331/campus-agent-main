package contract

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestOperationConversionPreservesPersistedJSON(t *testing.T) {
	now := time.Date(2026, 10, 10, 0, 0, 0, 123000, time.UTC)
	for _, empty := range []bool{false, true} {
		result := temporalruntime.WorkflowOperationActivityOutput{RequestID: "run", Operation: temporalruntime.WorkflowOperationSolve, SolveOutcome: "answer", Status: "completed", FinalOutput: "正文", ToolContractFingerprint: map[string]any{"schema_version": "v1"}, StageTiming: map[string]any{"workflow.solve_ms": float64(12)}, Plan: &temporalruntime.WorkflowTaskPlan{Steps: []temporalruntime.WorkflowTaskPlanStep{{ID: "step.a", CandidateSources: []temporalruntime.WorkflowSource{temporalruntime.WorkflowSourceCampusSearch}}}}, Failure: &temporalruntime.ExecutionFailure{Code: "provider_timeout", Citation: json.RawMessage(`{"reason":"invalid_url"}`)}, ToolResults: []temporalruntime.AgentToolResult{{StartedAt: &now, Failure: &temporalruntime.ExecutionFailure{Code: "tool_handler_failed"}, Result: map[string]any{"found": true}}}, Evidence: []temporalruntime.WorkflowEvidence{{Source: temporalruntime.WorkflowSourceCampusSearch, SourceLink: &temporalruntime.SourceLink{}}}, WebSearchDiagnostic: &temporalruntime.WebSearchDiagnostic{DiscardReasons: map[string]int{"invalid_url": 1}}}
		if empty {
			result.Evidence = []temporalruntime.WorkflowEvidence{}
			result.ToolResults = nil
			result.Plan = nil
		}
		app := AppWorkflowOperationActivityOutput(result)
		restored := WireWorkflowOperationActivityOutput(app)
		if !reflect.DeepEqual(result, restored) {
			t.Fatalf("conversion changed nil, empty or nested fields: %#v", restored)
		}
		before, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(app)
		if err != nil {
			t.Fatal(err)
		}
		if string(before) != string(after) {
			t.Fatalf("receipt JSON changed:\n%s\n%s", before, after)
		}
		input := temporalruntime.WriteWorkflowFinalizationActivityInput{RequestID: "run", WorkflowResult: result, AdmissionSnapshot: temporalruntime.AgentAdmissionSnapshot{AgentCapabilities: temporalruntime.AgentCapabilitiesSnapshot{VisibleFunctionToolNames: []string{"campus_search"}}}}
		if !reflect.DeepEqual(input, WireWriteWorkflowFinalizationActivityInput(AppWriteWorkflowFinalizationActivityInput(input))) {
			t.Fatal("finalization input conversion changed")
		}
	}
}
