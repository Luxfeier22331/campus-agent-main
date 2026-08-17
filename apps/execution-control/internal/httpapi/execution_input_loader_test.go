package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestExecutionInputLoaderLoadsAndValidatesFrozenBytes(t *testing.T) {
	run, body := executionInputTestRun(t)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			t.Fatalf("method = %s, want GET", request.Method)
		}
		if request.URL.Path != "/api/internal/execution/runs/run-input-001/input" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.Header.Get("x-app-execution-auth") != "input-secret" {
			t.Fatalf("execution input credential was not sent")
		}
		if request.Header.Get("Accept-Encoding") != "identity" {
			t.Fatalf("Accept-Encoding = %q, want identity", request.Header.Get("Accept-Encoding"))
		}
		response.Header().Set("Cache-Control", "private, no-store")
		response.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = response.Write(body)
	}))
	defer server.Close()

	loader := executionInputTestLoader(t, server.URL)
	wire, err := loader.Load(context.Background(), run)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if wire.RequestID != run.RequestID || wire.ConversationID != run.ConversationID || wire.Trace.TraceID != run.TraceID {
		t.Fatalf("loaded input is not bound to the run: %#v", wire)
	}
}

func TestExecutionInputLoaderRejectsInvalidRunIDBeforeRequest(t *testing.T) {
	run, _ := executionInputTestRun(t)
	run.RunID = "run/invalid"
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		requests.Add(1)
	}))
	defer server.Close()
	loader := executionInputTestLoader(t, server.URL)

	_, err := loader.Load(context.Background(), run)
	if err == nil || execution.InputErrorKind(err) != "execution_input_run_id_invalid" ||
		execution.InputErrorIsRetryable(err) {
		t.Fatalf("error = %v, want non-retryable run_id rejection", err)
	}
	if requests.Load() != 0 {
		t.Fatalf("HTTP requests = %d, want 0", requests.Load())
	}
}

func TestExecutionInputLoaderRejectsRedirects(t *testing.T) {
	run, _ := executionInputTestRun(t)
	var redirectedRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirectedRequests.Add(1)
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Location", target.URL)
		response.WriteHeader(http.StatusFound)
	}))
	defer source.Close()

	_, err := executionInputTestLoader(t, source.URL).Load(context.Background(), run)
	if err == nil || !errors.Is(err, execution.ErrInputRedirect) {
		t.Fatalf("error = %v, want redirect rejection", err)
	}
	if redirectedRequests.Load() != 0 {
		t.Fatalf("redirect target requests = %d, want 0", redirectedRequests.Load())
	}
}

func TestExecutionInputLoaderValidatesResponseHeaders(t *testing.T) {
	tests := []struct {
		name         string
		cacheControl string
		contentType  string
	}{
		{name: "missing no-store", contentType: "application/json"},
		{name: "non-json", cacheControl: "no-store", contentType: "text/plain"},
		{name: "invalid content-type", cacheControl: "no-store", contentType: "not a media type"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			run, body := executionInputTestRun(t)
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				if test.cacheControl != "" {
					response.Header().Set("Cache-Control", test.cacheControl)
				}
				if test.contentType != "" {
					response.Header().Set("Content-Type", test.contentType)
				}
				_, _ = response.Write(body)
			}))
			defer server.Close()

			_, err := executionInputTestLoader(t, server.URL).Load(context.Background(), run)
			if err == nil || execution.InputErrorKind(err) != "execution_input_response_invalid" || execution.InputErrorIsRetryable(err) {
				t.Fatalf("error = %v, want non-retryable invalid response", err)
			}
		})
	}
}

func TestExecutionInputLoaderEnforcesStreamingBodyLimit(t *testing.T) {
	run, _ := executionInputTestRun(t)
	oversized := strings.Repeat("x", int(execution.MaxInputBytes)+1)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Type", "application/json")
		response.(http.Flusher).Flush()
		_, _ = response.Write([]byte(oversized))
	}))
	defer server.Close()

	_, err := executionInputTestLoader(t, server.URL).Load(context.Background(), run)
	if err == nil || execution.InputErrorKind(err) != "execution_input_too_large" || execution.InputErrorIsRetryable(err) {
		t.Fatalf("error = %v, want non-retryable size rejection", err)
	}
}

func TestExecutionInputLoaderHashesRawResponseBeforeDecode(t *testing.T) {
	run, body := executionInputTestRun(t)
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("decode test input: %v", err)
	}
	semanticallyEqual, err := json.MarshalIndent(decoded, "", "  ")
	if err != nil {
		t.Fatalf("re-encode test input: %v", err)
	}
	server := executionInputResponseServer(semanticallyEqual)
	defer server.Close()

	_, err = executionInputTestLoader(t, server.URL).Load(context.Background(), run)
	if err == nil || execution.InputErrorKind(err) != "execution_input_hash_mismatch" {
		t.Fatalf("error = %v, want raw-byte hash mismatch", err)
	}
}

func TestExecutionInputLoaderStrictlyDecodesOneObject(t *testing.T) {
	run, body := executionInputTestRun(t)
	body = append(body, []byte("\n{}")...)
	run.Metadata["execution_input_sha256"] = sha256Hex(body)
	server := executionInputResponseServer(body)
	defer server.Close()

	_, err := executionInputTestLoader(t, server.URL).Load(context.Background(), run)
	if err == nil || execution.InputErrorKind(err) != "execution_input_contract_invalid" {
		t.Fatalf("error = %v, want strict contract rejection", err)
	}
}

func TestExecutionInputLoaderDoesNotIncludeInvalidJSONFieldsInErrors(t *testing.T) {
	run, body := executionInputTestRun(t)
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode test input: %v", err)
	}
	payload["sensitive-body-field"] = true
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode invalid input: %v", err)
	}
	run.Metadata["execution_input_sha256"] = sha256Hex(body)
	server := executionInputResponseServer(body)
	defer server.Close()

	_, err = executionInputTestLoader(t, server.URL).Load(context.Background(), run)
	if err == nil || execution.InputErrorKind(err) != "execution_input_contract_invalid" {
		t.Fatalf("error = %v, want strict contract rejection", err)
	}
	if strings.Contains(err.Error(), "sensitive-body-field") {
		t.Fatalf("error leaked a field from the response body: %v", err)
	}
}

func TestExecutionInputLoaderRejectsRunBindingMismatch(t *testing.T) {
	run, _ := executionInputTestRun(t)
	body := executionInputTestBody(t, run, "different-request")
	run.Metadata["execution_input_sha256"] = sha256Hex(body)
	server := executionInputResponseServer(body)
	defer server.Close()

	_, err := executionInputTestLoader(t, server.URL).Load(context.Background(), run)
	if err == nil || execution.InputErrorKind(err) != "execution_input_binding_mismatch" {
		t.Fatalf("error = %v, want run binding rejection", err)
	}
}

func TestExecutionInputLoaderNeverIncludesErrorResponseBody(t *testing.T) {
	run, _ := executionInputTestRun(t)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusServiceUnavailable)
		_, _ = response.Write([]byte("sensitive-upstream-body"))
	}))
	defer server.Close()

	_, err := executionInputTestLoader(t, server.URL).Load(context.Background(), run)
	if err == nil || !execution.InputErrorIsRetryable(err) {
		t.Fatalf("error = %v, want retryable upstream failure", err)
	}
	if strings.Contains(err.Error(), "sensitive-upstream-body") {
		t.Fatalf("error leaked response body: %v", err)
	}
}

func TestExecutionInputLoaderRejectsAmbiguousBaseURLSuffixes(t *testing.T) {
	for _, suffix := range []string{"?", "#"} {
		t.Run(suffix, func(t *testing.T) {
			_, err := execution.NewInputLoader(config.Config{
				AppAPIExecutionSharedSecret: "input-secret",
				ProductCallbackBaseURL:      "https://app-api.internal" + suffix,
			})
			if err == nil {
				t.Fatalf("base URL suffix %q must be rejected", suffix)
			}
		})
	}
}

func TestReadyzDoesNotExposeExecutionInputCredential(t *testing.T) {
	const secret = "execution-input-secret-must-not-appear"
	server := NewServer(config.Config{
		AppAPIExecutionSharedSecret: secret,
		DeploymentEnvironment:       "local",
	})
	t.Cleanup(func() { _ = server.Shutdown(context.Background()) })
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if strings.Contains(response.Body.String(), secret) {
		t.Fatalf("readiness response exposed the execution input credential: %s", response.Body.String())
	}
}

func executionInputTestLoader(t *testing.T, baseURL string) execution.InputLoader {
	t.Helper()
	loader, err := execution.NewInputLoader(config.Config{
		AppAPIExecutionSharedSecret: "input-secret",
		ProductCallbackBaseURL:      baseURL,
		ProductCallbackTimeoutMS:    2_000,
	})
	if err != nil {
		t.Fatalf("execution.NewInputLoader returned error: %v", err)
	}
	return loader
}

func executionInputTestRun(t *testing.T) (execution.DurableRun, []byte) {
	t.Helper()
	run := execution.DurableRun{
		RunID:          "run-input-001",
		ConversationID: "conversation-input-001",
		RequestID:      "request-input-001",
		TraceID:        "trace-input-001",
		Metadata: map[string]any{
			"execution_contract_version": contracts.ExecutionContractVersion,
			"execution_input_ref":        "app-api://execution-inputs/run-input-001",
		},
	}
	body := executionInputTestBody(t, run, run.RequestID)
	run.Metadata["execution_input_sha256"] = sha256Hex(body)
	return run, body
}

func executionInputTestBody(t *testing.T, run execution.DurableRun, requestID string) []byte {
	t.Helper()
	body, err := json.Marshal(contracts.ExecutionPayloadWire{
		ExecutionContractVersion: contracts.ExecutionContractVersion,
		ResponseContract:         contracts.ResponseContract,
		UserGoal:                 "Find the next campus bus.",
		ConversationID:           run.ConversationID,
		RequestID:                requestID,
		Trace:                    contracts.TraceContextWire{TraceID: run.TraceID},
		Context:                  map[string]any{},
	})
	if err != nil {
		t.Fatalf("marshal execution input: %v", err)
	}
	return body
}

func executionInputResponseServer(body []byte) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write(body)
	}))
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}
