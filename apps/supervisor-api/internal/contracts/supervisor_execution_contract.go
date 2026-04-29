// AUTO-GENERATED FROM supervisor-execution.openapi.yaml. Do not edit by hand.

package contracts

const (
	BridgeVersion                       = "supervisor_bridge_v6"
	ResponseContract                    = "agent_response"
	RuntimeDecisionsSchemaVersion       = "supervisor-runtime-decisions-v1"
	RuntimeDecisionSummarySchemaVersion = "runtime-decision-summary-v1"
	WorkflowTraceSummaryVersion         = "workflow-trace-summary-v1"
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

type SupervisorResponseWire struct {
	SelectedTarget       *AgentTarget     `json:"selected_target"`
	Status               SupervisorStatus `json:"status"`
	AnswerText           string           `json:"answer_text"`
	FollowUpQuestion     string           `json:"follow_up_question"`
	Confidence           ConfidenceLevel  `json:"confidence"`
	Result               map[string]any   `json:"result"`
	Error                map[string]any   `json:"error"`
	Observability        map[string]any   `json:"observability,omitempty"`
	WorkflowTraceSummary map[string]any   `json:"workflow_trace_summary,omitempty"`
	TraceID              string           `json:"trace_id"`
}
