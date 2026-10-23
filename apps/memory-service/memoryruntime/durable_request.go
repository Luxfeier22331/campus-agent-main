package memoryruntime

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var ErrRequestConflict = errors.New("memory command identity conflicts with accepted input")
var ErrRequestNotFound = errors.New("memory command not found")

// DurableRequest is the Memory-owned input and recovery checkpoint. The workflow
// only carries ID, so recovery never loads an answer run or conversation record.
type DurableRequest struct {
	ID         string          `json:"command_id"`
	Kind       string          `json:"kind"`
	OwnerHash  string          `json:"-"`
	Payload    json.RawMessage `json:"-"`
	State      string          `json:"status"`
	Result     json.RawMessage `json:"result,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
	Dispatched bool            `json:"-"`
}
type DurableRequestStore interface {
	AcceptRequest(context.Context, DurableRequest) (DurableRequest, error)
	GetRequest(context.Context, string) (DurableRequest, error)
	PendingRequests(context.Context, int) ([]DurableRequest, error)
	MarkDispatched(context.Context, string) error
	SaveRequestProgress(context.Context, string, string, any) error
}
