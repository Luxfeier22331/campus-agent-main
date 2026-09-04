package temporaladapter

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const agentInvocationReceiptSchemaVersion = "agent_invocation_receipt_v3"

var errAgentInvocationReceiptIntegrity = errors.New("agent invocation receipt integrity failure")

type agentInvocationOutputSummary struct {
	ProviderInvocationSHA256 string `json:"provider_invocation_sha256"`
	ResultRef                string `json:"result_ref"`
	SchemaVersion            string `json:"schema_version"`
}

type primaryAgentActivityEvidence struct {
	ActivityAttempt   int
	ActivityID        string
	ActivityType      string
	Attempt           int
	ScheduledAt       time.Time
	ScheduleToStartMS int64
	StartedAt         time.Time
	TaskQueue         string
	TemporalDispatch  bool
	TemporalRunID     string
	WorkerID          string
	WorkflowID        string
}

func primaryAgentActivityEvidenceFromProjection(
	projection temporalStepProjection,
	temporalDispatch bool,
) primaryAgentActivityEvidence {
	return primaryAgentActivityEvidence{
		ActivityAttempt:   projection.ActivityAttempt,
		ActivityID:        strings.TrimSpace(projection.ActivityID),
		ActivityType:      strings.TrimSpace(projection.ActivityType),
		Attempt:           projection.Attempt,
		ScheduledAt:       projection.ScheduledAt.UTC(),
		ScheduleToStartMS: projection.ScheduleToStartMS,
		StartedAt:         projection.StartedAt.UTC(),
		TaskQueue:         strings.TrimSpace(projection.TaskQueue),
		TemporalDispatch:  temporalDispatch,
		TemporalRunID:     strings.TrimSpace(projection.TemporalRunID),
		WorkerID:          strings.TrimSpace(projection.WorkerID),
		WorkflowID:        strings.TrimSpace(projection.WorkflowID),
	}
}

func (e primaryAgentActivityEvidence) payload() map[string]any {
	payload := map[string]any{
		"activity_attempt":     e.ActivityAttempt,
		"activity_id":          e.ActivityID,
		"activity_type":        e.ActivityType,
		"attempt":              e.Attempt,
		"schedule_to_start_ms": e.ScheduleToStartMS,
		"task_queue":           e.TaskQueue,
		"temporal_dispatch":    e.TemporalDispatch,
		"temporal_run_id":      e.TemporalRunID,
		"worker_id":            e.WorkerID,
		"workflow_id":          e.WorkflowID,
	}
	if !e.ScheduledAt.IsZero() {
		payload["scheduled_at"] = e.ScheduledAt.Format(time.RFC3339Nano)
	}
	if !e.StartedAt.IsZero() {
		payload["started_at"] = e.StartedAt.Format(time.RFC3339Nano)
	}
	return payload
}

func receiptIntegrityError(message string) error {
	return fmt.Errorf("%w: %s", errAgentInvocationReceiptIntegrity, message)
}

func encodeAgentInvocationOutputSummary(
	resultRef string,
	providerInvocationSHA256 string,
) ([]byte, error) {
	return json.Marshal(agentInvocationOutputSummary{
		ProviderInvocationSHA256: strings.TrimSpace(providerInvocationSHA256),
		ResultRef:                strings.TrimSpace(resultRef),
		SchemaVersion:            agentInvocationReceiptSchemaVersion,
	})
}
