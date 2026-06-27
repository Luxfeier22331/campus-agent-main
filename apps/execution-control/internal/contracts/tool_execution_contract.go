// AUTO-GENERATED FROM tool-execution.openapi.yaml. Do not edit by hand.

package contracts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

const (
	ExecutionContractVersion            = "tool_execution_v1"
	ResponseContract                    = "execution_finalization_response_v1"
	RuntimeDecisionsSchemaVersion       = "tool-execution-runtime-decisions-v1"
	RuntimeDecisionSummarySchemaVersion = "runtime-decision-summary-v1"
	WorkflowTraceSummaryVersion         = "workflow-trace-summary-v4"
)

type ToolID string

const (
	ToolIDKnowledgeQuery              ToolID = "knowledge_query"
	ToolIDPlaceLookup                 ToolID = "place_lookup"
	ToolIDTransportScheduleLookup     ToolID = "transport_schedule_lookup"
	ToolIDCampusNoticeDiscover        ToolID = "campus_notice_discover"
	ToolIDCampusNoticeChangeSetLookup ToolID = "campus_notice_change_set_lookup"
	ToolIDCampusNoticePeriodSummary   ToolID = "campus_notice_period_summary"
	ToolIDCampusNoticeGet             ToolID = "campus_notice_get"
)

type RequestedTool string

const (
	RequestedToolKnowledgeQuery              RequestedTool = "knowledge_query"
	RequestedToolPlaceLookup                 RequestedTool = "place_lookup"
	RequestedToolTransportScheduleLookup     RequestedTool = "transport_schedule_lookup"
	RequestedToolCampusNoticeDiscover        RequestedTool = "campus_notice_discover"
	RequestedToolCampusNoticeChangeSetLookup RequestedTool = "campus_notice_change_set_lookup"
	RequestedToolCampusNoticePeriodSummary   RequestedTool = "campus_notice_period_summary"
)

type ConfidenceLevel string

const (
	ConfidenceLevelHigh   ConfidenceLevel = "high"
	ConfidenceLevelMedium ConfidenceLevel = "medium"
	ConfidenceLevelLow    ConfidenceLevel = "low"
)

type DelegateStatus string

const (
	DelegateStatusCompleted          DelegateStatus = "completed"
	DelegateStatusNeedsClarification DelegateStatus = "needs_clarification"
	DelegateStatusNoAnswer           DelegateStatus = "no_answer"
	DelegateStatusError              DelegateStatus = "error"
)

type ExecutionStatus string

const (
	ExecutionStatusCompleted          ExecutionStatus = "completed"
	ExecutionStatusNeedsClarification ExecutionStatus = "needs_clarification"
	ExecutionStatusNoAnswer           ExecutionStatus = "no_answer"
	ExecutionStatusError              ExecutionStatus = "error"
	ExecutionStatusRejected           ExecutionStatus = "rejected"
	ExecutionStatusApprovalRequired   ExecutionStatus = "approval_required"
	ExecutionStatusCancelled          ExecutionStatus = "cancelled"
)

type WorkflowMode string

const (
	WorkflowModeTerminal   WorkflowMode = "terminal"
	WorkflowModeSingleStep WorkflowMode = "single_step"
	WorkflowModeMultiStep  WorkflowMode = "multi_step"
)

type StepOutputProjectionKind string

const (
	StepOutputProjectionKindNoticeContext       StepOutputProjectionKind = "notice_context"
	StepOutputProjectionKindNoticeChangeSet     StepOutputProjectionKind = "notice_change_set"
	StepOutputProjectionKindNoticePeriodSummary StepOutputProjectionKind = "notice_period_summary"
	StepOutputProjectionKindScheduleBaseline    StepOutputProjectionKind = "schedule_baseline"
	StepOutputProjectionKindPlaceContext        StepOutputProjectionKind = "place_context"
	StepOutputProjectionKindEvidenceBundle      StepOutputProjectionKind = "evidence_bundle"
	StepOutputProjectionKindGroundingVerdict    StepOutputProjectionKind = "grounding_verdict"
)

type ConversationContextWire struct {
	SchemaVersion         string           `json:"schema_version"`
	ConversationID        string           `json:"conversation_id"`
	UserMessageID         string           `json:"user_message_id"`
	ParentMessageID       *string          `json:"parent_message_id,omitempty"`
	CurrentUserMessage    map[string]any   `json:"current_user_message"`
	RecentTurns           []map[string]any `json:"recent_turns"`
	PreviousAnswerSummary *string          `json:"previous_answer_summary,omitempty"`
	PreviousEvidenceRefs  []map[string]any `json:"previous_evidence_refs"`
	PreviousToolResults   []map[string]any `json:"previous_tool_results"`
	SessionState          map[string]any   `json:"session_state"`
	Visibility            map[string]any   `json:"visibility"`
	MemoryRecall          map[string]any   `json:"memory_recall"`
	SourceAttribution     []map[string]any `json:"source_attribution"`
	ContextSummary        *string          `json:"context_summary"`
	Budget                map[string]any   `json:"budget"`
	Truncation            map[string]any   `json:"truncation"`
}

type RuntimeDecisionSummaryWire struct {
	SchemaVersion          string         `json:"schema_version"`
	ScopeGateDecision      string         `json:"scope_gate_decision,omitempty"`
	PolicyGateDecision     string         `json:"policy_gate_decision,omitempty"`
	ContextPreflightState  string         `json:"context_preflight_state,omitempty"`
	RoutingNextAction      string         `json:"routing_next_action,omitempty"`
	PlanningOutcome        string         `json:"planning_outcome"`
	SelectedTool           string         `json:"selected_tool,omitempty"`
	TaskQueue              string         `json:"task_queue,omitempty"`
	TerminalOutcome        string         `json:"terminal_outcome,omitempty"`
	FailCloseReason        string         `json:"fail_close_reason,omitempty"`
	RuntimeVersions        map[string]any `json:"runtime_versions,omitempty"`
	PolicyArtifactVersions map[string]any `json:"policy_artifact_versions,omitempty"`
}

type WorkflowPlanStepWire struct {
	StepID       string   `json:"step_id"`
	StepKind     string   `json:"step_kind"`
	Tool         string   `json:"tool,omitempty"`
	TaskQueue    string   `json:"task_queue,omitempty"`
	PayloadKind  string   `json:"payload_kind,omitempty"`
	AllowedTools []string `json:"allowed_tools,omitempty"`
	SelectedTool string   `json:"selected_tool,omitempty"`
}

type WorkflowPlanEdgeWire struct {
	FromStepID             string `json:"from_step_id"`
	ToStepID               string `json:"to_step_id"`
	Condition              string `json:"condition"`
	RequiredProjectionKind string `json:"required_projection_kind,omitempty"`
}

type ProjectionSafetySummaryWire struct {
	Truncated     bool     `json:"truncated"`
	Redacted      bool     `json:"redacted"`
	MaxChars      int      `json:"max_chars"`
	FieldsPresent []string `json:"fields_present"`
}

type StepOutputProjectionWire struct {
	ProjectionID   string                      `json:"projection_id"`
	SourceStepID   string                      `json:"source_step_id"`
	ProjectionKind string                      `json:"projection_kind"`
	ContentHash    string                      `json:"content_hash"`
	Payload        map[string]any              `json:"payload"`
	Safety         ProjectionSafetySummaryWire `json:"safety"`
}

type WorkflowContextProjectionWire struct {
	ProjectionID   string                      `json:"projection_id"`
	SourceStepID   string                      `json:"source_step_id"`
	ProjectionKind StepOutputProjectionKind    `json:"projection_kind"`
	ContentHash    string                      `json:"content_hash"`
	Safety         ProjectionSafetySummaryWire `json:"safety"`
}

type WorkflowToolContextWire struct {
	SchemaVersion           string                          `json:"schema_version"`
	Visibility              string                          `json:"visibility"`
	WorkflowRunRef          string                          `json:"workflow_run_ref"`
	StepID                  string                          `json:"step_id"`
	ToolID                  ToolID                          `json:"tool_id"`
	TaskQueue               string                          `json:"task_queue,omitempty"`
	RequiredProjectionKind  StepOutputProjectionKind        `json:"required_projection_kind,omitempty"`
	ExpectedOutputArtifacts []StepOutputProjectionKind      `json:"expected_output_artifacts"`
	ProjectionRefs          []WorkflowContextProjectionWire `json:"projection_refs"`
}

type WorkflowPlanWire struct {
	SchemaVersion       string                 `json:"schema_version"`
	PlanID              string                 `json:"plan_id"`
	WorkflowMode        WorkflowMode           `json:"workflow_mode"`
	AllowedTools        []ToolID               `json:"allowed_tools"`
	Steps               []WorkflowPlanStepWire `json:"steps"`
	Edges               []WorkflowPlanEdgeWire `json:"edges"`
	TerminalPolicy      map[string]any         `json:"terminal_policy"`
	ResumePolicy        map[string]any         `json:"resume_policy"`
	SemanticRetryPolicy map[string]any         `json:"semantic_retry_policy"`
}

type ToolInvocationWire struct {
	InvocationID       string   `json:"invocation_id"`
	ParentInvocationID string   `json:"parent_invocation_id,omitempty"`
	WorkflowRunRef     string   `json:"workflow_run_ref"`
	StepID             string   `json:"step_id"`
	ToolID             ToolID   `json:"tool_id"`
	Status             string   `json:"status"`
	AllowedTools       []string `json:"allowed_tools"`
	UsedTools          []string `json:"used_tools"`
	ProjectionIDs      []string `json:"projection_ids"`
	FailCloseReason    string   `json:"fail_close_reason,omitempty"`
}

type RuntimeDecisionsWire struct {
	SchemaVersion          string                     `json:"schema_version"`
	EffectiveTool          RequestedTool              `json:"effective_tool"`
	TaskQueue              string                     `json:"task_queue"`
	RoutingFrame           map[string]any             `json:"routing_frame"`
	RuntimeDecisionSummary RuntimeDecisionSummaryWire `json:"runtime_decision_summary"`
	ScopeGate              map[string]any             `json:"scope_gate,omitempty"`
	PolicyGate             map[string]any             `json:"policy_gate,omitempty"`
	ContextPreflight       map[string]any             `json:"context_preflight,omitempty"`
	ToolPolicy             map[string]any             `json:"tool_policy,omitempty"`
	Handoff                map[string]any             `json:"handoff,omitempty"`
	WorkflowPlan           *WorkflowPlanWire          `json:"workflow_plan,omitempty"`
	TerminalEnvelope       map[string]any             `json:"terminal_envelope,omitempty"`
}

type ToolExecutionRequestWire struct {
	ExecutionContractVersion string                `json:"execution_contract_version"`
	ResponseContract         string                `json:"response_contract"`
	UserGoal                 string                `json:"user_goal"`
	ConversationID           string                `json:"conversation_id,omitempty"`
	TenantID                 string                `json:"tenant_id,omitempty"`
	RequestID                string                `json:"request_id"`
	SafetyIdentifier         *string               `json:"safety_identifier,omitempty"`
	EffectiveTool            RequestedTool         `json:"effective_tool"`
	TaskQueue                string                `json:"task_queue"`
	RequestedTool            RequestedTool         `json:"requested_tool"`
	RequestedScope           map[string]any        `json:"requested_scope,omitempty"`
	Trace                    map[string]any        `json:"trace"`
	Actor                    map[string]any        `json:"actor"`
	Context                  map[string]any        `json:"context"`
	VersionQuery             map[string]any        `json:"version_query"`
	RuntimeDecisions         *RuntimeDecisionsWire `json:"runtime_decisions,omitempty"`
}

type ToolRequestWire struct {
	Tool             ToolID                   `json:"tool"`
	TaskQueue        string                   `json:"task_queue,omitempty"`
	UserGoal         string                   `json:"user_goal"`
	ConversationID   string                   `json:"conversation_id,omitempty"`
	RequestID        string                   `json:"request_id,omitempty"`
	SafetyIdentifier *string                  `json:"safety_identifier,omitempty"`
	Trace            map[string]any           `json:"trace,omitempty"`
	Actor            map[string]any           `json:"actor,omitempty"`
	Context          map[string]any           `json:"context,omitempty"`
	WorkflowContext  *WorkflowToolContextWire `json:"workflow_context,omitempty"`
	Payload          map[string]any           `json:"payload"`
	AllowedTools     []string                 `json:"allowed_tools"`
}

type WorkflowTraceSummaryWire struct {
	RoutingFrame                map[string]any                  `json:"routing_frame"`
	ContextResolution           map[string]any                  `json:"context_resolution"`
	PlanningOutcome             string                          `json:"planning_outcome"`
	DirectVsDelegateBranch      string                          `json:"direct_vs_delegate_branch"`
	WorkflowMode                WorkflowMode                    `json:"workflow_mode"`
	Handoff                     map[string]any                  `json:"handoff"`
	HandoffChain                []map[string]any                `json:"handoff_chain"`
	ToolInvocations             []ToolInvocationWire            `json:"tool_invocations"`
	SelectedTool                *string                         `json:"selected_tool"`
	SelectedTools               []string                        `json:"selected_tools"`
	ContextProjections          []WorkflowContextProjectionWire `json:"context_projections"`
	AnswerArtifactProjectionIDs []string                        `json:"answer_artifact_projection_ids"`
	AnswerArtifactKinds         []StepOutputProjectionKind      `json:"answer_artifact_kinds"`
	ToolArgumentSummary         map[string]any                  `json:"tool_argument_summary"`
	TraceSteps                  []map[string]any                `json:"trace_steps,omitempty"`
	ToolCallSummaries           []map[string]any                `json:"tool_call_summaries,omitempty"`
	GuardrailOutcomes           map[string]any                  `json:"guardrail_outcomes"`
	FailCloseReason             string                          `json:"fail_close_reason"`
	RuntimeVersions             map[string]any                  `json:"runtime_versions"`
	PolicyArtifactVersions      map[string]any                  `json:"policy_artifact_versions"`
}

type ToolExecutionResponseWire struct {
	SelectedTool         *ToolID                   `json:"selected_tool"`
	Status               ExecutionStatus           `json:"status"`
	AnswerText           string                    `json:"answer_text"`
	FollowUpQuestion     string                    `json:"follow_up_question"`
	Confidence           ConfidenceLevel           `json:"confidence"`
	Result               map[string]any            `json:"result"`
	Error                map[string]any            `json:"error"`
	Observability        map[string]any            `json:"observability,omitempty"`
	WorkflowTraceSummary *WorkflowTraceSummaryWire `json:"workflow_trace_summary,omitempty"`
	TraceID              string                    `json:"trace_id"`
}

func DecodeToolExecutionRequestWireJSON(data []byte) (ToolExecutionRequestWire, error) {
	var wire ToolExecutionRequestWire
	if err := decodeStrictJSON(data, &wire); err != nil {
		return wire, err
	}
	if err := wire.Validate(); err != nil {
		return wire, err
	}
	return wire, nil
}

func DecodeToolExecutionResponseWireJSON(data []byte) (ToolExecutionResponseWire, error) {
	var wire ToolExecutionResponseWire
	if err := decodeStrictJSON(data, &wire); err != nil {
		return wire, err
	}
	if err := wire.Validate(); err != nil {
		return wire, err
	}
	return wire, nil
}

func decodeStrictJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return fmt.Errorf("unexpected trailing JSON content")
	}
	return nil
}

func (wire ToolExecutionRequestWire) Validate() error {
	if wire.ExecutionContractVersion != ExecutionContractVersion {
		return fmt.Errorf("execution_contract_version must be %s", ExecutionContractVersion)
	}
	if wire.ResponseContract != ResponseContract {
		return fmt.Errorf("response_contract must be %s", ResponseContract)
	}
	if wire.UserGoal == "" {
		return fmt.Errorf("user_goal is required")
	}
	if wire.RequestID == "" {
		return fmt.Errorf("request_id is required")
	}
	if !wire.EffectiveTool.Valid() {
		return fmt.Errorf("effective_tool is invalid")
	}
	if !wire.RequestedTool.Valid() {
		return fmt.Errorf("requested_tool is invalid")
	}
	if wire.TaskQueue == "" {
		return fmt.Errorf("task_queue is required")
	}
	if len(wire.Trace) == 0 {
		return fmt.Errorf("trace is required")
	}
	if wire.Actor == nil {
		return fmt.Errorf("actor is required")
	}
	if wire.Context == nil {
		return fmt.Errorf("context is required")
	}
	if _, ok := wire.Context["profile_memory"]; ok {
		return fmt.Errorf("context.profile_memory is not an active online recall field")
	}
	if wire.VersionQuery == nil {
		return fmt.Errorf("version_query is required")
	}
	if wire.RuntimeDecisions != nil {
		if err := wire.RuntimeDecisions.Validate(); err != nil {
			return fmt.Errorf("runtime_decisions: %w", err)
		}
	}
	return nil
}

func (wire RuntimeDecisionsWire) Validate() error {
	if wire.SchemaVersion != RuntimeDecisionsSchemaVersion {
		return fmt.Errorf("schema_version must be %s", RuntimeDecisionsSchemaVersion)
	}
	if !wire.EffectiveTool.Valid() {
		return fmt.Errorf("effective_tool is invalid")
	}
	if wire.TaskQueue == "" {
		return fmt.Errorf("task_queue is required")
	}
	if wire.RoutingFrame == nil {
		return fmt.Errorf("routing_frame is required")
	}
	if err := wire.RuntimeDecisionSummary.Validate(); err != nil {
		return fmt.Errorf("runtime_decision_summary: %w", err)
	}
	if wire.WorkflowPlan != nil {
		if err := wire.WorkflowPlan.Validate(); err != nil {
			return fmt.Errorf("workflow_plan: %w", err)
		}
	}
	return nil
}

func (wire RuntimeDecisionSummaryWire) Validate() error {
	if wire.SchemaVersion != RuntimeDecisionSummarySchemaVersion {
		return fmt.Errorf("schema_version must be %s", RuntimeDecisionSummarySchemaVersion)
	}
	if wire.PlanningOutcome == "" {
		return fmt.Errorf("planning_outcome is required")
	}
	return nil
}

func (wire WorkflowPlanWire) Validate() error {
	if wire.SchemaVersion != "workflow-plan-v1" {
		return fmt.Errorf("schema_version must be workflow-plan-v1")
	}
	if wire.PlanID == "" {
		return fmt.Errorf("plan_id is required")
	}
	if !wire.WorkflowMode.Valid() {
		return fmt.Errorf("workflow_mode is invalid")
	}
	if wire.AllowedTools == nil {
		return fmt.Errorf("allowed_tools is required")
	}
	if wire.Steps == nil {
		return fmt.Errorf("steps is required")
	}
	if wire.Edges == nil {
		return fmt.Errorf("edges is required")
	}
	if wire.TerminalPolicy == nil {
		return fmt.Errorf("terminal_policy is required")
	}
	if wire.ResumePolicy == nil {
		return fmt.Errorf("resume_policy is required")
	}
	if wire.SemanticRetryPolicy == nil {
		return fmt.Errorf("semantic_retry_policy is required")
	}
	for index, step := range wire.Steps {
		if step.StepID == "" {
			return fmt.Errorf("steps[%d].step_id is required", index)
		}
		if step.StepKind == "" {
			return fmt.Errorf("steps[%d].step_kind is required", index)
		}
	}
	for index, edge := range wire.Edges {
		if edge.FromStepID == "" {
			return fmt.Errorf("edges[%d].from_step_id is required", index)
		}
		if edge.ToStepID == "" {
			return fmt.Errorf("edges[%d].to_step_id is required", index)
		}
		if edge.Condition == "" {
			return fmt.Errorf("edges[%d].condition is required", index)
		}
	}
	return nil
}

func (wire WorkflowTraceSummaryWire) Validate() error {
	if wire.RoutingFrame == nil {
		return fmt.Errorf("routing_frame is required")
	}
	if wire.ContextResolution == nil {
		return fmt.Errorf("context_resolution is required")
	}
	if wire.PlanningOutcome == "" {
		return fmt.Errorf("planning_outcome is required")
	}
	if wire.DirectVsDelegateBranch == "" {
		return fmt.Errorf("direct_vs_delegate_branch is required")
	}
	if wire.WorkflowMode == "" {
		return fmt.Errorf("workflow_mode is required")
	}
	if !wire.WorkflowMode.Valid() {
		return fmt.Errorf("workflow_mode is invalid")
	}
	if wire.Handoff == nil {
		return fmt.Errorf("handoff is required")
	}
	if wire.HandoffChain == nil {
		return fmt.Errorf("handoff_chain is required")
	}
	if wire.SelectedTool == nil || *wire.SelectedTool == "" {
		return fmt.Errorf("selected_tool is required")
	}
	if wire.SelectedTools == nil {
		return fmt.Errorf("selected_tools is required")
	}
	if wire.ContextProjections == nil {
		return fmt.Errorf("context_projections is required")
	}
	for index, projection := range wire.ContextProjections {
		if projection.ProjectionID == "" {
			return fmt.Errorf("context_projections[%d].projection_id is required", index)
		}
		if projection.SourceStepID == "" {
			return fmt.Errorf("context_projections[%d].source_step_id is required", index)
		}
		if !projection.ProjectionKind.Valid() {
			return fmt.Errorf("context_projections[%d].projection_kind is invalid", index)
		}
		if projection.ContentHash == "" {
			return fmt.Errorf("context_projections[%d].content_hash is required", index)
		}
	}
	if wire.ToolArgumentSummary == nil {
		return fmt.Errorf("tool_argument_summary is required")
	}
	if wire.GuardrailOutcomes == nil {
		return fmt.Errorf("guardrail_outcomes is required")
	}
	if wire.RuntimeVersions == nil {
		return fmt.Errorf("runtime_versions is required")
	}
	if wire.PolicyArtifactVersions == nil {
		return fmt.Errorf("policy_artifact_versions is required")
	}
	return nil
}

func (wire ToolExecutionResponseWire) Validate() error {
	if wire.SelectedTool != nil && !wire.SelectedTool.Valid() {
		return fmt.Errorf("selected_tool is invalid")
	}
	if !wire.Status.Valid() {
		return fmt.Errorf("status is invalid")
	}
	if !wire.Confidence.Valid() {
		return fmt.Errorf("confidence is invalid")
	}
	if wire.TraceID == "" {
		return fmt.Errorf("trace_id is required")
	}
	if wire.Error != nil {
		if code, ok := wire.Error["code"].(string); !ok || code == "" {
			return fmt.Errorf("error.code is required")
		}
		if message, ok := wire.Error["message"].(string); !ok || message == "" {
			return fmt.Errorf("error.message is required")
		}
		if _, ok := wire.Error["retryable"].(bool); !ok {
			return fmt.Errorf("error.retryable is required")
		}
	}
	if wire.WorkflowTraceSummary != nil {
		if err := wire.WorkflowTraceSummary.Validate(); err != nil {
			return fmt.Errorf("workflow_trace_summary: %w", err)
		}
	}
	return nil
}

func (value ToolID) Valid() bool {
	switch value {
	case ToolIDKnowledgeQuery, ToolIDPlaceLookup, ToolIDTransportScheduleLookup, ToolIDCampusNoticeDiscover, ToolIDCampusNoticeChangeSetLookup, ToolIDCampusNoticePeriodSummary, ToolIDCampusNoticeGet:
		return true
	default:
		return false
	}
}

func (value RequestedTool) Valid() bool {
	switch value {
	case RequestedToolKnowledgeQuery, RequestedToolPlaceLookup, RequestedToolTransportScheduleLookup, RequestedToolCampusNoticeDiscover, RequestedToolCampusNoticeChangeSetLookup, RequestedToolCampusNoticePeriodSummary:
		return true
	default:
		return false
	}
}

func (value ConfidenceLevel) Valid() bool {
	switch value {
	case ConfidenceLevelHigh, ConfidenceLevelMedium, ConfidenceLevelLow:
		return true
	default:
		return false
	}
}

func (value DelegateStatus) Valid() bool {
	switch value {
	case DelegateStatusCompleted, DelegateStatusNeedsClarification, DelegateStatusNoAnswer, DelegateStatusError:
		return true
	default:
		return false
	}
}

func (value ExecutionStatus) Valid() bool {
	switch value {
	case ExecutionStatusCompleted, ExecutionStatusNeedsClarification, ExecutionStatusNoAnswer, ExecutionStatusError, ExecutionStatusRejected, ExecutionStatusApprovalRequired, ExecutionStatusCancelled:
		return true
	default:
		return false
	}
}

func (value WorkflowMode) Valid() bool {
	switch value {
	case WorkflowModeTerminal, WorkflowModeSingleStep, WorkflowModeMultiStep:
		return true
	default:
		return false
	}
}

func (value StepOutputProjectionKind) Valid() bool {
	switch value {
	case StepOutputProjectionKindNoticeContext,
		StepOutputProjectionKindNoticeChangeSet,
		StepOutputProjectionKindNoticePeriodSummary,
		StepOutputProjectionKindScheduleBaseline,
		StepOutputProjectionKindPlaceContext,
		StepOutputProjectionKindEvidenceBundle,
		StepOutputProjectionKindGroundingVerdict:
		return true
	default:
		return false
	}
}
