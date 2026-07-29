package httpapi

import (
	"context"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type protectedPayloadReadErrorStore struct {
	execution.RunProjectionStore
	protected execution.ProtectedPayloadStore
	err       error
}

func (s *protectedPayloadReadErrorStore) PutProtectedPayload(
	ctx context.Context,
	payload execution.ProtectedPayload,
) (execution.ProtectedPayload, error) {
	return s.protected.PutProtectedPayload(ctx, payload)
}

func (s *protectedPayloadReadErrorStore) GetProtectedPayload(
	context.Context,
	string,
	string,
	string,
) (execution.ProtectedPayload, error) {
	return execution.ProtectedPayload{}, s.err
}

func (s *protectedPayloadReadErrorStore) DeleteProtectedPayloads(ctx context.Context, runID string) error {
	return s.protected.DeleteProtectedPayloads(ctx, runID)
}

// replaceTemporalAgentMetadata keeps legacy test fixtures readable while
// exercising the v3 protected-result path used by production activities.
func (s *Server) replaceTemporalAgentMetadata(
	ctx context.Context,
	run execution.DurableRun,
	mutate func(map[string]any),
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	if s.config.ProtectedPayloadKeyring == nil {
		s.config.ProtectedPayloadKeyring = protectedPayloadKeyringForTest()
	}
	result := map[string]any{}
	mutate(result)
	wire, err := s.loadExecutionInput(ctx, latest)
	if err != nil {
		return err
	}
	admissionSHA256 := sha256JSONRef(map[string]any{
		"run_id":  latest.RunID,
		"fixture": "agent_admission",
	})
	plan := groundingPlanForTest(strings.TrimSpace(wire.UserGoal))
	grounding := groundingContext{
		AdmissionSHA256: admissionSHA256,
		CoveredScopes:   []string{},
		Evidence:        []groundingEvidence{},
		Mode:            plan.Mode,
		PlanSHA256:      hashAdmissionJSON(plan),
		PreparedAt:      time.Date(2026, 7, 26, 8, 0, 0, 0, time.UTC),
		QuerySHA256:     plan.QuerySHA256,
		RunID:           latest.RunID,
		SchemaVersion:   groundingContextSchemaVersion,
		SelectedScopes:  []string{},
		Status:          "not_required",
	}
	grounding.ModelContextChars = groundingModelContextCharacterCount(grounding.Status, grounding.Evidence)
	groundingRef := groundingContextRef(latest.RunID)
	if err := s.putProtectedJSON(
		ctx,
		latest,
		groundingRef,
		protectedPayloadKindGroundingContext,
		grounding,
	); err != nil {
		return err
	}
	result["admission_snapshot_sha256"] = admissionSHA256
	if _, ok := result["allow_ungrounded_answer"]; !ok {
		result["allow_ungrounded_answer"] = true
	}
	result["grounding_context_ref"] = groundingRef
	result["grounding_context_sha256"] = sha256JSONRef(grounding)
	ref := strings.TrimSpace(stringValue(result["agent_result_ref"]))
	if ref == "" {
		ref = temporalProjectionRef(latest.RunID, "agent/primary/result")
		result["agent_result_ref"] = ref
	}
	if _, ok := result["status"]; !ok {
		result["status"] = "completed"
	}
	if _, ok := result["run_id"]; !ok {
		result["run_id"] = latest.RunID
	}
	providerInvocationSHA256 := strings.TrimSpace(stringValue(result["provider_invocation_sha256"]))
	if providerInvocationSHA256 == "" {
		providerInvocationSHA256 = sha256AnyValue(map[string]any{
			"run_id":  latest.RunID,
			"fixture": "primary_agent_provider_invocation",
		})
		result["provider_invocation_sha256"] = providerInvocationSHA256
	}
	result["result_schema_version"] = protectedPayloadKindAgentResult
	if err := s.putProtectedJSON(ctx, latest, ref, protectedPayloadKindAgentResult, result); err != nil {
		return err
	}
	// Finalization resolves the protected result through a completed step
	// projection; create the bounded index fixture without sensitive fields.
	attempt := intFromAny(result["activity_attempt"])
	if attempt <= 0 {
		attempt = 1
	}
	now := time.Now().UTC()
	outputSummary, err := encodeAgentInvocationOutputSummary(ref, providerInvocationSHA256, result)
	if err != nil {
		return err
	}
	projectionPayload := primaryAgentResultProjectionPayload(result)
	projectionPayload["protected_result_sha256"] = sha256AnyValue(result)
	projectionPayload["protected_result_schema_version"] = protectedPayloadKindAgentResult
	if _, err := s.runProjectionStore.UpsertRunStep(ctx, execution.RunStepProjection{
		StepID:               "agent.primary",
		RunID:                latest.RunID,
		ConversationID:       latest.ConversationID,
		StepKind:             "agent",
		Status:               "completed",
		ActivityAttempt:      attempt,
		TaskQueue:            "campus-agent.activity.agent.v3",
		StartedAt:            now,
		CompletedAt:          now,
		UpdatedAt:            now,
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload:     projectionPayload,
	}); err != nil {
		return err
	}
	attemptID := temporalStepAttemptID(latest.RunID, "agent.primary", attempt)
	if _, err := s.runProjectionStore.UpsertStepAttempt(ctx, execution.StepAttemptProjection{
		AttemptID:            attemptID,
		StepID:               "agent.primary",
		RunID:                latest.RunID,
		Attempt:              attempt,
		ActivityAttempt:      attempt,
		Status:               "completed",
		TaskQueue:            "campus-agent.activity.agent.v3",
		CompletedAt:          now,
		UpdatedAt:            now,
		PayloadSchemaVersion: "step-attempt-projection-v1",
	}); err != nil {
		return err
	}
	if _, err = s.runProjectionStore.UpsertStepResult(ctx, execution.StepResultProjection{
		ResultID:             temporalStepResultID(latest.RunID, "agent.primary", attempt),
		StepID:               "agent.primary",
		RunID:                latest.RunID,
		AttemptID:            attemptID,
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        ref,
		CreatedAt:            now,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     projectionPayload,
	}); err != nil {
		return err
	}
	receipt, disposition, err := s.runProjectionStore.BeginAgentInvocation(ctx, execution.AgentInvocationReceipt{
		InvocationID: latest.RunID + ":agent.primary",
		RunID:        latest.RunID,
		InputSHA256:  providerInvocationSHA256,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	if err != nil {
		return err
	}
	if disposition == execution.AgentInvocationDispositionReplay {
		return nil
	}
	completedAt := now.Add(time.Microsecond)
	_, err = s.runProjectionStore.CompleteAgentInvocation(ctx, execution.AgentInvocationReceipt{
		InvocationID: latest.RunID + ":agent.primary",
		RunID:        latest.RunID,
		InputSHA256:  providerInvocationSHA256,
		State:        execution.AgentInvocationReceiptStateCompleted,
		OutputJSON:   outputSummary,
		OutputSHA256: sha256Bytes(outputSummary),
		CreatedAt:    receipt.CreatedAt,
		CompletedAt:  completedAt,
		UpdatedAt:    completedAt,
	})
	return err
}
