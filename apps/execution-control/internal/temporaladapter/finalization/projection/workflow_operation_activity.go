package projection

import (
	"encoding/json"
	"strings"
)

const (
	WorkflowCampusSearchToolName         = "campus_search"
	WorkflowPersonalMemoryRecallToolName = "personal_memory_recall"
)

func WorkflowOperationResultRef(requestID string, stepID string) string {
	return TemporalProjectionRef(requestID, strings.ReplaceAll(strings.TrimSpace(stepID), ".", "/")+"/result")
}

func DecodeWorkflowValue(value any, target any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, target)
}
