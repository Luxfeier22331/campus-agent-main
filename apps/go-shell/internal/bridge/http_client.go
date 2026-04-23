package bridge

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
)

const (
	answerPath = "/internal/bridge/supervisor/answer"
	readyzPath = "/internal/bridge/readyz"
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
		client:       &http.Client{},
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
	defer response.Body.Close()

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return rawResponse{}, err
	}

	return rawResponse{
		StatusCode: response.StatusCode,
		Body:       responseBody,
		Kind:       strings.TrimSpace(response.Header.Get("x-supervisor-bridge-kind")),
	}, nil
}
