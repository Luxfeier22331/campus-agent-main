package execution

type WorkflowMode string

const (
	WorkflowModeTerminal      WorkflowMode = "terminal"
	WorkflowModeSingleHandoff WorkflowMode = "single_handoff"
	WorkflowModeDirectRuntime WorkflowMode = "direct_runtime"
	WorkflowModeMultiStep     WorkflowMode = "multi_step"
)

type WorkflowState string

const (
	WorkflowStatePending   WorkflowState = "pending"
	WorkflowStateRunning   WorkflowState = "running"
	WorkflowStateCompleted WorkflowState = "completed"
	WorkflowStateFailed    WorkflowState = "failed"
	WorkflowStateCanceled  WorkflowState = "cancelled"
	WorkflowStateTimedOut  WorkflowState = "timed_out"
)

type WorkflowRun struct {
	RunID              string
	RequestID          string
	TraceID            string
	PlanID             string
	Mode               WorkflowMode
	Branch             string
	State              WorkflowState
	HandoffChain       []HandoffStep
	Steps              []WorkflowStep
	ContextProjections []StepOutputProjection
}

type HandoffStep struct {
	Target       string
	PayloadKind  string
	AllowedTools []string
	SelectedTool string
}

type WorkflowStep struct {
	StepID            string
	SpanKind          string
	ParentStepID      string
	Target            string
	ToolName          string
	Outcome           string
	ResultStatus      string
	RetryCount        int
	AttemptCount      int
	RuntimeRetryCount int
	FailCloseReason   string
}

func (run WorkflowRun) HandoffChainMaps() []map[string]any {
	if run.Mode != WorkflowModeSingleHandoff && run.Mode != WorkflowModeMultiStep {
		return []map[string]any{}
	}
	items := make([]map[string]any, 0, len(run.HandoffChain))
	for _, handoff := range run.HandoffChain {
		items = append(items, handoff.Map())
	}
	return items
}

func (handoff HandoffStep) Map() map[string]any {
	item := map[string]any{
		"target":        handoff.Target,
		"payload_kind":  handoff.PayloadKind,
		"allowed_tools": append([]string{}, handoff.AllowedTools...),
	}
	if handoff.SelectedTool != "" {
		item["selected_tool"] = handoff.SelectedTool
	}
	return item
}

func (run WorkflowRun) StepMaps() []map[string]any {
	items := make([]map[string]any, 0, len(run.Steps))
	for _, step := range run.Steps {
		items = append(items, step.Map())
	}
	return items
}

func (run WorkflowRun) ContextProjectionMaps() []map[string]any {
	return WorkflowContextProjectionMaps(run.ContextProjections)
}

func (step WorkflowStep) Map() map[string]any {
	item := map[string]any{
		"step_id":        step.StepID,
		"span_kind":      step.SpanKind,
		"parent_step_id": step.ParentStepID,
		"outcome":        step.Outcome,
	}
	if step.Target != "" {
		item["target"] = step.Target
	}
	if step.ToolName != "" {
		item["tool_name"] = step.ToolName
	}
	if step.ResultStatus != "" {
		item["result_status"] = step.ResultStatus
	}
	if step.SpanKind == "tool_call" || step.StepID == "tool_call" {
		item["retry_count"] = step.RetryCount
	}
	if step.AttemptCount > 0 {
		item["attempt_count"] = step.AttemptCount
	}
	if step.RuntimeRetryCount > 0 || step.StepID == "finalization" {
		item["runtime_retry_count"] = step.RuntimeRetryCount
	}
	if step.FailCloseReason != "" {
		item["fail_close_reason"] = step.FailCloseReason
	}
	return item
}
