package memoryruntime

import (
	"fmt"
	memoryapi "github.com/MUC-WIKI/campus-agent/packages/memory-api-go"
	"strconv"
	"strings"
	"time"
)

var ErrInvalidMemoryProjection = memoryapi.ErrInvalidMemoryProjection

const PersonalMemoryCommandSchemaVersion = "personal_memory_command.v3"

type RecallRequest struct {
	OwnerGeneration int64             `json:"owner_generation"`
	QueryTimestamp  string            `json:"query_timestamp"`
	RequestID       string            `json:"request_id"`
	SessionSlots    map[string]string `json:"session_slots,omitempty"`
	TenantID        string            `json:"tenant_id"`
	ThreadID        string            `json:"thread_id"`
	UserGoal        string            `json:"user_goal"`
	UserID          string            `json:"user_id"`
}

type RecallResult struct {
	Facts             []string `json:"facts"`
	ContextCharBudget int      `json:"context_char_budget"`
}

type AppendConversationTurnRequest = memoryapi.AppendConversationTurnRequest

type PersonalMemoryCommandItem struct {
	Text string `json:"text,omitempty"`
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
	SourceUpdatedAt   string                     `json:"source_updated_at"`
	SubjectScopeHash  string                     `json:"-"`
	SupersessionScope string                     `json:"supersession_scope"`
	TenantID          string                     `json:"tenant_id"`
	UserID            string                     `json:"user_id"`
}

type PersonalMemoryCommandResult struct {
	CommandID string `json:"command_id"`
	ErrorCode string `json:"error_code,omitempty"`
	Status    string `json:"status"`
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
	case "memory_add":
		if request.Item == nil || strings.TrimSpace(request.SubjectID) == "" {
			return fmt.Errorf("%w: memory payload and subject_id are required", ErrInvalidMemoryProjection)
		}
		if strings.TrimSpace(request.Item.Text) == "" {
			return fmt.Errorf("%w: memory text is required", ErrInvalidMemoryProjection)
		}
		if request.SupersessionScope != "memory:"+strings.TrimSpace(request.SubjectID) {
			return fmt.Errorf("%w: memory scope is invalid", ErrInvalidMemoryProjection)
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
	if request.OwnerGeneration < 1 {
		return fmt.Errorf("%w: valid owner generation and sequence are required", ErrInvalidMemoryProjection)
	}
	if strings.TrimSpace(request.RequestID) == "" {
		return fmt.Errorf("%w: request_id is required", ErrInvalidMemoryProjection)
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
	return memoryapi.ValidateAppendConversationTurnRequest(request)
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
