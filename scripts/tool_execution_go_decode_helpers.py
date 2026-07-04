from __future__ import annotations

from collections.abc import Iterable


def go_decode_helpers(
    tool_ids: Iterable[str],
    requested_tools: Iterable[str],
    workflow_modes: Iterable[str],
    projection_kinds: Iterable[str],
    stage_timing_fields: Iterable[str],
    debug_trace_sinks: Iterable[str],
) -> str:
    tool_id_cases = ", ".join(f"ToolID{_go_const_suffix(value)}" for value in tool_ids)
    requested_tool_cases = ", ".join(
        f"RequestedTool{_go_const_suffix(value)}" for value in requested_tools
    )
    workflow_mode_cases = ", ".join(
        f"WorkflowMode{_go_const_suffix(value)}" for value in workflow_modes
    )
    projection_kind_cases = ",\n\t\t".join(
        f"StepOutputProjectionKind{_go_const_suffix(value)}" for value in projection_kinds
    )
    stage_timing_field_cases = ",\n\t\t".join(
        f"StageTimingField{_go_const_suffix(value)}" for value in stage_timing_fields
    )
    debug_trace_sink_cases = ", ".join(
        f"DebugTraceSink{_go_const_suffix(value)}" for value in debug_trace_sinks
    )
    template = """
func DecodeToolExecutionRequestWireJSON(data []byte) (ToolExecutionRequestWire, error) {
\tvar wire ToolExecutionRequestWire
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func DecodeToolExecutionResponseWireJSON(data []byte) (ToolExecutionResponseWire, error) {
\tvar wire ToolExecutionResponseWire
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

func (wire ToolExecutionRequestWire) Validate() error {
\tif wire.ExecutionContractVersion != ExecutionContractVersion {
\t\treturn fmt.Errorf("execution_contract_version must be %s", ExecutionContractVersion)
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
\tif !wire.EffectiveTool.Valid() {
\t\treturn fmt.Errorf("effective_tool is invalid")
\t}
\tif !wire.RequestedTool.Valid() {
\t\treturn fmt.Errorf("requested_tool is invalid")
\t}
\tif wire.TaskQueue == "" {
\t\treturn fmt.Errorf("task_queue is required")
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
\tif _, ok := wire.Context["profile_memory"]; ok {
\t\treturn fmt.Errorf("context.profile_memory is not an active online recall field")
\t}
\tif wire.VersionQuery == nil {
\t\treturn fmt.Errorf("version_query is required")
\t}
\tif wire.RuntimeDecisions != nil {
\t\tif err := wire.RuntimeDecisions.Validate(); err != nil {
\t\t\treturn fmt.Errorf("runtime_decisions: %w", err)
\t\t}
\t}
\treturn nil
}

func (wire RuntimeDecisionsWire) Validate() error {
\tif wire.SchemaVersion != RuntimeDecisionsSchemaVersion {
\t\treturn fmt.Errorf("schema_version must be %s", RuntimeDecisionsSchemaVersion)
\t}
\tif !wire.EffectiveTool.Valid() {
\t\treturn fmt.Errorf("effective_tool is invalid")
\t}
\tif wire.TaskQueue == "" {
\t\treturn fmt.Errorf("task_queue is required")
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
\tif wire.AllowedTools == nil {
\t\treturn fmt.Errorf("allowed_tools is required")
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
\tif wire.SelectedTool == nil || *wire.SelectedTool == "" {
\t\treturn fmt.Errorf("selected_tool is required")
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
\t\tif !projection.ProjectionKind.Valid() {
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

func (wire ToolExecutionResponseWire) Validate() error {
\tif wire.SelectedTool != nil && !wire.SelectedTool.Valid() {
\t\treturn fmt.Errorf("selected_tool is invalid")
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
\t\tif code, ok := wire.Error["code"].(string); !ok || code == "" {
\t\t\treturn fmt.Errorf("error.code is required")
\t\t}
\t\tif message, ok := wire.Error["message"].(string); !ok || message == "" {
\t\t\treturn fmt.Errorf("error.message is required")
\t\t}
\t\tif _, ok := wire.Error["retryable"].(bool); !ok {
\t\t\treturn fmt.Errorf("error.retryable is required")
\t\t}
\t}
\tif wire.WorkflowTraceSummary != nil {
\t\tif err := wire.WorkflowTraceSummary.Validate(); err != nil {
\t\t\treturn fmt.Errorf("workflow_trace_summary: %w", err)
\t\t}
\t}
\tif wire.StageTiming != nil {
\t\tif err := wire.StageTiming.Validate(); err != nil {
\t\t\treturn fmt.Errorf("stage_timing: %w", err)
\t\t}
\t}
\tfor index, ref := range wire.DebugTraceRefs {
\t\tif err := ref.Validate(); err != nil {
\t\t\treturn fmt.Errorf("debug_trace_refs[%d]: %w", index, err)
\t\t}
\t}
\treturn nil
}

func (wire StageTimingWire) Validate() error {
\tfor field, durationMs := range wire {
\t\tif !field.Valid() {
\t\t\treturn fmt.Errorf("%s is not an allowed stage timing field", field)
\t\t}
\t\tif durationMs < 0 || math.IsNaN(durationMs) || math.IsInf(durationMs, 0) {
\t\t\treturn fmt.Errorf("%s must be a finite non-negative duration", field)
\t\t}
\t}
\treturn nil
}

func (wire DebugTraceRefWire) Validate() error {
\tif !wire.Sink.Valid() {
\t\treturn fmt.Errorf("sink is invalid")
\t}
\tif wire.TraceRef == "" {
\t\treturn fmt.Errorf("trace_ref is required")
\t}
\treturn nil
}

func (value ToolID) Valid() bool {
\tswitch value {
\tcase __TOOL_ID_CASES__:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value RequestedTool) Valid() bool {
\tswitch value {
\tcase __REQUESTED_TOOL_CASES__:
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

func (value ExecutionStatus) Valid() bool {
\tswitch value {
\tcase ExecutionStatusCompleted, ExecutionStatusNeedsClarification, ExecutionStatusNoAnswer, ExecutionStatusError, ExecutionStatusRejected, ExecutionStatusApprovalRequired, ExecutionStatusCancelled:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value WorkflowMode) Valid() bool {
\tswitch value {
\tcase __WORKFLOW_MODE_CASES__:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value StepOutputProjectionKind) Valid() bool {
\tswitch value {
\tcase StepOutputProjectionKindNoticeContext,
\t\tStepOutputProjectionKindScheduleBaseline,
\t\tStepOutputProjectionKindServiceGuideFacts,
\t\tStepOutputProjectionKindPlaceContext,
\t\tStepOutputProjectionKindEvidenceBundle,
\t\tStepOutputProjectionKindGroundingVerdict:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value StageTimingField) Valid() bool {
\tswitch value {
\tcase __STAGE_TIMING_FIELD_CASES__:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value DebugTraceSink) Valid() bool {
\tswitch value {
\tcase __DEBUG_TRACE_SINK_CASES__:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}
"""
    legacy_projection_kind_cases = "\n".join(
        (
            "StepOutputProjectionKindNoticeContext,",
            "\t\tStepOutputProjectionKindScheduleBaseline,",
            "\t\tStepOutputProjectionKindServiceGuideFacts,",
            "\t\tStepOutputProjectionKindPlaceContext,",
            "\t\tStepOutputProjectionKindEvidenceBundle,",
            "\t\tStepOutputProjectionKindGroundingVerdict",
        )
    )
    result = (
        template.replace("__TOOL_ID_CASES__", tool_id_cases)
        .replace("__REQUESTED_TOOL_CASES__", requested_tool_cases)
        .replace("__WORKFLOW_MODE_CASES__", workflow_mode_cases)
        .replace("__STAGE_TIMING_FIELD_CASES__", stage_timing_field_cases)
        .replace("__DEBUG_TRACE_SINK_CASES__", debug_trace_sink_cases)
    )
    if legacy_projection_kind_cases not in result:
        raise ValueError("StepOutputProjectionKind Valid template block drifted")
    return result.replace(legacy_projection_kind_cases, projection_kind_cases)


def _go_const_suffix(value: str) -> str:
    normalized = value.replace(".", "-").replace("_", "-")
    return "".join(part[:1].upper() + part[1:] for part in normalized.split("-") if part)
