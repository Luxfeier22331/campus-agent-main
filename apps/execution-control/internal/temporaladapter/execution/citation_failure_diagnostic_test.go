package execution

import (
	"encoding/json"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestRuntimeCitationErrorProjection(t *testing.T) {
	citation := json.RawMessage(`{"schema_version":1,"validation_stage":"provider_annotation","start":0,"end":9,"text_length":4,"offset_unit":"utf16_code_unit"}`)
	for _, cause := range []error{AgentRuntimeHTTPError{Code: "citation_validation_failed", Reason: "span_out_of_bounds", Citation: citation, Operation: "workflow.solve"}, AgentRuntimeApplicationError{Code: "citation_validation_failed", Reason: "span_out_of_bounds", Citation: citation, Operation: "workflow.solve"}} {
		payload := map[string]any{"failure": map[string]any{"code": "citation_validation_failed"}}
		AddWorkflowFailureEvidence(payload, cause)
		failure := payload["failure"].(map[string]any)
		if failure["reason"] != "span_out_of_bounds" || string(failure["citation"].(json.RawMessage)) != string(citation) {
			t.Fatalf("facts lost: %#v", failure)
		}
	}
	normalized := normalizedRuntimeFailure(&temporalruntime.ExecutionFailure{Code: "citation_validation_failed", Reason: "missing_evidence", Citation: json.RawMessage(`{"schema_version":2,"private":"not persisted"}`)})
	if normalized.Code != "citation_validation_failed" || string(normalized.Citation) != `{"schema_version":0}` {
		t.Fatalf("malformed optional facts changed failure: %#v", normalized)
	}
}

func TestCitationDiagnosticRuntimeWire(t *testing.T) {
	body := `{"code":"citation_validation_failed","reason":"span_out_of_bounds","citation":{"schema_version":1,"validation_stage":"provider_annotation","start":0,"end":9,"text_length":4,"offset_unit":"utf16_code_unit"},"operation":"workflow.solve"}`
	for _, stream := range []bool{false, true} {
		adapter := &Adapter{AgentRuntimeClient: payloadRuntimeClient{body: `{"error":` + body + `}`, status: 422}}
		run := execution.DurableRun{RequestID: "citation-wire", CreatedAt: time.Now()}
		var err error
		if stream {
			_, err = adapter.ConsumeWorkflowRuntimeStream(t.Context(), run, temporalruntime.WorkflowOperationSolve, strings.NewReader("event: error\ndata: "+body+"\n\n"))
		} else {
			_, err = adapter.CallWorkflowOperationRuntime(t.Context(), run, temporalruntime.WorkflowOperationSolve, "", []byte("{}"), 60000, false)
		}
		if err == nil {
			t.Fatal("expected runtime rejection")
		}
		payload := map[string]any{"failure": map[string]any{"code": "citation_validation_failed"}}
		AddWorkflowFailureEvidence(payload, err)
		failure := payload["failure"].(map[string]any)
		if failure["reason"] != "span_out_of_bounds" || failure["citation"] == nil {
			t.Fatalf("stream=%v lost wire facts: %#v (%v)", stream, failure, err)
		}
	}
}
