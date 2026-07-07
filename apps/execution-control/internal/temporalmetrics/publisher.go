package temporalmetrics

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Publisher struct {
	BaseURL      string
	HTTPClient   *http.Client
	SharedSecret string
	Timeout      time.Duration
}

func (p Publisher) Publish(ctx context.Context, payload SnapshotPayload) error {
	baseURL := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	if baseURL == "" {
		return fmt.Errorf("app-api base URL is required")
	}
	secret := strings.TrimSpace(p.SharedSecret)
	if secret == "" {
		return fmt.Errorf("app-api internal shared secret is required")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		baseURL+"/api/internal/operator/runtime/temporal-task-queue-snapshots",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-app-internal-auth", secret)
	client := p.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("app-api temporal metrics ingest returned %d: %s", response.StatusCode, strings.TrimSpace(string(limited)))
	}
	return nil
}
