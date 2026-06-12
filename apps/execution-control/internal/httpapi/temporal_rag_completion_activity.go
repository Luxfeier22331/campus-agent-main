package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) SynthesizeRAGAnswerActivity(
	ctx context.Context,
	input temporalruntime.SynthesizeRAGAnswerActivityInput,
) (temporalruntime.SynthesizeRAGAnswerActivityOutput, error) {
	if strings.TrimSpace(input.RAGPlanRef) == "" {
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, fmt.Errorf("plan_ref is required")
	}
	if strings.TrimSpace(input.EvidenceRef) == "" {
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, fmt.Errorf("evidence_ref is required")
	}
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, err
	}
	if existing, ok := temporalRAGSynthesisRefFromRun(run); ok {
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{
			RunID:        run.RunID,
			Status:       "completed",
			SynthesisRef: existing,
		}, nil
	}
	packet, err := temporalRAGSynthesisPacketForRun(run, input.RAGPlanRef, input.EvidenceRef)
	if err != nil {
		_, failureErr := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
			FailureKind:   "rag_synthesis_packet_missing",
			ProjectionRef: temporalProjectionRef(run.RunID, "synthesis"),
			ResultKind:    "activity_failure",
			StepID:        "synthesis",
			StepKind:      "synthesis",
			TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
			Payload: map[string]any{
				"failure_kind": "rag_synthesis_packet_missing",
				"message":      err.Error(),
			},
		}, err)
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, failureErr
	}
	return s.completeRAGSynthesisActivity(ctx, run, packet)
}

func (s *Server) completeRAGSynthesisActivity(
	ctx context.Context,
	run execution.DurableRun,
	packet ragSynthesisPacket,
) (temporalruntime.SynthesizeRAGAnswerActivityOutput, error) {
	if s.ragSynthesisErr != nil {
		_, failureErr := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
			FailureKind:   "rag_synthesis_provider_not_configured",
			ProjectionRef: temporalProjectionRef(run.RunID, "synthesis"),
			ResultKind:    "activity_failure",
			StepID:        "synthesis",
			StepKind:      "synthesis",
			TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
			Payload: map[string]any{
				"failure_kind": "rag_synthesis_provider_not_configured",
				"message":      s.ragSynthesisErr.Error(),
			},
		}, s.ragSynthesisErr)
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, failureErr
	}
	if s.ragSynthesisExecutor == nil {
		cause := errors.New("rag synthesis executor is not configured")
		_, failureErr := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
			FailureKind:   "rag_synthesis_provider_not_configured",
			ProjectionRef: temporalProjectionRef(run.RunID, "synthesis"),
			ResultKind:    "activity_failure",
			StepID:        "synthesis",
			StepKind:      "synthesis",
			TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
			Payload: map[string]any{
				"failure_kind": "rag_synthesis_provider_not_configured",
				"message":      cause.Error(),
			},
		}, cause)
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, failureErr
	}
	synthesisStartedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "started",
		StepID:        "synthesis",
		StepKind:      "synthesis",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     synthesisStartedAt,
		UpdatedAt:     synthesisStartedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "synthesis"),
		Payload: map[string]any{
			"output_schema_id": packet.OutputSchemaID,
			"packet_ref":       temporalProjectionRef(run.RunID, "synthesis/packet"),
			"prompt_refs":      packet.PromptRefs,
			"provider_ref":     providerRequestRefForPacket(packet),
			"query_intent":     packet.QueryIntent,
		},
	}); err != nil {
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, err
	}
	synthesisResult, err := s.ragSynthesisExecutor.ExecuteRAGSynthesis(ctx, packet)
	synthesisCompletedAt := time.Now().UTC()
	if err != nil {
		_, failureErr := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
			CancelOutcome:   execution.CancelOutcome(synthesisResult.ProviderSummary.CancelOutcome),
			FailureKind:     "rag_synthesis_provider_failed",
			ProjectionRef:   temporalProjectionRef(run.RunID, "synthesis/provider"),
			ProviderSummary: &synthesisResult.ProviderSummary,
			ResultKind:      "provider_execution_summary",
			StepID:          "synthesis",
			StepKind:        "synthesis",
			TaskQueue:       temporalruntime.ActivityTaskQueueKnowledge,
			TimeoutOutcome:  execution.TimeoutOutcome(synthesisResult.ProviderSummary.TimeoutOutcome),
			Payload: map[string]any{
				"failure_kind": "rag_synthesis_provider_failed",
				"message":      err.Error(),
				"provider_ref": providerRequestRefForPacket(packet),
			},
		}, err)
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, failureErr
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:         1,
		Capability:      "knowledge",
		Run:             run,
		Status:          "completed",
		StepID:          "synthesis",
		StepKind:        "synthesis",
		TaskQueue:       temporalruntime.ActivityTaskQueueKnowledge,
		WorkerID:        s.config.TemporalWorkerIdentity,
		StartedAt:       synthesisStartedAt,
		CompletedAt:     synthesisCompletedAt,
		UpdatedAt:       synthesisCompletedAt,
		ResultKind:      "provider_execution_summary",
		ProjectionRef:   temporalProjectionRef(run.RunID, "synthesis/provider"),
		ProviderSummary: &synthesisResult.ProviderSummary,
		Payload: map[string]any{
			"diagnostic_status": synthesisResult.ProviderSummary.DiagnosticStatus,
			"provider_ref":      synthesisResult.ProviderSummary.ProviderRequestRef,
			"provider_response": synthesisResult.ProviderSummary.ProviderResponseID,
			"schema_version":    synthesisResult.ProviderSummary.SchemaVersion,
		},
	}); err != nil {
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, err
	}
	finalizedResponse := ragSynthesisFinalizedResponse(run, packet, synthesisResult)
	if err := s.replaceTemporalRAGMetadata(ctx, run, func(metadata map[string]any) {
		metadata["finalized_response"] = finalizedResponse
		metadata["synthesis_packet"] = packet
		metadata["synthesis_ref"] = temporalProjectionRef(run.RunID, "synthesis/provider")
		metadata["synthesis_result"] = map[string]any{
			"answer_text":       strings.TrimSpace(synthesisResult.AnswerText),
			"confidence":        strings.TrimSpace(synthesisResult.Confidence),
			"semantic_outcome":  strings.TrimSpace(synthesisResult.SemanticOutcome),
			"grounding_verdict": strings.TrimSpace(synthesisResult.GroundingVerdict),
		}
	}); err != nil {
		return temporalruntime.SynthesizeRAGAnswerActivityOutput{}, err
	}
	return temporalruntime.SynthesizeRAGAnswerActivityOutput{
		RunID:        run.RunID,
		Status:       "completed",
		SynthesisRef: temporalProjectionRef(run.RunID, "synthesis/provider"),
	}, nil
}

func (s *Server) VerifyGroundingActivity(
	ctx context.Context,
	input temporalruntime.VerifyGroundingActivityInput,
) (temporalruntime.VerifyGroundingActivityOutput, error) {
	if strings.TrimSpace(input.SynthesisRef) == "" {
		return temporalruntime.VerifyGroundingActivityOutput{}, fmt.Errorf("synthesis_ref is required")
	}
	if strings.TrimSpace(input.EvidenceRef) == "" {
		return temporalruntime.VerifyGroundingActivityOutput{}, fmt.Errorf("evidence_ref is required")
	}
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.VerifyGroundingActivityOutput{}, err
	}
	result, err := temporalGroundingVerificationForRun(run, input.EvidenceRef, input.SynthesisRef)
	if err != nil {
		return s.failVerifyGroundingActivity(ctx, run, "grounding_verification_failed", err)
	}
	groundingRef := temporalProjectionRef(run.RunID, "grounding/verify")
	if err := s.replaceTemporalRAGMetadata(ctx, run, func(metadata map[string]any) {
		metadata["grounding_ref"] = groundingRef
		metadata["grounding_verification"] = result
	}); err != nil {
		return temporalruntime.VerifyGroundingActivityOutput{}, err
	}
	startedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "grounding.verify",
		StepKind:      "grounding",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   startedAt,
		UpdatedAt:     startedAt,
		ResultKind:    "grounding_verification_projection",
		ProjectionRef: groundingRef,
		Payload: map[string]any{
			"claim_support_count": result.ClaimSupportCount,
			"grounding_ref":       groundingRef,
			"source_ref_count":    len(result.SourceRefs),
			"verdict":             result.Verdict,
		},
	}); err != nil {
		return temporalruntime.VerifyGroundingActivityOutput{}, err
	}
	return temporalruntime.VerifyGroundingActivityOutput{
		GroundingRef: groundingRef,
		RunID:        run.RunID,
		Status:       "completed",
	}, nil
}

func (s *Server) WriteFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	if strings.TrimSpace(input.ToolResultRef) != "" {
		return s.writeTypedToolFinalizationActivity(ctx, input)
	}
	if strings.TrimSpace(input.SynthesisRef) == "" {
		return temporalruntime.WriteFinalizationActivityOutput{}, fmt.Errorf("synthesis_ref is required")
	}
	if strings.TrimSpace(input.GroundingRef) == "" {
		return temporalruntime.WriteFinalizationActivityOutput{}, fmt.Errorf("grounding_ref is required")
	}
	run, err := s.temporalActivityRunAllowCompletedFinalization(
		ctx,
		input.RunID,
		input.TraceID,
		input.SynthesisRef,
	)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted {
		return temporalruntime.WriteFinalizationActivityOutput{
			CompletedAt:   run.CompletedAt,
			ProjectionRef: temporalProjectionRef(run.RunID, "finalization/write"),
			RunID:         run.RunID,
			Status:        string(run.Status),
		}, nil
	}
	finalizedResponse, err := temporalFinalizedResponseFromRun(run, input.SynthesisRef)
	if err != nil {
		return s.failFinalizationActivity(ctx, run, "finalization_packet_missing", err)
	}
	finalizationStartedAt := time.Now().UTC()
	finalizationRef := temporalProjectionRef(run.RunID, "finalization/write")
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "started",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueFinalization,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     finalizationStartedAt,
		UpdatedAt:     finalizationStartedAt,
		ProjectionRef: finalizationRef,
		Payload: map[string]any{
			"grounding_ref":       input.GroundingRef,
			"selected_capability": input.SelectedCapability,
			"selected_tool":       input.SelectedTool,
			"synthesis_ref":       input.SynthesisRef,
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":finalization-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           time.Now().UTC(),
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"grounding_ref": input.GroundingRef,
			"request_id":    run.RequestID,
			"response":      finalizedResponse,
			"synthesis_ref": input.SynthesisRef,
			"trace_id":      run.TraceID,
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	completedRun, err := s.runProjectionStore.CompleteRunProjection(
		ctx,
		execution.DurableRunCompleteRequest{
			FinalResponseRef: finalizationRef,
			Now:              completedAt,
			RunID:            run.RunID,
			TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
		},
	)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":run-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"projection_ref":  finalizationRef,
			"status":          string(execution.DurableRunStatusCompleted),
			"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueFinalization,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     finalizationStartedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "final_answer_projection",
		ProjectionRef: finalizationRef,
		Payload:       temporalFinalizationResultPayload(finalizedResponse, input, run),
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	return temporalruntime.WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: temporalProjectionRef(completedRun.RunID, "finalization/write"),
		RunID:         completedRun.RunID,
		Status:        string(completedRun.Status),
	}, nil
}
