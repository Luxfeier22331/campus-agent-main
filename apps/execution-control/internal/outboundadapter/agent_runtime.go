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

// AgentRuntimeStreamClient is the typed outbound port used by the Temporal
// adapter. The response body remains a stream because SSE decoding belongs to
// the Temporal activity owner.
type AgentRuntimeStreamClient interface {
	Stream(context.Context, AgentRuntimeStreamRequest) (AgentRuntimeStreamResponse, error)
}

type AgentRuntimeStreamRequest struct {
	Body      []byte
	RequestID string
}

type AgentRuntimeStreamResponse struct {
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
func NewAgentRuntimeClient(cfg config.Config) AgentRuntimeStreamClient {
	return &agentRuntimeHTTPClient{
		baseURL:      strings.TrimRight(strings.TrimSpace(cfg.AgentRuntimeBaseURL), "/"),
		sharedSecret: strings.TrimSpace(cfg.AgentRuntimeSharedSecret),
		httpClient:   NoRedirectHTTPClient(http.DefaultClient),
	}
}

func (client *agentRuntimeHTTPClient) Stream(
	ctx context.Context,
	request AgentRuntimeStreamRequest,
) (AgentRuntimeStreamResponse, error) {
	if client == nil || client.baseURL == "" || client.sharedSecret == "" {
		return AgentRuntimeStreamResponse{}, &AgentRuntimeRequestError{
			Cause: errors.New("agent runtime base URL and shared secret are required"),
		}
	}
	requestURL := client.baseURL + "/internal/agent-requests/stream"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(request.Body))
	if err != nil {
		return AgentRuntimeStreamResponse{}, &AgentRuntimeRequestError{Build: true, Cause: err}
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
		return AgentRuntimeStreamResponse{}, &AgentRuntimeRequestError{Cause: err}
	}
	return AgentRuntimeStreamResponse{
		StatusCode: httpResponse.StatusCode,
		Body:       httpResponse.Body,
	}, nil
}
