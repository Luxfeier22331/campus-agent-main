from __future__ import annotations


def go_decode_helpers() -> str:
    return """
func DecodeBridgeV6RequestWireJSON(data []byte) (BridgeV6RequestWire, error) {
\tvar wire BridgeV6RequestWire
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func DecodeSupervisorResponseWireJSON(data []byte) (SupervisorResponseWire, error) {
\tvar wire SupervisorResponseWire
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func decodeStrictJSON(data []byte, target any) error {
\tdecoder := json.NewDecoder(bytes.NewReader(data))
\tdecoder.DisallowUnknownFields()
\tif err := decoder.Decode(target); err != nil {
\t\treturn err
\t}
\tvar trailing any
\tif err := decoder.Decode(&trailing); err != io.EOF {
\t\treturn fmt.Errorf("unexpected trailing JSON content")
\t}
\treturn nil
}

func (wire BridgeV6RequestWire) Validate() error {
\tif wire.BridgeVersion != BridgeVersion {
\t\treturn fmt.Errorf("bridge_version must be %s", BridgeVersion)
\t}
\tif wire.ResponseContract != ResponseContract {
\t\treturn fmt.Errorf("response_contract must be %s", ResponseContract)
\t}
\tif wire.UserGoal == "" {
\t\treturn fmt.Errorf("user_goal is required")
\t}
\tif wire.RequestID == "" {
\t\treturn fmt.Errorf("request_id is required")
\t}
\tif !wire.EffectiveCapability.Valid() {
\t\treturn fmt.Errorf("effective_capability is invalid")
\t}
\tif !wire.RequestedCapability.Valid() {
\t\treturn fmt.Errorf("requested_capability is invalid")
\t}
\tif wire.Lane == "" {
\t\treturn fmt.Errorf("lane is required")
\t}
\tif len(wire.Trace) == 0 {
\t\treturn fmt.Errorf("trace is required")
\t}
\tif wire.Actor == nil {
\t\treturn fmt.Errorf("actor is required")
\t}
\tif wire.Context == nil {
\t\treturn fmt.Errorf("context is required")
\t}
\tif wire.VersionQuery == nil {
\t\treturn fmt.Errorf("version_query is required")
\t}
\tif err := wire.RuntimeDecisions.Validate(); err != nil {
\t\treturn fmt.Errorf("runtime_decisions: %w", err)
\t}
\treturn nil
}

func (wire RuntimeDecisionsWire) Validate() error {
\tif wire.SchemaVersion != RuntimeDecisionsSchemaVersion {
\t\treturn fmt.Errorf("schema_version must be %s", RuntimeDecisionsSchemaVersion)
\t}
\tif !wire.EffectiveCapability.Valid() {
\t\treturn fmt.Errorf("effective_capability is invalid")
\t}
\tif wire.Lane == "" {
\t\treturn fmt.Errorf("lane is required")
\t}
\tif wire.RoutingFrame == nil {
\t\treturn fmt.Errorf("routing_frame is required")
\t}
\tif err := wire.RuntimeDecisionSummary.Validate(); err != nil {
\t\treturn fmt.Errorf("runtime_decision_summary: %w", err)
\t}
\tif wire.WorkflowPlan != nil {
\t\tif err := wire.WorkflowPlan.Validate(); err != nil {
\t\t\treturn fmt.Errorf("workflow_plan: %w", err)
\t\t}
\t}
\treturn nil
}

func (wire RuntimeDecisionSummaryWire) Validate() error {
\tif wire.SchemaVersion != RuntimeDecisionSummarySchemaVersion {
\t\treturn fmt.Errorf("schema_version must be %s", RuntimeDecisionSummarySchemaVersion)
\t}
\tif wire.PlanningOutcome == "" {
\t\treturn fmt.Errorf("planning_outcome is required")
\t}
\treturn nil
}

func (wire WorkflowPlanWire) Validate() error {
\tif wire.SchemaVersion != "workflow-plan-v1" {
\t\treturn fmt.Errorf("schema_version must be workflow-plan-v1")
\t}
\tif wire.PlanID == "" {
\t\treturn fmt.Errorf("plan_id is required")
\t}
\tif !wire.WorkflowMode.Valid() {
\t\treturn fmt.Errorf("workflow_mode is invalid")
\t}
\tif wire.Steps == nil {
\t\treturn fmt.Errorf("steps is required")
\t}
\tif wire.Edges == nil {
\t\treturn fmt.Errorf("edges is required")
\t}
\tif wire.TerminalPolicy == nil {
\t\treturn fmt.Errorf("terminal_policy is required")
\t}
\tif wire.ResumePolicy == nil {
\t\treturn fmt.Errorf("resume_policy is required")
\t}
\tif wire.SemanticRetryPolicy == nil {
\t\treturn fmt.Errorf("semantic_retry_policy is required")
\t}
\tfor index, step := range wire.Steps {
\t\tif step.StepID == "" {
\t\t\treturn fmt.Errorf("steps[%d].step_id is required", index)
\t\t}
\t\tif step.StepKind == "" {
\t\t\treturn fmt.Errorf("steps[%d].step_kind is required", index)
\t\t}
\t}
\tfor index, edge := range wire.Edges {
\t\tif edge.FromStepID == "" {
\t\t\treturn fmt.Errorf("edges[%d].from_step_id is required", index)
\t\t}
\t\tif edge.ToStepID == "" {
\t\t\treturn fmt.Errorf("edges[%d].to_step_id is required", index)
\t\t}
\t\tif edge.Condition == "" {
\t\t\treturn fmt.Errorf("edges[%d].condition is required", index)
\t\t}
\t}
\treturn nil
}

func (wire WorkflowTraceSummaryWire) Validate() error {
\tif wire.RoutingFrame == nil {
\t\treturn fmt.Errorf("routing_frame is required")
\t}
\tif wire.ContextResolution == nil {
\t\treturn fmt.Errorf("context_resolution is required")
\t}
\tif wire.PlanningOutcome == "" {
\t\treturn fmt.Errorf("planning_outcome is required")
\t}
\tif wire.DirectVsDelegateBranch == "" {
\t\treturn fmt.Errorf("direct_vs_delegate_branch is required")
\t}
\tif wire.WorkflowMode == "" {
\t\treturn fmt.Errorf("workflow_mode is required")
\t}
\tif !wire.WorkflowMode.Valid() {
\t\treturn fmt.Errorf("workflow_mode is invalid")
\t}
\tif wire.Handoff == nil {
\t\treturn fmt.Errorf("handoff is required")
\t}
\tif wire.HandoffChain == nil {
\t\treturn fmt.Errorf("handoff_chain is required")
\t}
\tif wire.SelectedTarget == nil || *wire.SelectedTarget == "" {
\t\treturn fmt.Errorf("selected_target is required")
\t}
\tif wire.SelectedTools == nil {
\t\treturn fmt.Errorf("selected_tools is required")
\t}
\tif wire.ContextProjections == nil {
\t\treturn fmt.Errorf("context_projections is required")
\t}
\tfor index, projection := range wire.ContextProjections {
\t\tif projection.ProjectionID == "" {
\t\t\treturn fmt.Errorf("context_projections[%d].projection_id is required", index)
\t\t}
\t\tif projection.SourceStepID == "" {
\t\t\treturn fmt.Errorf("context_projections[%d].source_step_id is required", index)
\t\t}
\t\tif projection.ProjectionKind != "notice_context" {
\t\t\treturn fmt.Errorf("context_projections[%d].projection_kind is invalid", index)
\t\t}
\t\tif projection.ContentHash == "" {
\t\t\treturn fmt.Errorf("context_projections[%d].content_hash is required", index)
\t\t}
\t}
\tif wire.ToolArgumentSummary == nil {
\t\treturn fmt.Errorf("tool_argument_summary is required")
\t}
\tif wire.GuardrailOutcomes == nil {
\t\treturn fmt.Errorf("guardrail_outcomes is required")
\t}
\tif wire.RuntimeVersions == nil {
\t\treturn fmt.Errorf("runtime_versions is required")
\t}
\tif wire.PolicyArtifactVersions == nil {
\t\treturn fmt.Errorf("policy_artifact_versions is required")
\t}
\treturn nil
}

func (wire SupervisorResponseWire) Validate() error {
\tif wire.SelectedTarget != nil && !wire.SelectedTarget.Valid() {
\t\treturn fmt.Errorf("selected_target is invalid")
\t}
\tif !wire.Status.Valid() {
\t\treturn fmt.Errorf("status is invalid")
\t}
\tif !wire.Confidence.Valid() {
\t\treturn fmt.Errorf("confidence is invalid")
\t}
\tif wire.TraceID == "" {
\t\treturn fmt.Errorf("trace_id is required")
\t}
\tif wire.Error != nil {
\t\tif _, ok := wire.Error["code"].(string); !ok {
\t\t\treturn fmt.Errorf("error.code is required")
\t\t}
\t\tif _, ok := wire.Error["message"].(string); !ok {
\t\t\treturn fmt.Errorf("error.message is required")
\t\t}
\t}
\tif wire.WorkflowTraceSummary != nil {
\t\tif err := wire.WorkflowTraceSummary.Validate(); err != nil {
\t\t\treturn fmt.Errorf("workflow_trace_summary: %w", err)
\t\t}
\t}
\treturn nil
}

func (value AgentTarget) Valid() bool {
\tswitch value {
\tcase AgentTargetRagAgent, AgentTargetNavigationAgent, AgentTargetCampusServicesAgent, AgentTargetNoticeAgent:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value RequestedCapability) Valid() bool {
\tswitch value {
\tcase RequestedCapabilityKnowledge, RequestedCapabilityPlaceLookup, RequestedCapabilityCampusServices, RequestedCapabilityNotice:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value ConfidenceLevel) Valid() bool {
\tswitch value {
\tcase ConfidenceLevelHigh, ConfidenceLevelMedium, ConfidenceLevelLow:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value DelegateStatus) Valid() bool {
\tswitch value {
\tcase DelegateStatusCompleted, DelegateStatusNeedsClarification, DelegateStatusNoAnswer, DelegateStatusError:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value SupervisorStatus) Valid() bool {
\tswitch value {
\tcase SupervisorStatusCompleted, SupervisorStatusNeedsClarification, SupervisorStatusNoAnswer, SupervisorStatusError, SupervisorStatusRejected, SupervisorStatusApprovalRequired, SupervisorStatusCancelled:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value WorkflowMode) Valid() bool {
\tswitch value {
\tcase WorkflowModeTerminal, WorkflowModeDirectRuntime, WorkflowModeSingleHandoff, WorkflowModeMultiStep:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}
"""
