export function goDecodeHelpers({
	answerArtifactKinds,
	requestedTools,
	stageTimingFields,
	toolIds,
	workflowModes,
}: {
	answerArtifactKinds: string[];
	requestedTools: string[];
	stageTimingFields: string[];
	toolIds: string[];
	workflowModes: string[];
}): string {
	const toolIdCases = toolIds.map((value) => `ToolID${goConstSuffix(value)}`).join(", ");
	const requestedToolCases = requestedTools
		.map((value) => `RequestedTool${goConstSuffix(value)}`)
		.join(", ");
	const workflowModeCases = workflowModes
		.map((value) => `WorkflowMode${goConstSuffix(value)}`)
		.join(", ");
	const answerArtifactKindCases = answerArtifactKinds
		.map((value) => `AnswerArtifactKind${goConstSuffix(value)}`)
		.join(", ");
	const stageTimingFieldCases = stageTimingFields
		.map((value) => `StageTimingField${goConstSuffix(value)}`)
		.join(",\n\t\t");
	const template = `
func DecodeExecutionPayloadWireJSON(data []byte) (ExecutionPayloadWire, error) {
\tvar wire ExecutionPayloadWire
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func DecodeExecutionRunCreateRequestWireJSON(data []byte) (ExecutionRunCreateRequestWire, error) {
\tvar wire ExecutionRunCreateRequestWire
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
\tif err := requireJSONObjectFields(data, []string{
\t\t"selected_tool",
\t\t"status",
\t\t"answer_text",
\t\t"follow_up_question",
\t\t"confidence",
\t\t"result",
\t\t"error",
\t\t"resolved_targets",
\t\t"session_update",
\t\t"trace_id",
\t}); err != nil {
\t\treturn wire, err
\t}
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

func requireJSONObjectFields(data []byte, fields []string) error {
\tvar payload map[string]json.RawMessage
\tif err := json.Unmarshal(data, &payload); err != nil {
\t\treturn err
\t}
\tif payload == nil {
\t\treturn fmt.Errorf("expected JSON object")
\t}
\tfor _, field := range fields {
\t\tif _, ok := payload[field]; !ok {
\t\t\treturn fmt.Errorf("%s is required", field)
\t\t}
\t}
\treturn nil
}

func (wire ExecutionPayloadWire) Validate() error {
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
\tif wire.ConversationID == "" {
\t\treturn fmt.Errorf("conversation_id is required")
\t}
\tif wire.RequestedTool != "" && !wire.RequestedTool.Valid() {
\t\treturn fmt.Errorf("requested_tool is invalid")
\t}
\tif wire.Trace.TraceID == "" {
\t\treturn fmt.Errorf("trace.trace_id is required")
\t}
\tif wire.Context == nil {
\t\treturn fmt.Errorf("context is required")
\t}
\tif _, ok := wire.Context["profile_memory"]; ok {
\t\treturn fmt.Errorf("context.profile_memory is not an active online recall field")
\t}
\treturn nil
}

func (wire ExecutionRunCreateRequestWire) Validate() error {
\tif wire.RunID == "" {
\t\treturn fmt.Errorf("run_id is required")
\t}
\tif wire.ConversationID == "" {
\t\treturn fmt.Errorf("conversation_id is required")
\t}
\tif wire.TurnID == "" {
\t\treturn fmt.Errorf("turn_id is required")
\t}
\tif wire.RequestID == "" {
\t\treturn fmt.Errorf("request_id is required")
\t}
\tif wire.OwnerUserID == "" {
\t\treturn fmt.Errorf("owner_user_id is required")
\t}
\tif wire.Surface == "" {
\t\treturn fmt.Errorf("surface is required")
\t}
\tif err := wire.Metadata.ExecutionPayload.Validate(); err != nil {
\t\treturn fmt.Errorf("metadata.execution_payload: %w", err)
\t}
\tif wire.Metadata.ExecutionPayload.RequestID != wire.RequestID {
\t\treturn fmt.Errorf("metadata.execution_payload.request_id must match request_id")
\t}
\tif wire.Metadata.ExecutionPayload.ConversationID != wire.ConversationID {
\t\treturn fmt.Errorf("metadata.execution_payload.conversation_id must match conversation_id")
\t}
\tif wire.TraceID != "" &&
\t\twire.Metadata.ExecutionPayload.Trace.TraceID != wire.TraceID {
\t\treturn fmt.Errorf("metadata.execution_payload.trace.trace_id must match trace_id")
\t}
\treturn nil
}

func (wire WorkflowTraceSummaryWire) Validate() error {
\tif wire.WorkflowMode == "" {
\t\treturn fmt.Errorf("workflow_mode is required")
\t}
\tif !wire.WorkflowMode.Valid() {
\t\treturn fmt.Errorf("workflow_mode is invalid")
\t}
\tif wire.SelectedTool != nil && *wire.SelectedTool != "" && !ToolID(*wire.SelectedTool).Valid() {
\t\treturn fmt.Errorf("selected_tool is invalid")
\t}
\tif wire.SelectedTools == nil {
\t\treturn fmt.Errorf("selected_tools is required")
\t}
\tfor index, tool := range wire.SelectedTools {
\t\tif tool == "" {
\t\t\treturn fmt.Errorf("selected_tools[%d] is required", index)
\t\t}
\t}
\tif wire.FirstDecisionActor == "" {
\t\treturn fmt.Errorf("first_decision_actor is required")
\t}
\tif wire.PlanningOutcome == "" {
\t\treturn fmt.Errorf("planning_outcome is required")
\t}
\tif wire.DirectVsDelegateBranch == "" {
\t\treturn fmt.Errorf("direct_vs_delegate_branch is required")
\t}
\tif wire.TerminalReason == "" {
\t\treturn fmt.Errorf("terminal_reason is required")
\t}
\tif wire.AnswerArtifactKinds == nil {
\t\treturn fmt.Errorf("answer_artifact_kinds is required")
\t}
\tfor index, kind := range wire.AnswerArtifactKinds {
\t\tif !kind.Valid() {
\t\t\treturn fmt.Errorf("answer_artifact_kinds[%d] is invalid", index)
\t\t}
\t}
\tif wire.AnswerArtifactRefs == nil {
\t\treturn fmt.Errorf("answer_artifact_refs is required")
\t}
\tif wire.TraceSteps == nil {
\t\treturn fmt.Errorf("trace_steps is required")
\t}
\tif wire.ToolCallSummaries == nil {
\t\treturn fmt.Errorf("tool_call_summaries is required")
\t}
\tif wire.RuntimeVersions == nil {
\t\treturn fmt.Errorf("runtime_versions is required")
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
\tif wire.ResolvedTargets == nil {
\t\treturn fmt.Errorf("resolved_targets is required")
\t}
\tseenTargets := map[string]bool{}
\tfor index, target := range wire.ResolvedTargets {
\t\tif target == "" {
\t\t\treturn fmt.Errorf("resolved_targets[%d] is required", index)
\t\t}
\t\tif seenTargets[target] {
\t\t\treturn fmt.Errorf("resolved_targets[%d] is duplicated", index)
\t\t}
\t\tseenTargets[target] = true
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
\tif wire.SessionUpdate != nil {
\t\tif err := wire.SessionUpdate.Validate(); err != nil {
\t\t\treturn fmt.Errorf("session_update: %w", err)
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
\treturn nil
}

func (wire SessionUpdateWire) Validate() error {
\tif wire.UpsertSlots == nil {
\t\treturn fmt.Errorf("upsert_slots is required")
\t}
\tfor index, slot := range wire.UpsertSlots {
\t\tif !slot.Confirmed {
\t\t\treturn fmt.Errorf("upsert_slots[%d].confirmed must be true", index)
\t\t}
\t\tswitch slot.Name {
\t\tcase "curriculum_program", "curriculum_program_family", "curriculum_semester":
\t\tdefault:
\t\t\treturn fmt.Errorf("upsert_slots[%d].name is invalid", index)
\t\t}
\t\tif slot.Value == "" {
\t\t\treturn fmt.Errorf("upsert_slots[%d].value is required", index)
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

func (value AnswerArtifactKind) Valid() bool {
\tswitch value {
\tcase __ANSWER_ARTIFACT_KIND_CASES__:
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

`;
	const result = template
		.replace("__TOOL_ID_CASES__", toolIdCases)
		.replace("__REQUESTED_TOOL_CASES__", requestedToolCases)
		.replace("__WORKFLOW_MODE_CASES__", workflowModeCases)
		.replace("__ANSWER_ARTIFACT_KIND_CASES__", answerArtifactKindCases)
		.replace("__STAGE_TIMING_FIELD_CASES__", stageTimingFieldCases);
	return result;
}

export function goConstSuffix(value: string): string {
	return value
		.replaceAll(".", "-")
		.replaceAll("_", "-")
		.split("-")
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join("");
}
