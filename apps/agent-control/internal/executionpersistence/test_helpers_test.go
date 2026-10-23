package executionpersistence

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"strings"
	"time"
)

// executionMetadataForTest mirrors the production input reference without
// putting the payload itself in the run projection.
func executionMetadataForTest(requestID string, _ string) map[string]any {
	return map[string]any{
		"execution_contract_version": "tool_execution_v7",
		"execution_input_ref":        "app-api://execution-inputs/" + requestID,
		"execution_input_sha256":     strings.Repeat("a", 64),
	}
}

func storeFinalizationResultForTest(
	store *InMemoryRunProjectionStore,
	requestID string,
	projectionRef string,
	createdAt time.Time,
) error {
	results, err := store.ListStepResults(context.Background(), requestID)
	if err != nil {
		return err
	}
	for _, result := range results {
		if result.StepID == "finalization.write" && result.Status == "completed" &&
			result.ResultKind == "final_answer_projection" && result.ProjectionRef == projectionRef {
			return nil
		}
	}
	_, err = store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             requestID + ":finalization.write:result-1",
		StepID:               "finalization.write",
		RequestID:            requestID,
		AttemptID:            requestID + ":finalization.write:attempt-1",
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        projectionRef,
		CreatedAt:            createdAt,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"activity_attempt": 1},
	})
	return err
}
