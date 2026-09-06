package outboundadapter

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
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

type agentRuntimeHTTPClient struct {
	baseURL      string
	sharedSecret string
	httpClient   *http.Client
}

// NewAgentRuntimeClient constructs the sole HTTP implementation for the
// agent-runtime stream endpoint. Missing configuration is retained until the
// call so readiness/activity error contracts remain unchanged.
func NewAgentRuntimeClient(cfg config.Config) AgentRuntimeClient {
	return &agentRuntimeHTTPClient{
		baseURL:      strings.TrimRight(strings.TrimSpace(cfg.AgentRuntimeBaseURL), "/"),
		sharedSecret: strings.TrimSpace(cfg.AgentRuntimeSharedSecret),
		httpClient:   NoRedirectHTTPClient(http.DefaultClient),
	}
}

func (client *agentRuntimeHTTPClient) Execute(
	ctx context.Context,
	request AgentRuntimeRequest,
) (AgentRuntimeResponse, error) {
	if client == nil || client.baseURL == "" || client.sharedSecret == "" {
		return AgentRuntimeResponse{}, &AgentRuntimeRequestError{
			Cause: errors.New("agent runtime base URL and shared secret are required"),
		}
	}
	requestPath := "/internal/agent-requests"
	if request.Stream {
		requestPath += "/stream"
	}
	requestURL := client.baseURL + requestPath
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(request.Body))
	if err != nil {
		return AgentRuntimeResponse{}, &AgentRuntimeRequestError{Build: true, Cause: err}
	}
	httpRequest.Header.Set("authorization", "Bearer "+client.sharedSecret)
	httpRequest.Header.Set("content-type", "application/json")
	for key, value := range telemetry.InjectExecutionTraceHeaders(ctx, request.RequestID) {
		httpRequest.Header.Set(key, value)
	}
	httpResponse, err := client.httpClient.Do(httpRequest)
	if err != nil {
		if httpResponse != nil && httpResponse.Body != nil {
			_ = httpResponse.Body.Close()
		}
		return AgentRuntimeResponse{}, &AgentRuntimeRequestError{Cause: err}
	}
	return AgentRuntimeResponse{
		StatusCode: httpResponse.StatusCode,
		Body:       httpResponse.Body,
	}, nil
}
