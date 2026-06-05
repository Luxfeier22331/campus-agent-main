package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	answerPath           = "/internal/bridge/supervisor/answer"
	durableExecutionPath = "/internal/bridge/durable/execution"
	readyzPath           = "/internal/bridge/readyz"
	cancelPath           = "/internal/bridge/execution/cancel"
)

const defaultResponseLimitBytes int64 = 1_048_576

var ErrResponseTooLarge = errors.New("supervisor bridge response exceeds limit")

type HTTPClient struct {
	baseURL            string
	sharedSecret       string
	responseLimitBytes int64
	client             *http.Client
}

func NewHTTPClient(baseURL string, sharedSecret string) *HTTPClient {
	return NewHTTPClientWithResponseLimit(baseURL, sharedSecret, defaultResponseLimitBytes)
}

func NewHTTPClientWithResponseLimit(
	baseURL string,
	sharedSecret string,
	responseLimitBytes int64,
) *HTTPClient {
	if responseLimitBytes <= 0 {
		responseLimitBytes = defaultResponseLimitBytes
	}
	return &HTTPClient{
		baseURL:            strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		sharedSecret:       strings.TrimSpace(sharedSecret),
		responseLimitBytes: responseLimitBytes,
		client: &http.Client{
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 32,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

func (c *HTTPClient) Configured() bool {
	return c != nil && c.baseURL != "" && c.sharedSecret != ""
}

func (c *HTTPClient) Execute(ctx context.Context, request Request) (ExecuteResponse, error) {
	response, err := c.do(ctx, http.MethodPost, answerPath, request.Payload, request.TraceHeaders)
	if err != nil {
		return ExecuteResponse{}, err
	}
	return ExecuteResponse{
		StatusCode: response.StatusCode,
		Body:       response.Body,
		Kind:       response.Kind,
	}, nil
}

func (c *HTTPClient) ExecuteDurable(
	ctx context.Context,
	request DurableExecutionRequest,
) (ExecuteResponse, error) {
	body, err := json.Marshal(durableExecutionWireRequest{
		BridgeVersion: "supervisor_durable_worker_v1",
		RunID:         request.RunID,
		LeaseID:       request.LeaseID,
		StepID:        request.StepID,
		Lane:          request.Lane,
		WorkerID:      request.WorkerID,
		Attempt:       request.Attempt,
		Execution:     request.Execution.Payload,
	})
	if err != nil {
		return ExecuteResponse{}, err
	}
	response, err := c.do(
		ctx,
		http.MethodPost,
		durableExecutionPath,
		body,
		request.Execution.TraceHeaders,
	)
	if err != nil {
		return ExecuteResponse{}, err
	}
	return ExecuteResponse{
		StatusCode: response.StatusCode,
		Body:       response.Body,
		Kind:       response.Kind,
	}, nil
}

func (c *HTTPClient) Readyz(ctx context.Context) (ReadyzResponse, error) {
	response, err := c.do(ctx, http.MethodGet, readyzPath, nil, nil)
	if err != nil {
		return ReadyzResponse{}, err
	}
	return ReadyzResponse{
		StatusCode: response.StatusCode,
		Body:       response.Body,
	}, nil
}

func (c *HTTPClient) Cancel(ctx context.Context, request CancelRequest) (CancelResponse, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return CancelResponse{}, err
	}
	response, err := c.do(ctx, http.MethodPost, cancelPath, body, nil)
	if err != nil {
		return CancelResponse{}, err
	}
	return CancelResponse{
		StatusCode: response.StatusCode,
		Body:       response.Body,
	}, nil
}

type durableExecutionWireRequest struct {
	BridgeVersion string          `json:"bridge_version"`
	RunID         string          `json:"run_id"`
	LeaseID       string          `json:"lease_id"`
	StepID        string          `json:"step_id"`
	Lane          string          `json:"lane"`
	WorkerID      string          `json:"worker_id"`
	Attempt       int             `json:"attempt"`
	Execution     json.RawMessage `json:"execution"`
}

type rawResponse struct {
	StatusCode int
	Body       []byte
	Kind       string
}

func (c *HTTPClient) do(
	ctx context.Context,
	method string,
	path string,
	body []byte,
	traceHeaders map[string]string,
) (rawResponse, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		method,
		c.baseURL+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return rawResponse{}, err
	}
	request.Header.Set("x-supervisor-bridge-auth", c.sharedSecret)
	for key, value := range traceHeaders {
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		trimmedValue := strings.TrimSpace(value)
		if trimmedValue == "" || !allowedTraceHeader(normalizedKey) {
			continue
		}
		request.Header.Set(normalizedKey, trimmedValue)
	}
	if method == http.MethodPost {
		request.Header.Set("content-type", "application/json")
	}

	response, err := c.client.Do(request)
	if err != nil {
		return rawResponse{}, err
	}

	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, c.responseLimitBytes+1))
	closeErr := response.Body.Close()
	if readErr != nil {
		return rawResponse{}, readErr
	}
	if int64(len(responseBody)) > c.responseLimitBytes {
		return rawResponse{}, ErrResponseTooLarge
	}
	if closeErr != nil {
		return rawResponse{}, closeErr
	}

	return rawResponse{
		StatusCode: response.StatusCode,
		Body:       responseBody,
		Kind:       strings.TrimSpace(response.Header.Get("x-supervisor-bridge-kind")),
	}, nil
}

func allowedTraceHeader(key string) bool {
	switch key {
	case "traceparent", "baggage", "x-request-id", "x-trace-id":
		return true
	default:
		return false
	}
}
