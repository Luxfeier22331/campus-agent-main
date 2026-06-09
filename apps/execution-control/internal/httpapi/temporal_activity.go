package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) PlanChatAnswerActivity(
	ctx context.Context,
	input temporalruntime.PlanChatAnswerActivityInput,
) (temporalruntime.PlanChatAnswerActivityOutput, error) {
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.PlanChatAnswerActivityOutput{}, err
	}
	if _, err := semanticExecutionRequestForRun(run); err != nil {
		return s.failTemporalPlanning(ctx, run, "bridge_payload_invalid", err)
	}
	now := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "started",
		StepID:        "planning",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		UpdatedAt:     now,
		ResultKind:    "",
		ProjectionRef: temporalProjectionRef(run.RunID, "plan"),
		Payload: map[string]any{
			"namespace":       input.Namespace,
			"payload_sha256":  input.PayloadSHA256,
			"policy_versions": input.PolicyVersions,
			"workflow_id":     input.WorkflowID,
		},
	}); err != nil {
		return temporalruntime.PlanChatAnswerActivityOutput{}, err
	}
	switch run.Status {
	case execution.DurableRunStatusQueued:
		admitted, err := s.runProjectionStore.TransitionRun(
			ctx,
			run.RunID,
			execution.DurableRunStatusAdmitted,
			"",
			now,
		)
		if err != nil {
			return temporalruntime.PlanChatAnswerActivityOutput{}, err
		}
		run = admitted
	case execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
		execution.DurableRunStatusStreaming:
	default:
		return temporalruntime.PlanChatAnswerActivityOutput{}, fmt.Errorf(
			"run %s status %s cannot be planned",
			run.RunID,
			run.Status,
		)
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":workflow-planned",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeWorkflowPlanned,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"namespace":       input.Namespace,
			"payload_sha256":  input.PayloadSHA256,
			"policy_versions": input.PolicyVersions,
			"workflow_id":     input.WorkflowID,
		},
	}); err != nil {
		return temporalruntime.PlanChatAnswerActivityOutput{}, err
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "planning",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    "workflow_plan",
		ProjectionRef: temporalProjectionRef(run.RunID, "plan"),
		Payload: map[string]any{
			"namespace":       input.Namespace,
			"payload_sha256":  input.PayloadSHA256,
			"policy_versions": input.PolicyVersions,
			"workflow_id":     input.WorkflowID,
		},
	}); err != nil {
		return temporalruntime.PlanChatAnswerActivityOutput{}, err
	}
	return temporalruntime.PlanChatAnswerActivityOutput{
		PlanRef: temporalProjectionRef(run.RunID, "plan"),
		RunID:   run.RunID,
		Status:  "planned",
	}, nil
}

func (s *Server) PlanRAGActivity(
	ctx context.Context,
	input temporalruntime.PlanRAGActivityInput,
) (temporalruntime.PlanRAGActivityOutput, error) {
	if strings.TrimSpace(input.WorkflowPlanRef) == "" {
		return temporalruntime.PlanRAGActivityOutput{}, fmt.Errorf("workflow_plan_ref is required")
	}
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.PlanRAGActivityOutput{}, err
	}
	if existingPlan, ok := temporalRAGPlanFromRun(run, input.WorkflowPlanRef); ok {
		return temporalruntime.PlanRAGActivityOutput{
			PlanRef: existingPlan.PlanRef,
			RunID:   run.RunID,
			Status:  "completed",
		}, nil
	}
	startedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "started",
		StepID:        "rag.plan",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "rag/plan"),
		Payload:       map[string]any{"workflow_plan_ref": input.WorkflowPlanRef},
	}); err != nil {
		return temporalruntime.PlanRAGActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":activity-rag-started",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeActivityStarted,
		OccurredAt:           startedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"activity":   "rag.plan",
			"plan_ref":   input.WorkflowPlanRef,
			"task_queue": temporalruntime.ActivityTaskQueueRAG,
		},
	}); err != nil {
		return temporalruntime.PlanRAGActivityOutput{}, err
	}
	if run.Status == execution.DurableRunStatusAdmitted {
		run, err = s.runProjectionStore.TransitionRun(
			ctx,
			run.RunID,
			execution.DurableRunStatusRunning,
			"",
			startedAt,
		)
		if err != nil {
			return temporalruntime.PlanRAGActivityOutput{}, err
		}
	} else if run.Status != execution.DurableRunStatusRunning &&
		run.Status != execution.DurableRunStatusStreaming {
		return temporalruntime.PlanRAGActivityOutput{}, fmt.Errorf(
			"run %s status %s cannot plan rag",
			run.RunID,
			run.Status,
		)
	}
	plan, err := ragPlanProjectionForRun(run, s.config.QueryServingScopesPath)
	if err != nil {
		return s.failRAGPlanActivity(ctx, run, "rag_plan_invalid", err)
	}
	planRef := temporalProjectionRef(run.RunID, "rag/plan")
	if err := s.replaceTemporalRAGMetadata(ctx, run, func(metadata map[string]any) {
		metadata["workflow_plan_ref"] = input.WorkflowPlanRef
		metadata["plan_ref"] = planRef
		metadata["plan"] = plan
	}); err != nil {
		return temporalruntime.PlanRAGActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "rag.plan",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "rag_plan_projection",
		ProjectionRef: planRef,
		Payload: map[string]any{
			"collection_alias":  plan.CollectionAlias,
			"corpus":            plan.Corpus,
			"payload_sha256":    plan.PayloadSHA256,
			"query_mode":        plan.QueryMode,
			"top_k":             plan.TopK,
			"workflow_plan_ref": input.WorkflowPlanRef,
		},
	}); err != nil {
		return temporalruntime.PlanRAGActivityOutput{}, err
	}
	return temporalruntime.PlanRAGActivityOutput{
		PlanRef: planRef,
		RunID:   run.RunID,
		Status:  "completed",
	}, nil
}

func (s *Server) RetrieveIndexedLookupActivity(
	ctx context.Context,
	input temporalruntime.RetrieveIndexedLookupActivityInput,
) (temporalruntime.RetrieveIndexedLookupActivityOutput, error) {
	if strings.TrimSpace(input.RAGPlanRef) == "" {
		return temporalruntime.RetrieveIndexedLookupActivityOutput{}, fmt.Errorf("rag_plan_ref is required")
	}
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.RetrieveIndexedLookupActivityOutput{}, err
	}
	plan, err := temporalRAGPlanProjectionFromRun(run, input.RAGPlanRef)
	if err != nil {
		return s.failRetrieveIndexedLookupActivity(ctx, run, "rag_plan_projection_missing", err)
	}
	startedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "started",
		StepID:        "retrieval.indexed_lookup",
		StepKind:      "retrieval",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "retrieval/indexed-lookup"),
		Payload: map[string]any{
			"collection_alias": plan.CollectionAlias,
			"query_mode":       plan.QueryMode,
			"top_k":            plan.TopK,
		},
	}); err != nil {
		return temporalruntime.RetrieveIndexedLookupActivityOutput{}, err
	}
	result, err := s.ragIndexedLookup(ctx, run, plan)
	if err != nil {
		return s.failRetrieveIndexedLookupActivity(ctx, run, "retrieval_lookup_failed", err)
	}
	lookupRef := temporalProjectionRef(run.RunID, "retrieval/indexed-lookup")
	if err := s.replaceTemporalRAGMetadata(ctx, run, func(metadata map[string]any) {
		metadata["lookup_ref"] = lookupRef
		metadata["lookup_result"] = result
	}); err != nil {
		return temporalruntime.RetrieveIndexedLookupActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "retrieval.indexed_lookup",
		StepKind:      "retrieval",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "retrieval_lookup_projection",
		ProjectionRef: lookupRef,
		Payload: map[string]any{
			"candidate_count":  result.CandidateCount,
			"lookup_ref":       lookupRef,
			"payload_sha256":   result.PayloadSHA256,
			"query_latency_ms": result.QueryLatencyMS,
		},
	}); err != nil {
		return temporalruntime.RetrieveIndexedLookupActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":activity-retrieval-indexed-lookup-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeActivityCompleted,
		OccurredAt:           time.Now().UTC(),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"activity":        "retrieval.indexed_lookup",
			"candidate_count": result.CandidateCount,
			"lookup_ref":      lookupRef,
		},
	}); err != nil {
		return temporalruntime.RetrieveIndexedLookupActivityOutput{}, err
	}
	return temporalruntime.RetrieveIndexedLookupActivityOutput{
		LookupRef: lookupRef,
		RunID:     run.RunID,
		Status:    "completed",
	}, nil
}

func (s *Server) ExpandOrRescueRetrievalActivity(
	ctx context.Context,
	input temporalruntime.ExpandOrRescueRetrievalActivityInput,
) (temporalruntime.ExpandOrRescueRetrievalActivityOutput, error) {
	if strings.TrimSpace(input.LookupRef) == "" {
		return temporalruntime.ExpandOrRescueRetrievalActivityOutput{}, fmt.Errorf("lookup_ref is required")
	}
	if strings.TrimSpace(input.RAGPlanRef) == "" {
		return temporalruntime.ExpandOrRescueRetrievalActivityOutput{}, fmt.Errorf("rag_plan_ref is required")
	}
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.ExpandOrRescueRetrievalActivityOutput{}, err
	}
	if _, err := temporalRAGLookupResultFromRun(run, input.LookupRef); err != nil {
		return s.failExpandOrRescueRetrievalActivity(ctx, run, "retrieval_lookup_projection_missing", err)
	}
	startedAt := time.Now().UTC()
	rescueRef := temporalProjectionRef(run.RunID, "retrieval/expand-or-rescue")
	result := ragruntime.RetrievalRescueResult{
		LookupRef:     input.LookupRef,
		RescueApplied: false,
		RescueReason:  "not_admitted_or_not_required",
		RescueRef:     rescueRef,
		RunID:         run.RunID,
		SchemaVersion: "retrieval_rescue_result_v1",
	}
	if err := s.replaceTemporalRAGMetadata(ctx, run, func(metadata map[string]any) {
		metadata["rescue_ref"] = rescueRef
		metadata["rescue_result"] = result
	}); err != nil {
		return temporalruntime.ExpandOrRescueRetrievalActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "retrieval.expand_or_rescue",
		StepKind:      "retrieval",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "retrieval_rescue_projection",
		ProjectionRef: rescueRef,
		Payload: map[string]any{
			"lookup_ref":     input.LookupRef,
			"rescue_applied": result.RescueApplied,
			"rescue_reason":  result.RescueReason,
			"rescue_ref":     rescueRef,
		},
	}); err != nil {
		return temporalruntime.ExpandOrRescueRetrievalActivityOutput{}, err
	}
	return temporalruntime.ExpandOrRescueRetrievalActivityOutput{
		LookupRef: input.LookupRef,
		RescueRef: rescueRef,
		RunID:     run.RunID,
		Status:    "completed",
	}, nil
}

func (s *Server) SelectEvidenceActivity(
	ctx context.Context,
	input temporalruntime.SelectEvidenceActivityInput,
) (temporalruntime.SelectEvidenceActivityOutput, error) {
	if strings.TrimSpace(input.LookupRef) == "" {
		return temporalruntime.SelectEvidenceActivityOutput{}, fmt.Errorf("lookup_ref is required")
	}
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.SelectEvidenceActivityOutput{}, err
	}
	lookup, err := temporalRAGLookupResultFromRun(run, input.LookupRef)
	if err != nil {
		return s.failSelectEvidenceActivity(ctx, run, "retrieval_lookup_projection_missing", err)
	}
	startedAt := time.Now().UTC()
	selection, err := selectRAGEvidence(run, lookup)
	if err != nil {
		return s.failSelectEvidenceActivity(ctx, run, "evidence_selection_failed", err)
	}
	evidenceRef := temporalProjectionRef(run.RunID, "evidence/selection")
	selection.EvidenceRef = evidenceRef
	if err := s.replaceTemporalRAGMetadata(ctx, run, func(metadata map[string]any) {
		metadata["evidence_ref"] = evidenceRef
		metadata["evidence_selection"] = selection
	}); err != nil {
		return temporalruntime.SelectEvidenceActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "evidence.selection",
		StepKind:      "selection",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "evidence_selection_projection",
		ProjectionRef: evidenceRef,
		Payload: map[string]any{
			"candidate_count":             selection.CandidateCount,
			"coverage_status":             selection.CoverageStatus,
			"evidence_ref":                evidenceRef,
			"supporting_evidence_count":   selection.SupportingEvidenceCount,
			"selected_evidence_ref_count": len(selection.SelectedEvidence),
		},
	}); err != nil {
		return temporalruntime.SelectEvidenceActivityOutput{}, err
	}
	return temporalruntime.SelectEvidenceActivityOutput{
		EvidenceRef: evidenceRef,
		RunID:       run.RunID,
		Status:      "completed",
	}, nil
}

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
			TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
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
			TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
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
			TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
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
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
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
			TaskQueue:       temporalruntime.ActivityTaskQueueRAG,
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
		TaskQueue:       temporalruntime.ActivityTaskQueueRAG,
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
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
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
			"grounding_ref": input.GroundingRef,
			"synthesis_ref": input.SynthesisRef,
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
