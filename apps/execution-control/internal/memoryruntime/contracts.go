package memoryruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var ErrInvalidMemoryProjection = errors.New("invalid memory runtime projection")

const MaxCompactTextBytes = 1200

const PersonalMemoryCommandSchemaVersion = "personal_memory_command.v2"

type RecallRequest struct {
	OwnerGeneration int64             `json:"owner_generation"`
	OwnerSequence   int64             `json:"owner_sequence"`
	QueryTimestamp  string            `json:"query_timestamp"`
	RunID           string            `json:"run_id"`
	SessionSlots    map[string]string `json:"session_slots,omitempty"`
	TenantID        string            `json:"tenant_id"`
	ThreadID        string            `json:"thread_id"`
	UserGoal        string            `json:"user_goal"`
	UserID          string            `json:"user_id"`
}

type ContextItem struct {
	CompactText     string  `json:"compact_text"`
	MemoryID        string  `json:"memory_id"`
	MemoryType      string  `json:"memory_type"`
	Score           float64 `json:"score,omitempty"`
	SourceFactCount int     `json:"source_fact_count,omitempty"`
	UpdatedAt       string  `json:"updated_at"`
}

type RecentMessage struct {
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
	Role      string `json:"role"`
	RoleType  string `json:"role_type"`
}

type RecallResult struct {
	ContextBlock        string          `json:"context_block,omitempty"`
	Items               []ContextItem   `json:"memory_context_items"`
	MemoryRef           string          `json:"memory_ref"`
	PayloadSHA256       string          `json:"payload_sha256"`
	Provider            string          `json:"provider,omitempty"`
	RecentMessages      []RecentMessage `json:"recent_messages,omitempty"`
	RetrievalMode       string          `json:"retrieval_mode,omitempty"`
	RunID               string          `json:"run_id"`
	SchemaVersion       string          `json:"schema_version"`
	SelectedMemoryChars int             `json:"selected_memory_chars"`
	SelectedMemoryCount int             `json:"selected_memory_count"`
	ThreadID            string          `json:"thread_id,omitempty"`
	UserID              string          `json:"user_id,omitempty"`
}

type AppendConversationTurnRequest struct {
	OwnerGeneration      int64  `json:"owner_generation"`
	OwnerSequence        int64  `json:"owner_sequence"`
	RunID                string `json:"run_id"`
	TenantID             string `json:"tenant_id,omitempty"`
	ThreadID             string `json:"thread_id"`
	UserID               string `json:"user_id"`
	UserMessage          string `json:"user_message"`
	UserMessageCreatedAt string `json:"user_message_created_at"`
	UserMessageID        string `json:"user_message_id"`
}

type AppendConversationTurnResult struct {
	AppendedMessageCount int      `json:"appended_message_count"`
	MessageUUIDs         []string `json:"message_uuids,omitempty"`
	PayloadSHA256        string   `json:"payload_sha256"`
	RunID                string   `json:"run_id"`
	SchemaVersion        string   `json:"schema_version"`
	Status               string   `json:"status"`
	ThreadID             string   `json:"thread_id"`
	UserID               string   `json:"user_id"`
}

type PersonalMemoryCommandItem struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type PersonalMemoryCommandRequest struct {
	CommandID         string                     `json:"command_id"`
	CommandKind       string                     `json:"command_kind"`
	Item              *PersonalMemoryCommandItem `json:"item,omitempty"`
	LifecycleState    string                     `json:"lifecycle_state"`
	OwnerGeneration   int64                      `json:"owner_generation"`
	OwnerSequence     int64                      `json:"owner_sequence"`
	SchemaVersion     string                     `json:"schema_version"`
	SubjectID         string                     `json:"subject_id,omitempty"`
	SubjectRevision   int64                      `json:"subject_revision,omitempty"`
	SourceUpdatedAt   string                     `json:"source_updated_at"`
	SourceMessageIDs  []string                   `json:"source_message_ids,omitempty"`
	SubjectScopeHash  string                     `json:"-"`
	SupersessionScope string                     `json:"supersession_scope"`
	TenantID          string                     `json:"tenant_id"`
	UserID            string                     `json:"user_id"`
}

type PersonalMemoryCommandResult struct {
	CommandID         string `json:"command_id"`
	ErrorCode         string `json:"error_code,omitempty"`
	RetryAfterSeconds int    `json:"retry_after_seconds,omitempty"`
	Status            string `json:"status"`
}

func ValidatePersonalMemoryCommandRequest(request PersonalMemoryCommandRequest) error {
	required := map[string]string{
		"command_id":   request.CommandID,
		"command_kind": request.CommandKind,
		"tenant_id":    request.TenantID,
		"user_id":      request.UserID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
	}
	if strings.TrimSpace(request.SchemaVersion) != PersonalMemoryCommandSchemaVersion {
		return fmt.Errorf("%w: schema_version must be %s", ErrInvalidMemoryProjection, PersonalMemoryCommandSchemaVersion)
	}
	if request.OwnerGeneration < 1 {
		return fmt.Errorf("%w: owner_generation must be positive", ErrInvalidMemoryProjection)
	}
	if request.OwnerSequence < 1 {
		return fmt.Errorf("%w: owner_sequence must be positive", ErrInvalidMemoryProjection)
	}
	switch request.CommandKind {
	case "owner_transition":
		if request.LifecycleState != "active" && request.LifecycleState != "paused" {
			return fmt.Errorf("%w: owner transition lifecycle_state is invalid", ErrInvalidMemoryProjection)
		}
		if request.SupersessionScope != "owner:lifecycle" {
			return fmt.Errorf("%w: owner transition supersession_scope is invalid", ErrInvalidMemoryProjection)
		}
	case "owner_erase":
		if request.SupersessionScope != "owner:erase:"+strconv.FormatInt(request.OwnerGeneration, 10) {
			return fmt.Errorf("%w: owner erase supersession_scope is invalid", ErrInvalidMemoryProjection)
		}
	case "item_upsert":
		if request.Item == nil || strings.TrimSpace(request.SubjectID) == "" || strings.TrimSpace(request.Item.Key) == "" || strings.TrimSpace(request.Item.Value) == "" {
			return fmt.Errorf("%w: item upsert payload is incomplete", ErrInvalidMemoryProjection)
		}
		if request.SupersessionScope != "item:"+strings.TrimSpace(request.SubjectID) {
			return fmt.Errorf("%w: item upsert supersession_scope is invalid", ErrInvalidMemoryProjection)
		}
	case "item_delete":
		if strings.TrimSpace(request.SubjectID) == "" {
			return fmt.Errorf("%w: subject_id is required", ErrInvalidMemoryProjection)
		}
		if request.SupersessionScope != "item:"+strings.TrimSpace(request.SubjectID) {
			return fmt.Errorf("%w: item delete supersession_scope is invalid", ErrInvalidMemoryProjection)
		}
	case "conversation_prune", "conversation_delete":
		if strings.TrimSpace(request.SubjectID) == "" || len(request.SourceMessageIDs) < 1 || len(request.SourceMessageIDs) > 50 {
			return fmt.Errorf("%w: conversation source deletion requires subject_id and 1..50 source_message_ids", ErrInvalidMemoryProjection)
		}
		if request.SupersessionScope != "source_batch:"+strings.TrimSpace(request.CommandID) {
			return fmt.Errorf("%w: conversation source deletion supersession_scope is invalid", ErrInvalidMemoryProjection)
		}
		seen := make(map[string]struct{}, len(request.SourceMessageIDs))
		for _, sourceMessageID := range request.SourceMessageIDs {
			sourceMessageID = strings.TrimSpace(sourceMessageID)
			if sourceMessageID == "" {
				return fmt.Errorf("%w: source_message_ids must not contain empty ids", ErrInvalidMemoryProjection)
			}
			if _, duplicate := seen[sourceMessageID]; duplicate {
				return fmt.Errorf("%w: source_message_ids must be unique", ErrInvalidMemoryProjection)
			}
			seen[sourceMessageID] = struct{}{}
		}
	default:
		return fmt.Errorf("%w: unsupported command_kind", ErrInvalidMemoryProjection)
	}
	if err := validateRFC3339Timestamp("source_updated_at", request.SourceUpdatedAt); err != nil {
		return err
	}
	return nil
}

func ValidateRecallRequest(request RecallRequest) error {
	if request.OwnerGeneration < 1 || request.OwnerSequence < 0 {
		return fmt.Errorf("%w: valid owner generation and sequence are required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.RunID) == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.UserID) == "" {
		return fmt.Errorf("%w: user_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.ThreadID) == "" {
		return fmt.Errorf("%w: thread_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.UserGoal) == "" {
		return fmt.Errorf("%w: user_goal is required", ErrInvalidMemoryProjection)
	}
	if err := validateRFC3339Timestamp("query_timestamp", request.QueryTimestamp); err != nil {
		return err
	}
	return nil
}

func ValidateAppendConversationTurnRequest(request AppendConversationTurnRequest) error {
	if request.OwnerGeneration < 1 || request.OwnerSequence < 0 {
		return fmt.Errorf("%w: valid owner generation and sequence are required", ErrInvalidMemoryProjection)
	}
	required := map[string]string{
		"run_id":                  request.RunID,
		"thread_id":               request.ThreadID,
		"user_id":                 request.UserID,
		"user_message":            request.UserMessage,
		"user_message_created_at": request.UserMessageCreatedAt,
		"user_message_id":         request.UserMessageID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
	}
	if err := validateRFC3339Timestamp("user_message_created_at", request.UserMessageCreatedAt); err != nil {
		return err
	}
	return nil
}

func validateRFC3339Timestamp(field string, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
	}
	if _, err := time.Parse(time.RFC3339, strings.TrimSpace(value)); err != nil {
		return fmt.Errorf("%w: %s must be RFC3339", ErrInvalidMemoryProjection, field)
	}
	return nil
}

func FinalizeRecallResult(result RecallResult) (RecallResult, error) {
	if strings.TrimSpace(result.SchemaVersion) == "" {
		result.SchemaVersion = "memory_recall_result_v1"
	}
	result.SelectedMemoryCount = len(result.Items)
	result.SelectedMemoryChars = len([]rune(result.ContextBlock))
	for index, item := range result.Items {
		if err := validateContextItem(index, item); err != nil {
			return RecallResult{}, err
		}
		result.SelectedMemoryChars += len([]rune(item.CompactText))
	}
	for index, message := range result.RecentMessages {
		if err := validateRecentMessage(index, message); err != nil {
			return RecallResult{}, err
		}
	}
	if strings.TrimSpace(result.RunID) == "" {
		return RecallResult{}, fmt.Errorf("%w: run_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(result.MemoryRef) == "" {
		return RecallResult{}, fmt.Errorf("%w: memory_ref is required", ErrInvalidMemoryProjection)
	}
	result.PayloadSHA256 = ""
	hash, err := HashProjection(result)
	if err != nil {
		return RecallResult{}, err
	}
	result.PayloadSHA256 = hash
	return result, nil
}

func FinalizeAppendConversationTurnResult(
	result AppendConversationTurnResult,
) (AppendConversationTurnResult, error) {
	if strings.TrimSpace(result.SchemaVersion) == "" {
		result.SchemaVersion = "memory_conversation_append_result_v2"
	}
	if strings.TrimSpace(result.Status) == "" {
		result.Status = "completed"
	}
	if strings.TrimSpace(result.RunID) == "" {
		return AppendConversationTurnResult{}, fmt.Errorf("%w: run_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(result.ThreadID) == "" {
		return AppendConversationTurnResult{}, fmt.Errorf("%w: thread_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(result.UserID) == "" {
		return AppendConversationTurnResult{}, fmt.Errorf("%w: user_id is required", ErrInvalidMemoryProjection)
	}
	result.PayloadSHA256 = ""
	hash, err := HashProjection(result)
	if err != nil {
		return AppendConversationTurnResult{}, err
	}
	result.PayloadSHA256 = hash
	return result, nil
}

func HashProjection(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func validateContextItem(index int, item ContextItem) error {
	required := map[string]string{
		"memory_id":    item.MemoryID,
		"memory_type":  item.MemoryType,
		"compact_text": item.CompactText,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: memory_context_items[%d].%s is required", ErrInvalidMemoryProjection, index, field)
		}
	}
	if len([]byte(item.CompactText)) > MaxCompactTextBytes {
		return fmt.Errorf("%w: memory_context_items[%d].compact_text exceeds limit", ErrInvalidMemoryProjection, index)
	}
	return nil
}

func validateRecentMessage(index int, message RecentMessage) error {
	required := map[string]string{
		"content":    message.Content,
		"created_at": message.CreatedAt,
		"role":       message.Role,
		"role_type":  message.RoleType,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: recent_messages[%d].%s is required", ErrInvalidMemoryProjection, index, field)
		}
	}
	if len([]byte(message.Content)) > MaxCompactTextBytes {
		return fmt.Errorf("%w: recent_messages[%d].content exceeds limit", ErrInvalidMemoryProjection, index)
	}
	return nil
}
