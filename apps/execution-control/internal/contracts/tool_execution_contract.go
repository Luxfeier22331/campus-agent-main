// AUTO-GENERATED FROM tool-execution.openapi.yaml. Do not edit by hand.

package contracts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"regexp"
)

const (
	ExecutionContractVersion  = "tool_execution_v7"
	ExecutionRequestIDPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
	ResponseContract          = "execution_finalization_response_v9"
)

var executionRequestIDRegexp = regexp.MustCompile(ExecutionRequestIDPattern)

func ValidExecutionRequestID(value string) bool {
	return executionRequestIDRegexp.MatchString(value)
}

type ToolID string

const (
	ToolIDCampusSearch         ToolID = "campus_search"
	ToolIDPersonalMemoryRecall ToolID = "personal_memory_recall"
)

type ModelVisibleToolName string

const (
	ModelVisibleToolNameCampusSearch         ModelVisibleToolName = "campus_search"
	ModelVisibleToolNamePersonalMemoryRecall ModelVisibleToolName = "personal_memory_recall"
)

type ExecutionStatus string

const (
	ExecutionStatusCompleted        ExecutionStatus = "completed"
	ExecutionStatusError            ExecutionStatus = "error"
	ExecutionStatusRejected         ExecutionStatus = "rejected"
	ExecutionStatusApprovalRequired ExecutionStatus = "approval_required"
	ExecutionStatusCancelled        ExecutionStatus = "cancelled"
)

type StageTimingField string

const (
	StageTimingFieldRequestTotalMs                StageTimingField = "request.total_ms"
	StageTimingFieldExecutionDispatchMs           StageTimingField = "execution.dispatch_ms"
	StageTimingFieldWorkflowScheduleToStartMs     StageTimingField = "workflow.schedule_to_start_ms"
	StageTimingFieldStreamFirstDeltaPersistMs     StageTimingField = "stream.first_delta_persist_ms"
	StageTimingFieldStreamAppApiTtftMs            StageTimingField = "stream.app_api_ttft_ms"
	StageTimingFieldStreamOrchestrationOverheadMs StageTimingField = "stream.orchestration_overhead_ms"
	StageTimingFieldExecutionAdmissionMs          StageTimingField = "execution.admission_ms"
	StageTimingFieldMemoryRecallMs                StageTimingField = "memory.recall_ms"
	StageTimingFieldWorkflowSolveMs               StageTimingField = "workflow.solve_ms"
	StageTimingFieldWorkflowExecuteStepMs         StageTimingField = "workflow.execute_step_ms"
	StageTimingFieldWorkflowReplanMs              StageTimingField = "workflow.replan_ms"
	StageTimingFieldWorkflowSynthesizeMs          StageTimingField = "workflow.synthesize_ms"
	StageTimingFieldWorkflowFirstDeltaMs          StageTimingField = "workflow.first_delta_ms"
	StageTimingFieldToolTotalMs                   StageTimingField = "tool.total_ms"
	StageTimingFieldFinalizationWriteMs           StageTimingField = "finalization.write_ms"
	StageTimingFieldProjectionCloseoutMs          StageTimingField = "projection.closeout_ms"
)

type ConversationContextWire struct {
	SchemaVersion      string           `json:"schema_version"`
	ConversationID     string           `json:"conversation_id"`
	UserMessageID      string           `json:"user_message_id"`
	ParentMessageID    *string          `json:"parent_message_id,omitempty"`
	CurrentUserMessage map[string]any   `json:"current_user_message"`
	RecentTurns        []map[string]any `json:"recent_turns"`
	SessionState       map[string]any   `json:"session_state"`
}

type ExecutionPayloadWire struct {
	ExecutionContractVersion string         `json:"execution_contract_version"`
	ResponseContract         string         `json:"response_contract"`
	UserGoal                 string         `json:"user_goal"`
	ConversationID           string         `json:"conversation_id"`
	TenantID                 string         `json:"tenant_id,omitempty"`
	RequestID                string         `json:"request_id"`
	SafetyIdentifier         *string        `json:"safety_identifier,omitempty"`
	Context                  map[string]any `json:"context"`
}

type ExecutionRunMetadataWire struct {
	ExecutionContractVersion string `json:"execution_contract_version"`
	ExecutionInputRef        string `json:"execution_input_ref"`
	ExecutionInputSHA256     string `json:"execution_input_sha256"`
}

type ExecutionRunCreateRequestWire struct {
	ConversationID              string                   `json:"conversation_id"`
	RequestID                   string                   `json:"request_id"`
	OwnerUserID                 string                   `json:"owner_user_id"`
	PersonalMemoryRecallAllowed bool                     `json:"personal_memory_recall_allowed"`
	Surface                     string                   `json:"surface"`
	RuntimeVersions             map[string]any           `json:"runtime_versions,omitempty"`
	Metadata                    ExecutionRunMetadataWire `json:"metadata"`
}

type ModelUsageWire struct {
	InputTokens       int64 `json:"input_tokens"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	TotalTokens       int64 `json:"total_tokens"`
}

type StageTimingWire map[StageTimingField]float64

type ToolExecutionResponseWire struct {
	Status        ExecutionStatus `json:"status"`
	AnswerText    string          `json:"answer_text"`
	ModelUsage    ModelUsageWire  `json:"model_usage"`
	Result        map[string]any  `json:"result"`
	Error         map[string]any  `json:"error"`
	Observability map[string]any  `json:"observability,omitempty"`
	StageTiming   StageTimingWire `json:"stage_timing,omitempty"`
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
	if err := requireJSONObjectFields(data, []string{"personal_memory_recall_allowed"}); err != nil {
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

func DecodeToolExecutionResponseWireJSON(data []byte) (ToolExecutionResponseWire, error) {
	var wire ToolExecutionResponseWire
	if err := requireJSONObjectFields(data, []string{
		"status",
		"answer_text",
		"result",
		"error",
		"model_usage",
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
	if wire.Context == nil {
		return fmt.Errorf("context is required")
	}
	if _, ok := wire.Context["profile_memory"]; ok {
		return fmt.Errorf("context.profile_memory is not an active online recall field")
	}
	return nil
}

func (wire ExecutionRunCreateRequestWire) Validate() error {
	if wire.ConversationID == "" {
		return fmt.Errorf("conversation_id is required")
	}
	if wire.RequestID == "" {
		return fmt.Errorf("request_id is required")
	}
	if !ValidExecutionRequestID(wire.RequestID) {
		return fmt.Errorf("request_id must match %s", ExecutionRequestIDPattern)
	}
	if wire.OwnerUserID == "" {
		return fmt.Errorf("owner_user_id is required")
	}
	if wire.Surface == "" {
		return fmt.Errorf("surface is required")
	}
	if err := wire.Metadata.Validate(wire.RequestID); err != nil {
		return fmt.Errorf("metadata: %w", err)
	}
	return nil
}

func (wire ExecutionRunMetadataWire) Validate(requestID string) error {
	if !ValidExecutionRequestID(requestID) {
		return fmt.Errorf("request_id must match %s", ExecutionRequestIDPattern)
	}
	if wire.ExecutionContractVersion != ExecutionContractVersion {
		return fmt.Errorf("execution_contract_version must be %s", ExecutionContractVersion)
	}
	expectedRef := "app-api://execution-inputs/" + requestID
	if wire.ExecutionInputRef != expectedRef {
		return fmt.Errorf("execution_input_ref must be %s", expectedRef)
	}
	if !isLowerHexSHA256(wire.ExecutionInputSHA256) {
		return fmt.Errorf("execution_input_sha256 must be 64 lowercase hexadecimal characters")
	}
	return nil
}

func isLowerHexSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func (wire ToolExecutionResponseWire) Validate() error {
	if !wire.Status.Valid() {
		return fmt.Errorf("status is invalid")
	}
	if wire.ModelUsage.InputTokens < 0 || wire.ModelUsage.CachedInputTokens < 0 ||
		wire.ModelUsage.OutputTokens < 0 || wire.ModelUsage.TotalTokens < 0 ||
		wire.ModelUsage.CachedInputTokens > wire.ModelUsage.InputTokens ||
		wire.ModelUsage.TotalTokens != wire.ModelUsage.InputTokens+wire.ModelUsage.OutputTokens {
		return fmt.Errorf("model_usage is invalid")
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
	if wire.StageTiming != nil {
		if err := wire.StageTiming.Validate(); err != nil {
			return fmt.Errorf("stage_timing: %w", err)
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
	case ToolIDCampusSearch, ToolIDPersonalMemoryRecall:
		return true
	default:
		return false
	}
}

func (value ExecutionStatus) Valid() bool {
	switch value {
	case ExecutionStatusCompleted, ExecutionStatusError, ExecutionStatusRejected, ExecutionStatusApprovalRequired, ExecutionStatusCancelled:
		return true
	default:
		return false
	}
}

func (value StageTimingField) Valid() bool {
	switch value {
	case StageTimingFieldRequestTotalMs,
		StageTimingFieldExecutionDispatchMs,
		StageTimingFieldWorkflowScheduleToStartMs,
		StageTimingFieldStreamFirstDeltaPersistMs,
		StageTimingFieldStreamAppApiTtftMs,
		StageTimingFieldStreamOrchestrationOverheadMs,
		StageTimingFieldExecutionAdmissionMs,
		StageTimingFieldMemoryRecallMs,
		StageTimingFieldWorkflowSolveMs,
		StageTimingFieldWorkflowExecuteStepMs,
		StageTimingFieldWorkflowReplanMs,
		StageTimingFieldWorkflowSynthesizeMs,
		StageTimingFieldWorkflowFirstDeltaMs,
		StageTimingFieldToolTotalMs,
		StageTimingFieldFinalizationWriteMs,
		StageTimingFieldProjectionCloseoutMs:
		return true
	default:
		return false
	}
}
