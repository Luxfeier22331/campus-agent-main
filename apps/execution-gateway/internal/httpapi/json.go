package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/execution"
)

func (s *Server) readJSONBody(response http.ResponseWriter, request *http.Request) (json.RawMessage, bool) {
	limited := http.MaxBytesReader(response, request.Body, s.config.RequestBodyLimitBytes)

	body, err := io.ReadAll(limited)
	closeErr := limited.Close()
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			setOutcome(response, "request_body_too_large")
			writeError(
				response,
				http.StatusRequestEntityTooLarge,
				"request_body_too_large",
				"Request body exceeds supervisor execution limit.",
				false,
			)
		} else {
			setOutcome(response, "request_body_unreadable")
			writeError(
				response,
				http.StatusBadRequest,
				"request_body_unreadable",
				"Request body could not be fully read.",
				false,
			)
		}
		return nil, false
	}
	if closeErr != nil {
		setOutcome(response, "request_body_unreadable")
		writeError(
			response,
			http.StatusBadRequest,
			"request_body_unreadable",
			"Request body could not be fully read.",
			false,
		)
		return nil, false
	}
	if len(body) == 0 {
		return json.RawMessage(`{}`), true
	}

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil || decoded == nil {
		setOutcome(response, "invalid_json")
		writeError(
			response,
			http.StatusBadRequest,
			"invalid_json",
			"Request body must be a JSON object.",
			false,
		)
		return nil, false
	}

	return json.RawMessage(body), true
}

func writeError(
	response http.ResponseWriter,
	status int,
	code string,
	message string,
	retryable bool,
) {
	writeJSON(response, status, map[string]any{
		"error": errorInfo{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
	})
}

func writeRuntimeFailure(
	response http.ResponseWriter,
	status int,
	code string,
	message string,
	retryable bool,
	requestID string,
	traceID string,
	failureKind string,
) {
	writeJSON(response, status, map[string]any{
		"error": errorInfo{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
		"failure_kind": failureKind,
		"request_id":   requestID,
		"trace_id":     traceID,
	})
}

func writeRetryableAdmissionError(
	response http.ResponseWriter,
	queueTimeoutMS int,
	code string,
	message string,
) {
	response.Header().Set("retry-after", retryAfterSeconds(queueTimeoutMS))
	writeError(response, http.StatusServiceUnavailable, code, message, true)
}

func retryAfterSeconds(timeoutMS int) string {
	if timeoutMS <= 0 {
		return "1"
	}
	seconds := (timeoutMS + 999) / 1000
	if seconds <= 0 {
		seconds = 1
	}
	return strconv.Itoa(seconds)
}

func writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}

func writeExecutionError(response http.ResponseWriter, httpErr *execution.HTTPError) {
	writeError(
		response,
		httpErr.Status,
		httpErr.Code,
		httpErr.Message,
		httpErr.Retryable,
	)
}

func lowerHeaders(headers http.Header) map[string]string {
	normalized := make(map[string]string, len(headers))
	for key, values := range headers {
		if len(values) > 0 {
			normalized[http.CanonicalHeaderKey(key)] = values[0]
			normalized[toLowerASCII(key)] = values[0]
		}
	}
	return normalized
}

func writeRawJSON(response http.ResponseWriter, status int, body []byte) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_, _ = response.Write(body)
}

func injectTraceID(rawBody []byte, traceID string) ([]byte, error) {
	body, err := decodeJSONObject(rawBody)
	if err != nil {
		return nil, err
	}
	body["trace_id"] = traceID
	return json.Marshal(body)
}

func normalizeJSONObjectJSON(rawBody []byte) ([]byte, error) {
	body, err := decodeJSONObject(rawBody)
	if err != nil {
		return nil, err
	}
	return json.Marshal(body)
}

func bridgeErrorCode(rawBody []byte) string {
	body, err := decodeJSONObject(rawBody)
	if err != nil {
		return ""
	}
	errorBody, ok := body["error"].(map[string]any)
	if !ok {
		return ""
	}
	code, _ := errorBody["code"].(string)
	return strings.TrimSpace(code)
}

func decodeJSONObject(rawBody []byte) (map[string]any, error) {
	var body map[string]any
	if err := json.Unmarshal(rawBody, &body); err != nil || body == nil {
		return nil, errors.New("invalid JSON object")
	}
	return body, nil
}

func defaultString(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}

func toLowerASCII(value string) string {
	buffer := []byte(value)
	for index, item := range buffer {
		if item >= 'A' && item <= 'Z' {
			buffer[index] = item + ('a' - 'A')
		}
	}
	return string(buffer)
}
