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
	Capability          string   `json:"capability"`
	CanonicalKey        string   `json:"canonical_key"`
	CanonicalSubject    string   `json:"canonical_subject"`
	CompactText         string   `json:"compact_text"`
	Confidence          float64  `json:"confidence"`
	FirstSeenAt         string   `json:"first_seen_at"`
	LastSeenAt          string   `json:"last_seen_at"`
	MemoryID            string   `json:"memory_id"`
	MemoryType          string   `json:"memory_type"`
	MergeCount          int      `json:"merge_count"`
	ReasonCode          string   `json:"reason_code"`
	Source              string   `json:"source"`
	SourceHashes        []string `json:"source_hashes"`
	Status              string   `json:"status"`
	SupersedesMemoryIDs []string `json:"supersedes_memory_ids"`
	TenantID            string   `json:"tenant_id"`
	UpdatedAt           string   `json:"updated_at"`
	UserID              string   `json:"user_id"`
}

type ResolveCandidateRequest struct {
	Capability       string  `json:"capability"`
	CanonicalKey     string  `json:"canonical_key"`
	CanonicalSubject string  `json:"canonical_subject"`
	CompactText      string  `json:"compact_text"`
	Confidence       float64 `json:"confidence"`
	MemoryType       string  `json:"memory_type"`
	ReasonCode       string  `json:"reason_code"`
	SourceHash       string  `json:"source_hash"`
	TenantID         string  `json:"tenant_id"`
	UpdatedAt        string  `json:"updated_at"`
	UserID           string  `json:"user_id"`
}

type ResolveCandidateResult struct {
	Action   string        `json:"action"`
	Existing *MemoryRecord `json:"existing,omitempty"`
	Reason   string        `json:"reason,omitempty"`
	Score    float64       `json:"score,omitempty"`
}

type MemoryRecord struct {
	Capability          string   `json:"capability"`
	CanonicalKey        string   `json:"canonical_key"`
	CanonicalSubject    string   `json:"canonical_subject"`
	CompactText         string   `json:"compact_text"`
	Confidence          float64  `json:"confidence"`
	FirstSeenAt         string   `json:"first_seen_at"`
	LastSeenAt          string   `json:"last_seen_at"`
	MemoryID            string   `json:"memory_id"`
	MemoryType          string   `json:"memory_type"`
	MergeCount          int      `json:"merge_count"`
	ReasonCode          string   `json:"reason_code"`
	SourceHashes        []string `json:"source_hashes"`
	Status              string   `json:"status"`
	SupersedesMemoryIDs []string `json:"supersedes_memory_ids"`
	UpdatedAt           string   `json:"updated_at"`
}

type DisableRequest struct {
	MemoryID  string `json:"memory_id"`
	TenantID  string `json:"tenant_id"`
	UpdatedAt string `json:"updated_at"`
	UserID    string `json:"user_id"`
}

type DisableOwnerRequest struct {
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

type DisableOwnerResult struct {
	SchemaVersion string `json:"schema_version"`
	Status        string `json:"status"`
	UpdatedAt     string `json:"updated_at"`
	UserID        string `json:"user_id"`
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
		"memory_id":         request.MemoryID,
		"user_id":           request.UserID,
		"memory_type":       request.MemoryType,
		"capability":        request.Capability,
		"canonical_key":     request.CanonicalKey,
		"canonical_subject": request.CanonicalSubject,
		"status":            request.Status,
		"source":            request.Source,
		"compact_text":      request.CompactText,
		"updated_at":        request.UpdatedAt,
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
	if ContainsForbiddenMemoryPayload(request.CompactText) {
		return fmt.Errorf("%w: compact_text contains forbidden raw payload marker", ErrInvalidMemoryProjection)
	}
	return nil
}

func ValidateResolveCandidateRequest(request ResolveCandidateRequest) error {
	probe := UpsertRequest{
		Capability:       request.Capability,
		CanonicalKey:     request.CanonicalKey,
		CanonicalSubject: request.CanonicalSubject,
		CompactText:      request.CompactText,
		MemoryID:         "probe",
		MemoryType:       request.MemoryType,
		ReasonCode:       request.ReasonCode,
		Source:           "inferred",
		Status:           "active",
		UpdatedAt:        request.UpdatedAt,
		UserID:           request.UserID,
	}
	if err := ValidateUpsertRequest(probe); err != nil {
		return err
	}
	if strings.TrimSpace(request.SourceHash) == "" {
		return fmt.Errorf("%w: source_hash is required", ErrInvalidMemoryProjection)
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

func ValidateDisableOwnerRequest(request DisableOwnerRequest) error {
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

func StableMemoryID(userID string, tenantID string, canonicalKey string) string {
	identity := strings.TrimSpace(userID) + ":" + strings.TrimSpace(tenantID) + ":" + strings.TrimSpace(canonicalKey)
	return "mem_" + stableID(identity)[:24]
}

func CanonicalKey(memoryType string, capability string, canonicalSubject string) string {
	return strings.TrimSpace(memoryType) + ":" + strings.TrimSpace(capability) + ":" + NormalizeCanonicalSubject(canonicalSubject)
}

func NormalizeCanonicalSubject(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func MergeSourceHashes(existing []string, next ...string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(existing)+len(next))
	for _, value := range append(existing, next...) {
		normalized := strings.TrimSpace(value)
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		result = append(result, normalized)
	}
	return result
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

func ContainsForbiddenMemoryPayload(value string) bool {
	normalized := strings.ToLower(value)
	for _, marker := range []string{
		"api_key",
		"authorization:",
		"bearer ",
		"provider_response",
		"raw_prompt",
		"raw_source",
		"secret",
		"token",
		"transcript:",
		"密钥",
		"权限",
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
