package executionaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"
)

func (e *Emitter) run(ctx context.Context) {
	defer e.wg.Done()
	e.drainSpool(ctx)
	ticker := time.NewTicker(e.flushEvery)
	defer ticker.Stop()
	batch := make([]Event, 0, e.batchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		events := append([]Event(nil), batch...)
		batch = batch[:0]
		e.postBatch(events)
	}
	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case event, ok := <-e.queue:
			if !ok {
				flush()
				return
			}
			batch = append(batch, event)
			if len(batch) >= e.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (e *Emitter) postBatch(events []Event) {
	if len(events) == 0 {
		return
	}
	if err := e.postBatchWithRetry(events); err != nil {
		e.recordFailure(err)
		if e.spoolDir != "" {
			e.spoolBatch(events)
		}
	}
}

func (e *Emitter) postBatchWithRetry(events []Event) error {
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
		if err := e.postBatchOnce(events); err != nil {
			lastErr = err
			continue
		}
		return nil
	}
	return lastErr
}

func (e *Emitter) postBatchOnce(events []Event) error {
	payloads := make([]map[string]any, 0, len(events))
	for _, event := range events {
		payloads = append(payloads, eventPayload(event))
	}
	body, err := json.Marshal(map[string]any{
		"events": payloads,
	})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-app-internal-auth", e.sharedSecret)

	response, err := e.client.Do(request)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil {
			e.recordFailure(closeErr)
		}
	}()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errHTTPStatus(response.StatusCode)
	}
	return nil
}

type auditHTTPStatusError int

func (e auditHTTPStatusError) Error() string {
	return "execution audit ingest failed with HTTP status " + strconv.Itoa(int(e))
}

func errHTTPStatus(statusCode int) error {
	return auditHTTPStatusError(statusCode)
}
