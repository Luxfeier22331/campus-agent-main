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
	SessionSlots        map[string]string `json:"session_slots"`
	TenantID            string            `json:"tenant_id"`
	UserGoal            string            `json:"user_goal"`
	UserID              string            `json:"user_id"`
}

type UpsertRequest struct {
	Capability  string `json:"capability"`
	CompactText string `json:"compact_text"`
	MemoryID    string `json:"memory_id"`
	MemoryType  string `json:"memory_type"`
	Source      string `json:"source"`
	Status      string `json:"status"`
	TenantID    string `json:"tenant_id"`
	UpdatedAt   string `json:"updated_at"`
	UserID      string `json:"user_id"`
}

type DisableRequest struct {
	MemoryID  string `json:"memory_id"`
	TenantID  string `json:"tenant_id"`
	UpdatedAt string `json:"updated_at"`
	UserID    string `json:"user_id"`
}

type UpsertResult struct {
	MemoryID      string `json:"memory_id"`
	PointID       string `json:"point_id"`
	SchemaVersion string `json:"schema_version"`
	Status        string `json:"status"`
	UpdatedAt     string `json:"updated_at"`
}

type ContextItem struct {
	Capability  string  `json:"capability"`
	CompactText string  `json:"compact_text"`
	MemoryID    string  `json:"memory_id"`
	MemoryType  string  `json:"memory_type"`
	Score       float64 `json:"score"`
	UpdatedAt   string  `json:"updated_at"`
}

type RecallResult struct {
	Items               []ContextItem `json:"memory_context_items"`
	MemoryRef           string        `json:"memory_ref"`
	PayloadSHA256       string        `json:"payload_sha256"`
	RunID               string        `json:"run_id"`
	SchemaVersion       string        `json:"schema_version"`
	SelectedMemoryChars int           `json:"selected_memory_chars"`
	SelectedMemoryCount int           `json:"selected_memory_count"`
}

func ValidateRecallRequest(request RecallRequest) error {
	if strings.TrimSpace(request.RunID) == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.UserID) == "" {
		return fmt.Errorf("%w: user_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.UserGoal) == "" {
		return fmt.Errorf("%w: user_goal is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.RequestedCapability) == "" {
		return fmt.Errorf("%w: requested_capability is required", ErrInvalidMemoryProjection)
	}
	return nil
}

func ValidateUpsertRequest(request UpsertRequest) error {
	required := map[string]string{
		"memory_id":    request.MemoryID,
		"user_id":      request.UserID,
		"memory_type":  request.MemoryType,
		"capability":   request.Capability,
		"status":       request.Status,
		"source":       request.Source,
		"compact_text": request.CompactText,
		"updated_at":   request.UpdatedAt,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidMemoryProjection, field)
		}
	}
	if !allowedValue(request.MemoryType, "profile", "goal", "preference", "session_summary", "task_state") {
		return fmt.Errorf("%w: memory_type is not supported", ErrInvalidMemoryProjection)
	}
	if !allowedValue(request.Capability, "knowledge", "campus_services", "notice", "navigation", "any") {
		return fmt.Errorf("%w: capability is not supported", ErrInvalidMemoryProjection)
	}
	if !allowedValue(request.Status, "active", "stale", "disabled") {
		return fmt.Errorf("%w: status is not supported", ErrInvalidMemoryProjection)
	}
	if !allowedValue(request.Source, "explicit", "inferred", "imported") {
		return fmt.Errorf("%w: source is not supported", ErrInvalidMemoryProjection)
	}
	if len([]byte(strings.TrimSpace(request.CompactText))) > MaxCompactTextBytes {
		return fmt.Errorf("%w: compact_text exceeds limit", ErrInvalidMemoryProjection)
	}
	if containsForbiddenMemoryPayloadKey(request.CompactText) {
		return fmt.Errorf("%w: compact_text contains forbidden raw payload marker", ErrInvalidMemoryProjection)
	}
	return nil
}

func ValidateDisableRequest(request DisableRequest) error {
	if strings.TrimSpace(request.MemoryID) == "" {
		return fmt.Errorf("%w: memory_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.UserID) == "" {
		return fmt.Errorf("%w: user_id is required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.UpdatedAt) == "" {
		return fmt.Errorf("%w: updated_at is required", ErrInvalidMemoryProjection)
	}
	return nil
}

func FinalizeRecallResult(result RecallResult) (RecallResult, error) {
	if strings.TrimSpace(result.SchemaVersion) == "" {
		result.SchemaVersion = "memory_recall_result_v1"
	}
	result.SelectedMemoryCount = len(result.Items)
	result.SelectedMemoryChars = 0
	for index, item := range result.Items {
		if err := validateContextItem(index, item); err != nil {
			return RecallResult{}, err
		}
		result.SelectedMemoryChars += len([]rune(item.CompactText))
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

func NormalizeUpsertResult(request UpsertRequest) UpsertResult {
	return UpsertResult{
		MemoryID:      strings.TrimSpace(request.MemoryID),
		PointID:       PointID(request.UserID, request.MemoryID),
		SchemaVersion: "personal_memory_upsert_result_v1",
		Status:        strings.TrimSpace(request.Status),
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
	}
}

func PointID(userID string, memoryID string) string {
	return stableID(strings.TrimSpace(userID) + ":" + strings.TrimSpace(memoryID))
}

func HashProjection(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func stableID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func allowedValue(value string, allowed ...string) bool {
	normalized := strings.TrimSpace(value)
	for _, item := range allowed {
		if normalized == item {
			return true
		}
	}
	return false
}

func containsForbiddenMemoryPayloadKey(value string) bool {
	normalized := strings.ToLower(value)
	for _, marker := range []string{
		"api_key",
		"authorization:",
		"bearer ",
		"provider_response",
		"raw_prompt",
		"raw_source",
		"secret",
		"transcript:",
	} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
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
