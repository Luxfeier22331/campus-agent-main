package execution

import (
	"context"
	"strings"
	"time"
)

// executionMetadataForTest mirrors the production input reference without
// putting the payload itself in the run projection.
func executionMetadataForTest(runID string, _ string) map[string]any {
	return map[string]any{
		"execution_contract_version": "tool_execution_v5",
		"execution_input_ref":        "app-api://execution-inputs/" + runID,
		"execution_input_sha256":     strings.Repeat("a", 64),
	}
}

func storeFinalizationResultForTest(
	store *InMemoryRunProjectionStore,
	runID string,
	projectionRef string,
	createdAt time.Time,
) error {
	results, err := store.ListStepResults(context.Background(), runID)
	if err != nil {
		return err
	}
	for _, result := range results {
		if result.StepID == "finalization.write" && result.Status == "completed" &&
			result.ResultKind == "final_answer_projection" && result.ProjectionRef == projectionRef {
			return nil
		}
	}
	_, err = store.UpsertStepResult(context.Background(), StepResultProjection{
		ResultID:             runID + ":finalization.write:result-1",
		StepID:               "finalization.write",
		RunID:                runID,
		AttemptID:            runID + ":finalization.write:attempt-1",
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        projectionRef,
		CreatedAt:            createdAt,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"activity_attempt": 1},
	})
	return err
}
