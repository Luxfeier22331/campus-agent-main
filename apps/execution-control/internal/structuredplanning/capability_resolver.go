package structuredplanning

import (
	"fmt"
	"slices"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

func ResolveCapabilityPlan(
	capabilityPlan CapabilityPlan,
	capabilityRegistry runtimepolicy.CapabilitySpecRegistry,
	toolRegistry runtimepolicy.ToolSpecRegistry,
	artifactRegistry runtimepolicy.WorkflowArtifactRegistry,
) (*WorkflowPlan, error) {
	bindingsByArtifact := map[string][]runtimepolicy.WorkflowCapabilityBinding{}
	artifactsByKind := map[string]runtimepolicy.WorkflowArtifact{}
	for _, artifact := range artifactRegistry.Artifacts {
		artifactsByKind[artifact.Kind] = artifact
	}
	for _, binding := range artifactRegistry.Bindings {
		for _, producedKind := range binding.Produces {
			bindingsByArtifact[producedKind] = append(bindingsByArtifact[producedKind], binding)
		}
	}

	steps := map[string]runtimepolicy.WorkflowCapabilityBinding{}
	selectedArtifacts := selectedArtifactSet(capabilityPlan)
	visiting := map[string]bool{}
	for _, artifactKind := range capabilityPlan.RequiredArtifacts {
		if err := resolveArtifactRequirement(
			artifactKind,
			capabilityPlan,
			capabilityRegistry,
			toolRegistry,
			artifactsByKind,
			bindingsByArtifact,
			steps,
			selectedArtifacts,
			visiting,
		); err != nil {
			return nil, err
		}
	}

	if len(steps) > capabilityPlan.Budget.MaxSteps {
		return nil, resolverError(
			"budget_exceeded",
			"resolver requires more steps than capability plan budget",
		)
	}

	switch capabilityPlan.Capability {
	case "knowledge":
		return buildResolvedKnowledgeWorkflowPlan(capabilityPlan, steps)
	case "campus_services":
		return buildResolvedTransportNoticeOverrideWorkflowPlan(capabilityPlan, steps)
	default:
		return nil, resolverError(
			"artifact_owner_missing",
			"resolver does not yet support capability "+capabilityPlan.Capability,
		)
	}
}

func resolveArtifactRequirement(
	artifactKind string,
	capabilityPlan CapabilityPlan,
	capabilityRegistry runtimepolicy.CapabilitySpecRegistry,
	toolRegistry runtimepolicy.ToolSpecRegistry,
	artifactsByKind map[string]runtimepolicy.WorkflowArtifact,
	bindingsByArtifact map[string][]runtimepolicy.WorkflowCapabilityBinding,
	steps map[string]runtimepolicy.WorkflowCapabilityBinding,
	selectedArtifacts map[string]struct{},
	visiting map[string]bool,
) error {
	artifact, ok := artifactsByKind[artifactKind]
	if !ok {
		return resolverError("artifact_owner_missing", "artifact kind is not registered: "+artifactKind)
	}
	if capabilityPlan.AnswerPolicy.RequiresArtifactBackedAnswer &&
		artifactKind == "grounding_verdict" &&
		artifact.AnswerEligible {
		return resolverError(
			"ineligible_artifact_for_answer",
			"grounding_verdict must not be answer-eligible",
		)
	}
	if capabilityPlan.AnswerPolicy.RequiresArtifactBackedAnswer &&
		len(capabilityPlan.RequiredArtifacts) == 1 &&
		!artifact.AnswerEligible {
		return resolverError(
			"ineligible_artifact_for_answer",
			"capability plan requires non-answer-eligible artifact only: "+artifactKind,
		)
	}
	if visiting[artifactKind] {
		return resolverError("dependency_cycle", "artifact dependency cycle detected at "+artifactKind)
	}
	visiting[artifactKind] = true
	defer delete(visiting, artifactKind)

	bindings := bindingsByArtifact[artifactKind]
	if len(bindings) == 0 {
		return resolverError("artifact_owner_missing", "no binding produces "+artifactKind)
	}

	var openBindings []runtimepolicy.WorkflowCapabilityBinding
	var closedBindings []runtimepolicy.WorkflowCapabilityBinding
	for _, binding := range bindings {
		if binding.OpeningGate == "open" {
			openBindings = append(openBindings, binding)
		} else {
			closedBindings = append(closedBindings, binding)
		}
	}
	if len(openBindings) == 0 {
		return resolverError("producer_closed", "no open binding produces "+artifactKind)
	}
	slices.SortFunc(openBindings, func(a, b runtimepolicy.WorkflowCapabilityBinding) int {
		switch {
		case a.Priority < b.Priority:
			return -1
		case a.Priority > b.Priority:
			return 1
		default:
			return 0
		}
	})
	if len(openBindings) > 1 && openBindings[0].Priority == openBindings[1].Priority {
		return resolverError("ambiguous_producer", "multiple open bindings produce "+artifactKind)
	}
	selected := openBindings[0]

	capability, ok := capabilityRegistry.CapabilityByID(selected.OwnerCapability)
	if !ok || !capability.Active || capability.OpeningGate != "open" {
		return resolverError("producer_closed", "owner capability is not open for "+artifactKind)
	}
	if selected.ToolName != "" {
		tool, ok := toolRegistry.ToolByName(selected.ToolName)
		if !ok {
			return resolverError("tool_gate_closed", "tool is missing for "+selected.BindingID)
		}
		if !tool.Active {
			return resolverError("tool_gate_closed", "tool is not open for "+selected.BindingID)
		}
		if tool.RuntimePosture == "closed" && tool.Surface != "capability_internal" {
			return resolverError("tool_gate_closed", "tool is not open for "+selected.BindingID)
		}
	}

	for _, consumed := range selected.Consumes {
		if _, required := selectedArtifacts[consumed]; !required {
			continue
		}
		if err := resolveArtifactRequirement(
			consumed,
			capabilityPlan,
			capabilityRegistry,
			toolRegistry,
			artifactsByKind,
			bindingsByArtifact,
			steps,
			selectedArtifacts,
			visiting,
		); err != nil {
			return err
		}
	}
	stepIdentity := stepIdentityForBinding(selected)
	if _, exists := steps[stepIdentity]; !exists {
		steps[stepIdentity] = selected
	}
	_ = closedBindings
	return nil
}

func buildResolvedKnowledgeWorkflowPlan(
	capabilityPlan CapabilityPlan,
	steps map[string]runtimepolicy.WorkflowCapabilityBinding,
) (*WorkflowPlan, error) {
	noticeStep, ok := steps["capability:notice:campus_notice_get"]
	if !ok {
		return nil, resolverError(
			"artifact_owner_missing",
			"resolved knowledge capability is missing notice context step",
		)
	}
	ragEvidenceStep, ok := steps["capability:knowledge:rag_request"]
	if !ok {
		return nil, resolverError(
			"artifact_owner_missing",
			"resolved knowledge capability is missing evidence bundle step",
		)
	}

	noticeHandoff := capabilityBindingToHandoff(noticeStep, capabilityPlan)
	ragHandoff := capabilityBindingToHandoff(ragEvidenceStep, capabilityPlan)
	return MultiStepWorkflowPlan(
		"plan:resolver:notice:knowledge:notice_knowledge_followthrough",
		noticeHandoff,
		ragHandoff,
		"notice_context",
		capabilityPlan.Budget.MaxReplans,
		true,
		capabilityPlan,
	), nil
}

func buildResolvedTransportNoticeOverrideWorkflowPlan(
	capabilityPlan CapabilityPlan,
	steps map[string]runtimepolicy.WorkflowCapabilityBinding,
) (*WorkflowPlan, error) {
	scheduleStep, ok := steps["capability:campus_services:transport_schedule_lookup"]
	if !ok {
		return nil, resolverError(
			"artifact_owner_missing",
			"resolved transport override capability is missing schedule baseline step",
		)
	}
	changeSetStep, ok := steps["capability:notice:campus_notice_change_set_lookup"]
	if !ok {
		return nil, resolverError(
			"artifact_owner_missing",
			"resolved transport override capability is missing notice change-set step",
		)
	}
	ragStep, ok := steps["capability:knowledge:rag_request"]
	if !ok {
		return nil, resolverError(
			"artifact_owner_missing",
			"resolved transport override capability is missing grounding step",
		)
	}
	scheduleHandoff := capabilityBindingToHandoff(scheduleStep, capabilityPlan)
	changeSetHandoff := capabilityBindingToHandoff(changeSetStep, capabilityPlan)
	ragHandoff := capabilityBindingToHandoff(ragStep, capabilityPlan)
	return MultiStepWorkflowPlanFromHandoffs(
		"plan:resolver:campus_services:notice:knowledge:transport_notice_override",
		[]Handoff{scheduleHandoff, changeSetHandoff, ragHandoff},
		[]WorkflowPlanEdge{
			{
				FromStepID:             workflowPlanStepForHandoff(scheduleHandoff).StepID,
				ToStepID:               workflowPlanStepForHandoff(changeSetHandoff).StepID,
				Condition:              "completed",
				RequiredProjectionKind: "schedule_baseline",
			},
			{
				FromStepID:             workflowPlanStepForHandoff(changeSetHandoff).StepID,
				ToStepID:               workflowPlanStepForHandoff(ragHandoff).StepID,
				Condition:              "completed",
				RequiredProjectionKind: "notice_change_set",
			},
		},
		capabilityPlan.Budget.MaxReplans,
		true,
		capabilityPlan,
	), nil
}

func capabilityBindingToHandoff(
	binding runtimepolicy.WorkflowCapabilityBinding,
	capabilityPlan CapabilityPlan,
) Handoff {
	switch binding.BindingID {
	case "notice.notice_context.selected_notice_get":
		payload := map[string]any{
			"notice_id": capabilityPlan.Constraints.SelectedNotice.NoticeID,
		}
		if capabilityPlan.Constraints.SelectedNotice.SourceFamily != "" {
			payload["source_family"] = capabilityPlan.Constraints.SelectedNotice.SourceFamily
		}
		return Handoff{
			Capability:   binding.OwnerCapability,
			PayloadKind:  "campus_notice_get",
			Payload:      payload,
			AllowedTools: []string{},
		}
	case "rag.evidence_bundle.retrieval_query", "rag.grounding_verdict.retrieval_query":
		payload := map[string]any{
			"version_query": map[string]any{
				"mode": "current",
			},
		}
		if capabilityPlan.Constraints.RequestedScope != nil {
			payload["scope"] = map[string]any{
				"corpus":     capabilityPlan.Constraints.RequestedScope.Corpus,
				"collection": capabilityPlan.Constraints.RequestedScope.Collection,
			}
		}
		return Handoff{
			Capability:   binding.OwnerCapability,
			PayloadKind:  "rag_request",
			Payload:      payload,
			AllowedTools: []string{},
		}
	case "campus_services.schedule_baseline.transport_schedule_lookup":
		payload := map[string]any{
			"query_text": capabilityPlan.UserGoalSummary,
			"intent":     "service_window",
		}
		if constraint := capabilityPlan.Constraints.TransportQuery; constraint != nil {
			if len(constraint.RouteLabels) > 0 || len(constraint.DirectionLabels) > 0 {
				routeSelector := map[string]any{}
				if len(constraint.RouteLabels) > 0 {
					routeSelector["route_variant_query"] = constraint.RouteLabels[0]
				}
				if len(constraint.DirectionLabels) > 0 {
					switch constraint.DirectionLabels[0] {
					case "丰台到海淀":
						routeSelector["origin_campus"] = "fengtai"
						routeSelector["destination_campus"] = "haidian"
					case "海淀到丰台":
						routeSelector["origin_campus"] = "haidian"
						routeSelector["destination_campus"] = "fengtai"
					}
				}
				if len(routeSelector) > 0 {
					payload["route_selector"] = routeSelector
				}
			}
			serviceTimeQuery := map[string]any{
				"date_mode": "today",
				"daypart":   "all_day",
			}
			if constraint.ServiceDate != "" {
				serviceTimeQuery["date_mode"] = "date"
				serviceTimeQuery["service_date"] = constraint.ServiceDate
			}
			payload["service_time_query"] = serviceTimeQuery
		}
		return Handoff{
			Capability:   binding.OwnerCapability,
			PayloadKind:  "transport_schedule_lookup",
			Payload:      payload,
			AllowedTools: runtimepolicy.AllowedToolsForCapabilityPayloadKind(binding.OwnerCapability, "transport_schedule_lookup"),
		}
	case "notice.notice_change_set.transport_override_lookup":
		payload := map[string]any{
			"query_text": capabilityPlan.UserGoalSummary,
		}
		if constraint := capabilityPlan.Constraints.TransportQuery; constraint != nil {
			if len(constraint.RouteLabels) > 0 {
				payload["route_labels"] = append([]string{}, constraint.RouteLabels...)
			}
			if len(constraint.DirectionLabels) > 0 {
				payload["direction_labels"] = append([]string{}, constraint.DirectionLabels...)
			}
			if len(constraint.StopLabels) > 0 {
				payload["stop_labels"] = append([]string{}, constraint.StopLabels...)
			}
			if constraint.ServiceDate != "" {
				payload["service_date"] = constraint.ServiceDate
			}
			if constraint.QueryTimeAnchor != "" {
				payload["query_time_anchor"] = constraint.QueryTimeAnchor
			}
		}
		return Handoff{
			Capability:   binding.OwnerCapability,
			PayloadKind:  "campus_notice_change_set_lookup",
			Payload:      payload,
			AllowedTools: runtimepolicy.AllowedToolsForCapabilityPayloadKind(binding.OwnerCapability, "campus_notice_change_set_lookup"),
		}
	default:
		return Handoff{}
	}
}

func stepIdentityForBinding(binding runtimepolicy.WorkflowCapabilityBinding) string {
	switch binding.BindingID {
	case "notice.notice_context.selected_notice_get":
		return "capability:notice:campus_notice_get"
	case "notice.notice_change_set.transport_override_lookup":
		return "capability:notice:campus_notice_change_set_lookup"
	case "campus_services.schedule_baseline.transport_schedule_lookup":
		return "capability:campus_services:transport_schedule_lookup"
	case "rag.evidence_bundle.retrieval_query", "rag.grounding_verdict.retrieval_query":
		return "capability:knowledge:rag_request"
	default:
		if binding.ToolName != "" {
			return "binding:" + binding.OwnerCapability + ":" + binding.ToolName
		}
		return "binding:" + binding.BindingID
	}
}

func selectedArtifactSet(capabilityPlan CapabilityPlan) map[string]struct{} {
	selected := make(map[string]struct{}, len(capabilityPlan.RequiredArtifacts)+len(capabilityPlan.OptionalArtifacts)+len(capabilityPlan.GroundingPolicy.RequiredArtifacts))
	for _, artifactKind := range capabilityPlan.RequiredArtifacts {
		selected[artifactKind] = struct{}{}
	}
	for _, artifactKind := range capabilityPlan.OptionalArtifacts {
		selected[artifactKind] = struct{}{}
	}
	for _, artifactKind := range capabilityPlan.GroundingPolicy.RequiredArtifacts {
		selected[artifactKind] = struct{}{}
	}
	return selected
}

func resolverError(code string, message string) error {
	return fmt.Errorf("%s: %s", code, message)
}
