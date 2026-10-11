package outboundadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	memoryruntime "github.com/MUC-WIKI/campus-agent/packages/memory-api-go"
	"io"
	"net/http"
	"strings"
	"time"
)

// MemoryClient only uses Memory's public API; no provider or state-store access.
type MemoryClient struct {
	BaseURL, Secret string
	Client          *http.Client
}

func NewMemoryClient(baseURL, secret string) *MemoryClient {
	return &MemoryClient{BaseURL: strings.TrimRight(baseURL, "/"), Secret: secret, Client: &http.Client{Timeout: 95 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (c *MemoryClient) post(ctx context.Context, path string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-memory-origin-auth", c.Secret)
	resp, err := c.Client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == 409 {
		return memoryruntime.ErrMemoryFenceConflict
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("memory service status %d", resp.StatusCode)
	}
	if out == nil {
		_, err = io.Copy(io.Discard, resp.Body)
		return err
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}
func (c *MemoryClient) Append(ctx context.Context, in memoryruntime.AppendConversationTurnRequest) error {
	return c.post(ctx, "/internal/memory/appends", in, nil)
}
