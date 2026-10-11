package finalization

import (
	"encoding/json"
)

type ExecutionFinalizationResponseWire struct {
	AnswerText    string         `json:"answer_text"`
	Error         any            `json:"error"`
	ModelUsage    ModelUsageWire `json:"model_usage"`
	Observability map[string]any `json:"observability"`
	Result        map[string]any `json:"result"`
	StageTiming   map[string]any `json:"stage_timing,omitempty"`
	Status        string         `json:"status"`
}

type ModelUsageWire struct {
	InputTokens       int64 `json:"input_tokens"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	TotalTokens       int64 `json:"total_tokens"`
}

func ExecutionFinalizationResponseWireMap(response ExecutionFinalizationResponseWire) map[string]any {
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
