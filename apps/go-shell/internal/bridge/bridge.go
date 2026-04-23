package bridge

import (
	"context"
	"encoding/json"
)

type Request struct {
	Payload json.RawMessage `json:"payload"`
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

type Client interface {
	Execute(ctx context.Context, request Request) (ExecuteResponse, error)
	Readyz(ctx context.Context) (ReadyzResponse, error)
	Configured() bool
}
