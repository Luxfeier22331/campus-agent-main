package executionapplication

import (
	"context"
	"io"
	"time"
)

// AgentRuntimeClient is the typed outbound port used by the Temporal adapter.
// Response decoding remains with the activity owner because solve/replan
// operations return structured JSON while answer synthesis returns SSE.
type AgentRuntimeClient interface {
	Execute(context.Context, AgentRuntimeRequest) (AgentRuntimeResponse, error)
}

type AgentRuntimeRequest struct {
	Body      []byte
	RequestID string
	Stream    bool
}

type AgentRuntimeResponse struct {
	StatusCode int
	Body       io.ReadCloser
}

// AgentRuntimeRequestError keeps request construction failures distinct from
// transport failures without exposing HTTP implementation details to the
// Temporal activity.
type AgentRuntimeRequestError struct {
	Build bool
	Cause error
}

func (err *AgentRuntimeRequestError) Error() string {
	if err == nil || err.Cause == nil {
		return "agent runtime request failed"
	}
	return "agent runtime request failed"
}

func (err *AgentRuntimeRequestError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}

// ProductCallbackClient is the typed app-api callback port used by terminal
// Temporal activities. It owns callback URL construction and HTTP policy;
// Temporal owns the surrounding activity error mapping.
type ProductCallbackClient interface {
	WritePersonalMemoryCommandResult(context.Context, PersonalMemoryCommandResultRequest) error
	WriteExecutionFinalization(context.Context, ExecutionFinalizationRequest) error
}

type PersonalMemoryCommandResultRequest struct {
	CommandID string
	ErrorCode string
	Status    string
}

type ExecutionFinalizationRequest struct {
	RequestID   string
	CompletedAt time.Time
	Response    map[string]any
}

// ProductCallbackError deliberately keeps the response body out of the error
// value. It gives the Temporal adapter stable classification while preserving
// the existing no-diagnostic-details contract.
type ProductCallbackError struct {
	Code  string
	Cause error
}

func (err *ProductCallbackError) Error() string {
	if err == nil || err.Code == "" {
		return "product callback failed"
	}
	return "product callback failed"
}

func (err *ProductCallbackError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}
