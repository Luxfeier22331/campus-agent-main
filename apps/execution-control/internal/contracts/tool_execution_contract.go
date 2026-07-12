// AUTO-GENERATED FROM tool-execution.openapi.yaml. Do not edit by hand.

package contracts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
)

const (
	ExecutionContractVersion    = "tool_execution_v1"
	ResponseContract            = "execution_finalization_response_v2"
	WorkflowTraceSummaryVersion = "workflow-trace-summary-v5"
)

type ToolID string

const (
	ToolIDKnowledgeQuery          ToolID = "knowledge_query"
	ToolIDKnowledgeSearch         ToolID = "knowledge_search"
	ToolIDTransportScheduleLookup ToolID = "transport_schedule_lookup"
)

type ModelVisibleToolName string

const (
	ModelVisibleToolNameKnowledgeQuery          ModelVisibleToolName = "knowledge_query"
	ModelVisibleToolNameTransportScheduleLookup ModelVisibleToolName = "transport_schedule_lookup"
)

type RequestedTool string

const (
	RequestedToolKnowledgeQuery          RequestedTool = "knowledge_query"
	RequestedToolTransportScheduleLookup RequestedTool = "transport_schedule_lookup"
)

type ConfidenceLevel string

const (
	ConfidenceLevelHigh   ConfidenceLevel = "high"
	ConfidenceLevelMedium ConfidenceLevel = "medium"
	ConfidenceLevelLow    ConfidenceLevel = "low"
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

type AnswerArtifactKind string

const (
	AnswerArtifactKindAgentFinalOutput AnswerArtifactKind = "agent_final_output"
)

type StageTimingField string

const (
	StageTimingFieldRequestTotalMs                StageTimingField = "request.total_ms"
	StageTimingFieldStreamBrowserTtftMs           StageTimingField = "stream.browser_ttft_ms"
	StageTimingFieldExecutionAdmissionMs          StageTimingField = "execution.admission_ms"
	StageTimingFieldMemoryRecallMs                StageTimingField = "memory.recall_ms"
	StageTimingFieldAgentPrimaryMs                StageTimingField = "agent.primary_ms"
	StageTimingFieldAgentRuntimeMs                StageTimingField = "agent.runtime_ms"
	StageTimingFieldAgentFirstDeltaMs             StageTimingField = "agent.first_delta_ms"
	StageTimingFieldToolTotalMs                   StageTimingField = "tool.total_ms"
	StageTimingFieldToolTransportScheduleLookupMs StageTimingField = "tool.transport_schedule_lookup_ms"
	StageTimingFieldKnowledgeSearchMs             StageTimingField = "knowledge.search_ms"
	StageTimingFieldFinalizationWriteMs           StageTimingField = "finalization.write_ms"
	StageTimingFieldProjectionCloseoutMs          StageTimingField = "projection.closeout_ms"
)

type ConversationContextWire struct {
	SchemaVersion        string           `json:"schema_version"`
	ConversationID       string           `json:"conversation_id"`
	UserMessageID        string           `json:"user_message_id"`
	ParentMessageID      *string          `json:"parent_message_id,omitempty"`
	CurrentUserMessage   map[string]any   `json:"current_user_message"`
	RecentTurns          []map[string]any `json:"recent_turns"`
	PreviousEvidenceRefs []map[string]any `json:"previous_evidence_refs"`
	PreviousToolResults  []map[string]any `json:"previous_tool_results"`
	SessionState         map[string]any   `json:"session_state"`
}

type TraceContextWire struct {
	TraceID string `json:"trace_id"`
}

type VersionQueryWire struct {
	Mode               string `json:"mode,omitempty"`
	AsOf               string `json:"as_of,omitempty"`
	VersionID          string `json:"version_id,omitempty"`
	CompareToVersionID string `json:"compare_to_version_id,omitempty"`
}

type ExecutionPayloadWire struct {
	ExecutionContractVersion string            `json:"execution_contract_version"`
	ResponseContract         string            `json:"response_contract"`
	UserGoal                 string            `json:"user_goal"`
	ConversationID           string            `json:"conversation_id"`
	TenantID                 string            `json:"tenant_id,omitempty"`
	RequestID                string            `json:"request_id"`
	SafetyIdentifier         *string           `json:"safety_identifier,omitempty"`
	RequestedTool            RequestedTool     `json:"requested_tool,omitempty"`
	Scope                    string            `json:"scope,omitempty"`
	Trace                    TraceContextWire  `json:"trace"`
	Context                  map[string]any    `json:"context"`
	VersionQuery             *VersionQueryWire `json:"version_query"`
}

type ExecutionRunMetadataWire struct {
	ExecutionPayload ExecutionPayloadWire `json:"execution_payload"`
}

type ExecutionRunCreateRequestWire struct {
	RunID           string                   `json:"run_id"`
	ConversationID  string                   `json:"conversation_id"`
	TurnID          string                   `json:"turn_id"`
	RequestID       string                   `json:"request_id"`
	TraceID         string                   `json:"trace_id,omitempty"`
	OwnerUserID     string                   `json:"owner_user_id"`
	Surface         string                   `json:"surface"`
	RuntimeVersions map[string]any           `json:"runtime_versions,omitempty"`
	Metadata        ExecutionRunMetadataWire `json:"metadata"`
}

type WorkflowTraceSummaryWire struct {
	WorkflowMode           WorkflowMode         `json:"workflow_mode"`
	SelectedTool           *string              `json:"selected_tool"`
	SelectedTools          []string             `json:"selected_tools"`
	FirstDecisionActor     string               `json:"first_decision_actor"`
	PlanningOutcome        string               `json:"planning_outcome"`
	DirectVsDelegateBranch string               `json:"direct_vs_delegate_branch"`
	TerminalReason         string               `json:"terminal_reason"`
	AnswerArtifactKinds    []AnswerArtifactKind `json:"answer_artifact_kinds"`
	AnswerArtifactRefs     []string             `json:"answer_artifact_refs"`
	TraceSteps             []map[string]any     `json:"trace_steps"`
	ToolCallSummaries      []map[string]any     `json:"tool_call_summaries"`
	RuntimeVersions        map[string]any       `json:"runtime_versions"`
}

type StageTimingWire map[StageTimingField]float64

type SessionUpdateSlotWire struct {
	Confirmed bool   `json:"confirmed"`
	Name      string `json:"name"`
	Value     string `json:"value"`
}

type SessionUpdateWire struct {
	UpsertSlots []SessionUpdateSlotWire `json:"upsert_slots"`
}

type ToolExecutionResponseWire struct {
	SelectedTool         *ToolID                   `json:"selected_tool"`
	Status               ExecutionStatus           `json:"status"`
	AnswerText           string                    `json:"answer_text"`
	FollowUpQuestion     string                    `json:"follow_up_question"`
	Confidence           ConfidenceLevel           `json:"confidence"`
	ResolvedScope        *string                   `json:"resolved_scope"`
	SessionUpdate        *SessionUpdateWire        `json:"session_update"`
	Result               map[string]any            `json:"result"`
	Error                map[string]any            `json:"error"`
	Observability        map[string]any            `json:"observability,omitempty"`
	WorkflowTraceSummary *WorkflowTraceSummaryWire `json:"workflow_trace_summary,omitempty"`
	StageTiming          StageTimingWire           `json:"stage_timing,omitempty"`
	TraceID              string                    `json:"trace_id"`
}

func DecodeExecutionPayloadWireJSON(data []byte) (ExecutionPayloadWire, error) {
	var wire ExecutionPayloadWire
	if err := decodeStrictJSON(data, &wire); err != nil {
		return wire, err
	}
	if err := wire.Validate(); err != nil {
		return wire, err
	}
	return wire, nil
}

func DecodeExecutionRunCreateRequestWireJSON(data []byte) (ExecutionRunCreateRequestWire, error) {
	var wire ExecutionRunCreateRequestWire
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
	if err := requireJSONObjectFields(data, []string{
		"selected_tool",
		"status",
		"answer_text",
		"follow_up_question",
		"confidence",
		"result",
		"error",
		"resolved_scope",
		"session_update",
		"trace_id",
	}); err != nil {
		return wire, err
	}
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

func requireJSONObjectFields(data []byte, fields []string) error {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	if payload == nil {
		return fmt.Errorf("expected JSON object")
	}
	for _, field := range fields {
		if _, ok := payload[field]; !ok {
			return fmt.Errorf("%s is required", field)
		}
	}
	return nil
}

func (wire ExecutionPayloadWire) Validate() error {
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
	if wire.ConversationID == "" {
		return fmt.Errorf("conversation_id is required")
	}
	if wire.RequestedTool != "" && !wire.RequestedTool.Valid() {
		return fmt.Errorf("requested_tool is invalid")
	}
	if wire.RequestedTool == RequestedToolKnowledgeQuery && wire.Scope == "" {
		return fmt.Errorf("scope is required for requested_tool knowledge_query")
	}
	if wire.RequestedTool != RequestedToolKnowledgeQuery && wire.Scope != "" {
		return fmt.Errorf("scope requires requested_tool knowledge_query")
	}
	if wire.Trace.TraceID == "" {
		return fmt.Errorf("trace.trace_id is required")
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
	if err := wire.VersionQuery.Validate(); err != nil {
		return fmt.Errorf("version_query: %w", err)
	}
	return nil
}

func (wire VersionQueryWire) Validate() error {
	mode := wire.Mode
	if mode == "" {
		mode = "current"
	}
	switch mode {
	case "current", "historical", "as_of", "compare":
	default:
		return fmt.Errorf("mode is invalid")
	}
	if mode == "as_of" {
		if wire.AsOf == "" {
			return fmt.Errorf("as_of is required when mode is as_of")
		}
	} else if wire.AsOf != "" {
		return fmt.Errorf("as_of is only allowed when mode is as_of")
	}
	if mode != "historical" && mode != "compare" && wire.VersionID != "" {
		return fmt.Errorf("version_id is only allowed for historical or compare mode")
	}
	if mode != "compare" && wire.CompareToVersionID != "" {
		return fmt.Errorf("compare_to_version_id is only allowed when mode is compare")
	}
	if wire.CompareToVersionID != "" && wire.VersionID == "" {
		return fmt.Errorf("version_id is required when compare_to_version_id is set")
	}
	return nil
}

func (wire ExecutionRunCreateRequestWire) Validate() error {
	if wire.RunID == "" {
		return fmt.Errorf("run_id is required")
	}
	if wire.ConversationID == "" {
		return fmt.Errorf("conversation_id is required")
	}
	if wire.TurnID == "" {
		return fmt.Errorf("turn_id is required")
	}
	if wire.RequestID == "" {
		return fmt.Errorf("request_id is required")
	}
	if wire.OwnerUserID == "" {
		return fmt.Errorf("owner_user_id is required")
	}
	if wire.Surface == "" {
		return fmt.Errorf("surface is required")
	}
	if err := wire.Metadata.ExecutionPayload.Validate(); err != nil {
		return fmt.Errorf("metadata.execution_payload: %w", err)
	}
	if wire.Metadata.ExecutionPayload.RequestID != wire.RequestID {
		return fmt.Errorf("metadata.execution_payload.request_id must match request_id")
	}
	if wire.Metadata.ExecutionPayload.ConversationID != wire.ConversationID {
		return fmt.Errorf("metadata.execution_payload.conversation_id must match conversation_id")
	}
	if wire.TraceID != "" &&
		wire.Metadata.ExecutionPayload.Trace.TraceID != wire.TraceID {
		return fmt.Errorf("metadata.execution_payload.trace.trace_id must match trace_id")
	}
	return nil
}

func (wire WorkflowTraceSummaryWire) Validate() error {
	if wire.WorkflowMode == "" {
		return fmt.Errorf("workflow_mode is required")
	}
	if !wire.WorkflowMode.Valid() {
		return fmt.Errorf("workflow_mode is invalid")
	}
	if wire.SelectedTool != nil && *wire.SelectedTool != "" && !ToolID(*wire.SelectedTool).Valid() {
		return fmt.Errorf("selected_tool is invalid")
	}
	if wire.SelectedTools == nil {
		return fmt.Errorf("selected_tools is required")
	}
	for index, tool := range wire.SelectedTools {
		if tool == "" {
			return fmt.Errorf("selected_tools[%d] is required", index)
		}
	}
	if wire.FirstDecisionActor == "" {
		return fmt.Errorf("first_decision_actor is required")
	}
	if wire.PlanningOutcome == "" {
		return fmt.Errorf("planning_outcome is required")
	}
	if wire.DirectVsDelegateBranch == "" {
		return fmt.Errorf("direct_vs_delegate_branch is required")
	}
	if wire.TerminalReason == "" {
		return fmt.Errorf("terminal_reason is required")
	}
	if wire.AnswerArtifactKinds == nil {
		return fmt.Errorf("answer_artifact_kinds is required")
	}
	for index, kind := range wire.AnswerArtifactKinds {
		if !kind.Valid() {
			return fmt.Errorf("answer_artifact_kinds[%d] is invalid", index)
		}
	}
	if wire.AnswerArtifactRefs == nil {
		return fmt.Errorf("answer_artifact_refs is required")
	}
	if wire.TraceSteps == nil {
		return fmt.Errorf("trace_steps is required")
	}
	if wire.ToolCallSummaries == nil {
		return fmt.Errorf("tool_call_summaries is required")
	}
	if wire.RuntimeVersions == nil {
		return fmt.Errorf("runtime_versions is required")
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
	if wire.SessionUpdate != nil {
		if err := wire.SessionUpdate.Validate(); err != nil {
			return fmt.Errorf("session_update: %w", err)
		}
	}
	if wire.WorkflowTraceSummary != nil {
		if err := wire.WorkflowTraceSummary.Validate(); err != nil {
			return fmt.Errorf("workflow_trace_summary: %w", err)
		}
	}
	if wire.StageTiming != nil {
		if err := wire.StageTiming.Validate(); err != nil {
			return fmt.Errorf("stage_timing: %w", err)
		}
	}
	return nil
}

func (wire SessionUpdateWire) Validate() error {
	if wire.UpsertSlots == nil {
		return fmt.Errorf("upsert_slots is required")
	}
	for index, slot := range wire.UpsertSlots {
		if !slot.Confirmed {
			return fmt.Errorf("upsert_slots[%d].confirmed must be true", index)
		}
		switch slot.Name {
		case "curriculum_program", "curriculum_program_family", "curriculum_semester":
		default:
			return fmt.Errorf("upsert_slots[%d].name is invalid", index)
		}
		if slot.Value == "" {
			return fmt.Errorf("upsert_slots[%d].value is required", index)
		}
	}
	return nil
}

func (wire StageTimingWire) Validate() error {
	for field, durationMs := range wire {
		if !field.Valid() {
			return fmt.Errorf("%s is not an allowed stage timing field", field)
		}
		if durationMs < 0 || math.IsNaN(durationMs) || math.IsInf(durationMs, 0) {
			return fmt.Errorf("%s must be a finite non-negative duration", field)
		}
	}
	return nil
}

func (value ToolID) Valid() bool {
	switch value {
	case ToolIDKnowledgeQuery, ToolIDKnowledgeSearch, ToolIDTransportScheduleLookup:
		return true
	default:
		return false
	}
}

func (value RequestedTool) Valid() bool {
	switch value {
	case RequestedToolKnowledgeQuery, RequestedToolTransportScheduleLookup:
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

func (value AnswerArtifactKind) Valid() bool {
	switch value {
	case AnswerArtifactKindAgentFinalOutput:
		return true
	default:
		return false
	}
}

func (value StageTimingField) Valid() bool {
	switch value {
	case StageTimingFieldRequestTotalMs,
		StageTimingFieldStreamBrowserTtftMs,
		StageTimingFieldExecutionAdmissionMs,
		StageTimingFieldMemoryRecallMs,
		StageTimingFieldAgentPrimaryMs,
		StageTimingFieldAgentRuntimeMs,
		StageTimingFieldAgentFirstDeltaMs,
		StageTimingFieldToolTotalMs,
		StageTimingFieldToolTransportScheduleLookupMs,
		StageTimingFieldKnowledgeSearchMs,
		StageTimingFieldFinalizationWriteMs,
		StageTimingFieldProjectionCloseoutMs:
		return true
	default:
		return false
	}
}
