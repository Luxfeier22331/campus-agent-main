package temporalruntime

import (
	"context"
	"time"

	"go.temporal.io/sdk/activity"
)

type Activities struct{}

type workflowTestActivityRegistrar interface {
	RegisterActivityWithOptions(activity any, options activity.RegisterOptions)
}

func registerWorkflowTestActivities(env workflowTestActivityRegistrar, activities *Activities) {
	env.RegisterActivityWithOptions(activities.MemoryRecallActivity, activity.RegisterOptions{Name: MemoryRecallActivityName})
	env.RegisterActivityWithOptions(
		activities.ExtractMemoryCandidatesActivity,
		activity.RegisterOptions{Name: ExtractMemoryCandidatesActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.UpsertInferredMemoryActivity,
		activity.RegisterOptions{Name: UpsertInferredMemoryActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ExecutePrimaryAgentActivity,
		activity.RegisterOptions{Name: ExecutePrimaryAgentActivityName},
	)
	env.RegisterActivityWithOptions(activities.PlanRouteActivity, activity.RegisterOptions{Name: PlanRouteActivityName})
	env.RegisterActivityWithOptions(activities.PlanReplanActivity, activity.RegisterOptions{Name: PlanReplanActivityName})
	env.RegisterActivityWithOptions(activities.PlanRAGActivity, activity.RegisterOptions{Name: PlanRAGActivityName})
	env.RegisterActivityWithOptions(
		activities.RetrieveIndexedLookupActivity,
		activity.RegisterOptions{Name: RetrieveIndexedLookupActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ExpandOrRescueRetrievalActivity,
		activity.RegisterOptions{Name: ExpandOrRescueRetrievalActivityName},
	)
	env.RegisterActivityWithOptions(activities.SelectEvidenceActivity, activity.RegisterOptions{Name: SelectEvidenceActivityName})
	env.RegisterActivityWithOptions(
		activities.SynthesizeRAGAnswerActivity,
		activity.RegisterOptions{Name: SynthesizeRAGAnswerActivityName},
	)
	env.RegisterActivityWithOptions(activities.VerifyGroundingActivity, activity.RegisterOptions{Name: VerifyGroundingActivityName})
	env.RegisterActivityWithOptions(activities.ExecuteTypedToolActivity, activity.RegisterOptions{Name: ExecuteTypedToolActivityName})
	env.RegisterActivityWithOptions(activities.WriteFinalizationActivity, activity.RegisterOptions{Name: WriteFinalizationActivityName})
}

func (Activities) MemoryRecallActivity(
	_ context.Context,
	input MemoryRecallActivityInput,
) (MemoryRecallActivityOutput, error) {
	return MemoryRecallActivityOutput{
		MemoryRef:           "projection://runs/" + input.RunID + "/memory/recall",
		RunID:               input.RunID,
		SelectedMemoryChars: 0,
		SelectedMemoryCount: 0,
		Status:              "completed",
	}, nil
}

func (Activities) ExtractMemoryCandidatesActivity(
	_ context.Context,
	input ExtractMemoryCandidatesActivityInput,
) (ExtractMemoryCandidatesActivityOutput, error) {
	return ExtractMemoryCandidatesActivityOutput{
		Candidates: []MemoryCandidate{{
			Capability:  "any",
			CompactText: "近期目标: 关注保研材料",
			Confidence:  0.95,
			MemoryID:    "inf_test_goal",
			MemoryType:  "goal",
			ReasonCode:  "explicit_long_term_goal",
			SourceHash:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		}},
		RunID:         input.RunID,
		SchemaVersion: "memory_update_extract_result_v1",
		Status:        "completed",
	}, nil
}

func (Activities) UpsertInferredMemoryActivity(
	_ context.Context,
	input UpsertInferredMemoryActivityInput,
) (UpsertInferredMemoryActivityOutput, error) {
	return UpsertInferredMemoryActivityOutput{
		PayloadSHA256: "memory-update-hash",
		RunID:         input.RunID,
		SchemaVersion: "memory_update_result_v1",
		Status:        "completed",
		UpsertedCount: len(input.Candidates),
	}, nil
}

func (Activities) ExecutePrimaryAgentActivity(
	_ context.Context,
	input ExecutePrimaryAgentActivityInput,
) (ExecutePrimaryAgentActivityOutput, error) {
	return ExecutePrimaryAgentActivityOutput{
		AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
		FinalOutput:    "你好，我是校园问答助手。",
		RunID:          input.RunID,
		Status:         "completed",
		TerminalReason: "answer_completed",
	}, nil
}

func (Activities) PlanRouteActivity(
	_ context.Context,
	input PlanRouteActivityInput,
) (PlanRouteActivityOutput, error) {
	capability := input.RequestedCapability
	if capability == "" {
		capability = "knowledge"
	}
	if capability == "campus_services" {
		return PlanRouteActivityOutput{
			AllowedCapabilities: []string{"campus_services"},
			AllowedTools:        []string{"service_status_lookup"},
			Capability:          "campus_services",
			PlanRef:             "projection://runs/" + input.RunID + "/plan/route",
			RunID:               input.RunID,
			Status:              "planned",
			ToolName:            "service_status_lookup",
			WorkerRole:          "activity-worker-campus-services",
			PayloadKind:         "service_status_lookup",
		}, nil
	}
	return PlanRouteActivityOutput{
		AllowedCapabilities: []string{"knowledge"},
		AllowedTools:        []string{"retrieval.query"},
		Capability:          "knowledge",
		PlanRef:             "projection://runs/" + input.RunID + "/plan/route",
		RunID:               input.RunID,
		Status:              "planned",
		ToolName:            "retrieval.query",
		WorkerRole:          "activity-worker-knowledge",
		PayloadKind:         "rag_request",
	}, nil
}

func (Activities) PlanReplanActivity(
	_ context.Context,
	input PlanReplanActivityInput,
) (PlanReplanActivityOutput, error) {
	return PlanReplanActivityOutput{
		AllowedCapabilities: append([]string{}, input.AllowedCapabilities...),
		NewPlanRef:          "projection://runs/" + input.RunID + "/plan/replan/default",
		RunID:               input.RunID,
		Status:              "planned",
		Steps: []CapabilityBranchStep{{
			AllowedTools: append([]string{}, input.AllowedTools...),
			Capability:   input.AllowedCapabilities[0],
			PayloadKind:  "service_status_lookup",
			StepID:       "capability:campus_services:service_status_lookup:replan",
			ToolName:     input.AllowedTools[0],
			WorkerRole:   "activity-worker-campus-services",
		}},
	}, nil
}

func (Activities) ExecuteTypedToolActivity(
	_ context.Context,
	input ExecuteTypedToolActivityInput,
) (ExecuteTypedToolActivityOutput, error) {
	return ExecuteTypedToolActivityOutput{
		Capability:  input.Capability,
		ResultRef:   "projection://runs/" + input.RunID + "/tools/" + input.ToolName,
		RunID:       input.RunID,
		Status:      "completed",
		ToolName:    input.ToolName,
		PayloadKind: input.PayloadKind,
	}, nil
}

func (Activities) PlanRAGActivity(
	_ context.Context,
	input PlanRAGActivityInput,
) (PlanRAGActivityOutput, error) {
	return PlanRAGActivityOutput{
		PlanRef: "projection://runs/" + input.RunID + "/rag/plan",
		RunID:   input.RunID,
		Status:  "completed",
	}, nil
}

func (Activities) RetrieveIndexedLookupActivity(
	_ context.Context,
	input RetrieveIndexedLookupActivityInput,
) (RetrieveIndexedLookupActivityOutput, error) {
	return RetrieveIndexedLookupActivityOutput{
		LookupRef: "projection://runs/" + input.RunID + "/retrieval/indexed-lookup",
		RunID:     input.RunID,
		Status:    "completed",
	}, nil
}

func (Activities) ExpandOrRescueRetrievalActivity(
	_ context.Context,
	input ExpandOrRescueRetrievalActivityInput,
) (ExpandOrRescueRetrievalActivityOutput, error) {
	return ExpandOrRescueRetrievalActivityOutput{
		LookupRef: input.LookupRef,
		RescueRef: "projection://runs/" + input.RunID + "/retrieval/expand-or-rescue",
		RunID:     input.RunID,
		Status:    "completed",
	}, nil
}

func (Activities) SelectEvidenceActivity(
	_ context.Context,
	input SelectEvidenceActivityInput,
) (SelectEvidenceActivityOutput, error) {
	return SelectEvidenceActivityOutput{
		EvidenceRef: "projection://runs/" + input.RunID + "/evidence/selection",
		RunID:       input.RunID,
		Status:      "completed",
	}, nil
}

func (Activities) SynthesizeRAGAnswerActivity(
	_ context.Context,
	input SynthesizeRAGAnswerActivityInput,
) (SynthesizeRAGAnswerActivityOutput, error) {
	return SynthesizeRAGAnswerActivityOutput{
		SynthesisRef: "projection://runs/" + input.RunID + "/synthesis/provider",
		RunID:        input.RunID,
		Status:       "completed",
	}, nil
}

func (Activities) VerifyGroundingActivity(
	_ context.Context,
	input VerifyGroundingActivityInput,
) (VerifyGroundingActivityOutput, error) {
	return VerifyGroundingActivityOutput{
		GroundingRef: "projection://runs/" + input.RunID + "/grounding/verify",
		RunID:        input.RunID,
		Status:       "completed",
	}, nil
}

func (Activities) WriteFinalizationActivity(
	_ context.Context,
	input WriteFinalizationActivityInput,
) (WriteFinalizationActivityOutput, error) {
	return WriteFinalizationActivityOutput{
		CompletedAt:   time.Now().UTC(),
		ProjectionRef: "projection://runs/" + input.RunID + "/finalization",
		RunID:         input.RunID,
		Status:        "completed",
	}, nil
}

func memoryRecallInputMatcher(runID string) func(MemoryRecallActivityInput) bool {
	return func(input MemoryRecallActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RequestID == "req-workflow-001" &&
			input.RequestedCapability == "knowledge"
	}
}

func planInputMatcher(runID string) func(PlanRouteActivityInput) bool {
	return func(input PlanRouteActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.PayloadSHA256 != "" &&
			input.RequestedCapability == "knowledge"
	}
}

func ragPlanInputMatcher(runID string) func(PlanRAGActivityInput) bool {
	return func(input PlanRAGActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.WorkflowPlanRef == "projection://runs/run-workflow-001/plan/route"
	}
}

func retrievalLookupInputMatcher(runID string) func(RetrieveIndexedLookupActivityInput) bool {
	return func(input RetrieveIndexedLookupActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RAGPlanRef == "projection://runs/run-workflow-001/rag/plan"
	}
}

func retrievalRescueInputMatcher(runID string) func(ExpandOrRescueRetrievalActivityInput) bool {
	return func(input ExpandOrRescueRetrievalActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RAGPlanRef == "projection://runs/run-workflow-001/rag/plan" &&
			input.LookupRef == "projection://runs/run-workflow-001/retrieval/indexed-lookup"
	}
}

func evidenceSelectionInputMatcher(runID string) func(SelectEvidenceActivityInput) bool {
	return func(input SelectEvidenceActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RAGPlanRef == "projection://runs/run-workflow-001/rag/plan" &&
			input.LookupRef == "projection://runs/run-workflow-001/retrieval/indexed-lookup" &&
			input.RescueRef == "projection://runs/run-workflow-001/retrieval/expand-or-rescue"
	}
}

func synthesisInputMatcher(runID string) func(SynthesizeRAGAnswerActivityInput) bool {
	return func(input SynthesizeRAGAnswerActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RAGPlanRef == "projection://runs/run-workflow-001/rag/plan" &&
			input.EvidenceRef == "projection://runs/run-workflow-001/evidence/selection"
	}
}

func groundingInputMatcher(runID string) func(VerifyGroundingActivityInput) bool {
	return func(input VerifyGroundingActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.EvidenceRef == "projection://runs/run-workflow-001/evidence/selection" &&
			input.SynthesisRef == "projection://runs/run-workflow-001/synthesis/provider"
	}
}

func finalizeInputMatcher(runID string) func(WriteFinalizationActivityInput) bool {
	return func(input WriteFinalizationActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.GroundingRef == "projection://runs/run-workflow-001/grounding/verify" &&
			input.SynthesisRef == "projection://runs/run-workflow-001/synthesis/provider"
	}
}
