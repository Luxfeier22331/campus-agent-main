package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredplanning"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) PlanRouteActivity(
	ctx context.Context,
	input temporalruntime.PlanRouteActivityInput,
) (temporalruntime.PlanRouteActivityOutput, error) {
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.PlanRouteActivityOutput{}, err
	}
	route, err := s.temporalRoutePlanForRun(run, input)
	if err != nil {
		return s.failTemporalPlanning(ctx, run, "route_plan_invalid", err)
	}
	now := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    route.Capability,
		Run:           run,
		Status:        "started",
		StepID:        "plan.route",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		UpdatedAt:     now,
		ResultKind:    "",
		ProjectionRef: temporalProjectionRef(run.RunID, "plan/route"),
		Payload: map[string]any{
			"memory_ref":            input.MemoryRef,
			"namespace":             input.Namespace,
			"payload_sha256":        input.PayloadSHA256,
			"policy_versions":       input.PolicyVersions,
			"requested_capability":  input.RequestedCapability,
			"selected_memory_chars": input.SelectedMemoryChars,
			"selected_memory_count": input.SelectedMemoryCount,
			"workflow_id":           input.WorkflowID,
		},
	}); err != nil {
		return temporalruntime.PlanRouteActivityOutput{}, err
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
			return temporalruntime.PlanRouteActivityOutput{}, err
		}
		run = admitted
	case execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
		execution.DurableRunStatusStreaming:
	default:
		return temporalruntime.PlanRouteActivityOutput{}, fmt.Errorf(
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
			"capability":      route.Capability,
			"namespace":       input.Namespace,
			"payload_kind":    route.PayloadKind,
			"payload_sha256":  input.PayloadSHA256,
			"policy_versions": input.PolicyVersions,
			"selected_tool":   route.ToolName,
			"worker_role":     route.WorkerRole,
			"workflow_id":     input.WorkflowID,
		},
	}); err != nil {
		return temporalruntime.PlanRouteActivityOutput{}, err
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    route.Capability,
		Run:           run,
		Status:        "completed",
		StepID:        "plan.route",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    "route_plan",
		ProjectionRef: route.PlanRef,
		Payload: map[string]any{
			"allowed_tools":        append([]string{}, route.AllowedTools...),
			"memory_ref":           input.MemoryRef,
			"namespace":            input.Namespace,
			"payload_kind":         route.PayloadKind,
			"payload_sha256":       input.PayloadSHA256,
			"policy_versions":      input.PolicyVersions,
			"requested_capability": input.RequestedCapability,
			"selected_tool":        route.ToolName,
			"worker_role":          route.WorkerRole,
			"workflow_id":          input.WorkflowID,
		},
	}); err != nil {
		return temporalruntime.PlanRouteActivityOutput{}, err
	}
	return route, nil
}

func (s *Server) PlanReplanActivity(
	ctx context.Context,
	input temporalruntime.PlanReplanActivityInput,
) (temporalruntime.PlanReplanActivityOutput, error) {
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.PlanReplanActivityOutput{}, err
	}
	if input.ReplanCount <= 0 {
		return temporalruntime.PlanReplanActivityOutput{}, fmt.Errorf("replan_count is required")
	}
	if strings.TrimSpace(input.PreviousPlanRef) == "" {
		return temporalruntime.PlanReplanActivityOutput{}, fmt.Errorf("previous_plan_ref is required")
	}
	if len(input.AllowedCapabilities) == 0 {
		return temporalruntime.PlanReplanActivityOutput{}, fmt.Errorf("allowed_capabilities is required")
	}
	now := time.Now().UTC()
	replanRef := temporalProjectionRef(run.RunID, fmt.Sprintf("plan/replan/%d", input.ReplanCount))
	step := temporalruntime.CapabilityBranchStep{
		AllowedTools: append([]string{}, input.AllowedTools...),
		Capability:   input.AllowedCapabilities[0],
		PayloadKind:  firstNonEmptyText(input.PreviousStepID, "replanned_step"),
		StepID:       fmt.Sprintf("replan:%d:%s", input.ReplanCount, input.AllowedCapabilities[0]),
		ToolName:     firstNonEmptyText(firstString(input.AllowedTools), "retrieval.query"),
		WorkerRole:   runtimepolicy.WorkerRoleForCapability(input.AllowedCapabilities[0]),
	}
	if input.AllowedCapabilities[0] == "knowledge" {
		step.PayloadKind = "rag_request"
		step.ToolName = "retrieval.query"
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       input.ReplanCount,
		Capability:    step.Capability,
		Run:           run,
		Status:        "completed",
		StepID:        "plan.replan",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    "route_replan",
		ProjectionRef: replanRef,
		ReplanReason:  input.Reason,
		Payload: map[string]any{
			"allowed_capabilities": append([]string{}, input.AllowedCapabilities...),
			"allowed_tools":        append([]string{}, input.AllowedTools...),
			"failure_summary":      input.FailureSummary,
			"previous_plan_ref":    input.PreviousPlanRef,
			"previous_step_id":     input.PreviousStepID,
			"reason":               input.Reason,
			"replan_count":         input.ReplanCount,
		},
	}); err != nil {
		return temporalruntime.PlanReplanActivityOutput{}, err
	}
	return temporalruntime.PlanReplanActivityOutput{
		AllowedCapabilities: append([]string{}, input.AllowedCapabilities...),
		NewPlanRef:          replanRef,
		RunID:               run.RunID,
		Status:              "planned",
		Steps:               []temporalruntime.CapabilityBranchStep{step},
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
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "rag/plan"),
		Payload:       map[string]any{"workflow_plan_ref": input.WorkflowPlanRef},
	}); err != nil {
		return temporalruntime.PlanRAGActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":activity-knowledge-started",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeActivityStarted,
		OccurredAt:           startedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"activity":   "rag.plan",
			"plan_ref":   input.WorkflowPlanRef,
			"task_queue": temporalruntime.ActivityTaskQueueKnowledge,
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
	plan, err = resolvePlanVersionQuery(ctx, s.ragVersionResolver, plan)
	if err != nil {
		return s.failRAGPlanActivity(ctx, run, "rag_version_resolution_failed", err)
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
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
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

func (s *Server) temporalRoutePlanForRun(
	run execution.DurableRun,
	input temporalruntime.PlanRouteActivityInput,
) (temporalruntime.PlanRouteActivityOutput, error) {
	if route, ok, err := s.plannedRouteForRun(run, input.RequestedCapability); ok || err != nil {
		return route, err
	}
	return temporalruntime.PlanRouteActivityOutput{}, fmt.Errorf(
		"execution_payload with user_goal is required for plan.route",
	)
}

func (s *Server) plannedRouteForRun(
	run execution.DurableRun,
	requestedCapability string,
) (temporalruntime.PlanRouteActivityOutput, bool, error) {
	if s == nil || s.intentPolicyErr != nil {
		return temporalruntime.PlanRouteActivityOutput{}, false, nil
	}
	if len(run.Metadata) == 0 {
		return temporalruntime.PlanRouteActivityOutput{}, false, nil
	}
	payload := cloneAnyMapFromMetadata(run.Metadata["execution_payload"])
	userGoal := firstNonEmptyText(payload["user_goal"])
	if userGoal == "" {
		return temporalruntime.PlanRouteActivityOutput{}, false, nil
	}
	capability := firstNonEmptyText(
		payload["effective_capability"],
		run.SelectedCapability,
		run.RequestedCapability,
		requestedCapability,
	)
	if capability == "" {
		capability = "knowledge"
	}
	version := cloneAnyMapFromMetadata(payload["version_query"])
	scope := cloneAnyMapFromMetadata(payload["requested_scope"])
	selectedNotice := cloneAnyMapFromMetadata(nestedAny(payload, "context", "session", "selected_notice_ref"))
	plan := structuredplanning.PlanWithPolicy(structuredplanning.Request{
		EffectiveCapability:      capability,
		UserGoal:                 userGoal,
		HasRequestedScope:        len(scope) > 0,
		MultiStepWorkflowEnabled: true,
		RequestedScope: structuredplanning.Scope{
			Collection: firstNonEmptyText(scope["collection"]),
			Corpus:     firstNonEmptyText(scope["corpus"]),
		},
		SelectedNoticeRef: structuredplanning.SelectedNoticeRef{
			NoticeID:      firstNonEmptyText(selectedNotice["notice_id"]),
			SourceFamily:  firstNonEmptyText(selectedNotice["source_family"]),
			Title:         firstNonEmptyText(selectedNotice["title"]),
			TargetSurface: firstNonEmptyText(selectedNotice["target_surface"]),
		},
		VersionQuery: structuredplanning.VersionQuery{
			AsOf:               firstNonEmptyText(version["as_of"]),
			CompareToVersionID: firstNonEmptyText(version["compare_to_version_id"]),
			Mode:               firstNonEmptyText(version["mode"]),
			VersionID:          firstNonEmptyText(version["version_id"]),
		},
	}, s.intentPolicy)
	if plan == nil {
		return temporalruntime.PlanRouteActivityOutput{}, false, nil
	}
	if capabilityPlan := plan.CapabilityPlan(); capabilityPlan != nil {
		resolvedPlan, err := resolveStructuredCapabilityPlan(*capabilityPlan)
		if err != nil {
			return temporalruntime.PlanRouteActivityOutput{}, true, err
		}
		plan = resolvedPlan
	}
	route, err := temporalRouteOutputFromStructuredPlan(run.RunID, capability, plan)
	return route, true, err
}

func resolveStructuredCapabilityPlan(
	capabilityPlan structuredplanning.CapabilityPlan,
) (*structuredplanning.WorkflowPlan, error) {
	capabilityRegistry, ok := runtimepolicy.DefaultCapabilitySpecRegistry()
	if !ok {
		return nil, fmt.Errorf("capability registry is not available")
	}
	toolRegistry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if !ok {
		return nil, fmt.Errorf("tool registry is not available")
	}
	artifactRegistry, err := runtimepolicy.LoadWorkflowArtifactRegistry("")
	if err != nil {
		return nil, err
	}
	return structuredplanning.ResolveCapabilityPlan(
		capabilityPlan,
		capabilityRegistry,
		toolRegistry,
		artifactRegistry,
	)
}

func temporalRouteOutputFromStructuredPlan(
	runID string,
	effectiveCapability string,
	plan *structuredplanning.WorkflowPlan,
) (temporalruntime.PlanRouteActivityOutput, error) {
	if plan == nil {
		return temporalruntime.PlanRouteActivityOutput{}, fmt.Errorf("workflow plan is required")
	}
	capabilityRegistry, ok := runtimepolicy.DefaultCapabilitySpecRegistry()
	if !ok {
		return temporalruntime.PlanRouteActivityOutput{}, fmt.Errorf("capability registry is not available")
	}
	toolRegistry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if !ok {
		return temporalruntime.PlanRouteActivityOutput{}, fmt.Errorf("tool registry is not available")
	}
	if err := structuredplanning.ValidateWorkflowPlanWithCapabilitySpec(
		plan,
		capabilityRegistry,
		toolRegistry,
	); err != nil {
		return temporalruntime.PlanRouteActivityOutput{}, err
	}
	handoffs := plan.Handoffs()
	if len(handoffs) == 0 {
		return temporalruntime.PlanRouteActivityOutput{}, fmt.Errorf("workflow plan has no executable handoffs")
	}
	steps := make([]temporalruntime.CapabilityBranchStep, 0, len(handoffs))
	for index, handoff := range handoffs {
		planStep := structuredplanning.WorkflowPlanStep{}
		if index < len(plan.Steps) {
			planStep = plan.Steps[index]
		}
		steps = append(steps, temporalruntime.CapabilityBranchStep{
			AllowedTools: append([]string{}, handoff.AllowedTools...),
			Capability:   handoff.Capability,
			Payload:      cloneAnyMapFromMetadata(handoff.Payload),
			PayloadKind:  handoff.PayloadKind,
			StepID:       firstNonEmptyText(planStep.StepID, "capability:"+handoff.Capability+":"+handoff.PayloadKind),
			ToolName:     firstNonEmptyText(planStep.SelectedTool, selectedToolNameForHandoff(handoff)),
			WorkerRole:   firstNonEmptyText(planStep.WorkerRole, runtimepolicy.WorkerRoleForCapability(handoff.Capability)),
		})
	}
	first := steps[0]
	routeCapability := firstNonEmptyText(effectiveCapability, first.Capability)
	return temporalruntime.PlanRouteActivityOutput{
		AllowedCapabilities: append([]string{}, plan.AllowedCapabilities...),
		AllowedTools:        append([]string{}, first.AllowedTools...),
		Capability:          routeCapability,
		MaxReplans:          plan.SemanticRetryPolicy.MaxReplans,
		Payload:             cloneAnyMapFromMetadata(first.Payload),
		PayloadKind:         firstNonEmptyText(first.PayloadKind, "capability_plan"),
		PlanRef:             temporalProjectionRef(runID, "plan/route"),
		RunID:               runID,
		Status:              "planned",
		Steps:               steps,
		ToolName:            first.ToolName,
		WorkerRole:          runtimepolicy.WorkerRoleForCapability(routeCapability),
		WorkflowMode:        string(plan.WorkflowMode),
	}, nil
}

func selectedToolNameForHandoff(handoff structuredplanning.Handoff) string {
	if len(handoff.AllowedTools) == 1 {
		return handoff.AllowedTools[0]
	}
	if handoff.Capability == "knowledge" {
		return "retrieval.query"
	}
	return ""
}

func firstString(values []string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
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
		s.emitRetrievalRuntimeObservation(ctx, retrievalRuntimeObservationInput{
			CandidateCount: 0,
			FailureKind:    "retrieval_lookup_failed",
			Plan:           plan,
			ReferenceCount: 0,
			Run:            run,
			StartedAt:      startedAt,
			TerminalState:  "failed_closed",
			TraceID:        input.TraceID,
		})
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
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
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
	s.emitRetrievalRuntimeObservation(ctx, retrievalRuntimeObservationInput{
		CandidateCount: result.CandidateCount,
		FailureKind:    "",
		Plan:           plan,
		ReferenceCount: len(result.Candidates),
		Run:            run,
		StartedAt:      startedAt,
		TerminalState:  "completed",
		TraceID:        input.TraceID,
		QueryLatencyMS: result.QueryLatencyMS,
	})
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
	plan, err := temporalRAGPlanProjectionFromRun(run, input.RAGPlanRef)
	if err != nil {
		return s.failExpandOrRescueRetrievalActivity(ctx, run, "rag_plan_projection_missing", err)
	}
	lookup, err := temporalRAGLookupResultFromRun(run, input.LookupRef)
	if err != nil {
		return s.failExpandOrRescueRetrievalActivity(ctx, run, "retrieval_lookup_projection_missing", err)
	}
	startedAt := time.Now().UTC()
	rescueRef := temporalProjectionRef(run.RunID, "retrieval/expand-or-rescue")
	rescueApplied, rescueReason, err := retrievalRescueDecision(plan, lookup)
	if err != nil {
		return s.failExpandOrRescueRetrievalActivity(ctx, run, "retrieval_rescue_failed", err)
	}
	result := ragruntime.RetrievalRescueResult{
		LookupRef:     input.LookupRef,
		RescueApplied: rescueApplied,
		RescueReason:  rescueReason,
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
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
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
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
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
