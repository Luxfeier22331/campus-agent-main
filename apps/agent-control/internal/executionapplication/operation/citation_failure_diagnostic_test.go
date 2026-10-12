package operation

import (
	"encoding/json"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"testing"
)

func TestRuntimeCitationErrorProjection(t *testing.T) {
	citation := json.RawMessage(`{"schema_version":1,"validation_stage":"provider_annotation","start":0,"end":9,"text_length":4,"offset_unit":"utf16_code_unit"}`)
	response := executionapplication.AgentRuntimeResult{Status: "failed", Failure: &executioncontract.ExecutionFailure{Code: "citation_validation_failed", Reason: "span_out_of_bounds", Citation: citation, Operation: "workflow.solve"}}
	output, err := WorkflowOperationOutputFromRuntimeResponse(response, executioncontract.WorkflowOperationSolve, "result")
	if err != nil {
		t.Fatal(err)
	}
	if output.Failure.Reason != "span_out_of_bounds" || string(output.Failure.Citation) != string(citation) {
		t.Fatalf("facts lost: %#v", output.Failure)
	}
	normalized := normalizedRuntimeFailure(&executioncontract.ExecutionFailure{Code: "citation_validation_failed", Reason: "missing_evidence", Citation: json.RawMessage(`{"schema_version":2,"private":"not persisted"}`)})
	if normalized.Code != "citation_validation_failed" || string(normalized.Citation) != `{"schema_version":0}` {
		t.Fatalf("malformed optional facts changed failure: %#v", normalized)
	}
}

func TestRuntimeFailureProjectionPreservesSourceStatusAndOperation(t *testing.T) {
	for _, status := range []int{400, 502} {
		response := executionapplication.AgentRuntimeResult{Status: "failed", Failure: &executioncontract.ExecutionFailure{
			Code: "provider_http_failed", Operation: "workflow.execute_step", HTTPStatus: status,
			Detail: "provider rejection", InvocationID: "req:step.a",
		}}
		output, err := WorkflowOperationOutputFromRuntimeResponse(response, executioncontract.WorkflowOperationExecuteStep, "result")
		if err != nil {
			t.Fatal(err)
		}
		failure := output.Failure
		if failure.HTTPStatus != status || failure.Operation != "workflow.execute_step" || failure.Detail != "provider rejection" || failure.InvocationID != "req:step.a" {
			t.Fatalf("failure evidence = %#v", failure)
		}
	}
}
