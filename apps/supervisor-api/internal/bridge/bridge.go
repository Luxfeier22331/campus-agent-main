package bridge

import (
	"context"
	"encoding/json"
)

type Request struct {
	Payload      json.RawMessage   `json:"payload"`
	TraceHeaders map[string]string `json:"-"`
}

type ExecuteResponse struct {
	StatusCode int             `json:"status_code"`
	Body       json.RawMessage `json:"body"`
	Kind       string          `json:"kind"`
}

type ReadyzResponse struct {
	StatusCode int             `json:"status_code"`
	Body       json.RawMessage `json:"body"`
}

type CancelRequest struct {
	RequestID string `json:"request_id"`
	Reason    string `json:"reason"`
}

type CancelResponse struct {
	StatusCode int             `json:"status_code"`
	Body       json.RawMessage `json:"body"`
}

type Client interface {
	Execute(ctx context.Context, request Request) (ExecuteResponse, error)
	Readyz(ctx context.Context) (ReadyzResponse, error)
	Cancel(ctx context.Context, request CancelRequest) (CancelResponse, error)
	Configured() bool
}
