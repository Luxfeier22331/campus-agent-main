// Code generated from agent-runtime-control.v1.schema.json. DO NOT EDIT.
package executionapplication

import (
	"encoding/json"
)

type RuntimeInvocationResult struct {
	Disposition string          `json:"disposition,omitempty"`
	Output      json.RawMessage `json:"output,omitempty"`
}
