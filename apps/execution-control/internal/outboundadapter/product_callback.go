package outboundadapter

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

// ProductCallbackClient is the typed app-api callback port used by terminal
// Temporal activities. It owns callback URL construction and HTTP policy;
// Temporal owns the surrounding activity error mapping.
type ProductCallbackClient interface {
	WritePersonalMemoryCommandResult(context.Context, PersonalMemoryCommandResultRequest) error
	WriteExecutionFinalization(context.Context, ExecutionFinalizationRequest) error
}

type PersonalMemoryCommandResultRequest struct {
	CommandID         string
	ErrorCode         string
	ResultFingerprint string
	Status            string
}

type ExecutionFinalizationRequest struct {
	RequestID   string
	CompletedAt time.Time
	Response    map[string]any
}

// ProductCallbackError deliberately keeps the response body out of the error
// value. It gives the Temporal adapter stable classification while preserving
// the existing no-diagnostic-details contract.
type ProductCallbackError struct {
	Code  string
	Cause error
}

func (err *ProductCallbackError) Error() string {
	if err == nil || err.Code == "" {
		return "product callback failed"
	}
	return "product callback failed"
}

func (err *ProductCallbackError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}

type productCallbackHTTPClient struct {
	baseURL      string
	sharedSecret string
	httpClient   *http.Client
}

// NewProductCallbackClient constructs the app-api callback owner. Missing
// configuration is reported when the activity invokes the port, matching the
// previous runtime behavior.
func NewProductCallbackClient(cfg config.Config) ProductCallbackClient {
	timeout := time.Duration(cfg.ProductCallbackTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &productCallbackHTTPClient{
		baseURL:      strings.TrimRight(strings.TrimSpace(cfg.ProductCallbackBaseURL), "/"),
		sharedSecret: strings.TrimSpace(cfg.AppAPIExecutionSharedSecret),
		httpClient: NoRedirectHTTPClient(&http.Client{
			Timeout: timeout,
		}),
	}
}

func (client *productCallbackHTTPClient) WritePersonalMemoryCommandResult(
	ctx context.Context,
	request PersonalMemoryCommandResultRequest,
) error {
	resultFingerprint := strings.TrimSpace(request.ResultFingerprint)
	if resultFingerprint == "" {
		return productCallbackError(
			"product_callback_invalid",
			errors.New("personal memory result fingerprint is required"),
		)
	}
	body, err := json.Marshal(map[string]string{
		"error_code":         request.ErrorCode,
		"result_fingerprint": resultFingerprint,
		"status":             request.Status,
	})
	if err != nil {
		return productCallbackError("product_callback_invalid", err)
	}
	callbackURL := client.callbackURL(
		"/api/internal/profile-memory/commands/" + url.PathEscape(request.CommandID) + "/result",
	)
	return client.do(ctx, callbackURL, body)
}

func (client *productCallbackHTTPClient) WriteExecutionFinalization(
	ctx context.Context,
	request ExecutionFinalizationRequest,
) error {
	responseJSON, err := json.Marshal(request.Response)
	if err != nil {
		return productCallbackError("product_callback_invalid", err)
	}
	sum := sha256.Sum256(append([]byte(strings.TrimSpace(request.RequestID)+"\x00"), responseJSON...))
	payload, err := json.Marshal(map[string]any{
		"completed_at":             request.CompletedAt.UTC().Format(time.RFC3339Nano),
		"finalization_fingerprint": hex.EncodeToString(sum[:]),
		"response_json":            string(responseJSON),
	})
	if err != nil {
		return productCallbackError("product_callback_invalid", err)
	}
	callbackURL := client.callbackURL(
		"/api/internal/execution/requests/" + url.PathEscape(request.RequestID) + "/product-finalization",
	)
	return client.do(ctx, callbackURL, payload)
}

func (client *productCallbackHTTPClient) callbackURL(path string) string {
	if client == nil {
		return path
	}
	return client.baseURL + path
}

func (client *productCallbackHTTPClient) do(ctx context.Context, callbackURL string, body []byte) error {
	if client == nil || client.baseURL == "" || client.sharedSecret == "" {
		return productCallbackError(
			"product_callback_not_configured",
			errors.New("app-api product callback is not configured"),
		)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, callbackURL, bytes.NewReader(body))
	if err != nil {
		return productCallbackError("product_callback_invalid", err)
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-app-product-callback-auth", client.sharedSecret)
	response, err := client.httpClient.Do(request)
	if err != nil {
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		return productCallbackError("product_callback_unavailable", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil
	}
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	callbackFailure := fmt.Errorf(
		"product callback status=%d response=%s",
		response.StatusCode,
		strings.TrimSpace(string(responseBody)),
	)
	if response.StatusCode == http.StatusBadRequest ||
		response.StatusCode == http.StatusConflict ||
		response.StatusCode == http.StatusNotFound {
		return productCallbackError("product_callback_rejected", callbackFailure)
	}
	return productCallbackError("product_callback_unavailable", callbackFailure)
}

func productCallbackError(code string, cause error) error {
	return &ProductCallbackError{Code: code, Cause: cause}
}
