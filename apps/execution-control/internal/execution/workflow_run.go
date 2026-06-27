package execution

type WorkflowMode string

const (
	WorkflowModeTerminal   WorkflowMode = "terminal"
	WorkflowModeSingleStep WorkflowMode = "single_step"
	WorkflowModeMultiStep  WorkflowMode = "multi_step"
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
	ToolInvocations    []ToolInvocation
	ContextProjections []StepOutputProjection
	ToolCallSummaries  []ToolCallSummary
}

type HandoffStep struct {
	ToolTarget   string
	TaskQueue    string
	PayloadKind  string
	AllowedTools []string
	SelectedTool string
}

type WorkflowStep struct {
	StepID            string
	SpanKind          string
	ParentStepID      string
	ToolTarget        string
	ToolName          string
	Outcome           string
	ResultStatus      string
	RetryCount        int
	AttemptCount      int
	RuntimeRetryCount int
	FailCloseReason   string
}

type ToolInvocation struct {
	InvocationID       string
	ParentInvocationID string
	WorkflowRunRef     string
	StepID             string
	ToolTarget         string
	TaskQueue          string
	Status             string
	AllowedTools       []string
	UsedTools          []string
	ProjectionIDs      []string
	FailCloseReason    string
}

type ToolCallSummary struct {
	ToolCallID                 string
	WorkflowRunRef             string
	StepID                     string
	LifecycleState             string
	ResultProjection           string
	RawResultIncluded          bool
	ToolName                   string
	ToolTarget                 string
	ResultStatus               string
	BusinessOutcome            string
	FailCloseReason            string
	AccessDecision             string
	ArgumentSummary            map[string]any
	SourceIDs                  []string
	SafeDetails                map[string]any
	ProviderToolCallProjection map[string]any
}

func (run WorkflowRun) HandoffChainMaps() []map[string]any {
	if run.Mode != WorkflowModeSingleStep && run.Mode != WorkflowModeMultiStep {
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
		"tool":          handoff.ToolTarget,
		"task_queue":    handoff.TaskQueue,
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

func (run WorkflowRun) ToolInvocationMaps() []map[string]any {
	items := make([]map[string]any, 0, len(run.ToolInvocations))
	for _, invocation := range run.ToolInvocations {
		items = append(items, invocation.Map())
	}
	return items
}

func (run WorkflowRun) ToolCallSummaryMaps() []map[string]any {
	items := make([]map[string]any, 0, len(run.ToolCallSummaries))
	for _, summary := range run.ToolCallSummaries {
		items = append(items, summary.Map())
	}
	return items
}

func (step WorkflowStep) Map() map[string]any {
	item := map[string]any{
		"step_id":        step.StepID,
		"span_kind":      step.SpanKind,
		"parent_step_id": step.ParentStepID,
		"outcome":        step.Outcome,
	}
	if step.ToolTarget != "" {
		item["tool"] = step.ToolTarget
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

func (invocation ToolInvocation) Map() map[string]any {
	item := map[string]any{
		"invocation_id":    invocation.InvocationID,
		"workflow_run_ref": invocation.WorkflowRunRef,
		"step_id":          invocation.StepID,
		"tool_id":          invocation.ToolTarget,
		"task_queue":       invocation.TaskQueue,
		"status":           invocation.Status,
		"allowed_tools":    append([]string{}, invocation.AllowedTools...),
		"used_tools":       append([]string{}, invocation.UsedTools...),
		"projection_ids":   append([]string{}, invocation.ProjectionIDs...),
	}
	if invocation.ParentInvocationID != "" {
		item["parent_invocation_id"] = invocation.ParentInvocationID
	}
	if invocation.FailCloseReason != "" {
		item["fail_close_reason"] = invocation.FailCloseReason
	}
	return item
}

func (summary ToolCallSummary) Map() map[string]any {
	item := map[string]any{
		"schema_version":      "tool-call-summary-v1",
		"tool_call_id":        summary.ToolCallID,
		"workflow_run_ref":    summary.WorkflowRunRef,
		"step_id":             summary.StepID,
		"lifecycle_state":     summary.LifecycleState,
		"result_projection":   summary.ResultProjection,
		"raw_result_included": summary.RawResultIncluded,
		"tool_name":           summary.ToolName,
		"tool":                summary.ToolTarget,
		"result_status":       summary.ResultStatus,
		"argument_summary":    cloneAnyMap(summary.ArgumentSummary),
		"source_ids":          append([]string{}, summary.SourceIDs...),
	}
	if summary.BusinessOutcome != "" {
		item["business_outcome"] = summary.BusinessOutcome
	}
	if summary.FailCloseReason != "" {
		item["fail_close_reason"] = summary.FailCloseReason
	}
	if summary.AccessDecision != "" {
		item["access_decision"] = summary.AccessDecision
	}
	if len(summary.SafeDetails) > 0 {
		item["safe_details"] = cloneAnyMap(summary.SafeDetails)
	}
	if len(summary.ProviderToolCallProjection) > 0 {
		item["provider_tool_call_projection"] = cloneAnyMap(summary.ProviderToolCallProjection)
	}
	return item
}
