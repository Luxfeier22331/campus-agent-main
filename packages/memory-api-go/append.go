package memoryapi

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrInvalidMemoryProjection = errors.New("invalid memory runtime projection")
var ErrMemoryFenceConflict = errors.New("memory fence conflict")

type AppendConversationTurnRequest struct {
	OwnerGeneration      int64  `json:"owner_generation"`
	RequestID            string `json:"request_id"`
	TenantID             string `json:"tenant_id,omitempty"`
	ThreadID             string `json:"thread_id"`
	UserID               string `json:"user_id"`
	UserMessage          string `json:"user_message"`
	UserMessageCreatedAt string `json:"user_message_created_at"`
	UserMessageID        string `json:"user_message_id"`
}

func ValidateAppendConversationTurnRequest(request AppendConversationTurnRequest) error {
	if request.OwnerGeneration < 1 {
		return fmt.Errorf("%w: valid owner generation and sequence are required", ErrInvalidMemoryProjection)
	}
	required := map[string]string{
		"request_id":              request.RequestID,
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
