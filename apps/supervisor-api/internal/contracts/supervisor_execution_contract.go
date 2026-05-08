// AUTO-GENERATED FROM supervisor-execution.openapi.yaml. Do not edit by hand.

package contracts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

const (
	BridgeVersion                       = "supervisor_bridge_v6"
	ResponseContract                    = "agent_response"
	RuntimeDecisionsSchemaVersion       = "supervisor-runtime-decisions-v1"
	RuntimeDecisionSummarySchemaVersion = "runtime-decision-summary-v1"
	WorkflowTraceSummaryVersion         = "workflow-trace-summary-v4"
)

type AgentTarget string

const (
	AgentTargetRagAgent            AgentTarget = "rag-agent"
	AgentTargetNavigationAgent     AgentTarget = "navigation-agent"
	AgentTargetCampusServicesAgent AgentTarget = "campus-services-agent"
	AgentTargetNoticeAgent         AgentTarget = "notice-agent"
)

type RequestedCapability string

const (
	RequestedCapabilityKnowledge      RequestedCapability = "knowledge"
	RequestedCapabilityPlaceLookup    RequestedCapability = "place_lookup"
	RequestedCapabilityCampusServices RequestedCapability = "campus_services"
	RequestedCapabilityNotice         RequestedCapability = "notice"
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

type SupervisorStatus string

const (
	SupervisorStatusCompleted          SupervisorStatus = "completed"
	SupervisorStatusNeedsClarification SupervisorStatus = "needs_clarification"
	SupervisorStatusNoAnswer           SupervisorStatus = "no_answer"
	SupervisorStatusError              SupervisorStatus = "error"
	SupervisorStatusRejected           SupervisorStatus = "rejected"
	SupervisorStatusApprovalRequired   SupervisorStatus = "approval_required"
	SupervisorStatusCancelled          SupervisorStatus = "cancelled"
)

type WorkflowMode string

const (
	WorkflowModeTerminal      WorkflowMode = "terminal"
	WorkflowModeDirectRuntime WorkflowMode = "direct_runtime"
	WorkflowModeSingleHandoff WorkflowMode = "single_handoff"
	WorkflowModeMultiStep     WorkflowMode = "multi_step"
)

type StepOutputProjectionKind string

const (
	StepOutputProjectionKindNoticeContext     StepOutputProjectionKind = "notice_context"
	StepOutputProjectionKindNoticeChangeSet   StepOutputProjectionKind = "notice_change_set"
	StepOutputProjectionKindScheduleBaseline  StepOutputProjectionKind = "schedule_baseline"
	StepOutputProjectionKindServiceGuideFacts StepOutputProjectionKind = "service_guide_facts"
	StepOutputProjectionKindPlaceContext      StepOutputProjectionKind = "place_context"
	StepOutputProjectionKindEvidenceBundle    StepOutputProjectionKind = "evidence_bundle"
	StepOutputProjectionKindGroundingVerdict  StepOutputProjectionKind = "grounding_verdict"
)

type RuntimeDecisionSummaryWire struct {
	SchemaVersion          string         `json:"schema_version"`
	ScopeGateDecision      string         `json:"scope_gate_decision,omitempty"`
	PolicyGateDecision     string         `json:"policy_gate_decision,omitempty"`
	ContextPreflightState  string         `json:"context_preflight_state,omitempty"`
	RoutingNextAction      string         `json:"routing_next_action,omitempty"`
	PlanningOutcome        string         `json:"planning_outcome"`
	SelectedTarget         string         `json:"selected_target,omitempty"`
	SelectedTool           string         `json:"selected_tool,omitempty"`
	TerminalOutcome        string         `json:"terminal_outcome,omitempty"`
	FailCloseReason        string         `json:"fail_close_reason,omitempty"`
	RuntimeVersions        map[string]any `json:"runtime_versions,omitempty"`
	PolicyArtifactVersions map[string]any `json:"policy_artifact_versions,omitempty"`
}

type WorkflowPlanStepWire struct {
	StepID       string   `json:"step_id"`
	StepKind     string   `json:"step_kind"`
	Target       string   `json:"target,omitempty"`
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

type WorkflowAgentContextWire struct {
	SchemaVersion           string                          `json:"schema_version"`
	Visibility              string                          `json:"visibility"`
	WorkflowRunRef          string                          `json:"workflow_run_ref"`
	StepID                  string                          `json:"step_id"`
	AgentID                 AgentTarget                     `json:"agent_id"`
	Target                  AgentTarget                     `json:"target,omitempty"`
	RequiredProjectionKind  StepOutputProjectionKind        `json:"required_projection_kind,omitempty"`
	ExpectedOutputArtifacts []StepOutputProjectionKind      `json:"expected_output_artifacts"`
	ProjectionRefs          []WorkflowContextProjectionWire `json:"projection_refs"`
}

type WorkflowPlanWire struct {
	SchemaVersion       string                 `json:"schema_version"`
	PlanID              string                 `json:"plan_id"`
	WorkflowMode        WorkflowMode           `json:"workflow_mode"`
	AllowedAgents       []AgentTarget          `json:"allowed_agents"`
	Steps               []WorkflowPlanStepWire `json:"steps"`
	Edges               []WorkflowPlanEdgeWire `json:"edges"`
	TerminalPolicy      map[string]any         `json:"terminal_policy"`
	ResumePolicy        map[string]any         `json:"resume_policy"`
	SemanticRetryPolicy map[string]any         `json:"semantic_retry_policy"`
}

type AgentInvocationWire struct {
	InvocationID       string      `json:"invocation_id"`
	ParentInvocationID string      `json:"parent_invocation_id,omitempty"`
	WorkflowRunRef     string      `json:"workflow_run_ref"`
	StepID             string      `json:"step_id"`
	AgentID            AgentTarget `json:"agent_id"`
	Status             string      `json:"status"`
	AllowedTools       []string    `json:"allowed_tools"`
	UsedTools          []string    `json:"used_tools"`
	ProjectionIDs      []string    `json:"projection_ids"`
	FailCloseReason    string      `json:"fail_close_reason,omitempty"`
}

type RuntimeDecisionsWire struct {
	SchemaVersion          string                     `json:"schema_version"`
	EffectiveCapability    RequestedCapability        `json:"effective_capability"`
	Lane                   string                     `json:"lane"`
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

type BridgeV6RequestWire struct {
	BridgeVersion       string               `json:"bridge_version"`
	ResponseContract    string               `json:"response_contract"`
	UserGoal            string               `json:"user_goal"`
	ConversationID      string               `json:"conversation_id,omitempty"`
	RequestID           string               `json:"request_id"`
	SafetyIdentifier    *string              `json:"safety_identifier,omitempty"`
	EffectiveCapability RequestedCapability  `json:"effective_capability"`
	Lane                string               `json:"lane"`
	RequestedCapability RequestedCapability  `json:"requested_capability"`
	RequestedScope      map[string]any       `json:"requested_scope,omitempty"`
	Trace               map[string]any       `json:"trace"`
	Actor               map[string]any       `json:"actor"`
	Context             map[string]any       `json:"context"`
	VersionQuery        map[string]any       `json:"version_query"`
	RuntimeDecisions    RuntimeDecisionsWire `json:"runtime_decisions"`
}

type AgentRequestWire struct {
	Target           AgentTarget               `json:"target"`
	UserGoal         string                    `json:"user_goal"`
	ConversationID   string                    `json:"conversation_id,omitempty"`
	RequestID        string                    `json:"request_id,omitempty"`
	SafetyIdentifier *string                   `json:"safety_identifier,omitempty"`
	Trace            map[string]any            `json:"trace,omitempty"`
	Actor            map[string]any            `json:"actor,omitempty"`
	Context          map[string]any            `json:"context,omitempty"`
	WorkflowContext  *WorkflowAgentContextWire `json:"workflow_context,omitempty"`
	Payload          map[string]any            `json:"payload"`
	AllowedTools     []string                  `json:"allowed_tools"`
}

type WorkflowTraceSummaryWire struct {
	RoutingFrame                map[string]any                  `json:"routing_frame"`
	ContextResolution           map[string]any                  `json:"context_resolution"`
	PlanningOutcome             string                          `json:"planning_outcome"`
	DirectVsDelegateBranch      string                          `json:"direct_vs_delegate_branch"`
	WorkflowMode                WorkflowMode                    `json:"workflow_mode"`
	Handoff                     map[string]any                  `json:"handoff"`
	HandoffChain                []map[string]any                `json:"handoff_chain"`
	AgentInvocations            []AgentInvocationWire           `json:"agent_invocations"`
	SelectedTarget              *string                         `json:"selected_target"`
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

type SupervisorResponseWire struct {
	SelectedTarget       *AgentTarget              `json:"selected_target"`
	Status               SupervisorStatus          `json:"status"`
	AnswerText           string                    `json:"answer_text"`
	FollowUpQuestion     string                    `json:"follow_up_question"`
	Confidence           ConfidenceLevel           `json:"confidence"`
	Result               map[string]any            `json:"result"`
	Error                map[string]any            `json:"error"`
	Observability        map[string]any            `json:"observability,omitempty"`
	WorkflowTraceSummary *WorkflowTraceSummaryWire `json:"workflow_trace_summary,omitempty"`
	TraceID              string                    `json:"trace_id"`
}

func DecodeBridgeV6RequestWireJSON(data []byte) (BridgeV6RequestWire, error) {
	var wire BridgeV6RequestWire
	if err := decodeStrictJSON(data, &wire); err != nil {
		return wire, err
	}
	if err := wire.Validate(); err != nil {
		return wire, err
	}
	return wire, nil
}

func DecodeSupervisorResponseWireJSON(data []byte) (SupervisorResponseWire, error) {
	var wire SupervisorResponseWire
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

func (wire BridgeV6RequestWire) Validate() error {
	if wire.BridgeVersion != BridgeVersion {
		return fmt.Errorf("bridge_version must be %s", BridgeVersion)
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
	if !wire.EffectiveCapability.Valid() {
		return fmt.Errorf("effective_capability is invalid")
	}
	if !wire.RequestedCapability.Valid() {
		return fmt.Errorf("requested_capability is invalid")
	}
	if wire.Lane == "" {
		return fmt.Errorf("lane is required")
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
	if wire.VersionQuery == nil {
		return fmt.Errorf("version_query is required")
	}
	if err := wire.RuntimeDecisions.Validate(); err != nil {
		return fmt.Errorf("runtime_decisions: %w", err)
	}
	return nil
}

func (wire RuntimeDecisionsWire) Validate() error {
	if wire.SchemaVersion != RuntimeDecisionsSchemaVersion {
		return fmt.Errorf("schema_version must be %s", RuntimeDecisionsSchemaVersion)
	}
	if !wire.EffectiveCapability.Valid() {
		return fmt.Errorf("effective_capability is invalid")
	}
	if wire.Lane == "" {
		return fmt.Errorf("lane is required")
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
	if wire.AllowedAgents == nil {
		return fmt.Errorf("allowed_agents is required")
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
	if wire.SelectedTarget == nil || *wire.SelectedTarget == "" {
		return fmt.Errorf("selected_target is required")
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

func (wire SupervisorResponseWire) Validate() error {
	if wire.SelectedTarget != nil && !wire.SelectedTarget.Valid() {
		return fmt.Errorf("selected_target is invalid")
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
		if _, ok := wire.Error["code"].(string); !ok {
			return fmt.Errorf("error.code is required")
		}
		if _, ok := wire.Error["message"].(string); !ok {
			return fmt.Errorf("error.message is required")
		}
	}
	if wire.WorkflowTraceSummary != nil {
		if err := wire.WorkflowTraceSummary.Validate(); err != nil {
			return fmt.Errorf("workflow_trace_summary: %w", err)
		}
	}
	return nil
}

func (value AgentTarget) Valid() bool {
	switch value {
	case AgentTargetRagAgent, AgentTargetNavigationAgent, AgentTargetCampusServicesAgent, AgentTargetNoticeAgent:
		return true
	default:
		return false
	}
}

func (value RequestedCapability) Valid() bool {
	switch value {
	case RequestedCapabilityKnowledge, RequestedCapabilityPlaceLookup, RequestedCapabilityCampusServices, RequestedCapabilityNotice:
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

func (value SupervisorStatus) Valid() bool {
	switch value {
	case SupervisorStatusCompleted, SupervisorStatusNeedsClarification, SupervisorStatusNoAnswer, SupervisorStatusError, SupervisorStatusRejected, SupervisorStatusApprovalRequired, SupervisorStatusCancelled:
		return true
	default:
		return false
	}
}

func (value WorkflowMode) Valid() bool {
	switch value {
	case WorkflowModeTerminal, WorkflowModeDirectRuntime, WorkflowModeSingleHandoff, WorkflowModeMultiStep:
		return true
	default:
		return false
	}
}

func (value StepOutputProjectionKind) Valid() bool {
	switch value {
	case StepOutputProjectionKindNoticeContext,
		StepOutputProjectionKindScheduleBaseline,
		StepOutputProjectionKindServiceGuideFacts,
		StepOutputProjectionKindPlaceContext,
		StepOutputProjectionKindEvidenceBundle,
		StepOutputProjectionKindGroundingVerdict:
		return true
	default:
		return false
	}
}
