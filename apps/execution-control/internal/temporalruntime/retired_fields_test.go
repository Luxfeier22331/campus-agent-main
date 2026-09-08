package temporalruntime

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestOperationInputUsesFrozenVisibleToolsFromLegacyPayload(t *testing.T) {
	var input SolveTaskActivityInput
	err := json.Unmarshal([]byte(`{"request_id":"request","visible_function_tool_names":["retired-copy"],"admission_snapshot":{"agent_capabilities":{"visible_function_tool_names":["campus_search"]}}}`), &input)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(input.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames, []string{"campus_search"}) {
		t.Fatalf("frozen tools = %v", input.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if _, exists := fields["visible_function_tool_names"]; exists {
		t.Fatal("operation input serialized a second visible-tool list")
	}
}

func TestOperationOutputIgnoresHistoricalPromptTrace(t *testing.T) {
	for _, payload := range []string{`{}`, `{"prompt_trace":{"prompt_id":"workflow.solve"}}`} {
		var output WorkflowOperationActivityOutput
		if err := json.Unmarshal([]byte(payload), &output); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(output)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(encoded, &fields); err != nil {
			t.Fatal(err)
		}
		if _, exists := fields["prompt_trace"]; exists {
			t.Fatal("operation output serialized retired prompt trace")
		}
	}
}
