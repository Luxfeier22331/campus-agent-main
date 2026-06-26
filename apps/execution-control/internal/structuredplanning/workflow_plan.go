package structuredplanning

import (
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

const WorkflowPlanSchemaVersion = "workflow-plan-v1"

type WorkflowMode string

const (
	WorkflowModeTerminal   WorkflowMode = "terminal"
	WorkflowModeSingleStep WorkflowMode = "single_step"
	WorkflowModeMultiStep  WorkflowMode = "multi_step"
)

type WorkflowStepKind string

const (
	WorkflowStepKindTerminal   WorkflowStepKind = "terminal"
	WorkflowStepKindTypedTool  WorkflowStepKind = "typed_tool"
	WorkflowStepKindHandoff    WorkflowStepKind = "handoff"
	WorkflowStepKindToolCall   WorkflowStepKind = "tool_call"
	WorkflowStepKindValidation WorkflowStepKind = "validation"
)

type WorkflowPlan struct {
	SchemaVersion       string
	PlanID              string
	WorkflowMode        WorkflowMode
	AllowedCapabilities []string
	Steps               []WorkflowPlanStep
	Edges               []WorkflowPlanEdge
	TerminalPolicy      WorkflowTerminalPolicy
	ResumePolicy        WorkflowResumePolicy
	SemanticRetryPolicy SemanticRetryPolicy
	capabilityPlan      *CapabilityPlan
	handoffs            []Handoff
	expectedArtifacts   map[string][]string
}

type WorkflowPlanStep struct {
	StepID       string
	StepKind     WorkflowStepKind
	Capability   string
	WorkerRole   string
	PayloadKind  string
	AllowedTools []string
	SelectedTool string
}

type WorkflowPlanEdge struct {
	FromStepID             string
	ToStepID               string
	Condition              string
	RequiredProjectionKind string
}

type WorkflowTerminalPolicy struct {
	FailCloseOnInvalidPlan bool
}

type WorkflowResumePolicy struct {
	ResumeSupported bool
}

type SemanticRetryPolicy struct {
	MaxReplans int
}

func SingleStepPlan(handoff Handoff) *WorkflowPlan {
	selectedTool := selectedToolForHandoff(handoff)
	step := WorkflowPlanStep{
		StepID:       stepIDForHandoff(handoff),
		StepKind:     WorkflowStepKindHandoff,
		Capability:   handoff.Capability,
		WorkerRole:   runtimepolicy.WorkerRoleForCapability(handoff.Capability),
		PayloadKind:  handoff.PayloadKind,
		AllowedTools: append([]string{}, handoff.AllowedTools...),
		SelectedTool: selectedTool,
	}
	return &WorkflowPlan{
		SchemaVersion:       WorkflowPlanSchemaVersion,
		PlanID:              "plan:single_step:" + handoff.Capability + ":" + handoff.PayloadKind,
		WorkflowMode:        WorkflowModeSingleStep,
		AllowedCapabilities: []string{handoff.Capability},
		Steps:               []WorkflowPlanStep{step},
		Edges:               []WorkflowPlanEdge{},
		TerminalPolicy: WorkflowTerminalPolicy{
			FailCloseOnInvalidPlan: true,
		},
		ResumePolicy: WorkflowResumePolicy{
			ResumeSupported: false,
		},
		SemanticRetryPolicy: SemanticRetryPolicy{
			MaxReplans: 0,
		},
		handoffs: []Handoff{cloneHandoffValue(handoff)},
		expectedArtifacts: map[string][]string{
			step.StepID: expectedArtifactsForHandoff(handoff),
		},
	}
}

func MultiStepCapabilityPreplan(planID string, capabilityPlan CapabilityPlan) *WorkflowPlan {
	return &WorkflowPlan{
		SchemaVersion:       WorkflowPlanSchemaVersion,
		PlanID:              planID,
		WorkflowMode:        WorkflowModeMultiStep,
		AllowedCapabilities: []string{},
		Steps:               []WorkflowPlanStep{},
		Edges:               []WorkflowPlanEdge{},
		TerminalPolicy: WorkflowTerminalPolicy{
			FailCloseOnInvalidPlan: true,
		},
		ResumePolicy: WorkflowResumePolicy{
			ResumeSupported: capabilityPlan.Budget.MaxSteps > 1,
		},
		SemanticRetryPolicy: SemanticRetryPolicy{
			MaxReplans: capabilityPlan.Budget.MaxReplans,
		},
		capabilityPlan:    &capabilityPlan,
		handoffs:          []Handoff{},
		expectedArtifacts: map[string][]string{},
	}
}

func MultiStepWorkflowPlan(
	planID string,
	first Handoff,
	second Handoff,
	requiredProjectionKind string,
	maxReplans int,
	resumeSupported bool,
	capabilityPlan CapabilityPlan,
) *WorkflowPlan {
	firstStep := workflowPlanStepForHandoff(first)
	secondStep := workflowPlanStepForHandoff(second)
	return &WorkflowPlan{
		SchemaVersion:       WorkflowPlanSchemaVersion,
		PlanID:              planID,
		WorkflowMode:        WorkflowModeMultiStep,
		AllowedCapabilities: []string{first.Capability, second.Capability},
		Steps:               []WorkflowPlanStep{firstStep, secondStep},
		Edges: []WorkflowPlanEdge{
			{
				FromStepID:             firstStep.StepID,
				ToStepID:               secondStep.StepID,
				Condition:              "completed",
				RequiredProjectionKind: requiredProjectionKind,
			},
		},
		TerminalPolicy: WorkflowTerminalPolicy{
			FailCloseOnInvalidPlan: true,
		},
		ResumePolicy: WorkflowResumePolicy{
			ResumeSupported: resumeSupported,
		},
		SemanticRetryPolicy: SemanticRetryPolicy{
			MaxReplans: maxReplans,
		},
		capabilityPlan: &capabilityPlan,
		handoffs: []Handoff{
			cloneHandoffValue(first),
			cloneHandoffValue(second),
		},
		expectedArtifacts: map[string][]string{
			firstStep.StepID:  expectedArtifactsForHandoff(first),
			secondStep.StepID: expectedArtifactsForHandoff(second),
		},
	}
}

func MultiStepWorkflowPlanFromHandoffs(
	planID string,
	handoffs []Handoff,
	edges []WorkflowPlanEdge,
	maxReplans int,
	resumeSupported bool,
	capabilityPlan CapabilityPlan,
) *WorkflowPlan {
	steps := make([]WorkflowPlanStep, 0, len(handoffs))
	allowedCapabilities := make([]string, 0, len(handoffs))
	expectedArtifacts := map[string][]string{}
	clonedHandoffs := make([]Handoff, 0, len(handoffs))
	for _, handoff := range handoffs {
		step := workflowPlanStepForHandoff(handoff)
		steps = append(steps, step)
		allowedCapabilities = append(allowedCapabilities, handoff.Capability)
		expectedArtifacts[step.StepID] = expectedArtifactsForHandoff(handoff)
		clonedHandoffs = append(clonedHandoffs, cloneHandoffValue(handoff))
	}
	return &WorkflowPlan{
		SchemaVersion:       WorkflowPlanSchemaVersion,
		PlanID:              planID,
		WorkflowMode:        WorkflowModeMultiStep,
		AllowedCapabilities: allowedCapabilities,
		Steps:               steps,
		Edges:               edges,
		TerminalPolicy: WorkflowTerminalPolicy{
			FailCloseOnInvalidPlan: true,
		},
		ResumePolicy: WorkflowResumePolicy{
			ResumeSupported: resumeSupported,
		},
		SemanticRetryPolicy: SemanticRetryPolicy{
			MaxReplans: maxReplans,
		},
		capabilityPlan:    &capabilityPlan,
		handoffs:          clonedHandoffs,
		expectedArtifacts: expectedArtifacts,
	}
}

func workflowPlanStepForHandoff(handoff Handoff) WorkflowPlanStep {
	return WorkflowPlanStep{
		StepID:       stepIDForHandoff(handoff),
		StepKind:     WorkflowStepKindHandoff,
		Capability:   handoff.Capability,
		WorkerRole:   runtimepolicy.WorkerRoleForCapability(handoff.Capability),
		PayloadKind:  handoff.PayloadKind,
		AllowedTools: append([]string{}, handoff.AllowedTools...),
		SelectedTool: selectedToolForHandoff(handoff),
	}
}

func (p *WorkflowPlan) SelectedHandoff() *Handoff {
	if p == nil || len(p.handoffs) == 0 {
		return nil
	}
	return cloneHandoff(p.handoffs[0])
}

func (p *WorkflowPlan) Handoffs() []Handoff {
	if p == nil {
		return []Handoff{}
	}
	handoffs := make([]Handoff, 0, len(p.handoffs))
	for _, handoff := range p.handoffs {
		handoffs = append(handoffs, cloneHandoffValue(handoff))
	}
	return handoffs
}

func (p *WorkflowPlan) CapabilityPlan() *CapabilityPlan {
	if p == nil || p.capabilityPlan == nil {
		return nil
	}
	copyValue := cloneCapabilityPlanValue(*p.capabilityPlan)
	return &copyValue
}

func (p *WorkflowPlan) ExpectedArtifactsForStep(stepID string) []string {
	if p == nil || len(p.expectedArtifacts) == 0 {
		return nil
	}
	expected := p.expectedArtifacts[stepID]
	if len(expected) == 0 {
		return nil
	}
	return append([]string{}, expected...)
}

func (p *WorkflowPlan) Map() map[string]any {
	if p == nil {
		return nil
	}
	steps := make([]map[string]any, 0, len(p.Steps))
	for _, step := range p.Steps {
		steps = append(steps, step.Map())
	}
	edges := make([]map[string]any, 0, len(p.Edges))
	for _, edge := range p.Edges {
		edges = append(edges, edge.Map())
	}
	return map[string]any{
		"schema_version":        p.SchemaVersion,
		"plan_id":               p.PlanID,
		"workflow_mode":         string(p.WorkflowMode),
		"allowed_capabilities":  append([]string{}, p.AllowedCapabilities...),
		"steps":                 steps,
		"edges":                 edges,
		"terminal_policy":       p.TerminalPolicy.Map(),
		"resume_policy":         p.ResumePolicy.Map(),
		"semantic_retry_policy": p.SemanticRetryPolicy.Map(),
	}
}

func (s WorkflowPlanStep) Map() map[string]any {
	item := map[string]any{
		"step_id":      s.StepID,
		"step_kind":    string(s.StepKind),
		"capability":   s.Capability,
		"worker_role":  s.WorkerRole,
		"payload_kind": s.PayloadKind,
		"allowed_tools": append(
			[]string{},
			s.AllowedTools...,
		),
	}
	if s.SelectedTool != "" {
		item["selected_tool"] = s.SelectedTool
	}
	return item
}

func (e WorkflowPlanEdge) Map() map[string]any {
	item := map[string]any{
		"from_step_id": e.FromStepID,
		"to_step_id":   e.ToStepID,
		"condition":    e.Condition,
	}
	if e.RequiredProjectionKind != "" {
		item["required_projection_kind"] = e.RequiredProjectionKind
	}
	return item
}

func (p WorkflowTerminalPolicy) Map() map[string]any {
	return map[string]any{
		"fail_close_on_invalid_plan": p.FailCloseOnInvalidPlan,
	}
}

func (p WorkflowResumePolicy) Map() map[string]any {
	return map[string]any{
		"resume_supported": p.ResumeSupported,
	}
}

func (p SemanticRetryPolicy) Map() map[string]any {
	return map[string]any{
		"max_replans": p.MaxReplans,
	}
}

func ValidateWorkflowPlanWithCapabilitySpec(
	plan *WorkflowPlan,
	registry runtimepolicy.CapabilitySpecRegistry,
	toolRegistry runtimepolicy.ToolSpecRegistry,
) error {
	if plan == nil {
		return nil
	}
	for index, step := range plan.Steps {
		if step.StepKind != WorkflowStepKindHandoff {
			continue
		}
		capability, ok := registry.CapabilityByID(step.Capability)
		if !ok {
			return fmt.Errorf("workflow plan step[%d] capability is outside CapabilitySpec: %s", index, step.Capability)
		}
		if !capability.Active || capability.OpeningGate != "open" {
			return fmt.Errorf("workflow plan step[%d] CapabilitySpec capability is not open: %s", index, step.Capability)
		}
		if !toolRegistry.PayloadKindBelongsToCapability(step.Capability, step.PayloadKind) {
			return fmt.Errorf(
				"workflow plan step[%d] payload_kind %q is outside CapabilitySpec for capability %s",
				index,
				step.PayloadKind,
				step.Capability,
			)
		}
		if !allowedToolsWithinCapabilitySpec(step.AllowedTools, capability.AllowedStructuredTools) {
			return fmt.Errorf(
				"workflow plan step[%d] allowed_tools %#v are outside CapabilitySpec for capability %s",
				index,
				step.AllowedTools,
				step.Capability,
			)
		}
	}
	return nil
}

func allowedToolsWithinCapabilitySpec(allowedTools []string, allowedStructuredTools []string) bool {
	for _, tool := range allowedTools {
		if !containsString(allowedStructuredTools, tool) {
			return false
		}
	}
	return true
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func expectedArtifactsForHandoff(handoff Handoff) []string {
	switch {
	case handoff.Capability == "notice" && handoff.PayloadKind == "campus_notice_get":
		return []string{"notice_context"}
	case handoff.Capability == "campus_services" && handoff.PayloadKind == "transport_schedule_lookup":
		return []string{"schedule_baseline"}
	case handoff.Capability == "knowledge" && handoff.PayloadKind == "rag_request":
		return []string{"evidence_bundle", "grounding_verdict"}
	default:
		return nil
	}
}

func selectedToolForHandoff(handoff Handoff) string {
	if len(handoff.AllowedTools) == 1 {
		return handoff.AllowedTools[0]
	}
	if handoff.Capability == "knowledge" {
		return "retrieval.query"
	}
	return ""
}

func stepIDForHandoff(handoff Handoff) string {
	return "capability:" + handoff.Capability + ":" + handoff.PayloadKind
}

func cloneCapabilityPlanValue(source CapabilityPlan) CapabilityPlan {
	copyValue := source
	copyValue.RequiredArtifacts = append([]string{}, source.RequiredArtifacts...)
	copyValue.OptionalArtifacts = append([]string{}, source.OptionalArtifacts...)
	copyValue.GroundingPolicy.RequiredArtifacts = append(
		[]string{},
		source.GroundingPolicy.RequiredArtifacts...,
	)
	if source.Constraints.RequestedScope != nil {
		scope := *source.Constraints.RequestedScope
		copyValue.Constraints.RequestedScope = &scope
	}
	if source.Constraints.SelectedNotice != nil {
		selectedNotice := *source.Constraints.SelectedNotice
		selectedNotice.AllowedTargetSurfaces = append(
			[]string{},
			source.Constraints.SelectedNotice.AllowedTargetSurfaces...,
		)
		copyValue.Constraints.SelectedNotice = &selectedNotice
	}
	if source.Constraints.TransportQuery != nil {
		transportQuery := *source.Constraints.TransportQuery
		transportQuery.RouteLabels = append([]string{}, source.Constraints.TransportQuery.RouteLabels...)
		transportQuery.DirectionLabels = append([]string{}, source.Constraints.TransportQuery.DirectionLabels...)
		transportQuery.StopLabels = append([]string{}, source.Constraints.TransportQuery.StopLabels...)
		copyValue.Constraints.TransportQuery = &transportQuery
	}
	return copyValue
}

func cloneHandoff(handoff Handoff) *Handoff {
	clone := cloneHandoffValue(handoff)
	return &clone
}

func cloneHandoffValue(handoff Handoff) Handoff {
	return Handoff{
		Capability:   handoff.Capability,
		PayloadKind:  handoff.PayloadKind,
		Payload:      cloneAnyMap(handoff.Payload),
		AllowedTools: append([]string{}, handoff.AllowedTools...),
	}
}

func cloneAnyMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	clone := make(map[string]any, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}
