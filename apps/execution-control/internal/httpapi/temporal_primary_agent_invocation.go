package httpapi

import (
	"context"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const primaryAgentProviderInvocationEnvelopeSchemaVersion = "primary_agent_provider_invocation.v1"

type primaryAgentProviderInvocationEnvelope struct {
	ActivityAttempt         int                                    `json:"activity_attempt"`
	ActivityInputSHA256     string                                 `json:"activity_input_sha256"`
	AdmissionSnapshot       temporalruntime.AgentAdmissionSnapshot `json:"admission_snapshot"`
	AdmissionSnapshotSHA256 string                                 `json:"admission_snapshot_sha256"`
	ExecutionInputSHA256    string                                 `json:"execution_input_sha256"`
	ExecutionStrategySHA256 string                                 `json:"execution_strategy_sha256"`
	FinalModelContextSHA256 string                                 `json:"final_model_context_sha256"`
	InvocationID            string                                 `json:"invocation_id"`
	ProviderRequestSHA256   string                                 `json:"provider_request_sha256"`
	RunID                   string                                 `json:"run_id"`
	SchemaVersion           string                                 `json:"schema_version"`
}

func newPrimaryAgentProviderInvocationEnvelope(
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
	executionInputSHA256 string,
	finalModelContext map[string]any,
	providerRequestBody []byte,
	activityAttempt int,
) (primaryAgentProviderInvocationEnvelope, error) {
	envelope := primaryAgentProviderInvocationEnvelope{
		ActivityAttempt:         activityAttempt,
		ActivityInputSHA256:     hashAdmissionJSON(canonicalPrimaryAgentActivityInput(input)),
		AdmissionSnapshot:       input.AdmissionSnapshot,
		AdmissionSnapshotSHA256: hashAdmissionJSON(input.AdmissionSnapshot),
		ExecutionInputSHA256:    strings.TrimSpace(executionInputSHA256),
		ExecutionStrategySHA256: input.AdmissionSnapshot.ExecutionStrategySHA256,
		FinalModelContextSHA256: sha256AnyValue(finalModelContext),
		InvocationID:            run.RunID + ":agent.primary",
		ProviderRequestSHA256:   sha256Bytes(providerRequestBody),
		RunID:                   run.RunID,
		SchemaVersion:           primaryAgentProviderInvocationEnvelopeSchemaVersion,
	}
	if err := validatePrimaryAgentProviderInvocationEnvelope(envelope); err != nil {
		return primaryAgentProviderInvocationEnvelope{}, err
	}
	return envelope, nil
}

func validatePrimaryAgentProviderInvocationEnvelope(
	envelope primaryAgentProviderInvocationEnvelope,
) error {
	if envelope.SchemaVersion != primaryAgentProviderInvocationEnvelopeSchemaVersion ||
		envelope.ActivityAttempt <= 0 || strings.TrimSpace(envelope.RunID) == "" ||
		envelope.InvocationID != strings.TrimSpace(envelope.RunID)+":agent.primary" {
		return receiptIntegrityError("provider invocation envelope identity is invalid")
	}
	for _, digest := range []string{
		envelope.ActivityInputSHA256,
		envelope.AdmissionSnapshotSHA256,
		envelope.ExecutionInputSHA256,
		envelope.ExecutionStrategySHA256,
		envelope.FinalModelContextSHA256,
		envelope.ProviderRequestSHA256,
	} {
		if !lowercaseSHA256Pattern.MatchString(digest) {
			return receiptIntegrityError("provider invocation envelope hash is invalid")
		}
	}
	if err := validateAdmissionSnapshot(envelope.AdmissionSnapshot); err != nil {
		return receiptIntegrityError("provider invocation admission snapshot is invalid")
	}
	if hashAdmissionJSON(envelope.AdmissionSnapshot) != envelope.AdmissionSnapshotSHA256 {
		return receiptIntegrityError("provider invocation admission snapshot hash mismatch")
	}
	if envelope.ExecutionStrategySHA256 != envelope.AdmissionSnapshot.ExecutionStrategySHA256 {
		return receiptIntegrityError("provider invocation execution strategy identity is invalid")
	}
	return nil
}

func validatePrimaryAgentProviderInvocationReplay(
	envelope primaryAgentProviderInvocationEnvelope,
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
	executionInputSHA256 string,
) (string, error) {
	if err := validatePrimaryAgentProviderInvocationEnvelope(envelope); err != nil {
		return "", err
	}
	if envelope.RunID != run.RunID || envelope.InvocationID != run.RunID+":agent.primary" ||
		envelope.ExecutionInputSHA256 != strings.TrimSpace(executionInputSHA256) ||
		envelope.ActivityInputSHA256 != hashAdmissionJSON(canonicalPrimaryAgentActivityInput(input)) ||
		envelope.AdmissionSnapshotSHA256 != hashAdmissionJSON(input.AdmissionSnapshot) ||
		envelope.ExecutionStrategySHA256 != input.AdmissionSnapshot.ExecutionStrategySHA256 {
		return "", receiptIntegrityError("provider invocation replay input differs")
	}
	return sha256AnyValue(envelope), nil
}

func canonicalPrimaryAgentActivityInput(
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) temporalruntime.ExecutePrimaryAgentActivityInput {
	input.VisibleToolNames = canonicalStringSlice(input.VisibleToolNames)
	return input
}

func canonicalStringSlice(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string{}, values...)
}

func equalStringSlices(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func primaryAgentInvocationRef(runID string) string {
	return temporalProjectionRef(runID, "agent/primary/invocation")
}

func (s *Server) loadPrimaryAgentProviderInvocationEnvelope(
	ctx context.Context,
	run execution.DurableRun,
) (primaryAgentProviderInvocationEnvelope, error) {
	var envelope primaryAgentProviderInvocationEnvelope
	err := s.getProtectedJSON(
		ctx,
		run,
		primaryAgentInvocationRef(run.RunID),
		protectedPayloadKindAgentInvocation,
		&envelope,
	)
	return envelope, err
}
