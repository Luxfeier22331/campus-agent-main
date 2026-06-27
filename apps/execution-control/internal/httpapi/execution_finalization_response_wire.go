package httpapi

import "encoding/json"

type ExecutionFinalizationResponseWire struct {
	AnswerText           string         `json:"answer_text"`
	Confidence           string         `json:"confidence"`
	Error                any            `json:"error"`
	FollowUpQuestion     string         `json:"follow_up_question"`
	Observability        map[string]any `json:"observability"`
	Result               map[string]any `json:"result"`
	SelectedTool         *string        `json:"selected_tool"`
	Status               string         `json:"status"`
	TraceID              string         `json:"trace_id"`
	WorkflowTraceSummary map[string]any `json:"workflow_trace_summary"`
}

func executionFinalizationResponseWireMap(response ExecutionFinalizationResponseWire) map[string]any {
	encoded, err := json.Marshal(response)
	if err != nil {
		panic(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		panic(err)
	}
	return payload
}

func ptrString(value string) *string {
	return &value
}
