package autoscaler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type SnapshotSource interface {
	FetchTemporalTaskQueueSnapshots(context.Context, int) ([]TemporalTaskQueueSnapshot, error)
}

type ActuationSource interface {
	FetchWorkerAutoscalerActuations(context.Context, int) ([]Actuation, error)
}

type RuntimePublisher interface {
	PublishRuntimePayload(context.Context, AppAPIRuntimePayload) error
}

type AppAPIClient struct {
	BaseURL      string
	HTTPClient   *http.Client
	SharedSecret string
	Timeout      time.Duration
}

type temporalTaskQueueSnapshotResponse struct {
	Snapshots []TemporalTaskQueueSnapshot `json:"snapshots"`
}

type workerAutoscalerActuationResponse struct {
	Actuations []Actuation `json:"actuations"`
}

func (c AppAPIClient) FetchTemporalTaskQueueSnapshots(
	ctx context.Context,
	limit int,
) ([]TemporalTaskQueueSnapshot, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("app-api base URL is required")
	}
	if limit < 1 {
		return nil, fmt.Errorf("snapshot limit must be positive")
	}
	requestURL, err := url.Parse(baseURL + "/api/internal/operator/runtime/temporal-task-queues")
	if err != nil {
		return nil, err
	}
	query := requestURL.Query()
	query.Set("limit", strconv.Itoa(limit))
	requestURL.RawQuery = query.Encode()

	request, err := c.newRequest(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, err
	}
	responseBody, err := c.do(request)
	if err != nil {
		return nil, err
	}
	var payload temporalTaskQueueSnapshotResponse
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, err
	}
	if len(payload.Snapshots) == 0 {
		return nil, fmt.Errorf("app-api returned no temporal task queue snapshots")
	}
	return payload.Snapshots, nil
}

func (c AppAPIClient) FetchWorkerAutoscalerActuations(
	ctx context.Context,
	limit int,
) ([]Actuation, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("app-api base URL is required")
	}
	if limit < 1 {
		return nil, fmt.Errorf("actuation limit must be positive")
	}
	requestURL, err := url.Parse(baseURL + "/api/internal/operator/runtime/autoscaler/actuations")
	if err != nil {
		return nil, err
	}
	query := requestURL.Query()
	query.Set("limit", strconv.Itoa(limit))
	requestURL.RawQuery = query.Encode()

	request, err := c.newRequest(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, err
	}
	responseBody, err := c.do(request)
	if err != nil {
		return nil, err
	}
	var payload workerAutoscalerActuationResponse
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, err
	}
	return payload.Actuations, nil
}

func (c AppAPIClient) PublishRuntimePayload(
	ctx context.Context,
	payload AppAPIRuntimePayload,
) error {
	baseURL := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if baseURL == "" {
		return fmt.Errorf("app-api base URL is required")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := c.newRequest(
		ctx,
		http.MethodPost,
		baseURL+"/api/internal/operator/runtime/temporal-task-queue-snapshots",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	_, err = c.do(request)
	return err
}

func (c AppAPIClient) newRequest(
	ctx context.Context,
	method string,
	requestURL string,
	body io.Reader,
) (*http.Request, error) {
	secret := strings.TrimSpace(c.SharedSecret)
	if secret == "" {
		return nil, fmt.Errorf("app-api internal shared secret is required")
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	request, err := http.NewRequestWithContext(requestCtx, method, requestURL, body)
	if err != nil {
		cancel()
		return nil, err
	}
	context.AfterFunc(request.Context(), cancel)
	request.Header.Set("x-app-internal-auth", secret)
	return request, nil
}

func (c AppAPIClient) do(request *http.Request) ([]byte, error) {
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("app-api runtime endpoint returned %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	if readErr != nil {
		return nil, readErr
	}
	return body, nil
}
