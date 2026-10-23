package executionapplication

import (
	"context"
	"encoding/json"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

type RuntimePayloadStore interface {
	PutRuntimePayload(context.Context, string, string, json.RawMessage) error
	GetRuntimePayload(context.Context, string, string) (json.RawMessage, error)
}

// RuntimePayloadLifecycle is owned by Control; Temporal receipts remain durable.
type RuntimePayloadLifecycle interface {
	ListTerminalRuntimePayloads(context.Context, string, int) ([]execution.RuntimePayloadExecution, error)
	DeleteRuntimePayloads(context.Context, string) error
}
