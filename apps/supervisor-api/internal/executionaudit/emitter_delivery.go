package executionaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
)

func (e *Emitter) postBatchOnce(ctx context.Context, events []Event) error {
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

	requestCtx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, e.endpoint, bytes.NewReader(body))
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
