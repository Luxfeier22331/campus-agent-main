package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const agentInvocationReceiptSchemaVersion = "agent_invocation_receipt_v2"

var errAgentInvocationReceiptIntegrity = errors.New("agent invocation receipt integrity failure")

type agentInvocationOutputSummary struct {
	OutputSHA256             string `json:"output_sha256"`
	ProviderInvocationSHA256 string `json:"provider_invocation_sha256"`
	ResultRef                string `json:"result_ref"`
	ResultSchemaVersion      string `json:"result_schema_version"`
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

func (e primaryAgentActivityEvidence) protectedPayload() map[string]any {
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

func primaryAgentActivityEvidenceFromPayload(value any) (primaryAgentActivityEvidence, error) {
	payload := cloneAnyMapFromMetadata(value)
	if len(payload) == 0 {
		return primaryAgentActivityEvidence{}, receiptIntegrityError("activity evidence is missing")
	}
	evidence := primaryAgentActivityEvidence{
		ActivityAttempt:   intFromAny(payload["activity_attempt"]),
		ActivityID:        strings.TrimSpace(stringValue(payload["activity_id"])),
		ActivityType:      strings.TrimSpace(stringValue(payload["activity_type"])),
		Attempt:           intFromAny(payload["attempt"]),
		ScheduleToStartMS: int64(intFromAny(payload["schedule_to_start_ms"])),
		TaskQueue:         strings.TrimSpace(stringValue(payload["task_queue"])),
		TemporalRunID:     strings.TrimSpace(stringValue(payload["temporal_run_id"])),
		WorkerID:          strings.TrimSpace(stringValue(payload["worker_id"])),
		WorkflowID:        strings.TrimSpace(stringValue(payload["workflow_id"])),
	}
	evidence.TemporalDispatch, _ = payload["temporal_dispatch"].(bool)
	var err error
	if scheduledAt := strings.TrimSpace(stringValue(payload["scheduled_at"])); scheduledAt != "" {
		evidence.ScheduledAt, err = time.Parse(time.RFC3339Nano, scheduledAt)
		if err != nil {
			return primaryAgentActivityEvidence{}, receiptIntegrityError("scheduled_at is invalid")
		}
	}
	if startedAt := strings.TrimSpace(stringValue(payload["started_at"])); startedAt != "" {
		evidence.StartedAt, err = time.Parse(time.RFC3339Nano, startedAt)
		if err != nil {
			return primaryAgentActivityEvidence{}, receiptIntegrityError("started_at is invalid")
		}
	}
	if evidence.Attempt <= 0 || evidence.ActivityAttempt <= 0 ||
		evidence.Attempt != evidence.ActivityAttempt || evidence.StartedAt.IsZero() ||
		evidence.ActivityType == "" || evidence.WorkflowID == "" ||
		evidence.ScheduleToStartMS < 0 {
		return primaryAgentActivityEvidence{}, receiptIntegrityError("activity evidence identity is invalid")
	}
	if evidence.TemporalDispatch && (evidence.ActivityID == "" || evidence.TemporalRunID == "" || evidence.ScheduledAt.IsZero()) {
		return primaryAgentActivityEvidence{}, receiptIntegrityError("Temporal activity evidence is incomplete")
	}
	return evidence, nil
}

func receiptIntegrityError(message string) error {
	return fmt.Errorf("%w: %s", errAgentInvocationReceiptIntegrity, message)
}

func encodeAgentInvocationOutputSummary(
	resultRef string,
	providerInvocationSHA256 string,
	payload map[string]any,
) ([]byte, error) {
	return json.Marshal(agentInvocationOutputSummary{
		OutputSHA256:             sha256AnyValue(payload),
		ProviderInvocationSHA256: strings.TrimSpace(providerInvocationSHA256),
		ResultRef:                strings.TrimSpace(resultRef),
		ResultSchemaVersion:      protectedPayloadKindAgentResult,
		SchemaVersion:            agentInvocationReceiptSchemaVersion,
	})
}

func decodeAgentInvocationOutputSummary(raw []byte) (agentInvocationOutputSummary, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var summary agentInvocationOutputSummary
	if err := decoder.Decode(&summary); err != nil {
		return agentInvocationOutputSummary{}, errors.New("agent invocation receipt output is invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return agentInvocationOutputSummary{}, errors.New("agent invocation receipt output is invalid")
	}
	if summary.SchemaVersion != agentInvocationReceiptSchemaVersion ||
		summary.ResultSchemaVersion != protectedPayloadKindAgentResult ||
		strings.TrimSpace(summary.ResultRef) == "" ||
		!lowercaseSHA256Pattern.MatchString(summary.OutputSHA256) ||
		!lowercaseSHA256Pattern.MatchString(summary.ProviderInvocationSHA256) {
		return agentInvocationOutputSummary{}, errors.New("agent invocation receipt output identity is invalid")
	}
	return summary, nil
}

func (s *Server) completePrimaryAgentFromReceipt(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
	expectedInputSHA256 string,
	receipt execution.AgentInvocationReceipt,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	canonicalRef := temporalProjectionRef(run.RunID, "agent/primary/result")
	if receipt.State != execution.AgentInvocationReceiptStateCompleted ||
		receipt.InvocationID != run.RunID+":agent.primary" ||
		receipt.RunID != run.RunID || receipt.InputSHA256 != expectedInputSHA256 ||
		receipt.CreatedAt.IsZero() || receipt.CompletedAt.IsZero() ||
		receipt.CompletedAt.Before(receipt.CreatedAt) {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("completed receipt identity is invalid")
	}
	summary, err := decodeAgentInvocationOutputSummary(receipt.OutputJSON)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError(err.Error())
	}
	canonicalSummary, err := json.Marshal(summary)
	if err != nil || sha256Bytes(canonicalSummary) != receipt.OutputSHA256 {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("receipt output hash mismatch")
	}
	if summary.ResultRef != canonicalRef {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("receipt result ref differs")
	}
	if summary.ProviderInvocationSHA256 != receipt.InputSHA256 {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("receipt provider invocation hash mismatch")
	}
	var payload map[string]any
	if err := s.getProtectedJSON(
		ctx,
		run,
		canonicalRef,
		protectedPayloadKindAgentResult,
		&payload,
	); err != nil {
		if errors.Is(err, execution.ErrProtectedPayloadNotFound) || protectedPayloadIntegrityFailure(err) {
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError(err.Error())
		}
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("load completed agent result: %w", err)
	}
	if sha256AnyValue(payload) != summary.OutputSHA256 {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("protected result hash does not match receipt")
	}
	if strings.TrimSpace(stringValue(payload["provider_invocation_sha256"])) != summary.ProviderInvocationSHA256 ||
		strings.TrimSpace(stringValue(payload["result_schema_version"])) != summary.ResultSchemaVersion {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("protected result invocation or schema identity differs")
	}
	output, err := primaryAgentOutputFromResultPayload(payload)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError(err.Error())
	}
	if output.AgentResultRef != canonicalRef || output.Status != "completed" ||
		!validPrimaryAgentTerminalEnvelope(output.TerminalEnvelope) {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("completed result identity is invalid")
	}
	attempt, ok := positiveIntValue(payload["activity_attempt"])
	if !ok {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("completed result activity attempt is invalid")
	}
	evidence, err := primaryAgentActivityEvidenceFromPayload(payload["activity_evidence"])
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if evidence.Attempt != attempt {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, receiptIntegrityError("result attempt differs from frozen activity evidence")
	}
	output.RunID = run.RunID
	projectionIdentity := primaryAgentProjectionIdentity{
		ActivityAttempt:   evidence.ActivityAttempt,
		ActivityID:        evidence.ActivityID,
		ActivityType:      evidence.ActivityType,
		Attempt:           evidence.Attempt,
		PreserveAttempt:   true,
		ScheduledAt:       evidence.ScheduledAt,
		ScheduleToStartMS: evidence.ScheduleToStartMS,
		StartedAt:         evidence.StartedAt,
		TemporalRunID:     evidence.TemporalRunID,
		WorkerID:          evidence.WorkerID,
		WorkflowID:        evidence.WorkflowID,
	}
	if err := s.projectPrimaryAgentToolResults(
		ctx,
		run,
		evidence.StartedAt,
		receipt.CompletedAt,
		attempt,
		input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames,
		output,
		projectionIdentity,
	); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	projectionPayload := primaryAgentResultProjectionPayload(payload)
	projectionPayload["protected_result_sha256"] = summary.OutputSHA256
	projectionPayload["protected_result_schema_version"] = summary.ResultSchemaVersion
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:            evidence.Attempt,
		ActivityAttempt:    evidence.ActivityAttempt,
		ActivityID:         evidence.ActivityID,
		ActivityType:       evidence.ActivityType,
		PreserveAttempt:    true,
		Tool:               "",
		Run:                run,
		Status:             "completed",
		StepID:             "agent.primary",
		StepKind:           "agent",
		TaskQueue:          temporalruntime.ActivityTaskQueueAgent,
		WorkerID:           evidence.WorkerID,
		WorkflowID:         evidence.WorkflowID,
		TemporalRunID:      evidence.TemporalRunID,
		ScheduledAt:        evidence.ScheduledAt,
		ScheduleToStartMS:  evidence.ScheduleToStartMS,
		StartedAt:          evidence.StartedAt,
		CompletedAt:        receipt.CompletedAt,
		UpdatedAt:          receipt.CompletedAt,
		ResultKind:         "agent_final_output",
		ProjectionRef:      canonicalRef,
		ProviderResponseID: output.ProviderResponseID,
		ModelProvider:      output.ModelProvider,
		ModelName:          output.ModelName,
		InputTokens:        output.Usage.InputTokens,
		OutputTokens:       output.Usage.OutputTokens,
		CachedInputTokens:  output.Usage.CachedInputTokens,
		Payload:            projectionPayload,
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":agent-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeAgentCompleted,
		OccurredAt:           receipt.CompletedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"agent_result_ref":     canonicalRef,
			"provider_response_id": output.ProviderResponseID,
			"stage_timing":         cloneAnyMapFromMetadata(output.StageTiming),
			"terminal_reason":      output.TerminalReason,
		},
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	return output, nil
}

func protectedPayloadIntegrityFailure(err error) bool {
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	for _, fragment := range []string{
		"protected payload authentication failed",
		"protected payload cipher is invalid",
		"protected payload ciphertext is invalid",
		"protected payload envelope is invalid",
		"protected payload hash mismatch",
		"protected payload nonce is invalid",
		"decode protected payload",
	} {
		if strings.Contains(message, fragment) {
			return true
		}
	}
	return false
}
