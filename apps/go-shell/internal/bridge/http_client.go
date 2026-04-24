package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	answerPath = "/internal/bridge/supervisor/answer"
	readyzPath = "/internal/bridge/readyz"
	cancelPath = "/internal/bridge/execution/cancel"
)

type HTTPClient struct {
	baseURL      string
	sharedSecret string
	client       *http.Client
}

func NewHTTPClient(baseURL string, sharedSecret string) *HTTPClient {
	return &HTTPClient{
		baseURL:      strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		sharedSecret: strings.TrimSpace(sharedSecret),
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
	response, err := c.do(ctx, http.MethodPost, answerPath, request.Payload)
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
	response, err := c.do(ctx, http.MethodGet, readyzPath, nil)
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
	response, err := c.do(ctx, http.MethodPost, cancelPath, body)
	if err != nil {
		return CancelResponse{}, err
	}
	return CancelResponse{
		StatusCode: response.StatusCode,
		Body:       response.Body,
	}, nil
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
	if method == http.MethodPost {
		request.Header.Set("content-type", "application/json")
	}

	response, err := c.client.Do(request)
	if err != nil {
		return rawResponse{}, err
	}

	responseBody, readErr := io.ReadAll(response.Body)
	closeErr := response.Body.Close()
	if readErr != nil {
		return rawResponse{}, readErr
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
