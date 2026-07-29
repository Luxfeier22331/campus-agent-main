package execution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrProtectedPayloadNotFound  = errors.New("protected payload not found")
	ErrProtectedPayloadConflict  = errors.New("protected payload conflict")
	ErrProtectedPayloadRunClosed = errors.New("protected payload run is closed")
	ErrInvalidProtectedPayload   = errors.New("invalid protected payload")
)

// ProtectedPayload is an encrypted, activity-local value. The ciphertext is
// intentionally kept outside the ordinary run/step/event projections and is
// never passed through a Temporal workflow argument or result.
type ProtectedPayload struct {
	RunID         string
	PayloadRef    string
	Kind          string
	Ciphertext    []byte
	PayloadSHA256 string
	CreatedAt     time.Time
}

type ProtectedPayloadStore interface {
	PutProtectedPayload(context.Context, ProtectedPayload) (ProtectedPayload, error)
	GetProtectedPayload(context.Context, string, string, string) (ProtectedPayload, error)
	DeleteProtectedPayloads(context.Context, string) error
}

func validateProtectedPayload(payload ProtectedPayload) error {
	if strings.TrimSpace(payload.RunID) == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidProtectedPayload)
	}
	if strings.TrimSpace(payload.PayloadRef) == "" {
		return fmt.Errorf("%w: payload_ref is required", ErrInvalidProtectedPayload)
	}
	if strings.TrimSpace(payload.Kind) == "" {
		return fmt.Errorf("%w: kind is required", ErrInvalidProtectedPayload)
	}
	if len(payload.Ciphertext) == 0 {
		return fmt.Errorf("%w: ciphertext is required", ErrInvalidProtectedPayload)
	}
	if len(payload.PayloadSHA256) != sha256.Size*2 {
		return fmt.Errorf("%w: payload_sha256 must be a SHA-256", ErrInvalidProtectedPayload)
	}
	if _, err := hex.DecodeString(payload.PayloadSHA256); err != nil {
		return fmt.Errorf("%w: payload_sha256 must be hexadecimal", ErrInvalidProtectedPayload)
	}
	if payload.CreatedAt.IsZero() {
		return fmt.Errorf("%w: created_at is required", ErrInvalidProtectedPayload)
	}
	return nil
}
