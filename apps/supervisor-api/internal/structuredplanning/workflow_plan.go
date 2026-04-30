package structuredplanning

const WorkflowPlanSchemaVersion = "workflow-plan-v1"

type WorkflowMode string

const (
	WorkflowModeTerminal      WorkflowMode = "terminal"
	WorkflowModeDirectRuntime WorkflowMode = "direct_runtime"
	WorkflowModeSingleHandoff WorkflowMode = "single_handoff"
	WorkflowModeMultiStep     WorkflowMode = "multi_step"
)

type WorkflowStepKind string

const (
	WorkflowStepKindTerminal      WorkflowStepKind = "terminal"
	WorkflowStepKindDirectRuntime WorkflowStepKind = "direct_runtime"
	WorkflowStepKindHandoff       WorkflowStepKind = "handoff"
	WorkflowStepKindToolCall      WorkflowStepKind = "tool_call"
	WorkflowStepKindValidation    WorkflowStepKind = "validation"
)

type WorkflowPlan struct {
	SchemaVersion       string
	PlanID              string
	WorkflowMode        WorkflowMode
	Steps               []WorkflowPlanStep
	Edges               []WorkflowPlanEdge
	TerminalPolicy      WorkflowTerminalPolicy
	ResumePolicy        WorkflowResumePolicy
	SemanticRetryPolicy SemanticRetryPolicy
	handoff             *Handoff
}

type WorkflowPlanStep struct {
	StepID       string
	StepKind     WorkflowStepKind
	Target       string
	PayloadKind  string
	AllowedTools []string
	SelectedTool string
}

type WorkflowPlanEdge struct {
	FromStepID string
	ToStepID   string
	Condition  string
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

func SingleHandoffPlan(handoff Handoff) *WorkflowPlan {
	selectedTool := selectedToolForHandoff(handoff)
	step := WorkflowPlanStep{
		StepID:       "handoff:" + handoff.Target + ":" + handoff.PayloadKind,
		StepKind:     WorkflowStepKindHandoff,
		Target:       handoff.Target,
		PayloadKind:  handoff.PayloadKind,
		AllowedTools: append([]string{}, handoff.AllowedTools...),
		SelectedTool: selectedTool,
	}
	return &WorkflowPlan{
		SchemaVersion: WorkflowPlanSchemaVersion,
		PlanID:        "plan:single_handoff:" + handoff.Target + ":" + handoff.PayloadKind,
		WorkflowMode:  WorkflowModeSingleHandoff,
		Steps:         []WorkflowPlanStep{step},
		Edges:         []WorkflowPlanEdge{},
		TerminalPolicy: WorkflowTerminalPolicy{
			FailCloseOnInvalidPlan: true,
		},
		ResumePolicy: WorkflowResumePolicy{
			ResumeSupported: false,
		},
		SemanticRetryPolicy: SemanticRetryPolicy{
			MaxReplans: 0,
		},
		handoff: cloneHandoff(handoff),
	}
}

func (p *WorkflowPlan) SelectedHandoff() *Handoff {
	if p == nil || p.handoff == nil {
		return nil
	}
	return cloneHandoff(*p.handoff)
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
		"target":       s.Target,
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
	return map[string]any{
		"from_step_id": e.FromStepID,
		"to_step_id":   e.ToStepID,
		"condition":    e.Condition,
	}
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

func selectedToolForHandoff(handoff Handoff) string {
	if len(handoff.AllowedTools) == 1 {
		return handoff.AllowedTools[0]
	}
	if handoff.Target == "rag-agent" {
		return "retrieval.query"
	}
	return ""
}

func cloneHandoff(handoff Handoff) *Handoff {
	return &Handoff{
		Target:       handoff.Target,
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
