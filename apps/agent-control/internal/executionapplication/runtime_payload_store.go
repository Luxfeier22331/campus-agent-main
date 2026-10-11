package executionapplication

import (
	"context"
	"encoding/json"
)

type RuntimePayloadStore interface {
	PutRuntimePayload(context.Context, string, string, json.RawMessage) error
	GetRuntimePayload(context.Context, string, string) (json.RawMessage, error)
}
