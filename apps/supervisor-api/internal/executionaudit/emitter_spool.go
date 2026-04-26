package executionaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func (e *Emitter) spoolBatch(events []Event) {
	if e.spoolDir == "" {
		return
	}
	if err := os.MkdirAll(e.spoolDir, 0o700); err != nil {
		e.recordFailure(err)
		return
	}
	e.enforceSpoolLimit()
	path := filepath.Join(e.spoolDir, time.Now().UTC().Format("20060102T150405.000000000Z")+".jsonl")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		e.recordFailure(err)
		return
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			e.recordFailure(closeErr)
		}
	}()
	encoder := json.NewEncoder(file)
	for _, event := range events {
		if err := encoder.Encode(eventPayload(event)); err != nil {
			e.recordFailure(err)
			return
		}
	}
	e.recordSpooled(uint64(len(events)))
}

func (e *Emitter) drainSpool(ctx context.Context) {
	if e.spoolDir == "" {
		return
	}
	matches, err := filepath.Glob(filepath.Join(e.spoolDir, "*.jsonl"))
	if err != nil {
		e.recordFailure(err)
		return
	}
	for _, path := range matches {
		select {
		case <-ctx.Done():
			return
		default:
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			e.recordFailure(err)
			continue
		}
		events := decodeSpoolEvents(raw)
		if len(events) == 0 {
			_ = os.Remove(path)
			continue
		}
		if err := e.postRawPayloadsWithRetry(events); err != nil {
			e.recordFailure(err)
			return
		}
		if err := os.Remove(path); err != nil {
			e.recordFailure(err)
			return
		}
		e.recordSpoolDrained(uint64(len(events)))
	}
}

func (e *Emitter) postRawPayloadsWithRetry(payloads []map[string]any) error {
	var lastErr error
	attempts := e.retryAttempts
	if attempts <= 0 {
		attempts = 1
	}
	for attempt := 1; attempt <= attempts; attempt++ {
		if attempt > 1 {
			e.recordRetry()
			time.Sleep(e.retryBase * time.Duration(attempt-1))
		}
		body, err := json.Marshal(map[string]any{"events": payloads})
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
		if err != nil {
			cancel()
			return err
		}
		request.Header.Set("content-type", "application/json")
		request.Header.Set("x-app-internal-auth", e.sharedSecret)
		response, err := e.client.Do(request)
		cancel()
		if err != nil {
			lastErr = err
			continue
		}
		_, _ = io.Copy(io.Discard, response.Body)
		closeErr := response.Body.Close()
		if closeErr != nil {
			return closeErr
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			lastErr = errHTTPStatus(response.StatusCode)
			continue
		}
		return nil
	}
	return lastErr
}

func decodeSpoolEvents(raw []byte) []map[string]any {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	events := []map[string]any{}
	for {
		var event map[string]any
		if err := decoder.Decode(&event); err != nil {
			if errors.Is(err, io.EOF) {
				return events
			}
			return events
		}
		events = append(events, event)
	}
}

func (e *Emitter) enforceSpoolLimit() {
	if e.spoolDir == "" || e.spoolMaxBytes <= 0 {
		return
	}
	matches, err := filepath.Glob(filepath.Join(e.spoolDir, "*.jsonl"))
	if err != nil {
		e.recordFailure(err)
		return
	}
	var total int64
	for _, path := range matches {
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		total += info.Size()
	}
	for total > e.spoolMaxBytes && len(matches) > 0 {
		path := matches[0]
		matches = matches[1:]
		info, err := os.Stat(path)
		if err == nil {
			total -= info.Size()
		}
		if err := os.Remove(path); err == nil {
			e.recordSpoolDropped()
		}
	}
}
