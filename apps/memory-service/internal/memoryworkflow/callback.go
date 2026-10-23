package memoryworkflow

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type Callback struct {
	BaseURL, Secret string
	Client          *http.Client
}

func (c *Callback) WritePersonalMemoryCommandResult(ctx context.Context, in memoryapplication.PersonalMemoryCommandResultRequest) error {
	data, err := json.Marshal(map[string]string{"status": in.Status, "error_code": in.ErrorCode})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, strings.TrimRight(c.BaseURL, "/")+"/api/internal/profile-memory/commands/"+url.PathEscape(in.CommandID)+"/result", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-app-product-callback-auth", c.Secret)
	resp, err := c.Client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("memory product callback status %d", resp.StatusCode)
	}
	return nil
}
