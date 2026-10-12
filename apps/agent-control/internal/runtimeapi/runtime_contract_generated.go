// Code generated from agent-runtime-control.v1.schema.json. DO NOT EDIT.
package runtimeapi

import (
	"encoding/json"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"time"
)

type TerminalRequest struct {
	RequestID string                             `json:"request_id"`
	Payload   json.RawMessage                    `json:"payload"`
	Activity  executioncontract.ActivityMetadata `json:"activity"`
}

type PayloadGetRequest struct {
	RequestID string                             `json:"request_id"`
	Ref       string                             `json:"ref"`
	Activity  executioncontract.ActivityMetadata `json:"activity"`
}

type PayloadPutRequest struct {
	RequestID string                             `json:"request_id"`
	Ref       string                             `json:"ref"`
	Payload   json.RawMessage                    `json:"payload"`
	Activity  executioncontract.ActivityMetadata `json:"activity"`
}

type PrepareRequest struct {
	RequestID string                             `json:"request_id"`
	Ref       string                             `json:"ref"`
	Operation operation.OperationRequest         `json:"operation_request"`
	Activity  executioncontract.ActivityMetadata `json:"activity"`
}

type InvocationGetRequest struct {
	RequestID    string                             `json:"request_id"`
	InvocationID string                             `json:"invocation_id"`
	InputSHA256  string                             `json:"input_sha256"`
	Activity     executioncontract.ActivityMetadata `json:"activity"`
}

type InvocationBeginRequest struct {
	RequestID    string                             `json:"request_id"`
	InvocationID string                             `json:"invocation_id"`
	InputSHA256  string                             `json:"input_sha256"`
	Activity     executioncontract.ActivityMetadata `json:"activity"`
}

type InvocationCompleteRequest struct {
	RequestID    string                             `json:"request_id"`
	Payload      json.RawMessage                    `json:"payload"`
	InvocationID string                             `json:"invocation_id"`
	Activity     executioncontract.ActivityMetadata `json:"activity"`
}

type ProjectRequest struct {
	RequestID   string                             `json:"request_id"`
	CompletedAt time.Time                          `json:"completed_at"`
	Ref         string                             `json:"ref"`
	Payload     json.RawMessage                    `json:"payload"`
	Activity    executioncontract.ActivityMetadata `json:"activity"`
}

type AnswerCompletedRequest struct {
	RequestID    string                             `json:"request_id"`
	InvocationID string                             `json:"invocation_id"`
	Activity     executioncontract.ActivityMetadata `json:"activity"`
}

type AnswerDeltaRequest struct {
	RequestID    string                             `json:"request_id"`
	InvocationID string                             `json:"invocation_id"`
	Sequence     int                                `json:"sequence"`
	Delta        string                             `json:"delta"`
	Activity     executioncontract.ActivityMetadata `json:"activity"`
}

type RetrievalStatusRequest struct {
	RequestID       string                             `json:"request_id"`
	InvocationID    string                             `json:"invocation_id"`
	RetrievalStatus string                             `json:"retrieval_status"`
	Activity        executioncontract.ActivityMetadata `json:"activity"`
}

type CollectionBindRequest struct {
	RequestID  string                             `json:"request_id"`
	Collection string                             `json:"collection"`
	Activity   executioncontract.ActivityMetadata `json:"activity"`
}

type FinalizeRequest struct {
	RequestID string                             `json:"request_id"`
	Ref       string                             `json:"ref"`
	Operation FinalizationAdmission              `json:"operation_request"`
	Activity  executioncontract.ActivityMetadata `json:"activity"`
}

type PreparedOperation struct {
	Request operation.OperationRequest `json:"operation_request"`
	Wire    map[string]any             `json:"wire"`
}

type PrepareResponse struct {
	Prepared    PreparedOperation `json:"prepared"`
	ToolContext map[string]any    `json:"tool_context"`
	CreatedAt   time.Time         `json:"created_at"`
}

type PayloadResponse struct {
	Payload json.RawMessage `json:"payload"`
}

type ProjectionResponse struct {
	Ref string `json:"ref"`
}

type RuntimeAcknowledgement struct {
}

type FinalizationAdmission struct {
	AdmissionSnapshot execution.AgentAdmissionSnapshot `json:"admission_snapshot"`
}
