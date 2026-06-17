package memoryruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidMemoryProjection = errors.New("invalid memory runtime projection")

const MaxCompactTextBytes = 1200

type RecallRequest struct {
	RequestedCapability string            `json:"requested_capability"`
	RunID               string            `json:"run_id"`
	SessionSlots        map[string]string `json:"session_slots,omitempty"`
	TenantID            string            `json:"tenant_id"`
	ThreadID            string            `json:"thread_id"`
	UserGoal            string            `json:"user_goal"`
	UserID              string            `json:"user_id"`
}

type ContextItem struct {
	Capability  string  `json:"capability"`
	CompactText string  `json:"compact_text"`
	MemoryID    string  `json:"memory_id"`
	MemoryType  string  `json:"memory_type"`
	Score       float64 `json:"score,omitempty"`
	UpdatedAt   string  `json:"updated_at"`
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
	AssistantMessage        string `json:"assistant_message"`
	IgnoreAssistantForGraph bool   `json:"ignore_assistant_for_graph"`
	RunID                   string `json:"run_id"`
	TenantID                string `json:"tenant_id,omitempty"`
	ThreadID                string `json:"thread_id"`
	UserID                  string `json:"user_id"`
	UserMessage             string `json:"user_message"`
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

type UpsertProfileMemoryItemRequest struct {
	CanonicalSubject string `json:"canonical_subject"`
	CompactText      string `json:"compact_text"`
	MemoryID         string `json:"memory_id"`
	TenantID         string `json:"tenant_id,omitempty"`
	UpdatedAt        string `json:"updated_at"`
	UserID           string `json:"user_id"`
}

type DisableProfileMemoryItemRequest struct {
	EpisodeUUID string `json:"episode_uuid"`
	MemoryID    string `json:"memory_id"`
	TenantID    string `json:"tenant_id,omitempty"`
	UpdatedAt   string `json:"updated_at"`
	UserID      string `json:"user_id"`
}

type DisableProfileMemoryOwnerRequest struct {
	TenantID  string `json:"tenant_id,omitempty"`
	UpdatedAt string `json:"updated_at"`
	UserID    string `json:"user_id"`
}

type ProfileMemoryItemResult struct {
	EpisodeUUID   string `json:"episode_uuid"`
	MemoryID      string `json:"memory_id"`
	PayloadSHA256 string `json:"payload_sha256"`
	SchemaVersion string `json:"schema_version"`
	Status        string `json:"status"`
	UpdatedAt     string `json:"updated_at"`
	UserID        string `json:"user_id"`
}

type ProfileMemoryOwnerDisableResult struct {
	PayloadSHA256 string `json:"payload_sha256"`
	SchemaVersion string `json:"schema_version"`
	Status        string `json:"status"`
	UpdatedAt     string `json:"updated_at"`
	UserID        string `json:"user_id"`
}

func ValidateRecallRequest(request RecallRequest) error {
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
	if strings.TrimSpace(request.RequestedCapability) == "" {
		return fmt.Errorf("%w: requested_capability is required", ErrInvalidMemoryProjection)
	}
	return nil
}

func ValidateAppendConversationTurnRequest(request AppendConversationTurnRequest) error {
	required := map[string]string{
		"assistant_message": request.AssistantMessage,
		"run_id":            request.RunID,
		"thread_id":         request.ThreadID,
		"user_id":           request.UserID,
		"user_message":      request.UserMessage,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
	}
	return nil
}

func ValidateUpsertProfileMemoryItemRequest(request UpsertProfileMemoryItemRequest) error {
	required := map[string]string{
		"canonical_subject": request.CanonicalSubject,
		"compact_text":      request.CompactText,
		"memory_id":         request.MemoryID,
		"updated_at":        request.UpdatedAt,
		"user_id":           request.UserID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
	}
	if len([]byte(request.CompactText)) > MaxCompactTextBytes {
		return fmt.Errorf("%w: compact_text exceeds limit", ErrInvalidMemoryProjection)
	}
	return nil
}

func ValidateDisableProfileMemoryItemRequest(request DisableProfileMemoryItemRequest) error {
	required := map[string]string{
		"episode_uuid": request.EpisodeUUID,
		"memory_id":    request.MemoryID,
		"updated_at":   request.UpdatedAt,
		"user_id":      request.UserID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
	}
	return nil
}

func ValidateDisableProfileMemoryOwnerRequest(request DisableProfileMemoryOwnerRequest) error {
	required := map[string]string{
		"updated_at": request.UpdatedAt,
		"user_id":    request.UserID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
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
		result.SchemaVersion = "memory_conversation_append_result_v1"
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

func FinalizeProfileMemoryItemResult(result ProfileMemoryItemResult) (ProfileMemoryItemResult, error) {
	if strings.TrimSpace(result.SchemaVersion) == "" {
		result.SchemaVersion = "memory_profile_item_result_v1"
	}
	required := map[string]string{
		"episode_uuid": result.EpisodeUUID,
		"memory_id":    result.MemoryID,
		"status":       result.Status,
		"updated_at":   result.UpdatedAt,
		"user_id":      result.UserID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return ProfileMemoryItemResult{}, fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
	}
	result.PayloadSHA256 = ""
	hash, err := HashProjection(result)
	if err != nil {
		return ProfileMemoryItemResult{}, err
	}
	result.PayloadSHA256 = hash
	return result, nil
}

func FinalizeProfileMemoryOwnerDisableResult(
	result ProfileMemoryOwnerDisableResult,
) (ProfileMemoryOwnerDisableResult, error) {
	if strings.TrimSpace(result.SchemaVersion) == "" {
		result.SchemaVersion = "memory_profile_owner_disable_result_v1"
	}
	required := map[string]string{
		"status":     result.Status,
		"updated_at": result.UpdatedAt,
		"user_id":    result.UserID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return ProfileMemoryOwnerDisableResult{}, fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
	}
	result.PayloadSHA256 = ""
	hash, err := HashProjection(result)
	if err != nil {
		return ProfileMemoryOwnerDisableResult{}, err
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
		"capability":   item.Capability,
		"compact_text": item.CompactText,
		"updated_at":   item.UpdatedAt,
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
