package outboundadapter

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

type agentRuntimeHTTPClient struct {
	baseURL      string
	sharedSecret string
	httpClient   *http.Client
}

// NewAgentRuntimeClient constructs the sole HTTP implementation for the
// agent-runtime stream endpoint. Missing configuration is retained until the
// call so readiness/activity error contracts remain unchanged.
func NewAgentRuntimeClient(cfg config.Config) executionapplication.AgentRuntimeClient {
	return &agentRuntimeHTTPClient{
		baseURL:      strings.TrimRight(strings.TrimSpace(cfg.AgentRuntimeBaseURL), "/"),
		sharedSecret: strings.TrimSpace(cfg.AgentRuntimeSharedSecret),
		httpClient:   NoRedirectHTTPClient(http.DefaultClient),
	}
}

func (client *agentRuntimeHTTPClient) Execute(
	ctx context.Context,
	request executionapplication.AgentRuntimeRequest,
) (executionapplication.AgentRuntimeResponse, error) {
	if client == nil || client.baseURL == "" || client.sharedSecret == "" {
		return executionapplication.AgentRuntimeResponse{}, &executionapplication.AgentRuntimeRequestError{
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
		return executionapplication.AgentRuntimeResponse{}, &executionapplication.AgentRuntimeRequestError{Build: true, Cause: err}
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
		return executionapplication.AgentRuntimeResponse{}, &executionapplication.AgentRuntimeRequestError{Cause: err}
	}
	return executionapplication.AgentRuntimeResponse{
		StatusCode: httpResponse.StatusCode,
		Body:       httpResponse.Body,
	}, nil
}
